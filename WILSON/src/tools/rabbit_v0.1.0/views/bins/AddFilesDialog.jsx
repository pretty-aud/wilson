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
import { AlertTriangle, Layers, FolderTree, Check } from 'lucide-react'
import { C, Btn, Modal, Select, TextInput, MediaTag, Toggle, Spinner } from './binUi'
import { MEDIA_TYPES, MEDIA_TYPE_META, formatBytes } from '../../bins/binMedia'

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

export default function AddFilesDialog({ bin, plan, scenes, onConfirm, onCancel, busy, progress }) {
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
  const included = items.filter(i => i.include && i.status === 'ok')
  const dupes = items.filter(i => i.duplicate).length
  const missing = items.filter(i => i.status !== 'ok').length
  const seqs = included.filter(i => i.kind === 'sequence').length
  const bytes = included.reduce((s, i) => s + (Number(i.size_bytes) || 0), 0)
  const sceneOptions = (scenes || []).slice().sort((a, b) => (a.scene_number ?? 0) - (b.scene_number ?? 0)).map(s => ({ value: s.id, label: s.name || 'Untitled scene' }))

  const confirm = () => {
    const tags = batch.tags.split(',').map(t => t.trim()).filter(Boolean)
    const out = included.map(it => {
      const s = it.apply ? (it.suggestions || {}) : {}
      return {
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
    <Modal title={`Add to "${bin?.name || 'bin'}"`} onClose={onCancel} width={860} busy={busy}
      subtitle={`${included.length} of ${items.length} will be added${seqs ? ` · ${seqs} sequence${seqs === 1 ? '' : 's'}` : ''}${dupes ? ` · ${dupes} duplicate${dupes === 1 ? '' : 's'}` : ''}${missing ? ` · ${missing} missing` : ''} · ${formatBytes(bytes)} referenced in place`}
      footer={<>
        {busy && progress && <span className="flex items-center gap-2 text-[10.5px] font-mono mr-auto" style={{ color: C.muted }}><Spinner /> {progress}</span>}
        <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
        <Btn primary onClick={confirm} disabled={busy || included.length === 0}><Check className="w-3 h-3" /> Add {included.length} {included.length === 1 ? 'item' : 'items'}</Btn>
      </>}>
      {plan?.truncated && (
        <div className="flex items-center gap-2 px-2 py-1.5 mb-3 rounded-sm text-[10.5px] font-mono" style={{ color: C.amber, border: `1px solid ${C.amber}55`, backgroundColor: 'rgba(245,158,11,0.08)' }}>
          <AlertTriangle className="w-3.5 h-3.5" /> The folder was too large to walk completely; add the rest in a second pass.
        </div>
      )}

      <div className="grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
        <label className="flex flex-col gap-1"><span className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: C.dim }}>Scene (all)</span>
          <Select value={batch.scene_id} placeholder="— none —" options={sceneOptions} onChange={v => setBatch(b => ({ ...b, scene_id: v }))} /></label>
        <label className="flex flex-col gap-1"><span className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: C.dim }}>Shoot day (all)</span>
          <TextInput type="date" value={batch.shoot_day} onChange={v => setBatch(b => ({ ...b, shoot_day: v }))} /></label>
        <label className="flex flex-col gap-1"><span className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: C.dim }}>Camera (all)</span>
          <TextInput value={batch.camera} onChange={v => setBatch(b => ({ ...b, camera: v.toUpperCase() }))} placeholder="A" maxLength={4} /></label>
        <label className="flex flex-col gap-1"><span className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: C.dim }}>Roll (all)</span>
          <TextInput value={batch.roll} onChange={v => setBatch(b => ({ ...b, roll: v.toUpperCase() }))} placeholder="A001" /></label>
        <label className="flex flex-col gap-1"><span className="text-[9.5px] font-mono uppercase tracking-wider" style={{ color: C.dim }}>Tags (all)</span>
          <TextInput value={batch.tags} onChange={v => setBatch(b => ({ ...b, tags: v }))} placeholder="hero, b-roll" /></label>
      </div>
      <div className="flex items-center gap-4 mb-2 flex-wrap">
        {anySub && <Toggle checked={createSubBins} onChange={setCreateSubBins} label="Folders become nested bins" />}
        <button type="button" className="text-[10px] font-mono uppercase tracking-wider hover:text-stone-200" style={{ color: C.dim }}
          onClick={() => setItems(list => list.map(it => ({ ...it, include: it.status === 'ok' })))}>Tick all</button>
        <button type="button" className="text-[10px] font-mono uppercase tracking-wider hover:text-stone-200" style={{ color: C.dim }}
          onClick={() => setItems(list => list.map(it => ({ ...it, include: false })))}>Untick all</button>
        <button type="button" className="text-[10px] font-mono uppercase tracking-wider hover:text-stone-200" style={{ color: C.dim }}
          onClick={() => setItems(list => list.map(it => ({ ...it, apply: !!it.suggestions && it.apply === false })))}>Toggle suggestions</button>
      </div>

      <div className="rounded-sm overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
        <div className="grid items-center px-2 text-[9.5px] font-mono uppercase tracking-wider" style={{ gridTemplateColumns: '24px minmax(200px,2fr) 96px 90px minmax(150px,1.4fr) 110px', color: C.dim, backgroundColor: C.deep, borderBottom: `1px solid ${C.line}` }}>
          <span /><span className="px-1 py-1.5">Name</span><span className="px-1">Type</span><span className="px-1">Size</span><span className="px-1">From the name</span><span className="px-1">Folder</span>
        </div>
        <div className="max-h-[46vh] overflow-y-auto">
          {items.length > RENDER_CAP && (
            <div className="px-3 py-1.5 text-[10px] font-mono" style={{ color: C.amber, borderBottom: `1px solid ${C.faint}` }}>
              Showing the first {RENDER_CAP} of {items.length}. The rest are added with their defaults (ticked unless duplicate or missing); use Tick all / Untick all to change them together.
            </div>
          )}
          {items.slice(0, RENDER_CAP).map((it, idx) => {
            const disabled = it.status !== 'ok'
            const sug = suggestionText(it.suggestions)
            return (
              <div key={it.source_path} className="grid items-center px-2" style={{ gridTemplateColumns: '24px minmax(200px,2fr) 96px 90px minmax(150px,1.4fr) 110px', borderBottom: `1px solid ${C.faint}`, opacity: disabled ? 0.5 : it.include ? 1 : 0.7, minHeight: 34 }}>
                <input type="checkbox" checked={!!it.include} disabled={disabled} onChange={e => set(idx, { include: e.target.checked })} className="accent-orange-600" />
                <div className="px-1 py-1 min-w-0">
                  <TextInput value={it.display_name} onChange={v => set(idx, { display_name: v })} disabled={disabled} className="!py-0.5" />
                  <div className="truncate text-[9px] font-mono mt-0.5 flex items-center gap-1" style={{ color: it.duplicate ? C.amber : C.dimmer }} title={it.source_path}>
                    {it.kind === 'sequence' && <Layers className="w-2.5 h-2.5" />}
                    {it.original_name}{it.kind === 'sequence' && it.sequence ? ` · ${it.sequence.frame_count} frames (${it.sequence.pattern})${it.sequence.missing_frames ? `, ${it.sequence.missing_frames} missing` : ''}${it.sequence.sidecars ? `, ${it.sequence.sidecars} sidecar file${it.sequence.sidecars === 1 ? '' : 's'} set aside` : ''}` : ''}
                    {disabled && ' · missing on disk'}
                    {it.duplicate && ` · already in ${it.duplicate.existing_bin_name ? `"${it.duplicate.existing_bin_name}"` : 'the project'}${it.duplicate.reason === 'same_name_size' ? ' (same name and size)' : ''}`}
                  </div>
                </div>
                <div className="px-1">
                  <Select value={it.media_type} disabled={disabled} options={MEDIA_TYPES.map(t => ({ value: t, label: MEDIA_TYPE_META[t].label }))} onChange={v => v && set(idx, { media_type: v })} className="!py-0.5" />
                </div>
                <div className="px-1 text-[10.5px] font-mono tabular-nums" style={{ color: C.muted }}>{formatBytes(it.size_bytes)}</div>
                <div className="px-1 min-w-0">
                  {sug ? (
                    <label className="flex items-center gap-1.5 cursor-pointer min-w-0">
                      <input type="checkbox" checked={!!it.apply} disabled={disabled} onChange={e => set(idx, { apply: e.target.checked })} className="accent-orange-600" />
                      <span className="truncate text-[10.5px] font-mono" style={{ color: it.apply ? C.accentText : C.dim }} title={sug}>{sug}</span>
                    </label>
                  ) : <span className="text-[10px] font-mono" style={{ color: C.dimmer }}>—</span>}
                </div>
                <div className="px-1 truncate text-[10px] font-mono flex items-center gap-1" style={{ color: C.dim }} title={it.sub_bin || ''}>
                  {it.sub_bin ? <><FolderTree className="w-2.5 h-2.5 flex-shrink-0" />{it.sub_bin}</> : ''}
                </div>
              </div>
            )
          })}
          {items.length === 0 && <div className="px-3 py-4 text-[11px] font-mono" style={{ color: C.dimmer }}>Nothing to add.</div>}
        </div>
      </div>
      <div className="mt-2 text-[9.5px] font-mono leading-relaxed" style={{ color: C.dimmer }}>
        Files are referenced where they are; nothing is copied or renamed. A ticked suggestion fills slate, take, camera, roll and day from the file name; the batch fields above win where both are set.
        {' '}<MediaTag type="sequence" small /> a folder of numbered frames is added as one item.
      </div>
    </Modal>
  )
}
