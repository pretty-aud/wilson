// ============================================================
// Projects — detail panel (single project, read+write)
// ============================================================

import { useState, useRef } from 'react'
import { Trash2, FileText, Image, Calendar, ChevronLeft, X, Upload, Rabbit as RabbitIcon } from 'lucide-react'

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function ProjectDetailPanel({
  project,
  onBack,
  onUpdate,
  onOpenInRabbit,
  onDelete,
  deleteConfirm,
  onRequestDelete,
  onCancelDelete,
  onUploadFiles,
  onRemoveFile,
  saveError,
  storageWarning,
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
        {/* Back / open-in-RABBIT row */}
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Projects
          </button>
          {onOpenInRabbit && (
            <button
              onClick={onOpenInRabbit}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
              style={{ backgroundColor: '#44403c', color: '#fb923c', border: '1px solid #57534e' }}
              title="Open this project in RABBIT"
            >
              <RabbitIcon className="w-4 h-4" />
              Open in RABBIT
            </button>
          )}
        </div>

        {/* Title */}
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-stone-800 mb-1 block">Title</label>
          <input
            type="text"
            value={project.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            className="w-full px-4 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none' }}
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-stone-800 mb-1 block">Description</label>
          <textarea
            value={project.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
            rows={4}
            placeholder="Brief description of the project..."
            className="w-full px-4 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-y"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none' }}
          />
        </div>

        {/* Status */}
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-stone-800 mb-1 block">Status</label>
          <select
            value={project.status || 'active'}
            onChange={(e) => onUpdate({ status: e.target.value })}
            className="px-4 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none cursor-pointer"
            style={{
              backgroundColor: '#1c1917',
              color: (project.status || 'active') === 'active' ? '#22c55e' : '#ef4444',
              border: 'none',
              minWidth: '180px',
            }}
          >
            <option value="active" style={{ color: '#22c55e' }}>Active</option>
            <option value="inactive" style={{ color: '#ef4444' }}>Inactive</option>
          </select>
        </div>

        {/* Dates */}
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-stone-800 mb-1 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" />
            Dates
          </label>
          <div className="flex gap-4">
            <div className="flex-1">
              <span className="text-[10px] text-stone-600 uppercase tracking-wide block mb-1">Start Date</span>
              <input
                type="date"
                value={project.startDate}
                onChange={(e) => onUpdate({ startDate: e.target.value })}
                className="w-full px-4 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none', colorScheme: 'dark' }}
              />
            </div>
            <div className="flex-1">
              <span className="text-[10px] text-stone-600 uppercase tracking-wide block mb-1">End Date</span>
              <input
                type="date"
                value={project.endDate}
                onChange={(e) => onUpdate({ endDate: e.target.value })}
                className="w-full px-4 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none', colorScheme: 'dark' }}
              />
            </div>
          </div>
        </div>

        {/* Related Documents */}
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-stone-800 mb-1 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" />
            Related Documents & Assets
          </label>
          <p className="text-[10px] text-stone-600 mb-2">PDF, DOC, DOCX, TXT, MD, CSV, XLSX files only</p>
          <FileDropZone
            files={project.documents}
            accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx"
            onUpload={(files) => onUploadFiles('documents', files)}
            onRemove={(fileId) => onRemoveFile('documents', fileId)}
          />
        </div>

        {/* Visual Assets */}
        <div>
          <label className="text-xs font-bold uppercase tracking-widest text-stone-800 mb-1 flex items-center gap-1.5">
            <Image className="w-3.5 h-3.5" />
            Visual Assets
          </label>
          <p className="text-[10px] text-stone-600 mb-2">Images and videos only</p>
          <FileDropZone
            files={project.visualAssets}
            accept="image/*,video/*"
            onUpload={(files) => onUploadFiles('visualAssets', files)}
            onRemove={(fileId) => onRemoveFile('visualAssets', fileId)}
            showThumbnails
          />
        </div>

        {/* Delete project */}
        <div className="pt-4 border-t border-stone-400/30">
          {deleteConfirm ? (
            <div className="flex items-center gap-3">
              <span className="text-xs text-red-700 font-bold">Delete this project permanently?</span>
              <button
                onClick={onDelete}
                className="px-3 py-1 text-xs font-bold uppercase rounded-sm transition-colors"
                style={{ backgroundColor: '#dc2626', color: '#fff' }}
              >
                Confirm
              </button>
              <button
                onClick={onCancelDelete}
                className="px-3 py-1 text-xs font-bold uppercase rounded-sm text-stone-600 hover:text-stone-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={onRequestDelete}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
              style={{ backgroundColor: '#dc2626', color: '#fff' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Project
            </button>
          )}
        </div>

        {saveError && (
          <div className="text-xs text-red-700 bg-red-100/50 px-3 py-2 rounded">
            {saveError}
          </div>
        )}

        {storageWarning && (
          <div className="text-xs text-amber-700 bg-amber-100/50 px-3 py-2 rounded">
            Storage usage is high. Consider removing unused files to free up space.
          </div>
        )}
      </div>
    </div>
  )
}

// File upload / drop zone sub-component
function FileDropZone({ files, accept, onUpload, onRemove, showThumbnails }) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  return (
    <div>
      {/* Drop zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragging(false)}
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed rounded-sm px-4 py-4 text-center cursor-pointer transition-colors"
        style={{
          borderColor: isDragging ? '#ea580c' : '#78716c',
          backgroundColor: isDragging ? 'rgba(234, 88, 12, 0.1)' : 'transparent',
        }}
      >
        <Upload className="w-5 h-5 mx-auto mb-1" style={{ color: '#78716c' }} />
        <p className="text-xs text-stone-600">Drop files here or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files.length > 0) onUpload(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-2 space-y-1">
          {files.map(file => (
            <div key={file.id} className="flex items-center gap-2 px-3 py-1.5 rounded-sm" style={{ backgroundColor: '#1c1917' }}>
              {showThumbnails && file.type?.startsWith('image/') && (
                <img
                  src={file.content}
                  alt={file.name}
                  className="w-8 h-8 object-cover rounded-sm flex-shrink-0"
                />
              )}
              <span className="text-xs text-orange-400 truncate flex-1">{file.name}</span>
              <span className="text-[10px] text-stone-600 flex-shrink-0">{formatFileSize(file.size)}</span>
              <button
                onClick={() => onRemove(file.id)}
                className="p-0.5 text-stone-600 hover:text-red-400 transition-colors flex-shrink-0"
                title="Remove file"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
