// ============================================================
// RABBIT — shot takes: the chip strip on a shot row (milestone 2)
// ============================================================
//
// Audrey: "the shot item in the scenes table should be able to show which
// take/files are being used in the shot." One poster per assigned take, the
// primary ringed in orange with a star, "+n" past the first few, and the
// count. With nothing assigned it is the affordance that opens the picker.
// Every click stops propagation: the strip sits inside rows that open the
// detail view on click.

import { Plus, Star } from 'lucide-react'
import { C } from './binUi'
import BinPoster from './BinPoster'
import { TAKE_ROLE_META } from '../../bins/shotTakeSelectors'

export default function ShotTakeChips({ entries, thumbUrlFor, height = 24, max = 4, onOpen, canWrite = true }) {
  const list = entries || []
  const w = Math.round(height * 16 / 9)
  const shown = list.slice(0, max)
  const extra = list.length - shown.length
  const open = (e) => { e.stopPropagation(); onOpen?.() }
  if (!list.length) {
    return (
      <button type="button" onClick={open} title={canWrite ? 'Assign takes from the bins' : 'No takes assigned'}
        className="inline-flex items-center gap-1 px-1.5 rounded-sm text-[9px] font-mono uppercase tracking-wider hover:bg-stone-700 transition-colors"
        style={{ height, color: C.dimmer, border: `1px dashed ${C.line}` }}>
        {canWrite ? <><Plus style={{ width: 10, height: 10 }} /> takes</> : '—'}
      </button>
    )
  }
  return (
    <button type="button" onClick={open} title={`${list.length} take${list.length === 1 ? '' : 's'} — click to manage`}
      className="inline-flex items-center gap-1 rounded-sm px-0.5 hover:bg-stone-700/60 transition-colors" style={{ height: height + 4 }}>
      {shown.map(({ take, file }) => (
        <span key={take.id} className="relative inline-block flex-shrink-0" title={`${file.display_name || file.original_name} · ${TAKE_ROLE_META[take.role]?.label || take.role}`}>
          <BinPoster row={file} src={thumbUrlFor?.(file.id)} width={w} height={height} radius={2}
            style={{ border: `1px solid ${take.role === 'primary' ? C.accent : C.line}`, boxShadow: take.role === 'primary' ? `0 0 0 1px ${C.accent}` : 'none' }} />
          {take.role === 'primary' && (
            <Star style={{ width: 8, height: 8, position: 'absolute', top: 1, left: 1, color: C.accentText, fill: C.accentText }} />
          )}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[9px] font-mono px-1 rounded-sm" style={{ color: C.muted, backgroundColor: C.panel, border: `1px solid ${C.line}` }}>+{extra}</span>
      )}
      <span className="text-[9.5px] font-mono tabular-nums ml-0.5" style={{ color: C.muted }}>{list.length}</span>
    </button>
  )
}
