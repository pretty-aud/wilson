// ============================================================
// RABBIT — shot takes: assign bin files to shots (milestone 2)
// ============================================================
//
// From a bin file: "Assign to shot… (pick scene → shot, with search; assign
// several files at once)" (DEMO_BINS_BRIEF §5). The shots are grouped by
// scene with the scene most of the files are logged to first; omitted shots
// are hidden and counted (Q6: any shot not marked omitted); several shots may
// be ticked because one take may serve several shots. A shot that already
// has some of these files says so, and those pairs are skipped by the server.

import { useMemo, useState } from 'react'
import { Search, X, Check, Film, Clapperboard } from 'lucide-react'
import { C, Btn, Modal, Select } from './binUi'
import BinPoster from './BinPoster'
import { assignableShotGroups, commonSceneId, matchesShotSearch, TAKE_ROLES, TAKE_ROLE_META } from '../../bins/shotTakeSelectors'

function statusColor(status) {
  switch (status) {
    case 'in_progress': return '#fb923c'
    case 'pending_review': return '#fbbf24'
    case 'needs_revisions': return '#e879f9'
    case 'approved': return '#4ade80'
    case 'final': return '#22c55e'
    case 'blocked': return '#ef4444'
    case 'on_hold': return '#fcd34d'
    case 'omitted': return '#57534e'
    default: return '#a8a29e'
  }
}

