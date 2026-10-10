// =============================================================================
// GatewaySettings — GW1 (post-overhaul, 2026-10-10): Settings, Storage, File
// gateway (GATEWAY_DESIGN.md §2, §3, §4, §6, §8, §11; the brief's item 4).
//
// Between Footage locations and the switch, because it is about both: it
// reads the footage where it is (the locations above) and opens the door the
// switch below governs. An admin adds a gateway (a token shown once, the
// cloud's address, the two install stories), confirms its fingerprint (D25),
// downloads its certificate, sets where it is reached from outside and which
// private ranges count as the office (D21), checks its reach (§4), renames
// and forgets it (undoable for a minute), and reads who viewed what from
// outside the office in the last 30 days and what changed. Everyone else
// sees that a gateway exists and that only an admin manages it (the
// switch's rule: usePermissions().role === 'admin'; the database says so too).
//
// Laws of UX that shaped it (design-direction + laws-of-ux, GW1):
//   Tesler's law — the container's mount line for every footage location and
//     the cloud address the gateway is given are computed and shown beside
//     the token, never typed by the admin.
//   Hick's law — the empty state has ONE button, Add a gateway; a gateway's
//     row offers §8's four actions (Download certificate appears only once
//     the fingerprint is confirmed), and the two settings that need editing
//     open in place.
//   Selective attention — one line per gateway (§8's health line); its
//     warnings are set in weight, and the error form (the page's one red,
//     since no red ink passes AA on this ground) is reserved for the office
//     door reached from the internet.
//   Jakob's law — the same Section / Group / Row chrome, the same Edit-in-
//     place and the same button sizes as the Footage locations card above.
//   Doherty threshold — Checking… appears on the click, before any request,
//     and says what it waits for (the gateway's next check-in, then the knock).
//   Peak-end rule — the first time a check reaches the gateway the row says
//     It works: play a clip from outside.
//   Postel's law — an address, a range or a fingerprint is read as people
//     paste it and saved in the database's own spelling (gatewayWords.js).
//   Cognitive bias — Rotate the ticket keys (review round 2, finding 6) is a
//     quiet row with a question before it acts, and says what does not
//     happen (nobody's playback stops) as plainly as what does.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { usePermissions } from '../../permissions'
import { Section, Group, Row } from './SettingsChrome'
import { Button, Dialog, Input, Tabs } from '../../ui'
import {
  listGateways, listEnrolmentTokens, listGatewayAudit, listRemoteViewings, makeEnrolmentToken,
  cancelEnrolmentToken, confirmGatewayFingerprint, fetchRootCertificate, renameGateway,
  setGatewayOutsideAddress, setGatewayOfficeRanges, forgetGateway, unforgetGateway,
  requestGatewayUpdateCheck, checkGatewayReach, gatewayCloudBase, rotateTicketKeys,
} from '../../cloud/gatewayApi'
import {
  GATEWAY_CERT_PARAGRAPH, NAS_STORY, WINDOWS_STORY, GATEWAY_SECTION_DESCRIPTION, GATEWAY_ADMIN_ONLY,
  GATEWAY_EMPTY, TOKEN_SHOWN_ONCE, CLOUD_URL_HINT, FINGERPRINT_PROMPT, FINGERPRINT_OTHER_ADMIN,
  NEW_GATEWAY_NOTICE, OFFICE_RANGES_HINT, OUTSIDE_ADDRESS_HINT, NAME_REFUSAL, FORGET_CONFIRM,
  FORGOTTEN_LINE, IT_WORKS, CHECKING, CERTIFICATE_DOWNLOADED, VIEWED_EMPTY, VIEWED_DESCRIPTION,
  AUDIT_EMPTY, FINGERPRINT_SHAPE, mountPathFor, cloudUrlFor, parseOutsideAddress,
  formatAddress, parseOfficeRanges, normalizeFingerprint, formatFingerprint, agoWords, healthPhrases,
  insideForwardSentence, reachSentence, auditPhrase, howMuchWords, whereWords, whoWords,
  TICKET_KEYS_DESCRIPTION, ROTATE_CONFIRM, ROTATED_LINE, versionWords, gatewayNameWords,
} from './gatewayWords'

// The tokens made in this browser since the app started: §2's notice for a
// gateway "that no admin of this browser enrolled in this session".
const SESSION_TOKENS = new Set()

