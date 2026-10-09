// =============================================================================
// FootageSettings — Bins on the cloud, the desktop signed in (BC2, items 2 + 7).
//
// Two sections of Settings, Storage, shown while signed in to a company:
//
//   FootageLocationsSection — the company's footage locations: a share on the
//     office network, saved by its network address and named once (B2).
//     Add, rename, re-address, remove (refused with its sentence while clips
//     use it); per computer, "Where is it on this computer?" for a share this
//     computer sees only as a drive letter (B2's fallback, kept in this
//     computer's settings, never the cloud).
//   RemoteViewingSection — the company's switch (B5a): "Allow files to be
//     viewed from outside the office network", admins only, off by default,
//     with the storage design §4b sentence at the switch. Everyone else sees
//     its state and why they cannot change it. Undoable (the app's toast).
//
// Laws of UX that shaped it (design-direction + laws-of-ux, BC2):
//   Mental model — a location is written exactly as Explorer shows a share,
//     in the data mono, so a person pastes what they already see.
//   Postel's law — the address field reads \\nas\footage, //nas/footage,
//     smb://nas/footage, quotes and a trailing backslash as the one shape the
//     database stores, then refuses exactly what the database refuses, with
//     the database's sentence, before any request.
//   Common region / chunking — where the footage is and who may view it from
//     outside are two sections: two questions, two owners (anyone may name a
//     share; only an admin may open the office up).
//   Hick's law — a row offers Edit and Remove; the per-computer question
//     appears only where it is needed (this computer cannot reach the share,
//     or a folder is already saved for it).
//   Proximity — the TPN sentence sits directly under the switch's own label,
//     not in a manual (§4b point 2: "at the point of the switch").
//   Cognitive bias — off by default; the consequence is stated before the
//     click, and the click is undoable, rather than a confirm that gets
//     clicked through.
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { usePermissions } from '../../permissions'
import { useWorkspaceMembers } from '../TeamMembers/useWorkspaceMembers'
import { BINS_REFUSALS } from '../../tools/rabbit_v0.1.0/adapters/supabaseAdapter'
import {
  isUncPath, normalizeUncInput, addedByName, locationReachWords, CONNECT_LABEL, CONNECT_TITLE,
} from '../../tools/rabbit_v0.1.0/bins/binLocations'
import { Section, Group, Row } from './SettingsChrome'
import { Button, Input, Switch } from '../../ui'
// B5a's control and the §4b sentence: one place, so Help quotes them exactly.
import { REMOTE_VIEWING_LABEL, REMOTE_VIEWING_TPN_SENTENCE } from '../../tools/rabbit_v0.1.0/bins/cloudPosters'

// The sentence a person reads, without the backend's bracketed prefix.
function said(e) {
  return String(e?.message || e || '').replace(/^\[(supabase|localServer)\]\s*/, '')
}

// The checks the database makes, made first (the field is still there).
function locationProblem({ name, unc_path }, locations, exceptId = null) {
  if (!String(name || '').trim()) return BINS_REFUSALS.locationName
  if (!isUncPath(unc_path)) return BINS_REFUSALS.locationShape
  const clash = (locations || []).some(l => l.id !== exceptId && String(l.unc_path || '').toLowerCase() === unc_path.toLowerCase())
  if (clash) return BINS_REFUSALS.locationExists
  return null
}