export default function AssignToShotDialog({ files, binFiles, scenes, shots, shotTakes, thumbUrlFor, onConfirm, onCancel, busy, error = null }) {
  const fileIds = useMemo(() => new Set((files || []).map(f => f.id)), [files])
  const liveFiles = useMemo(() => new Set((binFiles || []).map(f => f.id)), [binFiles])
  const preferSceneId = useMemo(() => commonSceneId(files), [files])
  const { groups, hiddenOmitted } = useMemo(() => assignableShotGroups(shots, scenes, { preferSceneId }), [shots, scenes, preferSceneId])
  // Counted through the live files, like every other consumer: a take whose
  // file was just removed is an orphan in state until the next response and
  // must not be counted (adversarial review).
  const takesPerShot = useMemo(() => {
    const out = new Map()
    for (const t of shotTakes || []) {
      if (binFiles && !liveFiles.has(t.bin_file_id)) continue
      if (!out.has(t.shot_id)) out.set(t.shot_id, { total: 0, ofThese: 0 })
      const o = out.get(t.shot_id); o.total++; if (fileIds.has(t.bin_file_id)) o.ofThese++
    }
    return out
  }, [shotTakes, fileIds, binFiles, liveFiles])
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState(() => new Set())
  const [role, setRole] = useState('auto')
  const toggle = (id) => setPicked(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const shown = useMemo(() => groups.map(g => ({ ...g, shots: g.shots.filter(s => matchesShotSearch(s, g.scene, search)) })).filter(g => g.shots.length), [groups, search])
  const nFiles = (files || []).length
  const nShots = picked.size
  const totalShots = groups.reduce((n, g) => n + g.shots.length, 0)

  return (
    <Modal title={nFiles === 1 ? `Assign "${files[0].display_name || files[0].original_name}" to a shot` : `Assign ${nFiles} files to a shot`} onClose={onCancel} width={720} busy={busy} error={error}
      subtitle={`${totalShots} shot${totalShots === 1 ? '' : 's'} across ${groups.filter(g => g.scene).length} scene${groups.filter(g => g.scene).length === 1 ? '' : 's'}${hiddenOmitted ? ` · ${hiddenOmitted} omitted shot${hiddenOmitted === 1 ? '' : 's'} hidden` : ''}`}
      footer={<>
        <Select value={role} className="!w-auto" options={[{ value: 'auto', label: 'Automatic — primary if the shot has none, else alt' }, ...TAKE_ROLES.map(r => ({ value: r, label: `As ${TAKE_ROLE_META[r].label.toLowerCase()}` }))]} onChange={v => setRole(v || 'auto')} />
        <span className="flex-1" />
        <Btn onClick={onCancel} disabled={busy}>Cancel</Btn>
        <Btn primary disabled={busy || nShots === 0} onClick={() => onConfirm([...picked], role === 'auto' ? null : role)}>
          <Check className="w-3 h-3" /> Assign to {nShots || ''} {nShots === 1 ? 'shot' : 'shots'}
        </Btn>
      </>}>
      <div className="flex items-center gap-1.5 mb-3 overflow-x-auto pb-1">
        {(files || []).slice(0, 12).map(f => (
          <span key={f.id} className="flex-shrink-0 inline-flex items-center gap-1.5 pr-2 rounded-sm" style={{ backgroundColor: C.panel, border: `1px solid ${C.line}` }} title={f.display_name || f.original_name}>
            <BinPoster row={f} src={thumbUrlFor?.(f.id)} width={44} height={25} radius={0} style={{ border: 'none' }} />
            <span className="text-[10px] font-mono truncate" style={{ color: C.text, maxWidth: 120 }}>{f.display_name || f.original_name}</span>
          </span>
        ))}
        {nFiles > 12 && <span className="text-[10px] font-mono flex-shrink-0" style={{ color: C.dim }}>+{nFiles - 12} more</span>}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <div className="relative flex-1">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: C.dim }} />
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shots by name, number, scene or framing…"
            className="w-full pl-6 pr-6 py-1.5 text-[11px] font-mono rounded-sm focus:ring-1 focus:ring-orange-500"
            style={{ backgroundColor: C.panel, color: C.text, border: `1px solid ${C.line}` }}
            onKeyDown={e => { if (e.key === 'Escape' && search) { e.stopPropagation(); setSearch('') } }} />
          {search && <button type="button" onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2" style={{ color: C.dim }}><X className="w-3 h-3" /></button>}
        </div>
        <span className="text-[9.5px] font-mono" style={{ color: C.dimmer }}>tick several to use these takes in more than one shot · a shot's first take is always its primary</span>
      </div>

      <div className="rounded-sm overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
        <div className="max-h-[48vh] overflow-y-auto">
          {shown.length === 0 && (
            <div className="px-3 py-6 text-center text-[11px] font-mono" style={{ color: C.dimmer }}>
              {totalShots === 0 ? 'No shots to assign to yet. Add shots on the Scenes tab first.' : 'No shot matches.'}
            </div>
          )}
          {shown.map(g => (
            <div key={g.key}>
              <div className="flex items-center gap-2 px-3 py-1 text-[9.5px] font-mono uppercase tracking-wider" style={{ color: g.key === preferSceneId ? C.accentText : C.dim, backgroundColor: C.deep, borderBottom: `1px solid ${C.line}` }}>
                <Film className="w-3 h-3" /> {g.scene ? `${g.scene.scene_number != null ? `Sc ${g.scene.scene_number} · ` : ''}${g.scene.name || 'Untitled scene'}` : 'Shots without a scene'}
                {g.key === preferSceneId && <span className="normal-case tracking-normal" style={{ color: C.dim }}>· where these files are logged</span>}
              </div>
              {g.shots.map(shot => {
                const on = picked.has(shot.id)
                const t = takesPerShot.get(shot.id)
                const allIn = t && t.ofThese === nFiles
                return (
                  <label key={shot.id} className="flex items-center gap-2.5 px-2.5 py-1.5 cursor-pointer" style={{ borderBottom: `1px solid ${C.faint}`, backgroundColor: on ? 'rgba(234,88,12,0.12)' : 'transparent', opacity: allIn ? 0.6 : 1 }}>
                    <input type="checkbox" className="accent-orange-600" checked={on} disabled={busy || allIn} onChange={() => toggle(shot.id)} />
                    <Clapperboard className="w-3 h-3 flex-shrink-0" style={{ color: C.dimmer }} />
                    <span className="w-8 text-[10.5px] font-mono tabular-nums text-right flex-shrink-0" style={{ color: C.dim }}>#{shot.shot_number ?? '—'}</span>
                    <span className="flex-1 min-w-0 truncate text-[11.5px] font-mono" style={{ color: C.bright }}>{shot.name || 'Untitled shot'}</span>
                    {shot.framing && <span className="text-[9.5px] font-mono uppercase flex-shrink-0" style={{ color: C.dim }}>{shot.framing}</span>}
                    <span className="px-1.5 py-0.5 text-[8.5px] font-mono uppercase tracking-wider rounded-sm flex-shrink-0" style={{ color: statusColor(shot.status), backgroundColor: 'rgba(0,0,0,0.3)', border: `1px solid ${statusColor(shot.status)}30` }}>{String(shot.status || 'not_started').replace(/_/g, ' ')}</span>
                    <span className="w-36 text-right text-[9.5px] font-mono flex-shrink-0" style={{ color: t?.ofThese ? C.accentText : C.dimmer }}>
                      {t ? `${t.total} take${t.total === 1 ? '' : 's'}${t.ofThese ? ` · ${allIn ? (nFiles === 1 ? 'already assigned' : 'all of these already') : `${t.ofThese} of these already`}` : ''}` : 'no takes yet'}
                    </span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
