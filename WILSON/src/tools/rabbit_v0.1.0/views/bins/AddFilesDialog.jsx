// ============================================================
// RABBIT — Bins: the add dialog (review the batch before it lands)
// ============================================================
//
// docs/BINS_DESIGN.md §4.5 step 3. The server's `prepare` plan arrives here:
// one line per file or sequence with its type, size, the suggestions parsed
// from its name, and a duplicate warning where one applies. She decides per
// line whether it goes in (duplicates start unticked — Q9: "make sure user
// can choose to skip it or still add"), edits names and types in place,
// applies the batch fields (scene, day, camera, roll, tags) to everything,
// and chooses whether folders become nested bins.

import { useMemo, useState } from 'react'
import { AlertTriangle, Layers, FolderTree, Check, Server } from 'lucide-react'
import { C, Btn, Modal, Field, Select, TextInput, MediaTag, Toggle, Loading, Banner } from './binUi'
import { MEDIA_TYPES, MEDIA_TYPE_META, formatBytes } from '../../bins/binMedia'
// BC2 (Bins on the cloud, the desktop signed in): a picked file lies in one
// of the company's footage locations, or it is refused with the sentence —
// never silently added. On a share nobody has named yet, the dialog asks:
// "Which location is this? Name it."
import { suggestLocationName } from '../../bins/binLocations'
import { OUTSIDE_LOCATIONS_SENTENCE } from '../../adapters/desktopCloudBins'

// Why a line cannot be added, in words (the desktop's prepare says which).
function refusedWords(it) {
  if (it.status === 'outside') return it.share_root ? 'not in any footage location yet' : 'not on a footage location'
  if (it.status === 'unsafe_name') return 'this name cannot be stored (a part of it ends in a dot or a space)'
  return 'missing on disk'
}

function suggestionText(s) {
  if (!s) return ''
  const parts = []
  if (s.slate) parts.push(s.slate)
  if (s.take_number) parts.push(`T${s.take_number}${s.take_modifier ? ' ' + s.take_modifier : ''}`)
  if (s.camera) parts.push(`${s.camera} cam`)
  if (s.roll) parts.push(s.roll)
  if (s.shoot_day) parts.push(s.shoot_day)
  return parts.join(' · ')
}

