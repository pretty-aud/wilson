import { X, Play, RotateCcw, BookOpen, FolderPlus } from 'lucide-react'

/**
 * Unified proposal popup for agent generation actions.
 *
 * Props:
 *   proposalData  - { mode: 'single_subject' | 'full_course', topic?, description?, softwareName? }
 *   onGenerate    - () => void — run the real generation pipeline
 *   onRefresh     - () => void — re-ask agent for a different proposal
 *   onCancel      - () => void
 *   loading       - boolean
 */
export default function LessonOutlinePopup({
  proposalData,
  onGenerate,
  onRefresh,
  onCancel,
  loading,
}) {
  const isSingleSubject = proposalData.mode === 'single_subject'
  const isCourse = proposalData.mode === 'full_course'

  const headerText = isSingleSubject ? 'New Subject' : 'New Course'
  const HeaderIcon = isSingleSubject ? BookOpen : FolderPlus
  const generateLabel = isSingleSubject ? 'Generate Subject' : 'Generate Course'
  const generatingLabel = isSingleSubject ? 'Generating...' : 'Generating...'
  const noteText = isSingleSubject
    ? 'This will generate a full subject with lessons, hotkeys, and web-sourced content using the AI pipeline.'
    : 'This will create a new course with 5-10 subject outlines. After creation, subjects can be filled with content using the Generate All button.'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div className="bg-stone-900 border-2 border-orange-500 rounded-sm shadow-2xl flex flex-col" style={{ width: '500px', maxHeight: '70vh' }}>
        {/* Header */}
        <div className="bg-stone-800 px-4 py-3 flex items-center justify-between border-b-2 border-stone-600 shrink-0 rounded-t-sm">
          <div className="flex items-center gap-2">
            <HeaderIcon className="w-4 h-4 text-orange-400" />
            <span className="text-sm font-bold text-orange-400 uppercase tracking-wide">{headerText}</span>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-stone-700 rounded transition-colors" disabled={loading}>
            <X className="w-4 h-4 text-stone-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Title / Topic */}
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">
              {isSingleSubject ? 'Topic' : 'Software / Language'}
            </div>
            <div className="text-lg font-bold text-orange-400">
              {isSingleSubject ? proposalData.topic : proposalData.softwareName}
            </div>
          </div>

          {/* Description */}
          {proposalData.description && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">Description</div>
              <div className="text-sm text-stone-300">{proposalData.description}</div>
            </div>
          )}

          {/* Info note */}
          <div className="bg-stone-800 border border-stone-600 rounded-sm px-3 py-2">
            <p className="text-xs text-stone-400 leading-relaxed">{noteText}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t-2 border-stone-600 flex items-center gap-2 shrink-0">
          <button
            onClick={onGenerate}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-700 text-white text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-green-600 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" /> {loading ? generatingLabel : generateLabel}
          </button>
          <button
            onClick={onRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-stone-700 text-stone-300 text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-stone-600 transition-colors disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Refresh
          </button>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 bg-stone-700 text-stone-300 text-xs font-bold uppercase tracking-wide rounded-sm hover:bg-stone-600 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