export function FootageLocationsSection() {
  const ctx = useRabbit()
  const { members } = useWorkspaceMembers()
  const locations = useMemo(() => [...(ctx?.binLocations || [])].sort((a, b) => String(a.name).localeCompare(String(b.name))), [ctx?.binLocations])
  const statusById = useMemo(() => new Map((ctx?.binsInfo?.locations || []).map(s => [s.id, s])), [ctx?.binsInfo?.locations])
  const desktop = !!ctx?.binsDesktopFiles
  const refreshBinLocations = ctx?.refreshBinLocations

  // The list is the company's, open project or not: read it on arrival.
  useEffect(() => { refreshBinLocations?.().catch(() => {}) }, [refreshBinLocations])

  const [draft, setDraft] = useState({ name: '', unc_path: '' })
  const [addError, setAddError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null) // { id, name, unc_path }
  const [rowError, setRowError] = useState({}) // id → sentence
  const [rowBusy, setRowBusy] = useState(null)

  const add = async () => {
    const row = { name: draft.name.trim(), unc_path: normalizeUncInput(draft.unc_path) }
    setDraft(d => ({ ...d, unc_path: row.unc_path }))
    const problem = locationProblem(row, locations)
    if (problem) { setAddError(problem); return }
    setAdding(true); setAddError(null)
    let created = null
    try {
      created = await ctx.addBinLocation(row)
      setDraft({ name: '', unc_path: '' })
    } catch (e) { setAddError(said(e)) }
    finally { setAdding(false) }
    // Review round 1: on the desktop, the person who just typed the address
    // is asked at once whether THIS computer may connect to it (the desktop's
    // own confirmation, naming the address). Cancel leaves it unconnected.
    if (created?.id && desktop && typeof ctx.connectBinLocation === 'function') {
      await run(created.id, () => ctx.connectBinLocation(created.id))
    }
  }

  const saveEdit = async () => {
    const loc = locations.find(l => l.id === editing.id)
    const next = { name: editing.name.trim(), unc_path: normalizeUncInput(editing.unc_path) }
    const problem = locationProblem(next, locations, editing.id)
    if (problem) { setRowError(r => ({ ...r, [editing.id]: problem })); return }
    const patch = {}
    if (next.name !== loc?.name) patch.name = next.name
    if (next.unc_path !== loc?.unc_path) patch.unc_path = next.unc_path
    if (!Object.keys(patch).length) { setEditing(null); return }
    setRowBusy(editing.id)
    try {
      await ctx.updateBinLocation(editing.id, patch)
      setRowError(r => ({ ...r, [editing.id]: null }))
      setEditing(null)
    } catch (e) { setRowError(r => ({ ...r, [editing.id]: said(e) })) }
    finally { setRowBusy(null) }
  }

  const run = async (id, fn) => {
    setRowBusy(id); setRowError(r => ({ ...r, [id]: null }))
    try { await fn() } catch (e) { setRowError(r => ({ ...r, [id]: said(e) })) }
    finally { setRowBusy(null) }
  }

  return (
    <Section
      title="Footage locations"
      description="Where the company's footage lives: a share on the office network, saved once by its network address and named. Clips are read on the share where they are; nothing is copied to this computer, and everyone in the company sees the same list."
    >
      <Group label="Locations">
        {locations.length === 0 && (
          <Row label="None yet" description={'Add the share your footage lives on by its network address, like \\\\server\\footage. Every clip added from it is read where it is.'} />
        )}
        {locations.map(loc => {
          const st = statusById.get(loc.id) || null
          const reach = desktop ? locationReachWords(st) : null
          const who = addedByName(loc.added_by, members)
          const busy = rowBusy === loc.id
          const err = rowError[loc.id]
          if (editing?.id === loc.id) {
            return (
              <div key={loc.id} className="s-row" data-stacked="true" data-location-row={loc.id}>
                <div className="flex gap-2 flex-wrap">
                  <Input surface="light" size="sm" aria-label="Location name" value={editing.name} onChange={v => setEditing(e => ({ ...e, name: v }))} placeholder="Footage NAS" className="flex-1 min-w-[160px]" autoFocus />
                  <Input surface="light" size="sm" aria-label="Network address" value={editing.unc_path} onChange={v => setEditing(e => ({ ...e, unc_path: v }))}
                    onBlur={() => setEditing(e => (e ? { ...e, unc_path: normalizeUncInput(e.unc_path) } : e))}
                    placeholder={'\\\\server\\footage'} className="flex-[2] min-w-[220px] s-data" />
                </div>
                <div className="s-row-control">
                  <Button surface="light" size="sm" variant="primary" onClick={saveEdit} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
                  <Button surface="light" size="sm" variant="ghost" onClick={() => { setEditing(null); setRowError(r => ({ ...r, [loc.id]: null })) }} disabled={busy}>Cancel</Button>
                </div>
                {err && <p className="s-feedback" data-tone="error" role="alert">{err}</p>}
                {editing.unc_path && normalizeUncInput(editing.unc_path) !== loc.unc_path && (
                  <p className="s-row-desc">A new address points every clip of this location at the new share, for everyone. Each computer that saved a folder for it is asked again.</p>
                )}
              </div>
            )
          }
          // The name is the person's own data, so it keeps its case (the Row
          // label is the uppercase Label step): the card-title step, then the
          // address in the data mono, then who added it and what this
          // computer can reach.
          return (
            <div key={loc.id} className="s-row" data-location-row={loc.id}>
              <div className="s-row-label">
                <span className="s-card-title">{loc.name}</span>
                <p className="s-row-desc">
                  <span className="s-data">{loc.unc_path}</span>
                  <br />
                  {[who ? `Added by ${who}` : null, reach].filter(Boolean).join(' · ')}
                </p>
                {err && <p className="s-feedback mt-2" data-tone="error" role="alert">{err}</p>}
              </div>
              <div className="s-row-control">
                {/* Review round 1: consent before contact — first, as the
                    step that comes first; the folder question beside it
                    still serves a computer that sees the share as Z:. */}
                {desktop && st && st.connected === false && (
                  <Button surface="light" size="sm" variant="primary" onClick={() => run(loc.id, () => ctx.connectBinLocation(loc.id))} disabled={busy}
                    title={CONNECT_TITLE}>
                    {CONNECT_LABEL}
                  </Button>
                )}
                {desktop && st && !st.local_path && !st.reachable && (
                  <Button surface="light" size="sm" onClick={() => run(loc.id, () => ctx.pickBinLocationLocalPath(loc.id))} disabled={busy}
                    title="Choose the folder this share is under on this computer, for example the drive letter it is mapped to. Only this computer keeps it.">
                    Where is it on this computer?
                  </Button>
                )}
                {desktop && st?.local_path && (
                  <Button surface="light" size="sm" variant="ghost" onClick={() => run(loc.id, () => ctx.forgetBinLocationLocalPath(loc.id))} disabled={busy}
                    title="Read this location at its network address again on this computer.">
                    Forget this computer's folder
                  </Button>
                )}
                <Button surface="light" size="sm" variant="ghost" onClick={() => { setEditing({ id: loc.id, name: loc.name, unc_path: loc.unc_path }); setRowError(r => ({ ...r, [loc.id]: null })) }} disabled={busy}>Edit</Button>
                <Button surface="light" size="sm" variant="ghost" onClick={() => run(loc.id, () => ctx.removeBinLocation(loc.id))} disabled={busy}
                  title="Take this location off the company's list. Refused while clips use it.">
                  Remove
                </Button>
              </div>
            </div>
          )
        })}
      </Group>

      <Group label="Add a location">
        <div className="s-row" data-stacked="true">
          <div className="flex gap-2 flex-wrap items-center">
            <Input surface="light" size="sm" aria-label="New location name" value={draft.name} onChange={v => setDraft(d => ({ ...d, name: v }))} placeholder="Footage NAS" className="flex-1 min-w-[160px]" />
            <Input surface="light" size="sm" aria-label="New location network address" value={draft.unc_path}
              onChange={v => setDraft(d => ({ ...d, unc_path: v }))}
              onBlur={() => setDraft(d => ({ ...d, unc_path: normalizeUncInput(d.unc_path) }))}
              onKeyDown={e => { if (e.key === 'Enter') add() }}
              placeholder={'\\\\server\\footage'} className="flex-[2] min-w-[220px] s-data" />
            <Button surface="light" size="sm" variant="primary" onClick={add} disabled={adding || !draft.name.trim() || !draft.unc_path.trim()}>
              {adding ? 'Adding…' : 'Add location'}
            </Button>
          </div>
          <p className="s-row-desc">The network address, never a drive letter: a letter like Z: means something different on every computer. A computer that sees the share only as a drive letter is asked once, here, where it is.</p>
          {addError && <p className="s-feedback" data-tone="error" role="alert">{addError}</p>}
        </div>
      </Group>
    </Section>
  )
}

