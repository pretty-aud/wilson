// ============================================================
// RABBIT — Bins: the inspector (preview + logging fields)
// ============================================================
//
// The right rail. One row selected: its preview (a <video> through the stream
// route for what Chromium plays, an <img> for stills, an <audio> for sound,
// the poster and an honest sentence for everything else) and every field.
// Several rows: bulk editing — a field that differs across the selection
// says "mixed" and typing sets it on all of them.
//
// 🚨 Never a spinner that never ends: every preview kind is decided from the
// row's extension before anything is fetched (previewKindFor), and the
// element's own onError names the failure.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FolderOpen, RefreshCw, Check, Ban, Circle, Trash2, Unplug, ChevronDown, ChevronRight, Clapperboard, Plus, X, Star } from 'lucide-react'
import { C, Btn, IconBtn, Chip, Field, TextInput, TextArea, Select, ColorPicker, MediaTag, Toggle, visibleOverlayOpen, OVER_THE_VIEW, drawerOnScreen } from './binUi'
// Post-overhaul S3c, step 1: the pickers' active-list default, and the shot
// list beside a shot a file is used in.
import LinkHome from '../scenes/LinkHome'
import { pickerRows, otherListRows } from '../scenes/linkHomes'
import BinPoster from './BinPoster'
import { MEDIA_TYPES, MEDIA_TYPE_META, TAKE_MODIFIERS, previewKindFor, formatDuration, formatBytes, secondsToTimecode } from '../../bins/binMedia'
import { mixedValue } from '../../bins/binSelectors'
import { TAKE_ROLE_META } from '../../bins/shotTakeSelectors'
import { navigateTo } from '../../state/rabbitNavigate'
// BC2: a company's clip (a footage location + a path inside it). BC3: the
// browser's sentence under it, and what Space does there. GW3: the gateway
// plays it in a browser — the sentence per location when it cannot, the
// format that needs the desktop app, the player with the viewer's mark.
import {
  NOT_ON_THIS_COMPUTER, notHereSentence, notConnectedClipSentence, browserClipSentence, POSTER_LARGE_HINT, PLAYER_LARGE_HINT,
  NEEDS_DESKTOP_FORMAT, GATEWAY_LOADING, gatewayClipSentence, gatewayMissingSentence,
} from '../../bins/binLocations'
import { playabilityOf, browserCanPlayType } from '../../bins/gatewayMedia'
import GatewayVideo, { usePlayerSrc, useSlowFlag } from './GatewayVideo'
// GW1: the one admin line about viewings from outside, in the Settings
// table's own words (a pure module: it imports nothing).
import { inspectorRemoteLine } from '../../../../components/settings/gatewayWords'

/** GW3: the sentence's state for a clip the gateway cannot serve, from the location's word or the tab's state. */
export function gatewayStateWord(location, gateway) {
  if (location && typeof location.gateway === 'string' && location.gateway !== 'reachable') return location.gateway
  const s = gateway?.state
  if (s === 'none') return 'no_gateway'
  if (s === 'unseen') return 'unseen'
  if (s === 'reached') return 'not_reachable'
  return 'gateway_unreachable'
}

function useDraft(value, key) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => { setDraft(value ?? '') }, [value, key])
  return [draft, setDraft]
}

// The header is a row of SIBLINGS — the toggle button and the optional
// right-hand action — never a button inside a button (invalid HTML; React
// warns and browsers may split the DOM, so the inner click lands on the toggle).
function Section({ title, children, open = true, onToggle, right = null }) {
  // A section that cannot collapse has a plain heading, not a button that
  // does nothing (review round 2: the Marks header was a tab stop with no action).
  const heading = (
    <>
      {onToggle ? (open ? <ChevronDown className="w-3 h-3 flex-shrink-0" style={{ color: C.dim }} /> : <ChevronRight className="w-3 h-3 flex-shrink-0" style={{ color: C.dim }} />) : null}
      <span className="text-label uppercase flex-1 truncate" style={{ color: C.dim }}>{title}</span>
    </>
  )
  return (
    <div style={{ borderBottom: `1px solid ${C.line}` }}>
      <div className="flex items-center gap-1.5 pr-2">
        {onToggle
          ? <button type="button" onClick={onToggle} aria-expanded={open} className="bn-section-head flex-1 min-w-0 flex items-center gap-1.5 px-3 py-2 text-left">{heading}</button>
          : <div className="bn-section-head flex-1 min-w-0 flex items-center gap-1.5 px-3 py-2 text-left">{heading}</div>}
        {right}
      </div>
      {/* The kit's field stack: 16px between fields, and it stands down the
          kit's sibling margin so the gap is not paid twice. */}
      {open && <div className="px-3 pb-3 ui-field-stack">{children}</div>}
    </div>
  )
}

