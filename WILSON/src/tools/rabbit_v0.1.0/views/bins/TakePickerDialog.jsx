// ============================================================
// RABBIT — shot takes: pick bin files for a shot (milestone 2)
// ============================================================
//
// From a shot: "a Takes affordance that opens the project's bins filtered
// sensibly (same scene first), multi-select, assign" (DEMO_BINS_BRIEF §5).
// The files are ranked in three tiers — logged for this shot, logged to the
// same scene, everything else — with selects and circled takes ahead of
// rejects inside each tier; search and the media-type chips narrow them;
// "same scene only" is on when the scene has any files. Files already
// assigned to the shot are shown ticked and locked so the batch is honest.

import { useMemo, useState } from 'react'
import { Search, X, Check, Film, Star } from 'lucide-react'
import { C, Btn, Modal, Select, Chip, MediaTag, FlagMark } from './binUi'
import BinPoster from './BinPoster'
import { MEDIA_TYPES, MEDIA_TYPE_META, slateLine, techLine } from '../../bins/binMedia'
import { matchesSearch, binPathLabel } from '../../bins/binSelectors'
import { rankFilesForShot, TIER_LABELS, TAKE_ROLES, TAKE_ROLE_META } from '../../bins/shotTakeSelectors'

export default function TakePickerDialog({ shot, scene, files, bins, assignedFileIds, hasPrimary, thumbUrlFor, onConfirm, onCancel, busy }) {
  const assigned = useMemo(() => new Set(assignedFileIds || []), [assignedFileIds])
  const ranked = useMemo(() => rankFilesForShot(files, shot), [files, shot])
  const sceneHasFiles = useMemo(() => ranked.some(r => r.tier < 2), [ranked])
  const [search, setSearch] = useState('')
  const [types, setTypes] = useState(() => new Set())
  const [sameSceneOnly, setSameSceneOnly] = useState(sceneHasFiles)
  const [picked, setPicked] = useState(() => new Set())
  const [role, setRole] = useState('auto')

  const rows = useMemo(() => ranked.filter(({ file, tier }) => {
    if (sameSceneOnly && tier === 2) return false
    if (types.size && !types.has(file.media_type)) return false
    return matchesSearch(file, search)
  }), [ranked, sameSceneOnly, types, search])
  const typesPresent = useMemo(() => MEDIA_TYPES.filter(t => (files || []).some(f => f.media_type === t)), [files])
  const toggle = (id) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pickAllShown = () => setPicked(new Set(rows.filter(r => !assigned.has(r.file.id)).map(r => r.file.id)))
  const n = picked.size
  const autoLabel = hasPrimary ? 'Automatic — alt (the shot has a primary already)' : 'Automatic — the first becomes primary, the rest alt'

  let lastTier = -1
  return (
    <Modal title={`Add takes to "${shot?.name || 'Untitled shot'}"`} onClose={onCancel} width={820} busy={busy}
      subtitle={`${scene ? `${scene.name || 'Untitled scene'} · ` : ''}${(files || []).length} file${(files || []).length === 1 ? '' : 's'} in the bins · ${rows.length} shown · ${assigned.size} already assigned`}
      footer={<>
        <Select value={role} className="!w-auto" options={[{ value: 'auto', label: autoLabel }, ...TAKE_ROLES.map(r => ({ value: r, label: `As ${TAKE_ROLE_META[r].label.toLowerCase()}` }))]} onChange={v => setRole(v || 'auto')} />
        <span className="flex-1" />
        <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
        <Btn primary disabled={busy || n === 0} onClick={() => onConfirm([...picked], role === 'auto' ? null : role)}><Check className="w-3 h-3" /> Assign {n || ''} {n === 1 ? 'take' : 'takes'}</Btn>
      </>}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: C.dim }} />
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, slate, notes, path…"
            className="pl-6 pr-6 py-1.5 text-[11px] font-mono rounded-sm focus:outline-none focus:ring-1 focus:ring-orange-500 w-64"
            style={{ backgroundColor: C.panel, color: C.text, border: `1px solid ${C.line}` }}
            onKeyDown={e => { if (e.key === 'Escape' && search) { e.stopPropagation(); setSearch('') } }} />
          {search && <button type="button" onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2" style={{ color: C.dim }}><X className="w-3 h-3" /></button>}
        </div>
        {sceneHasFiles && <Chip active={sameSceneOnly} onClick={() => setSameSceneOnly(v => !v)} title="Only files logged to this shot or its scene"><Film className="w-3 h-3" /> same scene only</Chip>}
        {typesPresent.map(t => <Chip key={t} active={types.has(t)} color={MEDIA_TYPE_META[t].color + 'cc'} onClick={() => setTypes(s => { const x = new Set(s); if (x.has(t)) x.delete(t); else x.add(t); return x })}>{MEDIA_TYPE_META[t].label}</Chip>)}
        <span className="ml-auto flex items-center gap-2">
          <button type="button" className="text-[10px] font-mono uppercase tracking-wider hover:text-stone-200" style={{ color: C.dim }} onClick={pickAllShown}>Tick all shown</button>
          <button type="button" className="text-[10px] font-mono uppercase tracking-wider hover:text-stone-200" style={{ color: C.dim }} onClick={() => setPicked(new Set())}>Untick all</button>
        </span>
      </div>

      <div className="rounded-sm overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
        <div className="max-h-[52vh] overflow-y-auto">
          {rows.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] font-mono" style={{ color: C.dimmer }}>
              {(files || []).length === 0 ? 'No files in any bin yet. Add footage on the Bins tab first.' : sameSceneOnly ? 'Nothing logged to this scene matches. Switch off "same scene only" to see every file.' : 'Nothing matches.'}
            </div>
          )}
          {rows.map(({ file, tier }) => {
            const header = tier !== lastTier ? TIER_LABELS[tier] : null
            lastTier = tier
            const locked = assigned.has(file.id)
            const on = locked || picked.has(file.id)
            return (
              <div key={file.id}>
                {header && <div className="px-3 py-1 text-[9.5px] font-mono uppercase tracking-wider" style={{ color: tier === 0 ? C.accentText : C.dim, backgroundColor: C.deep, borderBottom: `1px solid ${C.line}` }}>{header}</div>}
                <label className="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer" style={{ borderBottom: `1px solid ${C.faint}`, backgroundColor: on && !locked ? 'rgba(234,88,12,0.12)' : 'transparent', opacity: locked ? 0.6 : file.online === false ? 0.75 : 1 }}>
                  <input type="checkbox" className="accent-orange-600" checked={on} disabled={locked || busy} onChange={() => toggle(file.id)} />
                  <BinPoster row={file} src={thumbUrlFor?.(file.id)} width={64} height={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-[11.5px] font-mono" style={{ color: C.bright }}>{file.display_name || file.original_name}</span>
                      <FlagMark flag={file.review_flag} circled={file.circled} size={11} />
                      <MediaTag type={file.media_type} small />
                      {locked && <span className="text-[9px] font-mono uppercase tracking-wider inline-flex items-center gap-1" style={{ color: C.accentText }}><Star className="w-2.5 h-2.5" /> assigned</span>}
                    </div>
                    <div className="truncate text-[9.5px] font-mono" style={{ color: C.dim }}>
                      {[slateLine(file), techLine(file), binPathLabel(bins, file.bin_id)].filter(Boolean).join(' · ') || file.original_name}
                    </div>
                  </div>
                </label>
              </div>
            )
          })}
        </div>
      </div>
      <div className="mt-2 text-[9.5px] font-mono leading-relaxed" style={{ color: C.dimmer }}>
        Files stay in their bins; a take is a link. A file may be assigned to several shots. Roles: {TAKE_ROLES.map(r => `${TAKE_ROLE_META[r].label} — ${TAKE_ROLE_META[r].help}`).join(' ')}
      </div>
    </Modal>
  )
}