// B5a: the company's switch. A workspace admin flips it (the database says
// so too: workspaces_admin_update); everyone else reads its state and why
// they cannot change it. Its consequence for TPN sits under its own label.
export function RemoteViewingSection() {
  const ctx = useRabbit()
  const perms = usePermissions()
  const isAdmin = perms.role === 'admin'
  const on = ctx?.binsInfo?.remoteViewing
  const refreshRemoteViewing = ctx?.refreshRemoteViewing
  // Read on arrival, for the company signed in to, open project or not.
  useEffect(() => { Promise.resolve(refreshRemoteViewing?.({ workspaceId: perms.workspaceId })).catch(() => {}) }, [refreshRemoteViewing, perms.workspaceId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const flip = async (next) => {
    setBusy(true); setError(null)
    try { await ctx.setRemoteViewingEnabled(next, { workspaceId: perms.workspaceId }) }
    catch (e) { setError(said(e)) }
    finally { setBusy(false) }
  }

  return (
    <Section
      title="Viewing from outside the office network"
      description="Off by default. While it is off, no picture of a clip leaves the office network: teammates on the network make their own from the file. While it is on, a small picture of each clip is kept in the cloud, so people who cannot reach the share still see what it is. Playing footage from outside the office comes with the WILSON file gateway, later. Turning it off deletes nothing: pictures already uploaded stay until their clips are removed."
    >
      <Group>
        {/* The switch's label is a sentence, so it takes the sentence-case
            H3 step, not the uppercase row label; the §4b sentence is the
            first thing under it. */}
        <div className="s-row" data-testid="remote-viewing-row">
          <div className="s-row-label">
            {isAdmin
              ? <label className="s-card-title" htmlFor="s-remote-viewing">{REMOTE_VIEWING_LABEL}</label>
              : <span className="s-card-title">{REMOTE_VIEWING_LABEL}</span>}
            <p className="s-row-desc">{REMOTE_VIEWING_TPN_SENTENCE}</p>
            {!isAdmin && <p className="s-row-desc">{BINS_REFUSALS.switchAdminOnly}</p>}
          </div>
          <div className="s-row-control">
            {isAdmin ? (
              <Switch surface="light" id="s-remote-viewing" checked={on === true} disabled={busy || on == null} onChange={flip}
                aria-label={REMOTE_VIEWING_LABEL} />
            ) : (
              <span className="s-badge">{on == null ? 'Unknown' : on ? 'On' : 'Off'}</span>
            )}
          </div>
        </div>
      </Group>
      {error && <p className="s-feedback" data-tone="error" role="alert">{error}</p>}
    </Section>
  )
}