const PAGE_SIZE = 25
const STORY_PANEL_ID = 's-gw-story-panel'

function whenWords(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function sinceWords(iso, now) {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? `${agoWords((now - t) / 1000)} ago` : 'just now'
}

function downloadPem(name, pem) {
  const safe = String(name || 'gateway').replace(/[^A-Za-z0-9 _-]+/g, '').trim() || 'gateway'
  const url = URL.createObjectURL(new Blob([pem], { type: 'application/x-x509-ca-cert' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${safe} root certificate.crt`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { setCopied(false) }
  }
  return <Button surface="light" size="sm" onClick={copy} aria-label={label}>{copied ? 'Copied' : 'Copy'}</Button>
}

function Phrase({ p }) {
  if (!p.strong || !p.text.includes(p.strong)) return <span className="s-gw-phrase" data-tone={p.tone}>{p.text}</span>
  const at = p.text.indexOf(p.strong)
  return (
    <span className="s-gw-phrase" data-tone={p.tone}>
      {p.text.slice(0, at)}<b>{p.strong}</b>{p.text.slice(at + p.strong.length)}
    </span>
  )
}

// ── §11: the two install stories, verbatim, with the mount lines computed ──

function Story({ story, locations }) {
  return (
    <div className="s-gw-story">
      {story.intro && <p>{story.intro}</p>}
      <ol>
        {story.steps.map((s) => (
          <li key={s.lead}>
            <b>{s.lead}</b> {s.text}
            {s.items && (
              <ul>
                {s.items.map((it) => (
                  <li key={it.lead}>
                    <b>{it.lead}</b> {it.text}
                    {it.mounts && (
                      <ul className="s-gw-mounts" aria-label="Your footage locations, mounted">
                        {locations.length === 0 && <li>No footage location is named yet: name one in Footage locations above, and its line appears here.</li>}
                        {locations.map((loc) => (
                          <li key={loc.id}>
                            {loc.name} (<span className="s-data">{loc.unc_path}</span>): the share&apos;s folder on the NAS → <span className="s-data">{mountPathFor(loc.unc_path)}</span>, read-only
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {(story.after || []).map((a) => (
        <p key={a.text.slice(0, 24)}>{a.lead && <b>{a.lead}</b>}{a.text}</p>
      ))}
    </div>
  )
}

function TokenPanel({ panel, locations, onDone }) {
  const [tab, setTab] = useState('nas')
  const cloudUrl = cloudUrlFor(gatewayCloudBase())
  return (
    <Group label="Add a gateway">
      <div className="s-row" data-stacked="true" data-testid="gateway-token">
        <div className="s-row-label">
          <span className="s-label">Enrolment token</span>
          <p className="s-row-desc">{TOKEN_SHOWN_ONCE}</p>
        </div>
        <div className="s-row-control">
          <code className="s-gw-token">{panel.token}</code>
          <CopyButton text={panel.token} label="Copy the enrolment token" />
        </div>
      </div>
      <div className="s-row" data-stacked="true">
        <div className="s-row-label">
          <span className="s-label">WILSON cloud</span>
          <p className="s-row-desc">{CLOUD_URL_HINT}</p>
        </div>
        <div className="s-row-control">
          <code className="s-gw-token" data-size="small">{cloudUrl || 'This build has no cloud address.'}</code>
          {cloudUrl && <CopyButton text={cloudUrl} label="Copy the WILSON cloud address" />}
        </div>
      </div>
      <div className="s-row" data-stacked="true">
        <Tabs surface="light" label="Where the gateway runs" panelId={STORY_PANEL_ID} value={tab} onChange={setTab}
          items={[{ id: 'nas', label: 'On a NAS' }, { id: 'windows', label: 'On a Windows PC' }]} />
        <div id={STORY_PANEL_ID} role="tabpanel">
          <Story story={tab === 'nas' ? NAS_STORY : WINDOWS_STORY} locations={locations} />
        </div>
        <p className="s-row-desc s-gw-cert">
          {GATEWAY_CERT_PARAGRAPH.map((part, i) => (typeof part === 'string' ? part : <em key={i}>{part.em}</em>))}
        </p>
        <div className="s-row-control">
          <Button surface="light" size="sm" onClick={onDone}>Done</Button>
          <span className="s-row-desc">The token stays valid until it is used or 24 hours pass; cancel it below if it is not needed.</span>
        </div>
      </div>
    </Group>
  )
}

// ── One gateway ─────────────────────────────────────────────────────────────

function GatewayRow({ gw, now, locations, me, fromThisBrowser, appeared, onChanged, onForget }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null) // { text, tone }
  const [editing, setEditing] = useState(null) // 'name' | 'address' | 'ranges'
  const [draft, setDraft] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [check, setCheck] = useState(null) // { running } | { result, wasOk }
  const confirmed = !!gw.root_confirmed_at
  const mine = gw.created_by && gw.created_by === me
  const insideForward = insideForwardSentence(gw)
  const phrases = healthPhrases(gw, { now, locations })

  const act = async (what, fn, after) => {
    setBusy(what); setError(null); setNote(null)
    const res = await fn()
    setBusy(null)
    if (!res.ok) { setError(res.friendly); return res }
    if (after) after(res)
    onChanged()
    return res
  }

  const open = (which) => {
    setEditing(which); setError(null); setNote(null)
    setDraft(which === 'name' ? gw.name : which === 'address' ? formatAddress(gw.outside_address) : (gw.office_ranges || []).join(', '))
  }

  const save = async () => {
    if (editing === 'name') {
      const name = draft.trim()
      if (name.length < 1 || name.length > 80) { setError(NAME_REFUSAL); return }
      if (name === gw.name) { setEditing(null); return }
      await act('save', () => renameGateway(gw.id, name), () => setEditing(null))
    } else if (editing === 'address') {
      const p = parseOutsideAddress(draft)
      if (!p.ok) { setError(p.problem); return }
      setDraft(formatAddress(p.value))
      await act('save', () => setGatewayOutsideAddress(gw.id, p.value), () => { setEditing(null); setCheck(null) })
    } else if (editing === 'ranges') {
      const p = parseOfficeRanges(draft)
      if (!p.ok) { setError(p.problem); return }
      setDraft(p.value.join(', '))
      await act('save', () => setGatewayOfficeRanges(gw.id, p.value), () => setEditing(null))
    }
  }

  const removeAddress = () => act('save', () => setGatewayOutsideAddress(gw.id, null), () => { setEditing(null); setCheck(null) })

  const confirmFp = async () => {
    const fp = normalizeFingerprint(fingerprint)
    if (!fp) { setError(FINGERPRINT_SHAPE); return }
    await act('confirm', () => confirmGatewayFingerprint(gw.id, fp), () => {
      setFingerprint('')
      setNote({ text: 'Confirmed: this is your gateway. Download certificate is ready.', tone: 'ok' })
    })
  }

  const download = () => act('certificate', () => fetchRootCertificate(gw.id), (res) => {
    downloadPem(gw.name, res.data)
    setNote({ text: CERTIFICATE_DOWNLOADED, tone: 'ok' })
  })

  const runCheck = async () => {
    setError(null); setNote(null)
    if (!gw.outside_address) {
      setCheck(null)
      setError('Give the gateway its outside address first: the public name or address people outside the office will reach it at.')
      return
    }
    const wasOk = gw.reach_ok === true
    setCheck({ running: true })
    const res = await checkGatewayReach(gw.id)
    if (!res.ok) { setCheck(null); setError(res.friendly); return }
    setCheck({ result: res.data, wasOk })
    onChanged()
  }

  const askUpdate = () => act('update', () => requestGatewayUpdateCheck(gw.id), () => setNote({ text: 'Asked. The gateway checks for an update at its next check-in, within ten seconds.', tone: 'ok' }))

  const said = check?.result ? reachSentence(check.result, gw, { now }) : null
  const firstSuccess = said && check.result?.outside?.detail === 'reached' && !check.wasOk && said.inside?.tone !== 'error'

  // §8: the name, the health line, and "under the line: Download
  // certificate, Check reach, Rename, Forget" — so the row is stacked, and
  // the line gets the column's whole measure.
  return (
    <div className="s-row" data-stacked="true" data-gateway-row={gw.id}>
      <div className="s-row-label">
        {editing === 'name' ? (
          <div className="flex gap-2 flex-wrap items-center">
            <Input surface="light" size="sm" aria-label="Gateway name" value={draft} onChange={setDraft} autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') save() }} className="min-w-[200px]" />
            <Button surface="light" size="sm" variant="primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
            <Button surface="light" size="sm" variant="ghost" onClick={() => { setEditing(null); setError(null) }} disabled={!!busy}>Cancel</Button>
          </div>
        ) : <span className="s-card-title">{gatewayNameWords(gw.name)}</span>}
        <p className="s-row-desc s-gw-line" data-testid="gateway-health">
          {phrases.map((p, i) => (
            <span key={i}>{i > 0 && ' · '}<Phrase p={p} /></span>
          ))}
        </p>
        {insideForward && <p className="s-feedback" data-tone="error" role="alert">{insideForward}</p>}
      </div>
      <div className="s-row-control">
        {confirmed && (
          <Button surface="light" size="sm" onClick={download} disabled={!!busy}
            title="The gateway's root certificate, to install once on each office computer as a trusted root.">
            {busy === 'certificate' ? 'Fetching…' : 'Download certificate'}
          </Button>
        )}
        <Button surface="light" size="sm" onClick={runCheck} disabled={!!busy || !!check?.running}
          title="WILSON knocks on the outside address from the internet and says, in words, what answered.">
          {check?.running ? 'Checking…' : 'Check reach'}
        </Button>
        <Button surface="light" size="sm" variant="ghost" onClick={() => open('name')} disabled={!!busy}>Rename</Button>
        <Button surface="light" size="sm" variant="ghost" onClick={() => onForget(gw)} disabled={!!busy}
          title="Stop this gateway at once. Undoable for one minute.">
          Forget
        </Button>
      </div>
      <div className="s-gw-detail">
        {check?.running && <p className="s-feedback" role="status">{CHECKING}</p>}
        {said?.inside?.tone === 'error' && <p className="s-feedback" data-tone="error" role="alert">{said.inside.text}</p>}
        {said && <p className="s-feedback" data-tone={said.tone} role="status">{said.text}</p>}
        {said?.inside && said.inside.tone !== 'error' && <p className="s-feedback">{said.inside.text}</p>}
        {firstSuccess && <p className="s-feedback s-gw-peak" data-tone="ok">{IT_WORKS}</p>}
        {note && <p className="s-feedback" data-tone={note.tone}>{note.text}</p>}
        {error && <p className="s-feedback" data-tone="error" role="alert">{error}</p>}
        {appeared && <p className="s-feedback" data-tone="ok">“{gatewayNameWords(gw.name)}” appeared just now, and the token is spent.</p>}
        {!confirmed && !fromThisBrowser && !appeared && (
          <p className="s-feedback" data-tone="warning">{NEW_GATEWAY_NOTICE(sinceWords(gw.created_at, now))}</p>
        )}
        {!confirmed && (mine ? (
          <div className="s-well">
            <label className="s-label" htmlFor={`s-gw-fp-${gw.id}`}>Certificate fingerprint</label>
            <p className="s-row-desc">{FINGERPRINT_PROMPT}</p>
            <div className="flex gap-2 flex-wrap items-center">
              <Input surface="light" size="sm" id={`s-gw-fp-${gw.id}`} value={fingerprint} onChange={setFingerprint}
                onBlur={() => { const fp = normalizeFingerprint(fingerprint); if (fp) setFingerprint(formatFingerprint(fp)) }}
                onKeyDown={(e) => { if (e.key === 'Enter') confirmFp() }}
                placeholder="5A:C1:F4:…" className="flex-1 min-w-[260px] s-data" />
              <Button surface="light" size="sm" variant="primary" onClick={confirmFp} disabled={!!busy || !fingerprint.trim()}>
                {busy === 'confirm' ? 'Confirming…' : 'Confirm'}
              </Button>
            </div>
          </div>
        ) : <p className="s-row-desc">{FINGERPRINT_OTHER_ADMIN}</p>)}

        <dl className="s-gw-props">
          <dt className="s-label">Outside address</dt>
          <dd>
            {editing === 'address' ? (
              <span className="s-gw-edit">
                <Input surface="light" size="sm" aria-label="Outside address" value={draft} onChange={setDraft} autoFocus
                  onBlur={() => { const p = parseOutsideAddress(draft); if (p.ok) setDraft(formatAddress(p.value)) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') save() }}
                  placeholder="gateway.yourcompany.com:8444" className="min-w-[240px] s-data" />
                <Button surface="light" size="sm" variant="primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
                {gw.outside_address && <Button surface="light" size="sm" variant="ghost" onClick={removeAddress} disabled={!!busy}>Remove</Button>}
                <Button surface="light" size="sm" variant="ghost" onClick={() => { setEditing(null); setError(null) }} disabled={!!busy}>Cancel</Button>
                <span className="s-row-desc">{OUTSIDE_ADDRESS_HINT}</span>
              </span>
            ) : (
              <>
                <span className="s-data">{gw.outside_address ? formatAddress(gw.outside_address) : 'none'}</span>
                {' '}<Button surface="light" size="sm" variant="ghost" onClick={() => open('address')} disabled={!!busy}>{gw.outside_address ? 'Change' : 'Set'}</Button>
              </>
            )}
          </dd>
          <dt className="s-label">Office ranges</dt>
          <dd>
            {editing === 'ranges' ? (
              <span className="s-gw-edit">
                <Input surface="light" size="sm" aria-label="Office ranges" value={draft} onChange={setDraft} autoFocus
                  onBlur={() => { const p = parseOfficeRanges(draft); if (p.ok) setDraft(p.value.join(', ')) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') save() }}
                  placeholder="10.8.0.0/16, 192.168.20.0/24" className="min-w-[260px] s-data" />
                <Button surface="light" size="sm" variant="primary" onClick={save} disabled={!!busy}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
                <Button surface="light" size="sm" variant="ghost" onClick={() => { setEditing(null); setError(null) }} disabled={!!busy}>Cancel</Button>
                <span className="s-row-desc">{OFFICE_RANGES_HINT}</span>
              </span>
            ) : (
              <>
                <span className="s-data">{(gw.office_ranges || []).length ? gw.office_ranges.join(', ') : 'none besides its own network'}</span>
                {' '}<Button surface="light" size="sm" variant="ghost" onClick={() => open('ranges')} disabled={!!busy}>Change</Button>
              </>
            )}
          </dd>
          {gw.platform === 'windows' && (
            <>
              <dt className="s-label">Updates</dt>
              <dd>
                <span>It updates itself once a day.</span>
                {' '}<Button surface="light" size="sm" variant="ghost" onClick={askUpdate} disabled={!!busy}>{busy === 'update' ? 'Asking…' : 'Check now'}</Button>
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  )
}

function ForgottenRow({ gw, now, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const left = Math.max(0, Math.ceil(60 - (now - Date.parse(gw.revoked_at)) / 1000))
  const undo = async () => {
    setBusy(true); setError(null)
    const res = await unforgetGateway(gw.id)
    setBusy(false)
    if (!res.ok) { setError(res.friendly); return }
    onChanged()
  }
  return (
    <div className="s-row" data-gateway-row={gw.id} data-forgotten="true">
      <div className="s-row-label">
        <span className="s-card-title">{gatewayNameWords(gw.name)}</span>
        <p className="s-row-desc">{FORGOTTEN_LINE}</p>
        {error && <p className="s-feedback" data-tone="error" role="alert">{error}</p>}
      </div>
      <div className="s-row-control">
        {left > 0 && (
          <Button surface="light" size="sm" variant="primary" onClick={undo} disabled={busy}>
            {busy ? 'Undoing…' : `Undo (${left} s)`}
          </Button>
        )}
      </div>
    </div>
  )
}

// ── The viewings and the trail ──────────────────────────────────────────────

function ViewedFromOutside({ viewings, error, page, onPage }) {
  const rows = viewings?.rows || []
  const total = viewings?.total || 0
  const from = page * PAGE_SIZE
  return (
    <Group label="Viewed from outside the office">
      <p className="s-row-desc s-gw-group-desc">{VIEWED_DESCRIPTION}</p>
      {error && <p className="s-feedback" data-tone="error" role="alert">{error}</p>}
      {!error && viewings && rows.length === 0 && <Row label="None" description={VIEWED_EMPTY} />}
      {rows.length > 0 && (
        <div className="s-gw-table-wrap">
          <table className="s-table s-gw-table" data-testid="gateway-viewings">
            <colgroup>
              <col style={{ width: '13%' }} />
              <col style={{ width: '17%' }} />
              <col style={{ width: '27%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '23%' }} />
            </colgroup>
            <thead>
              <tr><th>When</th><th>Who</th><th>Clip and project</th><th>How much</th><th>From where, through</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="s-data">{whenWords(r.created_at)}</td>
                  <td>{whoWords(r)}</td>
                  <td><span className="s-data s-gw-clip">{r.file_name || 'a clip removed since'}</span><br />{r.project_title || 'a project you cannot open'}</td>
                  <td>{howMuchWords(r.details || {})}</td>
                  <td>{whereWords(r.details || {})}<br />through {r.details?.gateway_name ? gatewayNameWords(r.details.gateway_name) : 'a gateway forgotten since'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {total > PAGE_SIZE && (
        <div className="s-row">
          <div className="s-row-label"><span className="s-row-desc">{from + 1}–{Math.min(from + PAGE_SIZE, total)} of {total}</span></div>
          <div className="s-row-control">
            <Button surface="light" size="sm" variant="ghost" onClick={() => onPage(page - 1)} disabled={page === 0}>Newer</Button>
            <Button surface="light" size="sm" variant="ghost" onClick={() => onPage(page + 1)} disabled={from + PAGE_SIZE >= total}>Older</Button>
          </div>
        </div>
      )}
    </Group>
  )
}

function Changes({ rows, error, nameFor }) {
  return (
    <Group label="Changes">
      {error && <p className="s-feedback" data-tone="error" role="alert">{error}</p>}
      {!error && rows.length === 0 && <Row label="None" description={AUDIT_EMPTY} />}
      {rows.length > 0 && (
        <ul className="s-gw-audit" data-testid="gateway-audit">
          {rows.map((a) => (
            <li key={a.id}><span className="s-data">{whenWords(a.created_at)}</span> {auditPhrase(a, nameFor(a))}</li>
          ))}
        </ul>
      )}
    </Group>
  )
}

// ── The section ─────────────────────────────────────────────────────────────

export function GatewaySection() {
  const ctx = useRabbit()
  const perms = usePermissions()
  // Nothing is read before the role is known: a member's read and an admin's
  // are different tables.
  const ready = perms.ready !== false
  const admin = perms.role === 'admin'
  const locations = useMemo(() => [...(ctx?.binLocations || [])].sort((a, b) => String(a.name).localeCompare(String(b.name))), [ctx?.binLocations])
  const refreshBinLocations = ctx?.refreshBinLocations

  const [gateways, setGateways] = useState(null)
  const [tokens, setTokens] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [now, setNow] = useState(() => Date.now())
  const [panel, setPanel] = useState(null)
  const [panelError, setPanelError] = useState(null)
  const [making, setMaking] = useState(false)
  const [appeared, setAppeared] = useState(null)
  const [auditRows, setAuditRows] = useState([])
  const [auditError, setAuditError] = useState(null)
  const [page, setPage] = useState(0)
  const [viewings, setViewings] = useState(null)
  const [viewError, setViewError] = useState(null)
  const [forgetting, setForgetting] = useState(null)
  const [forgetBusy, setForgetBusy] = useState(false)
  const [forgetError, setForgetError] = useState(null)
  const [tokenError, setTokenError] = useState(null)
  const [rotating, setRotating] = useState(false)
  const [rotateBusy, setRotateBusy] = useState(false)
  const [rotateError, setRotateError] = useState(null)
  const [rotated, setRotated] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  const refresh = useCallback(async () => {
    if (!ready) return
    const t = Date.now()
    const g = await listGateways({ admin, now: t })
    if (!mounted.current) return
    if (g.ok) { setGateways(g.data || []); setLoadError(null) } else setLoadError(g.friendly)
    if (admin) {
      const tk = await listEnrolmentTokens({ now: t })
      if (mounted.current && tk.ok) setTokens(tk.data || [])
    }
    if (mounted.current) setNow(Date.now())
  }, [admin, ready])

  const refreshAudit = useCallback(async () => {
    if (!admin || !ready) return
    const a = await listGatewayAudit({ limit: 20 })
    if (!mounted.current) return
    if (a.ok) { setAuditRows(a.data || []); setAuditError(null) } else setAuditError(a.friendly)
  }, [admin, ready])

  const loadViewings = useCallback(async (p) => {
    if (!admin || !ready) return
    const v = await listRemoteViewings({ page: p, pageSize: PAGE_SIZE })
    if (!mounted.current) return
    if (v.ok) { setViewings(v.data); setViewError(null) } else setViewError(v.friendly)
  }, [admin, ready])

  const changed = useCallback(() => { refresh(); refreshAudit() }, [refresh, refreshAudit])

  // On arrival: the gateways, the trail, the first page of viewings, and the
  // company's locations (the mount lines and the per-location reach).
  useEffect(() => {
    refresh(); refreshAudit()
    Promise.resolve(refreshBinLocations?.()).catch(() => {})
  }, [refresh, refreshAudit, refreshBinLocations])
  useEffect(() => { loadViewings(page) }, [loadViewings, page])

  const anyForgotten = (gateways || []).some(g => g.revoked_at)
  // A gateway checks in every ten seconds, so the list is read as often;
  // every three while a token waits to be spent (§11: "within ten seconds the
  // gateway appears on this page"). Not while the page is hidden.
  useEffect(() => {
    const ms = panel ? 3000 : 10000
    const id = setInterval(() => { if (typeof document === 'undefined' || !document.hidden) refresh() }, ms)
    return () => clearInterval(id)
  }, [panel, refresh])
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), anyForgotten ? 1000 : 5000)
    return () => clearInterval(id)
  }, [anyForgotten])

  // §11 step 4: the token on this page disappears once a gateway spends it.
  useEffect(() => {
    if (!panel) return
    const used = tokens.find(t => t.id === panel.id && t.used_at)
    if (used) { setAppeared(used.gateway_id); setPanel(null); refreshAudit() }
  }, [tokens, panel, refreshAudit])

  const add = async () => {
    setMaking(true); setPanelError(null); setAppeared(null)
    const res = await makeEnrolmentToken()
    setMaking(false)
    if (!res.ok) { setPanelError(res.friendly); return }
    SESSION_TOKENS.add(res.data.id)
    setPanel(res.data)
    refresh(); refreshAudit()
  }

  const cancelToken = async (id) => {
    setTokenError(null)
    const res = await cancelEnrolmentToken(id)
    if (!res.ok) { setTokenError(res.friendly); return }
    if (panel?.id === id) setPanel(null)
    changed()
  }

  const doForget = async () => {
    setForgetBusy(true); setForgetError(null)
    const res = await forgetGateway(forgetting.id)
    setForgetBusy(false)
    if (!res.ok) { setForgetError(res.friendly); return }
    setForgetting(null)
    changed()
  }

  const doRotate = async () => {
    setRotateBusy(true); setRotateError(null)
    const res = await rotateTicketKeys()
    setRotateBusy(false)
    if (!res.ok) { setRotateError(res.friendly); return }
    setRotating(false); setRotated(true)
    refreshAudit()
  }

  const fromThisBrowser = (g) => tokens.some(t => t.gateway_id === g.id && SESSION_TOKENS.has(t.id))
  const nameFor = (row) => (gateways || []).find(g => g.id === row.gateway_id)?.name || row.details?.name || null
  const pending = tokens.filter(t => !t.used_at && Date.parse(t.expires_at) > now && t.id !== panel?.id)
  const live = (gateways || []).filter(g => !g.revoked_at)
  const forgotten = (gateways || []).filter(g => g.revoked_at)
  // Hick: before the company's first gateway the card is the one button.
  const hadGateway = live.length > 0 || forgotten.length > 0 || !!panel

  if (!ready) return null

  if (!admin) {
    return (
      <Section title="File gateway" description={GATEWAY_SECTION_DESCRIPTION}>
        <Group label="Gateways">
          {loadError && <p className="s-feedback" data-tone="error" role="alert">{loadError}</p>}
          {gateways && gateways.length === 0 && <Row label="None yet" description={GATEWAY_ADMIN_ONLY} />}
          {(gateways || []).map((g) => {
            const t = Date.parse(g.last_seen_at)
            const s = Number.isFinite(t) ? (now - t) / 1000 : null
            return (
              <div className="s-row" key={g.id} data-gateway-row={g.id}>
                <div className="s-row-label">
                  <span className="s-card-title">{gatewayNameWords(g.name)}</span>
                  <p className="s-row-desc">{[versionWords(g.version), s === null ? 'never seen' : s < 5 ? 'seen just now' : s < 30 ? `seen ${agoWords(s)} ago` : `not seen for ${agoWords(s)}`].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
            )
          })}
        </Group>
        {gateways && gateways.length > 0 && <p className="s-row-desc">{GATEWAY_ADMIN_ONLY}</p>}
      </Section>
    )
  }

  const addButton = (
    <Button surface="light" size="sm" variant={live.length === 0 ? 'primary' : undefined} onClick={add} disabled={making}>
      {making ? 'Making a token…' : 'Add a gateway'}
    </Button>
  )

  return (
    <Section title="File gateway" description={GATEWAY_SECTION_DESCRIPTION}>
      <Group label="Gateways" actions={live.length > 0 && !panel ? addButton : null}>
        {loadError && <p className="s-feedback" data-tone="error" role="alert">{loadError}</p>}
        {gateways && live.length === 0 && forgotten.length === 0 && !panel && (
          <div className="s-row" data-testid="gateway-empty">
            <div className="s-row-label">
              <span className="s-label">None yet</span>
              <p className="s-row-desc">{GATEWAY_EMPTY}</p>
            </div>
            <div className="s-row-control">{addButton}</div>
          </div>
        )}
        {!gateways && !loadError && <Row label="Reading…" />}
        {panel && live.length === 0 && (
          <Row label="Waiting for the gateway" description="It appears here within ten seconds of starting with the token below, and the token disappears." />
        )}
        {live.map((g) => (
          <GatewayRow key={g.id} gw={g} now={now} locations={locations} me={perms.userId}
            fromThisBrowser={fromThisBrowser(g)} appeared={appeared === g.id}
            onChanged={changed} onForget={(x) => { setForgetError(null); setForgetting(x) }} />
        ))}
        {forgotten.map((g) => <ForgottenRow key={g.id} gw={g} now={now} onChanged={changed} />)}
        {panelError && <p className="s-feedback" data-tone="error" role="alert">{panelError}</p>}
      </Group>

      {panel && <TokenPanel panel={panel} locations={locations} onDone={() => setPanel(null)} />}

      {pending.length > 0 && (
        <Group label="Unused tokens">
          {pending.map((t) => (
            <Row key={t.id} label="Waiting for a gateway"
              description={`Made ${sinceWords(t.created_at, now)}; works until ${whenWords(t.expires_at)}. The token itself is not shown again.`}>
              <Button surface="light" size="sm" variant="ghost" onClick={() => cancelToken(t.id)}>Cancel</Button>
            </Row>
          ))}
          {tokenError && <p className="s-feedback" data-tone="error" role="alert">{tokenError}</p>}
        </Group>
      )}

      {live.length > 0 && (
        <Group label="Ticket keys">
          <Row label="Signing key" description={TICKET_KEYS_DESCRIPTION}>
            <Button surface="light" size="sm" variant="ghost" onClick={() => { setRotateError(null); setRotated(false); setRotating(true) }}>
              Rotate the ticket keys
            </Button>
          </Row>
          {rotated && <p className="s-feedback" data-tone="ok" role="status">{ROTATED_LINE}</p>}
        </Group>
      )}

      {(hadGateway || (viewings?.total || 0) > 0 || viewError) && (
        <ViewedFromOutside viewings={viewings} error={viewError} page={page} onPage={(p) => setPage(Math.max(0, p))} />
      )}
      {(hadGateway || auditRows.length > 0 || auditError) && <Changes rows={auditRows} error={auditError} nameFor={nameFor} />}

      {forgetting && (
        <Dialog
          title="Forget this gateway"
          width="confirm"
          busy={forgetBusy}
          error={forgetError}
          onClose={() => setForgetting(null)}
          footer={(
            <>
              <Button disabled={forgetBusy} onClick={() => setForgetting(null)}>Cancel</Button>
              <Button variant="danger" disabled={forgetBusy} onClick={doForget}>{forgetBusy ? 'Forgetting…' : 'Forget'}</Button>
            </>
          )}
        >
          <p>{FORGET_CONFIRM(forgetting.name)}</p>
        </Dialog>
      )}

      {rotating && (
        <Dialog
          title="Rotate the ticket keys"
          width="confirm"
          busy={rotateBusy}
          error={rotateError}
          onClose={() => setRotating(false)}
          footer={(
            <>
              <Button disabled={rotateBusy} onClick={() => setRotating(false)}>Cancel</Button>
              <Button variant="primary" disabled={rotateBusy} onClick={doRotate}>{rotateBusy ? 'Rotating…' : 'Rotate'}</Button>
            </>
          )}
        >
          <p>{ROTATE_CONFIRM}</p>
        </Dialog>
      )}
    </Section>
  )
}