export default function AddFilesDialog({ bin, plan, scenes, onConfirm, onCancel, busy, progress, error = null, onNameLocation = null }) {
  // A suggestion starts ticked only when the parser read an explicit marker
  // (T4, SH03, a camera clip name, a date): 'high' confidence. A bare "12A"
  // or "4K" is shown but left unticked (adversarial review: ordinary names
  // used to arrive pre-ticked with a fabricated slate).
  const initial = useMemo(() => (plan?.items || []).map(it => ({
    ...it,
    include: it.status === 'ok' && !it.duplicate,
    apply: it.suggestions?.confidence === 'high',
  })), [plan])
  const RENDER_CAP = 500
  const [items, setItems] = useState(initial)
  const [batch, setBatch] = useState({ scene_id: null, shoot_day: '', camera: '', roll: '', tags: '' })
  const anySub = items.some(i => i.sub_bin)
  const [createSubBins, setCreateSubBins] = useState(true)

  const set = (idx, patch) => setItems(list => list.map((it, i) => i === idx ? { ...it, ...patch } : it))
  // A batch she has worked on (ticks, names, batch fields) is not thrown away
  // by a stray Escape or a click beside the dialog (review round 2).
  const dirty = items !== initial || !!(batch.scene_id || batch.shoot_day || batch.camera || batch.roll || batch.tags) || !createSubBins
  // W9: the kit Dialog in place of window.confirm, stacked over this one (the
  // kit's topmost-only Escape closes the question, not the batch).
  const [askDiscard, setAskDiscard] = useState(false)
  const guardedCancel = () => { if (busy) return; if (!dirty) onCancel(); else setAskDiscard(true) }
  const included = items.filter(i => i.include && i.status === 'ok')
  const dupes = items.filter(i => i.duplicate).length
  const missing = items.filter(i => i.status === 'missing').length
  // BC2: the lines outside every footage location, grouped by the share they
  // are on (one question per share), and those on no share at all.
  const outside = items.filter(i => i.status === 'outside')
  const unnamedShares = useMemo(() => {
    const m = new Map()
    for (const it of items) if (it.status === 'outside' && it.share_root) m.set(it.share_root, (m.get(it.share_root) || 0) + 1)
    return [...m.entries()].map(([root, count]) => ({ root, count }))
  }, [items])
  const offShare = outside.filter(i => !i.share_root).length
  const unsafe = items.filter(i => i.status === 'unsafe_name').length
  const seqs = included.filter(i => i.kind === 'sequence').length
  const bytes = included.reduce((s, i) => s + (Number(i.size_bytes) || 0), 0)
  const sceneOptions = (scenes || []).slice().sort((a, b) => (a.scene_number ?? 0) - (b.scene_number ?? 0)).map(s => ({ value: s.id, label: s.name || 'Untitled scene' }))

  const confirm = () => {
    const tags = batch.tags.split(',').map(t => t.trim()).filter(Boolean)
    const out = included.map(it => {
      const s = it.apply ? (it.suggestions || {}) : {}
      return {
        // BC2: a clip in a footage location goes to the cloud as its location
        // and its path inside it, with what this computer read of it.
        ...(it.location_id ? {
          location_id: it.location_id, relative_path: it.relative_path,
          original_name: it.original_name, extension: it.extension, mime_type: it.mime_type,
          is_sequence: it.kind === 'sequence', sequence_pattern: it.sequence?.pattern ?? it.sequence_pattern ?? null,
          frame_count: it.sequence?.frame_count ?? it.frame_count ?? null,
          size_bytes: it.size_bytes ?? null, mtime: it.mtime ?? null,
        } : {}),
        kind: it.kind, source_path: it.source_path, sub_bin: createSubBins ? it.sub_bin : null,
        display_name: it.display_name, media_type: it.media_type, tags,
        scene_id: batch.scene_id || null,
        shoot_day: batch.shoot_day || s.shoot_day || null,
        camera: batch.camera || s.camera || null,
        roll: batch.roll || s.roll || null,
        slate: s.slate || null, take_number: s.take_number ?? null, take_modifier: s.take_modifier || null,
      }
    })
    onConfirm(out, createSubBins)
  }

  return (
    <Modal title={`Add to "${bin?.name || 'bin'}"`} onClose={onCancel} onBeforeClose={() => { if (!dirty) return true; setAskDiscard(true); return false }} width="workbench" busy={busy} error={error}
      subtitle={`${included.length} of ${items.length} will be added${seqs ? ` · ${seqs} sequence${seqs === 1 ? '' : 's'}` : ''}${dupes ? ` · ${dupes} duplicate${dupes === 1 ? '' : 's'}` : ''}${missing ? ` · ${missing} missing` : ''}${outside.length ? ` · ${outside.length} outside the footage locations` : ''}${unsafe ? ` · ${unsafe} with a name that cannot be stored` : ''} · ${formatBytes(bytes)} referenced in place`}
      footer={<>
        {busy && progress && <Loading className="mr-auto" label={progress} />}
        <Btn onClick={guardedCancel} disabled={busy}>Cancel</Btn>
        <Btn primary onClick={confirm} disabled={busy || included.length === 0}><Check className="w-3 h-3" /> Add {included.length} {included.length === 1 ? 'item' : 'items'}</Btn>
      </>}>
      {askDiscard && (
        <Modal title="Discard this batch?" width="confirm" onClose={() => setAskDiscard(false)}
          footer={<>
            <Btn autoFocus onClick={() => setAskDiscard(false)}>Keep editing</Btn>
            <Btn danger onClick={() => { setAskDiscard(false); onCancel() }}>Discard</Btn>
          </>}>
          <p className="text-dense" style={{ color: C.text }}>Your ticks, names and batch fields will be lost.</p>
        </Modal>
      )}
      {plan?.truncated && (
        <Banner tone="warning" Icon={AlertTriangle} className="mb-3 rounded-control">
          The folder was too large to walk completely; add the rest in a second pass.
        </Banner>
      )}
      {/* BC2: "Which location is this? Name it." — one question per share a
          picked file lies on that the company has not named. */}
      {unnamedShares.map(({ root, count }) => (
        <NameShareBanner key={root} root={root} count={count} onNameLocation={onNameLocation} disabled={busy} />
      ))}
      {offShare > 0 && (
        <Banner tone="warning" Icon={AlertTriangle} className="mb-3 rounded-control">
          {offShare === 1 ? 'One file is' : `${offShare} files are`} not on a footage location, so {offShare === 1 ? 'it' : 'they'} cannot be added. {OUTSIDE_LOCATIONS_SENTENCE} A share this computer sees only as a drive letter is set in Settings, Storage, Footage locations.
        </Banner>
      )}

      <div className="bn-field-grid grid gap-4 mb-3" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <Field label="Scene (all)">
          <Select autoFocus value={batch.scene_id} placeholder="— none —" options={sceneOptions} onChange={v => setBatch(b => ({ ...b, scene_id: v }))} /></Field>
        <Field label="Shoot day (all)">
          <TextInput type="date" value={batch.shoot_day} onChange={v => setBatch(b => ({ ...b, shoot_day: v }))} /></Field>
        <Field label="Camera (all)">
          <TextInput value={batch.camera} onChange={v => setBatch(b => ({ ...b, camera: v.toUpperCase() }))} placeholder="A" maxLength={4} /></Field>
        <Field label="Roll (all)">
          <TextInput value={batch.roll} onChange={v => setBatch(b => ({ ...b, roll: v.toUpperCase() }))} placeholder="A001" /></Field>
        <Field label="Tags (all)">
          <TextInput value={batch.tags} onChange={v => setBatch(b => ({ ...b, tags: v }))} placeholder="hero, b-roll" /></Field>
      </div>
      <div className="flex items-center gap-4 mb-2 flex-wrap">
        {anySub && <Toggle checked={createSubBins} onChange={setCreateSubBins} label="Folders become nested bins" />}
        <Btn variant="ghost" small
          onClick={() => setItems(list => list.map(it => ({ ...it, include: it.status === 'ok' })))}>Tick all</Btn>
        <Btn variant="ghost" small
          onClick={() => setItems(list => list.map(it => ({ ...it, include: false })))}>Untick all</Btn>
        <Btn variant="ghost" small
          onClick={() => setItems(list => list.map(it => ({ ...it, apply: !!it.suggestions && it.apply === false })))}>Toggle suggestions</Btn>
      </div>

      <div className="rounded-control overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
        <div className="grid items-center px-2 text-label uppercase" style={{ gridTemplateColumns: '24px minmax(200px,2fr) 96px 90px minmax(150px,1.4fr) 110px', color: C.dim, backgroundColor: C.deep, borderBottom: `1px solid ${C.line}` }}>
          <span /><span className="px-1 py-1.5">Name</span><span className="px-1">Type</span><span className="px-1">Size</span><span className="px-1">From the name</span><span className="px-1">Folder</span>
        </div>
        <div className="max-h-[46vh] overflow-y-auto">
          {items.length > RENDER_CAP && (
            <div className="px-3 py-1.5 text-dense" style={{ color: C.amber, borderBottom: `1px solid ${C.faint}` }}>
              Showing the first {RENDER_CAP} of {items.length}. The rest are added with their defaults (ticked unless duplicate or missing); use Tick all / Untick all to change them together.
            </div>
          )}
          {items.slice(0, RENDER_CAP).map((it, idx) => {
            const disabled = it.status !== 'ok'
            const sug = suggestionText(it.suggestions)
            return (
              <div key={it.source_path} className="bn-add-row grid items-center px-2" data-disabled={disabled ? 'true' : undefined} data-included={it.include ? 'true' : undefined} style={{ gridTemplateColumns: '24px minmax(200px,2fr) 96px 90px minmax(150px,1.4fr) 110px', borderBottom: `1px solid ${C.faint}`, minHeight: 34 }}>
                <input type="checkbox" checked={!!it.include} disabled={disabled} onChange={e => set(idx, { include: e.target.checked })} className="accent-signal" />
                <div className="px-1 py-1 min-w-0">
                  <TextInput value={it.display_name} onChange={v => set(idx, { display_name: v })} disabled={disabled} className="!py-0.5" />
                  <div className="bn-add-meta truncate text-dense font-mono tabular-nums mt-0.5 flex items-center gap-1" data-duplicate={it.duplicate ? 'true' : undefined} title={it.source_path}>
                    {it.kind === 'sequence' && <Layers className="w-2.5 h-2.5" />}
                    {/* P1 review R2-07: the name and the sequence counts are
                        data (mono); the two status phrases are words, so the
                        sans. One span holds the run so the flex row keeps its
                        two items (icon, text) and the gap does not move. */}
                    <span>
                      {it.original_name}{it.kind === 'sequence' && it.sequence ? ` · ${it.sequence.frame_count} frames (${it.sequence.pattern})${it.sequence.missing_frames ? `, ${it.sequence.missing_frames} missing` : ''}${it.sequence.sidecars ? `, ${it.sequence.sidecars} sidecar file${it.sequence.sidecars === 1 ? '' : 's'} set aside` : ''}` : ''}
                      {disabled && <span className="font-sans"> · {refusedWords(it)}</span>}
                      {it.duplicate && <span className="font-sans">{` · already in ${it.duplicate.existing_bin_name ? `"${it.duplicate.existing_bin_name}"` : 'the project'}${it.duplicate.reason === 'same_name_size' ? ' (same name and size)' : ''}`}</span>}
                    </span>
                  </div>
                </div>
                <div className="px-1">
                  <Select value={it.media_type} disabled={disabled} options={MEDIA_TYPES.map(t => ({ value: t, label: MEDIA_TYPE_META[t].label }))} onChange={v => v && set(idx, { media_type: v })} className="!py-0.5" />
                </div>
                <div className="px-1 text-dense font-mono tabular-nums" style={{ color: C.muted }}>{formatBytes(it.size_bytes)}</div>
                <div className="px-1 min-w-0">
                  {sug ? (
                    <label className="flex items-center gap-1.5 cursor-pointer min-w-0">
                      <input type="checkbox" checked={!!it.apply} disabled={disabled} onChange={e => set(idx, { apply: e.target.checked })} className="accent-signal" />
                      <span className="bn-add-sug truncate text-dense" data-apply={it.apply ? 'true' : undefined} title={sug}>{sug}</span>
                    </label>
                  ) : <span className="text-dense" style={{ color: C.dimmer }}>—</span>}
                </div>
                <div className="px-1 truncate text-dense flex items-center gap-1" style={{ color: C.dim }} title={it.sub_bin || ''}>
                  {it.sub_bin ? <><FolderTree className="w-2.5 h-2.5 flex-shrink-0" />{it.sub_bin}</> : ''}
                </div>
              </div>
            )
          })}
          {items.length === 0 && <div className="px-3 py-4 text-dense" style={{ color: C.dimmer }}>Nothing to add.</div>}
        </div>
      </div>
      <div className="mt-2 text-dense leading-relaxed" style={{ color: C.dimmer }}>
        Files are referenced where they are; nothing is copied or renamed. A ticked suggestion fills slate, take, camera, roll and day from the file name; the batch fields above win where both are set.
        {' '}<MediaTag type="sequence" small /> a folder of numbered frames is added as one item.
      </div>
    </Modal>
  )
}

