import { useState } from 'react'
import { X, Check, SkipForward, CheckCheck, Pencil } from 'lucide-react'

// Compute simple word-level diff for display
function computeWordDiff(original, proposed) {
  const origWords = original.split(/(\s+)/)
  const propWords = proposed.split(/(\s+)/)
  const origSet = new Set(origWords)
  const propSet = new Set(propWords)

  const origHighlighted = origWords.map((w, i) => {
    if (/^\s+$/.test(w)) return { text: w, type: 'same' }
    // Simple check: if this word doesn't appear in proposed at same relative position
    if (i < propWords.length && w === propWords[i]) return { text: w, type: 'same' }
    return { text: w, type: 'removed' }
  })

  const propHighlighted = propWords.map((w, i) => {
    if (/^\s+$/.test(w)) return { text: w, type: 'same' }
    if (i < origWords.length && w === origWords[i]) return { text: w, type: 'same' }
    return { text: w, type: 'added' }
  })

  return { origHighlighted, propHighlighted }
}

export default function DiffView({
  changes,        // Array of { field, original, proposed } or single edit
  lessonTitle,
  subjectTitle,
  bulkIndex,      // Current index in bulk operation (null if single)
  bulkTotal,      // Total edits in bulk operation (null if single)
  onApply,        // () => void
  onReject,       // () => void
  onEdit,         // (instruction) => void — send agent back with more instructions
  onApplyAll,     // () => void — bulk: apply all remaining
  onSkip,         // () => void — bulk: skip this one
  onClose,        // () => void
}) {
  const [editMode, setEditMode] = useState(false)
  const [editInstruction, setEditInstruction] = useState('')
  const isBulk = bulkIndex != null && bulkTotal != null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div className="bg-stone-900 border-2 border-orange-500 rounded-sm shadow-2xl flex flex-col" style={{ width: '85%', maxWidth: '1000px', maxHeight: '80vh' }}>
        {/* Header */}
        <div className="bg-stone-800 px-4 py-3 flex items-center justify-between border-b-2 border-stone-600 shrink-0 rounded-t-sm">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-orange-400 uppercase tracking-wide">
              {isBulk ? `Change ${bulkIndex + 1} of ${bulkTotal}` : 'Proposed Changes'}
            </span>
            {lessonTitle && (
              <span className="text-xs text-stone-400 font-mono">
                {subjectTitle ? `${subjectTitle} → ` : ''}{lessonTitle}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-stone-700 rounded transition-colors">
            <X className="w-4 h-4 text-stone-400" />
          </button>
        </div>

        {/* Diff content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {changes.map((change, idx) => {
            const { origHighlighted, propHighlighted } = computeWordDiff(change.original, change.proposed)
            return (
              <div key={idx} className="border border-stone-700 rounded-sm overflow-hidden">
                <div className="bg-stone-800 px-3 py-1.5 border-b border-stone-700">
                  <span className="text-xs font-bold text-stone-400 uppercase tracking-wide">
                    {change.field === 'content' ? 'Content' : change.field}
                  </span>
                </div>
                <div className="grid grid-cols-2 divide-x divide-stone-700">
                  {/* Original */}
                  <div className="p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-red-400 mb-2">Original</div>
                    <div className="text-sm text-stone-300 font-mono whitespace-pre-wrap leading-relaxed">
                      {origHighlighted.map((w, i) => (
                        <span key={i} className={w.type === 'removed' ? 'bg-red-900/50 text-red-300 line-through' : ''}>
                          {w.text}
                        </span>
                      ))}
                    </div>
                  </div>
                  {/* Proposed */}
                  <div className="p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-green-400 mb-2">Proposed</div>
                    <div className="text-sm text-stone-300 font-mono whitespace-pre-wrap leading-relaxed">
                      {propHighlighted.map((w, i) => (
                        <span key={i} className={w.type === 'added' ? 'bg-green-900/50 text-green-300' : ''}>
                          {w.text}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Edit instruction area */}
        {editMode && (
          <div className="px-4 py-3 border-t border-stone-700 flex gap-2">
            <input
              value={editInstruction}
              onChange={e => setEditInstruction(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && editInstruction.trim()) { onEdit(editInstruction); setEditMode(false); setEditInstruction(''); } }}
              placeholder="Tell the agent what to change..."
              className="flex-1 bg-stone-800 text-stone-200 border border-stone-600 rounded-sm px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-orange-500"
              autoFocus
            />
            <button
              onClick={() => { if (editInstruction.trim()) { onEdit(editInstruction); setEditMode(false); setEditInstruction(''); } }}
              className="px-3 py-1.5 bg-orange-600 text-white text-xs font-bold uppercase rounded-sm hover:bg-orange-700 transition-colors"
            >
              Send
            </button>
            <button
              onClick={() => { setEditMode(false); setEditInstruction(''); }}
              className="px-3 py-1.5 bg-stone-700 text-stone-300 text-xs font-bold uppercase rounded-sm hover:bg-stone-600 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div className="px-4 py-3 border-t-2 border-stone-600 flex items-center gap-2 shrink-0">
          <button
            onClick={onApply}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-700 text-white text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-green-600 transition-colors"
          >
            <Check className="w-3.5 h-3.5" /> Apply Changes
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-800 text-white text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-red-700 transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Reject
          </button>
          {!editMode && (
            <button
              onClick={() => setEditMode(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-stone-700 text-stone-300 text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-stone-600 transition-colors"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit & Resubmit
            </button>
          )}
          <div className="flex-1" />
          {isBulk && (
            <>
              <button
                onClick={onSkip}
                className="flex items-center gap-1.5 px-4 py-2 bg-stone-700 text-stone-300 text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-stone-600 transition-colors"
              >
                <SkipForward className="w-3.5 h-3.5" /> Skip
              </button>
              <button
                onClick={onApplyAll}
                className="flex items-center gap-1.5 px-4 py-2 bg-orange-700 text-white text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-orange-600 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" /> Apply All Remaining
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