export default function BinInspector({
  rows, scenes, shots, fps, canWrite, ffmpeg, thumbUrlFor, streamUrlFor,
  onPatch, onOpen, onProbe, onRemove, binPathFor, width = 320,
  // Shot takes (milestone 2): usage is Map fileId → [{ take, shot, scene }].
  usage = null, onAssign = null, onUnassign = null, projectId = null,
  // R.A.B.B.I.T. is the page on screen (BinsView's own `pageActive`, S2a-01).
  // Closed by default, as BinsView's is: the preview's Space plays nothing
  // for a host that does not say so.
  pageActive = false,
  // Post-overhaul S3c, step 1: `scenes` / `shots` are the ACTIVE shot list's
  // (D10) — what the Scene and Shot pickers offer by default; `allScenes` /
  // `allShots` every row, offered once "All lists" is on (and the row a file
  // is already logged to, always); `homeOf` names the list that holds each
  // shot a file is used in (linkHomes.homeIndex; null: no words).
  allScenes = null, allShots = null, homeOf = null,
  // BC2: for a company's clip, its footage location (row → { name,
  // unc_path } | null) and who added it (row → words | null), B11.
  locationOf = null, addedByOf = null,
  // GW1: (clipId) → Promise<{ count, last }> — given by BinsView for a
  // workspace admin only; null for everyone else, who is never asked.
  remoteViewsFor = null,
  // GW3 (item 5): the line opens the viewings table filtered to the clip,
  // for the same admin; null for everyone else (the line stays a line).
  onOpenRemoteViews = null,
  // GW3: the gateway in a browser. `gateway` is the tab's state ({ state,
  // name, … }) — null on every other backend; `streamInfoFor(id)` the door
  // and the ticket's state; the four verbs the player needs; `viewer` for
  // the mark over remote playback; `spaceTogglesPreview` false where Space
  // belongs to the large player instead (a browser).
  gateway = null, streamInfoFor = null, onTicketWanted = null, onRenew = null, onFreshSrc = null, onDiagnose = null,
  viewer = null, spaceTogglesPreview = true,
  // BC3: what this backend can do with a FILE (the capability object, read
  // by BinsView's binsModeOf). A control is offered only where its verb is
  // answered — never disabled with no reason beside it: no Open or Reveal
  // without `openInOs`, no "read the columns again" without `probe`, and
  // where nothing streams the preview is the picture with the sentence that
  // says why. `catalogue`: a browser (B5) — the sentence under a clip is the
  // browser's, and Space shows the picture large.
  canStream = true, canOpen = true, canProbe = true, catalogue = false,
  // P8 (0104, TPN-AUTH-012): the checked mark the file gateway requires. A
  // workspace admin or manager (project.bins.vet) marks a clip through
  // onPatch({ vetted_at }) and a location through onVetLocation(id); the
  // trigger stamps who and when, and refuses anyone else.
  canVet = false, onVetLocation = null,
}) {
  const single = rows.length === 1 ? rows[0] : null
  const key = rows.map(r => r.id).join(',')
  const [previewOpen, setPreviewOpen] = useState(true)
  const [techOpen, setTechOpen] = useState(true)
  const [logOpen, setLogOpen] = useState(true)
  const [notesOpen, setNotesOpen] = useState(true)
  const [usedOpen, setUsedOpen] = useState(true)
  const uses = single ? (usage?.get(single.id) || []) : []
  const remoteLine = useRemoteViewsLine(single, remoteViewsFor)
  const usedRows = usage ? rows.filter(r => (usage.get(r.id) || []).length > 0).length : 0

  const mv = (k) => mixedValue(rows, k)
  const [name, setName] = useDraft(single?.display_name, key)
  const [slate, setSlate] = useDraft(mv('slate').value, key)
  const [take, setTake] = useDraft(mv('take_number').value, key)
  const [camera, setCamera] = useDraft(mv('camera').value, key)
  const [roll, setRoll] = useDraft(mv('roll').value, key)
  const [day, setDay] = useDraft(mv('shoot_day').value, key)
  const [tags, setTags] = useDraft((mv('tags').value || []).join(', '), key)
  const [description, setDescription] = useDraft(mv('description').value, key)
  const [notes, setNotes] = useDraft(mv('notes').value, key)

  const [showAllLists, setShowAllLists] = useState(false)
  const sceneVal = mv('scene_id')
  const shotVal = mv('shot_id')
  const everyScene = allScenes || scenes
  const everyShot = allShots || shots
  const sceneOptions = useMemo(() => pickerRows({ active: scenes, all: everyScene, showAll: showAllLists, keep: sceneVal.value })
    .slice().sort((a, b) => (a.scene_number ?? 0) - (b.scene_number ?? 0)).map(s => ({ value: s.id, label: s.name || 'Untitled scene' })), [scenes, everyScene, showAllLists, sceneVal.value])
  const shotOptions = useMemo(() => {
    const ofScene = (rows) => (rows || []).filter(s => !sceneVal.value || s.scene_id === sceneVal.value)
    return pickerRows({ active: ofScene(shots), all: ofScene(everyShot), showAll: showAllLists, keep: shotVal.value })
      .slice().sort((a, b) => (a.shot_number ?? 0) - (b.shot_number ?? 0)).map(s => ({ value: s.id, label: s.name || 'Untitled shot' }))
  }, [shots, everyShot, showAllLists, sceneVal.value, shotVal.value])
  const canShowAllLists = otherListRows({ active: scenes, all: everyScene }) || otherListRows({ active: shots, all: everyShot })

  const commit = (k, draft, current) => {
    const v = typeof draft === 'string' ? draft.trim() : draft
    const cur = current ?? ''
    if ((v || '') === (cur || '')) return
    onPatch({ [k]: v === '' ? null : v })
  }
  const commitTake = () => {
    const n = String(take).trim() === '' ? null : Number(take)
    const cur = mv('take_number').value ?? null
    if (n === cur) return
    if (n != null && !(Number.isFinite(n) && n > 0)) { setTake(cur ?? ''); return }
    onPatch({ take_number: n })
  }
  const commitTags = () => {
    const list = String(tags).split(',').map(t => t.trim()).filter(Boolean)
    const cur = mv('tags').value || []
    if (JSON.stringify(list) === JSON.stringify(cur)) return
    onPatch({ tags: list })
  }

  if (!rows.length) {
    return (
      <div className="flex-shrink-0 h-full flex flex-col" style={{ width, borderLeft: `1px solid ${C.line}`, backgroundColor: C.bg }}>
        <div className="px-3 py-2 text-label uppercase" style={{ color: C.dim, borderBottom: `1px solid ${C.line}` }}>Inspector</div>
        <div className="flex-1 flex items-center justify-center px-6 text-center text-dense leading-relaxed" style={{ color: C.dimmer }}>
          Select a file to preview it and log it. Shift-click or drag to select several and edit them together.
        </div>
      </div>
    )
  }

  const flag = mv('review_flag')
  const circled = mv('circled')
  const color = mv('color')
  const mediaType = mv('media_type')

  return (
    <div className="flex-shrink-0 h-full flex flex-col overflow-hidden" style={{ width, borderLeft: `1px solid ${C.line}`, backgroundColor: C.bg }}>
      <div className="px-3 py-2 flex items-center gap-2 flex-shrink-0" style={{ borderBottom: `1px solid ${C.line}` }}>
        <span className="text-label uppercase flex-1 truncate" style={{ color: C.dim }}>
          {single ? 'Inspector' : `${rows.length} files selected`}
        </span>
        {canWrite && <IconBtn Icon={Trash2} title={single ? 'Remove from bin (Delete)' : `Remove ${rows.length} from bin (Delete)`} onClick={() => onRemove?.(rows.map(r => r.id))} danger size={3} />}
      </div>
      <div className="flex-1 overflow-y-auto">
        {single && (
          <Section title="Preview" open={previewOpen} onToggle={() => setPreviewOpen(o => !o)}>
            <Preview row={single} thumbUrl={thumbUrlFor?.(single.id)} streamUrl={canStream ? streamUrlFor?.(single.id) : null} ffmpeg={ffmpeg} onOpen={onOpen} pageActive={pageActive}
              location={locationOf?.(single) || null} canStream={canStream} canOpen={canOpen} catalogue={catalogue}
              gateway={gateway} streamInfo={streamInfoFor?.(single.id) || null} onTicketWanted={onTicketWanted} onRenew={onRenew} onFreshSrc={onFreshSrc} onDiagnose={onDiagnose}
              viewer={viewer} spaceTogglesPreview={spaceTogglesPreview} />
          </Section>
        )}

        <Section title="Marks" >
          <div className="flex items-center gap-1.5 flex-wrap">
            <MarkBtn active={flag.value === 'select' && !flag.mixed} onClick={() => onPatch({ review_flag: flag.value === 'select' ? 'unflagged' : 'select' })} disabled={!canWrite} Icon={Check} color={C.green} label="Select" hint="S" />
            <MarkBtn active={flag.value === 'reject' && !flag.mixed} onClick={() => onPatch({ review_flag: flag.value === 'reject' ? 'unflagged' : 'reject' })} disabled={!canWrite} Icon={Ban} color={C.red} label="Reject" hint="R" />
            <MarkBtn active={!!circled.value && !circled.mixed} onClick={() => onPatch({ circled: !circled.value })} disabled={!canWrite} Icon={Circle} color={C.accent} label="Circled" hint="C" />
            {(flag.mixed || circled.mixed) && <span className="text-dense" style={{ color: C.amber }}>mixed</span>}
          </div>
          <Field label="Colour" mixed={color.mixed}>
            <ColorPicker value={color.mixed ? null : color.value} onChange={c => canWrite && onPatch({ color: c })} />
          </Field>
        </Section>

        {usage && (
          <Section title={single ? `Used in shots (${uses.length})` : `Used in shots`} open={usedOpen} onToggle={() => setUsedOpen(o => !o)}
            right={canWrite && onAssign ? <IconBtn Icon={Plus} title="Assign to shot… (A)" size={3} onClick={e => { e.stopPropagation(); onAssign(rows.map(r => r.id)) }} /> : null}>
            {single ? (
              uses.length === 0
                ? <div className="text-dense" style={{ color: C.dimmer }}>Not assigned to any shot yet.</div>
                : uses.map(({ take, shot, scene }) => {
                  const meta = TAKE_ROLE_META[take.role] || TAKE_ROLE_META.alt
                  return (
                    <div key={take.id} className="flex items-center gap-1.5 text-dense min-w-0">
                      <Clapperboard className="w-3 h-3 flex-shrink-0" style={{ color: C.dim }} />
                      <span className="truncate flex-1" style={{ color: C.text }} title={`${scene?.name ? scene.name + ' · ' : ''}#${shot.shot_number ?? '—'} ${shot.name || 'Untitled shot'}${take.notes ? ' — ' + take.notes : ''}`}>
                        {scene?.name ? <span style={{ color: C.dim }}>{scene.name} · </span> : null}#{shot.shot_number ?? '—'} {shot.name || 'Untitled shot'}
                      </span>
                      {/* Post-overhaul S3c, step 1: the shot list that holds
                          the shot, beside its name (Audrey: takes "clearly
                          indicate" which shot version they are assigned to). */}
                      {homeOf && <LinkHome homeOf={homeOf} id={shot.id} name={shot.name || 'Untitled shot'} />}
                      <span className="px-1 rounded-control text-label uppercase flex-shrink-0 inline-flex items-center gap-0.5" style={{ color: meta.color, border: `1px solid ${meta.color}55` }} title={meta.help}>
                        {take.role === 'primary' && <Star className="w-2 h-2" style={{ fill: meta.color }} />}{meta.label}
                      </span>
                      <IconBtn Icon={ExternalLink} title="Open the shot in Scenes" size={3} onClick={() => navigateTo({ view: 'scenes', shotId: shot.id, projectId })} />
                      {canWrite && onUnassign && <IconBtn Icon={X} title="Unassign from this shot" size={3} danger onClick={() => onUnassign([take.id])} />}
                    </div>
                  )
                })
            ) : (
              <div className="text-dense" style={{ color: C.muted }}>
                {usedRows === 0 ? 'None of these is assigned to a shot yet.' : `${usedRows} of ${rows.length} are assigned to shots. Select one file to see where.`}
              </div>
            )}
            {canWrite && onAssign && (
              <div><Btn small onClick={() => onAssign(rows.map(r => r.id))} title="Pick the shot (or shots) these takes are used in"><Clapperboard className="w-3 h-3" style={{ color: C.accentText }} /> Assign to shot…</Btn></div>
            )}
          </Section>
        )}

        <Section title="Logging" open={logOpen} onToggle={() => setLogOpen(o => !o)}>
          {single && (
            <Field label="Name">
              <TextInput value={name} onChange={setName} onCommit={() => commit('display_name', name || single.display_name, single.display_name)} disabled={!canWrite} placeholder={single.original_name} />
            </Field>
          )}
          <Field label="Type" mixed={mediaType.mixed}>
            <div className="flex items-center gap-2">
              <Select value={mediaType.mixed ? '' : mediaType.value} placeholder={mediaType.mixed ? 'mixed' : null} disabled={!canWrite}
                options={MEDIA_TYPES.map(t => ({ value: t, label: MEDIA_TYPE_META[t].label }))}
                onChange={v => v && onPatch({ media_type: v })} />
              {!mediaType.mixed && <MediaTag type={mediaType.value} small />}
            </div>
          </Field>
          <Field label="Tags" mixed={mv('tags').mixed} hint="comma separated">
            <TextInput value={tags} onChange={setTags} onCommit={commitTags} disabled={!canWrite} placeholder="hero, b-roll, interview" />
          </Field>
          <div className="bn-field-grid bn-insp-grid grid gap-4">
            <Field label="Slate" mixed={mv('slate').mixed}>
              <TextInput value={slate} onChange={setSlate} onCommit={() => commit('slate', slate, mv('slate').value)} disabled={!canWrite} placeholder="24A" />
            </Field>
            <Field label="Take" mixed={mv('take_number').mixed}>
              <TextInput value={take} onChange={setTake} onCommit={commitTake} disabled={!canWrite} placeholder="3" type="number" min={1} />
            </Field>
            <Field label="Modifier" mixed={mv('take_modifier').mixed}>
              <Select value={mv('take_modifier').mixed ? '' : (mv('take_modifier').value || '')} placeholder={mv('take_modifier').mixed ? 'mixed' : '—'} disabled={!canWrite}
                options={TAKE_MODIFIERS.map(m => ({ value: m, label: m }))} onChange={v => onPatch({ take_modifier: v })} />
            </Field>
            <Field label="Camera" mixed={mv('camera').mixed}>
              <TextInput value={camera} onChange={v => setCamera(v.toUpperCase())} onCommit={() => commit('camera', camera, mv('camera').value)} disabled={!canWrite} placeholder="A" maxLength={4} />
            </Field>
            <Field label="Roll / card" mixed={mv('roll').mixed}>
              <TextInput value={roll} onChange={v => setRoll(v.toUpperCase())} onCommit={() => commit('roll', roll, mv('roll').value)} disabled={!canWrite} placeholder="A001" />
            </Field>
            <Field label="Shoot day" mixed={mv('shoot_day').mixed}>
              <TextInput value={day} onChange={setDay} onCommit={() => commit('shoot_day', day, mv('shoot_day').value)} disabled={!canWrite} type="date" />
            </Field>
          </div>
          <Field label="Scene" mixed={sceneVal.mixed}>
            <Select value={sceneVal.mixed ? '' : sceneVal.value} placeholder={sceneVal.mixed ? 'mixed' : '— none —'} disabled={!canWrite}
              options={sceneOptions} onChange={v => onPatch({ scene_id: v, ...(v !== sceneVal.value ? { shot_id: null } : {}) })} />
          </Field>
          <Field label="Shot (intended)" mixed={mv('shot_id').mixed} hint={sceneVal.value ? null : 'pick a scene to narrow the list'}>
            <Select value={mv('shot_id').mixed ? '' : mv('shot_id').value} placeholder={mv('shot_id').mixed ? 'mixed' : '— none —'} disabled={!canWrite}
              options={shotOptions} onChange={v => onPatch({ shot_id: v })} />
          </Field>
          {/* Post-overhaul S3c, step 1: the two pickers offer the active shot
              list's rows; this offers every list's. */}
          {canShowAllLists && (
            <Toggle checked={showAllLists} onChange={setShowAllLists} label="Scenes and shots of all lists" />
          )}
        </Section>

        <Section title="Notes" open={notesOpen} onToggle={() => setNotesOpen(o => !o)}>
          <Field label="Description" mixed={mv('description').mixed}>
            <TextInput value={description} onChange={setDescription} onCommit={() => commit('description', description, mv('description').value)} disabled={!canWrite} placeholder="What is in it" />
          </Field>
          <Field label="Notes" mixed={mv('notes').mixed}>
            <TextArea value={notes} onChange={setNotes} onCommit={() => commit('notes', notes, mv('notes').value)} disabled={!canWrite} placeholder="NG sound, false start, boom in shot…" rows={3} />
          </Field>
        </Section>

        {single && (
          <Section title="File" open={techOpen} onToggle={() => setTechOpen(o => !o)}
            right={single.online !== false && canWrite && canProbe ? <IconBtn Icon={RefreshCw} title="Read the technical columns again" size={3} onClick={e => { e.stopPropagation(); onProbe?.(single.id) }} /> : null}>
            <TechRows row={single} fps={fps} binPath={binPathFor?.(single.bin_id)} ffmpeg={ffmpeg}
              location={locationOf?.(single) || null} addedBy={addedByOf?.(single) || null} remoteLine={remoteLine}
              onOpenRemoteViews={onOpenRemoteViews} canVet={canVet} onPatch={onPatch} onVetLocation={onVetLocation} />
            {canOpen && (
              <div className="flex items-center gap-1.5 flex-wrap pt-1">
                <Btn small onClick={() => onOpen?.(single.id, false)} disabled={single.online === false} title="Open with the default app"><ExternalLink className="w-3 h-3" /> Open</Btn>
                <Btn small onClick={() => onOpen?.(single.id, true)} disabled={single.online === false} title="Show the file in Explorer"><FolderOpen className="w-3 h-3" /> Reveal</Btn>
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  )
}

// A mark is a toggle carrying its own data colour: the kit's Chip, through
// binUi's adapter (the colour as a tint and an edge, the ink unchanged).
function MarkBtn({ active, onClick, disabled, Icon, color, label, hint }) {
  return (
    <Chip active={active} onClick={onClick} disabled={disabled} color={color} title={`${label} (${hint})`}>
      <Icon className="w-3 h-3" /> {label}
    </Chip>
  )
}

// GW1: one clip's viewings from outside, read when a single company clip is
// selected and the caller is an admin; null until it answers, and nothing at
// all for a clip never viewed from outside.
function useRemoteViewsLine(row, remoteViewsFor) {
  const [line, setLine] = useState(null)
  const id = row?.id ?? null
  const cloudRow = !!row?.location_id
  useEffect(() => {
    setLine(null)
    if (!id || !cloudRow || typeof remoteViewsFor !== 'function') return undefined
    let live = true
    Promise.resolve(remoteViewsFor(id))
      .then((r) => { if (live) setLine(r ? inspectorRemoteLine(r) : null) })
      .catch(() => { if (live) setLine(null) })
    return () => { live = false }
  }, [id, cloudRow, remoteViewsFor])
  return line
}

function TechRows({ row, fps, binPath, ffmpeg, location = null, addedBy = null, remoteLine = null, onOpenRemoteViews = null, canVet = false, onPatch = null, onVetLocation = null }) {
  const cloudRow = !!row.location_id
  const R = ({ k, v, title }) => v == null || v === '' ? null : (
    <div className="flex items-baseline gap-2 text-dense min-w-0">
      <span className="flex-shrink-0" style={{ color: C.dimmer, minWidth: 70 }}>{k}</span>
      <span className="truncate" style={{ color: C.text }} title={title || String(v)}>{v}</span>
    </div>
  )
  const probeNote = row.probe_status === 'pending' ? 'reading…'
    : row.probe_status === 'unavailable' ? (ffmpeg === false ? 'no decoder on this machine (ffmpeg missing)' : 'not readable without a decoder')
      : row.probe_status === 'failed' ? 'could not be read' : null
  return (
    <div className="flex flex-col gap-1">
      <R k="Bin" v={binPath} />
      <R k="File" v={row.original_name} />
      {/* BC2: a company's clip is a footage location + a path inside it,
          the same on every computer; who added it (B11). */}
      {cloudRow ? (
        <>
          <R k="Location" v={location ? location.name : 'a location no longer in the list'} title={location?.unc_path || undefined} />
          <R k="Path" v={row.relative_path} />
          <R k="Added by" v={addedBy} />
          {/* GW3 (item 5): for the admin the line opens the viewings table filtered to this clip. */}
          {remoteLine && (onOpenRemoteViews
            ? <button type="button" className="text-dense text-left hover:underline" data-testid="bin-remote-views" style={{ color: C.text }} title="Every viewing of this clip from outside the office, in the last 30 days" onClick={() => onOpenRemoteViews(row.id)}>{remoteLine}</button>
            : <div className="text-dense" data-testid="bin-remote-views" style={{ color: C.text }}>{remoteLine}</div>)}
          {/* P8 (0104, TPN-AUTH-012): the gateway serves a clip only once a
              workspace admin or manager has checked its path; the mark, and
              the control for those who may set it (the trigger refuses the
              rest with 42501). A withdrawn mark stops the gateway within ten
              minutes (24 hours on the office door while the cloud is away).
              After the remote line: "Added by" stays beside it (GW3). */}
          <R k="Checked" v={row.vetted_at ? `for the file gateway, ${new Date(row.vetted_at).toLocaleDateString()}` : 'not yet: the file gateway does not serve it'} />
          {canVet && onPatch && (
            <div className="flex flex-wrap gap-1.5">
              <Btn small data-testid="bin-vet" onClick={() => onPatch({ vetted_at: row.vetted_at ? null : new Date().toISOString() })}
                title={row.vetted_at ? 'The file gateway stops serving this clip within ten minutes' : 'Its path is one the file gateway may serve'}>
                {row.vetted_at ? 'Withdraw the check' : 'Mark as checked'}
              </Btn>
              {location && !location.vetted_at && onVetLocation && (
                <Btn small data-testid="bin-vet-location" onClick={() => onVetLocation(location.id)} title="The gateway is told this location only once it is checked">Mark the location as checked</Btn>
              )}
            </div>
          )}
        </>
      ) : <R k="Path" v={row.source_path} />}
      {row.online === false && (cloudRow
        ? <div className="flex items-center gap-1.5 text-dense" style={{ color: C.amber }}><Unplug className="w-3 h-3" /> {NOT_ON_THIS_COMPUTER}</div>
        : <div className="flex items-center gap-1.5 text-dense" style={{ color: C.amber }}><Unplug className="w-3 h-3" /> offline — the file is not at this path</div>)}
      <R k="Size" v={formatBytes(row.size_bytes)} />
      {row.is_sequence && <R k="Frames" v={`${row.frame_count ?? '?'}${row.sequence_pattern ? ` · ${row.sequence_pattern}` : ''}`} />}
      <R k="Duration" v={row.duration_sec ? `${formatDuration(row.duration_sec)} · ${secondsToTimecode(row.duration_sec, row.fps || fps)}` : null} />
      <R k="Start TC" v={row.timecode_start} />
      <R k="Frame" v={row.width && row.height ? `${row.width} × ${row.height}` : null} />
      <R k="fps" v={row.fps} />
      <R k="Codec" v={row.codec ? String(row.codec).toUpperCase() : null} />
      <R k="Audio" v={row.sample_rate ? `${row.sample_rate} Hz${row.channels ? ` · ${row.channels}` : ''}` : null} />
      <R k="Added" v={row.added_at ? new Date(row.added_at).toLocaleString() : null} />
      {probeNote && <R k="Columns" v={probeNote} />}
    </div>
  )
}

function Preview({
  row, thumbUrl, streamUrl, ffmpeg, onOpen, pageActive = false, location = null, canStream = true, canOpen = true, catalogue = false,
  gateway = null, streamInfo = null, onTicketWanted = null, onRenew = null, onFreshSrc = null, onDiagnose = null, viewer = null, spaceTogglesPreview = true,
}) {
  const kind = previewKindFor(row)
  const [failed, setFailed] = useState(null)
  const [playing, setPlaying] = useState(false)
  const mediaRef = useRef(null)
  const pageActiveRef = useRef(pageActive)
  pageActiveRef.current = pageActive
  const spaceRef = useRef(spaceTogglesPreview)
  spaceRef.current = spaceTogglesPreview
  useEffect(() => { setFailed(null); setPlaying(false) }, [row.id, streamUrl])
  // GW3: through the gateway. What plays (§7): the extension on the list,
  // canPlayType not empty for the type (with the probe's codec), the first
  // bytes decoding. D22: the first play costs one round trip; the picture
  // and "loading" meanwhile — the ticket is asked for here, when a playable
  // clip is selected and no ticket is held.
  const viaGateway = !!gateway
  const play = viaGateway ? playabilityOf(row, { canPlayType: browserCanPlayType() }) : null
  // A ticket that lapsed while THIS player sat idle keeps its URL here: no
  // new mint until it plays again, when the door's 401 is answered by the
  // player's one fresh src; a player that was not showing it asks for a
  // fresh ticket (GW3 review round 1, finding 7; usePlayerSrc).
  const playerSrc = usePlayerSrc(streamUrl, streamInfo)
  const wantsTicket = viaGateway && canStream && !!play?.playable && !playerSrc && row.online !== false
    && !streamInfo?.refused && !streamInfo?.missing && !streamInfo?.pending
  useEffect(() => {
    if (wantsTicket) onTicketWanted?.(row.id)
  }, [wantsTicket, row.id, onTicketWanted])
  // "loading…" only while a ticket is on its way and has taken a moment
  // (round 2, note 16); never beside the player's refusal sentence.
  const ticketSlow = useSlowFlag(!playerSrc && !streamInfo?.ticketError && !streamInfo?.refused && !streamInfo?.missing)
  const notice = (text) => (
    <div className="text-dense leading-relaxed px-1" style={{ color: C.dim }}>{text}</div>
  )

  // Space toggles play/pause when the preview is a video or audio — and only
  // then: never while a modal or menu is up, never when Space is a control's
  // own activation (review round 2: it paged nothing in the add dialog's list,
  // cancelled every button's Space, and played the clip behind the backdrop).
  // And never from another page or under a drawer (post-overhaul S4a review
  // round 1, R1-UI-03, measured: on D.O.G. or Help, Space played the hidden
  // clip, with sound, and no page scrolled on Space; under R.A.B.B.I.T.'s
  // settings drawer it played the clip behind it) — BinsView's S2a-01 gate.
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space' || e.defaultPrevented || e.repeat) return
      if (!pageActiveRef.current) return
      const t = e.target
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (t && typeof t.closest === 'function' && t.closest('button, a, [role="button"], [role="menuitem"], summary')) return
      if (visibleOverlayOpen()) return
      if (drawerOnScreen() || (t && typeof t.closest === 'function' && t.closest(OVER_THE_VIEW))) return
      // GW3: in a browser Space belongs to the large player (BinsView's
      // handler), never to this preview as well (two players on one key).
      if (!spaceRef.current) return
      const m = mediaRef.current
      if (!m) return
      e.preventDefault()
      if (m.paused) m.play().catch(() => {}); else m.pause()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // BC2 (B3): a company's clip this computer cannot reach still shows its
  // picture (the one cached here, else the cloud's) and everything but
  // playback, marked "not on this computer". BC3: in a browser the sentence
  // is the browser's (no share is read here; the desktop app plays it), and
  // Space shows the picture large.
  if (row.online === false && row.location_id) {
    // GW3: the gateway's word per location (§2's fourth row), or a 404's
    // "missing at its location"; BC3's browser sentence where no gateway
    // backend answers; the desktop's two otherwise.
    const sentence = row.not_checked && viaGateway ? gatewayClipSentence(location?.name, 'not_checked')
      : row.gateway_missing ? gatewayMissingSentence(location?.name)
      : viaGateway ? gatewayClipSentence(location?.name, gatewayStateWord(location, gateway))
        : catalogue ? browserClipSentence(location?.name)
          : location?.connected === false ? notConnectedClipSentence(location?.name) : notHereSentence(location?.name)
    return (
      <div className="flex flex-col gap-1.5" data-testid="not-here">
        <div className="rounded-control flex items-center justify-center overflow-hidden" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}`, minHeight: 120 }}>
          <BinPoster row={row} src={thumbUrl} width="100%" height={180} radius={0} style={{ border: 'none' }} iconSize={40} />
        </div>
        <div className="flex items-center gap-1.5 text-dense" style={{ color: C.amber }}><Unplug className="w-3 h-3" /> Not on this computer</div>
        <div className="text-dense px-1" style={{ color: C.dim }}>{sentence}</div>
        {catalogue && <div className="text-caption px-1" style={{ color: C.dimmer }}>{POSTER_LARGE_HINT}</div>}
      </div>
    )
  }
  // BC3: a backend that streams no bytes (a browser with no gateway reached,
  // or the dev fixtures' plain catalogue): the picture, the sentence that
  // says why nothing plays, and no Open button where the OS is not here.
  if (!canStream) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="no-stream">
        <div className="rounded-control flex items-center justify-center overflow-hidden" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}`, minHeight: 120 }}>
          <BinPoster row={row} src={thumbUrl} width="100%" height={180} radius={0} style={{ border: 'none' }} iconSize={40} />
        </div>
        <div className="text-dense px-1" style={{ color: C.dim }}>{viaGateway ? gatewayClipSentence(location?.name, gatewayStateWord(location, gateway)) : browserClipSentence(location?.name)}</div>
        <div className="text-caption px-1" style={{ color: C.dimmer }}>{POSTER_LARGE_HINT}</div>
      </div>
    )
  }
  // GW3: the gateway reached. A format the browser does not play shows the
  // picture and says so (G7, D8); everything else is the player, with the
  // picture until the first frame and "loading" until the ticket.
  if (viaGateway) {
    const refused = streamInfo?.refused === 'not_playable' || !play?.playable
    if (refused) {
      return (
        <div className="flex flex-col gap-1.5" data-testid="needs-desktop-format">
          <div className="rounded-control flex items-center justify-center overflow-hidden" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}`, minHeight: 120 }}>
            <BinPoster row={row} src={thumbUrl} width="100%" height={180} radius={0} style={{ border: 'none' }} iconSize={40} />
          </div>
          <div className="text-dense px-1" style={{ color: C.dim }}>{NEEDS_DESKTOP_FORMAT}{play?.reason === 'codec' && row.codec ? ` (${String(row.codec)} is not one this browser decodes.)` : ''}</div>
          <div className="text-caption px-1" style={{ color: C.dimmer }}>{POSTER_LARGE_HINT}</div>
        </div>
      )
    }
    const previewHeight = play.kind === 'audio' ? 120 : 200
    return (
      <div className="flex flex-col gap-1.5" data-testid="gateway-preview">
        <GatewayVideo row={row} src={playerSrc} kind={play.kind} stream={streamInfo} viewer={viewer} poster={thumbUrl} controls mediaRef={mediaRef}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onRenew={onRenew} onFreshSrc={onFreshSrc} onDiagnose={onDiagnose} locationName={location?.name || null}
          renewAfterMs={gateway?.renewAfterMs || undefined}
          className="w-full rounded-control" style={{ height: previewHeight, border: `1px solid ${C.line}` }} />
        {notice(!playerSrc ? (ticketSlow ? `${GATEWAY_LOADING}…` : '\u00a0') : playing ? (spaceTogglesPreview ? 'Playing · Space pauses' : 'Playing') : (spaceTogglesPreview ? 'Space plays · hover a tile in the grid to scrub' : `${PLAYER_LARGE_HINT} Hover a tile in the grid to scrub.`))}
      </div>
    )
  }
  if (row.online === false) {
    return (
      <div className="rounded-control flex flex-col items-center justify-center gap-1 py-6 text-center" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}` }}>
        <Unplug className="w-5 h-5" style={{ color: C.amber }} />
        <div className="text-dense" style={{ color: C.amber }}>Offline</div>
        <div className="text-dense px-4" style={{ color: C.dim }}>The file is not at its recorded path. Plug the drive in, or use Relink.</div>
      </div>
    )
  }
  if (kind === 'video' && streamUrl && !failed) {
    return (
      <div className="flex flex-col gap-1.5">
        <video ref={mediaRef} key={streamUrl} src={streamUrl} controls preload="metadata" playsInline
          poster={thumbUrl || undefined}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={() => setFailed('Chromium could not decode this file. The poster frame stands in.')}
          className="w-full rounded-control" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}`, maxHeight: 240 }} />
        {notice(playing ? 'Playing · Space pauses' : 'Space plays · hover a tile in the grid to scrub')}
      </div>
    )
  }
  if (kind === 'audio' && streamUrl && !failed) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="rounded-control flex items-center justify-center py-4" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}` }}>
          <BinPoster row={row} src={null} width={64} height={64} iconSize={28} style={{ border: 'none', backgroundColor: 'transparent' }} />
        </div>
        <audio ref={mediaRef} key={streamUrl} src={streamUrl} controls preload="metadata" className="w-full"
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={() => setFailed('Chromium could not decode this audio format.')} />
        {notice('Space plays and pauses')}
      </div>
    )
  }
  if (kind === 'image' && streamUrl && !failed) {
    return (
      <div className="flex flex-col gap-1.5">
        <img key={streamUrl} src={streamUrl} alt="" onError={() => setFailed('The image could not be decoded by the browser; the poster stands in.')}
          className="w-full rounded-control object-contain" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}`, maxHeight: 240 }} />
      </div>
    )
  }
  // poster / frame / none, or a failed element above
  const posterNotice = kind === 'frame'
    ? `A frame sequence: ${row.frame_count ?? '?'} frames. The poster is the middle frame; open the folder to step through them.`
    : kind === 'poster'
      ? (failed || `Preview is not available for this format in the app${ffmpeg === false ? ' and there is no decoder to make a poster' : ''}. Open it in its default app.`)
      : kind === 'none'
        ? (failed || 'No preview for this type. Open it in its default app.')
        : failed
  return (
    <div className="flex flex-col gap-1.5">
      <div className="rounded-control flex items-center justify-center overflow-hidden" style={{ backgroundColor: C.deep, border: `1px solid ${C.line}`, minHeight: 120 }}>
        <BinPoster row={row} src={thumbUrl} width="100%" height={180} radius={0} style={{ border: 'none' }} iconSize={40} />
      </div>
      {notice(posterNotice)}
      {canOpen && <div><Btn small onClick={() => onOpen?.(row.id, false)}><ExternalLink className="w-3 h-3" /> Open in default app</Btn></div>}
    </div>
  )
}