// BC2: "Which location is this? Name it." The share a picked file lies on,
// with a name to start from (its own); naming it makes it one of the
// company's footage locations, and the batch is read again inside it. Where
// the caller cannot name locations (no company), the banner says what to do.
function NameShareBanner({ root, count, onNameLocation, disabled }) {
  const [name, setName] = useState(() => suggestLocationName(root))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const go = async () => {
    const n = name.trim()
    if (!n || !onNameLocation) return
    setBusy(true); setError(null)
    try { await onNameLocation(root, n) }
    catch (e) { setError(String(e?.message || e).replace(/^\[(supabase|localServer)\]\s*/, '')) }
    finally { setBusy(false) }
  }
  return (
    <Banner tone="info" Icon={Server} className="mb-3 rounded-control" data-testid="name-share">
      <div className="flex flex-col gap-2">
        <span>
          {count === 1 ? 'One file is' : `${count} files are`} on <span className="font-mono">{root}</span>, which is not one of the company's footage locations yet.
          {onNameLocation ? ' Which location is this? Name it to add them.' : ' Name it in Settings, Storage, Footage locations to add them.'}
        </span>
        {onNameLocation && (
          <div className="flex items-center gap-2 flex-wrap">
            <TextInput value={name} onChange={setName} aria-label={`Name for ${root}`} placeholder="Footage NAS" className="!w-56" disabled={busy || disabled} />
            <Btn small primary onClick={go} disabled={busy || disabled || !name.trim()}>{busy ? 'Adding…' : 'Add as a footage location'}</Btn>
          </div>
        )}
        {error && <span role="alert" style={{ color: C.text }}>{error}</span>}
      </div>
    </Banner>
  )
}
