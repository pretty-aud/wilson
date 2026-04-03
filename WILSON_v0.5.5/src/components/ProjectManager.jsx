import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Trash2, FileText, Image, Calendar, ChevronLeft, X, Upload } from 'lucide-react'
import { loadProjects as idbLoadProjects, saveProjects as idbSaveProjects, loadProjectsSync, STORAGE_WARNING_BYTES } from '../storage'

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function createEmptyProject(title) {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    title: title || 'Untitled Project',
    description: '',
    status: 'active',
    startDate: '',
    endDate: '',
    documents: [],
    visualAssets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export default function ProjectManager() {
  // Initialize with sync localStorage data, then hydrate from IndexedDB
  const [projects, setProjects] = useState(loadProjectsSync);
  const [view, setView] = useState('list'); // 'list' | 'create' | 'detail'
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [newTitle, setNewTitle] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [storageWarning, setStorageWarning] = useState(false);
  const [saveError, setSaveError] = useState('');
  const saveTimerRef = useRef(null);
  const hydratedRef = useRef(false);

  const activeProject = projects.find(p => p.id === activeProjectId) || null;

  // Hydrate from IndexedDB on mount (async — overwrites sync localStorage data if IDB has data)
  useEffect(() => {
    idbLoadProjects().then(idbProjects => {
      if (idbProjects && idbProjects.length > 0) {
        setProjects(idbProjects);
      }
      hydratedRef.current = true;
    }).catch(() => {
      hydratedRef.current = true;
    });
  }, []);

  // Auto-save with debounce — saves to IndexedDB
  useEffect(() => {
    if (!hydratedRef.current) return; // Don't save until hydrated
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      idbSaveProjects(projects).then(bytes => {
        setStorageWarning(bytes > STORAGE_WARNING_BYTES);
        setSaveError('');
      }).catch(err => {
        console.error('[WILSON] Save failed:', err);
        setSaveError('Failed to save — storage may be full.');
      });
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [projects]);

  const updateProject = useCallback((id, updates) => {
    setProjects(prev => prev.map(p =>
      p.id === id ? { ...p, ...updates, updatedAt: new Date().toISOString() } : p
    ));
  }, []);

  const handleCreateProject = () => {
    if (!newTitle.trim()) return;
    const project = createEmptyProject(newTitle.trim());
    setProjects(prev => [project, ...prev]);
    setActiveProjectId(project.id);
    setNewTitle('');
    setView('detail');
  };

  const handleDeleteProject = (id) => {
    setProjects(prev => prev.filter(p => p.id !== id));
    setDeleteConfirm(null);
    if (activeProjectId === id) {
      setActiveProjectId(null);
      setView('list');
    }
  };

  const handleFileUpload = useCallback((projectId, category, files) => {
    const promises = Array.from(files).map(file => {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve({
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          name: file.name,
          content: reader.result,
          type: file.type,
          size: file.size,
        });
        reader.readAsDataURL(file);
      });
    });

    Promise.all(promises).then(newFiles => {
      setProjects(prev => prev.map(p => {
        if (p.id !== projectId) return p;
        return {
          ...p,
          [category]: [...p[category], ...newFiles],
          updatedAt: new Date().toISOString(),
        };
      }));
    });
  }, []);

  const handleRemoveFile = useCallback((projectId, category, fileId) => {
    setProjects(prev => prev.map(p => {
      if (p.id !== projectId) return p;
      return {
        ...p,
        [category]: p[category].filter(f => f.id !== fileId),
        updatedAt: new Date().toISOString(),
      };
    }));
  }, []);

  // Create prompt view
  if (view === 'create') {
    return (
      <div className="h-full flex items-center justify-center px-8">
        <div className="w-full max-w-md">
          <h2 className="text-lg font-bold uppercase tracking-widest text-stone-900 mb-6 text-center">
            Create New Project
          </h2>
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateProject(); }}
            placeholder="Enter project title..."
            autoFocus
            className="w-full px-4 py-3 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none' }}
          />
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => { setView('list'); setNewTitle(''); }}
              className="flex-1 px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
              style={{ backgroundColor: '#44403c', color: '#a8a29e' }}
            >
              Cancel
            </button>
            <button
              onClick={handleCreateProject}
              disabled={!newTitle.trim()}
              className="flex-1 px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors disabled:opacity-40"
              style={{ backgroundColor: '#ea580c', color: '#fff' }}
            >
              Create
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Project detail view
  if (view === 'detail' && activeProject) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8 space-y-6">
          {/* Back to list */}
          <button
            onClick={() => { setView('list'); setActiveProjectId(null); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors mb-2"
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
          >
            <ChevronLeft className="w-4 h-4" />
            Back to Projects
          </button>

          {/* Title */}
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-stone-800 mb-1 block">Title</label>
            <input
              type="text"
              value={activeProject.title}
              onChange={(e) => updateProject(activeProject.id, { title: e.target.value })}
              className="w-full px-4 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none' }}
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-stone-800 mb-1 block">Description</label>
            <textarea
              value={activeProject.description}
              onChange={(e) => updateProject(activeProject.id, { description: e.target.value })}
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
              value={activeProject.status || 'active'}
              onChange={(e) => updateProject(activeProject.id, { status: e.target.value })}
              className="px-4 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500 appearance-none cursor-pointer"
              style={{ backgroundColor: '#1c1917', color: (activeProject.status || 'active') === 'active' ? '#22c55e' : '#ef4444', border: 'none', minWidth: '180px' }}
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
                  value={activeProject.startDate}
                  onChange={(e) => updateProject(activeProject.id, { startDate: e.target.value })}
                  className="w-full px-4 py-2 text-sm font-mono rounded-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
                  style={{ backgroundColor: '#1c1917', color: '#f4a261', border: 'none', colorScheme: 'dark' }}
                />
              </div>
              <div className="flex-1">
                <span className="text-[10px] text-stone-600 uppercase tracking-wide block mb-1">End Date</span>
                <input
                  type="date"
                  value={activeProject.endDate}
                  onChange={(e) => updateProject(activeProject.id, { endDate: e.target.value })}
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
              files={activeProject.documents}
              accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx"
              onUpload={(files) => handleFileUpload(activeProject.id, 'documents', files)}
              onRemove={(fileId) => handleRemoveFile(activeProject.id, 'documents', fileId)}
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
              files={activeProject.visualAssets}
              accept="image/*,video/*"
              onUpload={(files) => handleFileUpload(activeProject.id, 'visualAssets', files)}
              onRemove={(fileId) => handleRemoveFile(activeProject.id, 'visualAssets', fileId)}
              showThumbnails
            />
          </div>

          {/* Delete project */}
          <div className="pt-4 border-t border-stone-400/30">
            {deleteConfirm === activeProject.id ? (
              <div className="flex items-center gap-3">
                <span className="text-xs text-red-700 font-bold">Delete this project permanently?</span>
                <button
                  onClick={() => handleDeleteProject(activeProject.id)}
                  className="px-3 py-1 text-xs font-bold uppercase rounded-sm transition-colors"
                  style={{ backgroundColor: '#dc2626', color: '#fff' }}
                >
                  Confirm
                </button>
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="px-3 py-1 text-xs font-bold uppercase rounded-sm text-stone-600 hover:text-stone-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setDeleteConfirm(activeProject.id)}
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
    );
  }

  // List view (default)
  return (
    <div className="h-full flex flex-col">
      <div className="max-w-4xl mx-auto w-full px-8 py-8 flex-1">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-stone-900">
              Projects
            </h2>
            <p className="text-[10px] text-stone-600 mt-0.5">Create and manage your deck projects, upload reference documents and visual assets</p>
          </div>
          <button
            onClick={() => setView('create')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
            style={{ backgroundColor: '#ea580c', color: '#fff' }}
          >
            <Plus className="w-3.5 h-3.5" />
            New Project
          </button>
        </div>

        {projects.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
              style={{ backgroundColor: '#1c1917' }}>
              <Plus className="w-6 h-6 text-stone-500" />
            </div>
            <p className="text-sm text-stone-700 font-bold mb-1">No projects yet</p>
            <p className="text-xs text-stone-500 mb-4">Create your first project to get started</p>
            <button
              onClick={() => setView('create')}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wide rounded-sm transition-colors"
              style={{ backgroundColor: '#ea580c', color: '#fff' }}
            >
              Create Project
            </button>
          </div>
        ) : (
          /* Project table */
          <div className="rounded-sm overflow-hidden" style={{ backgroundColor: '#1c1917' }}>
            {/* Table header */}
            <div className="grid grid-cols-[1fr_90px_120px_120px_40px] gap-4 px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-stone-500 border-b border-stone-700">
              <span>Title</span>
              <span>Status</span>
              <span>Start</span>
              <span>End</span>
              <span></span>
            </div>
            {/* Rows */}
            {projects.map(project => (
              <div
                key={project.id}
                className="grid grid-cols-[1fr_90px_120px_120px_40px] gap-4 px-4 py-3 border-b border-stone-800 hover:bg-stone-800/50 transition-colors cursor-pointer items-center"
                onClick={() => { setActiveProjectId(project.id); setView('detail'); }}
              >
                <span className="text-sm text-orange-400 font-medium truncate">{project.title}</span>
                <span>
                  <select
                    value={project.status || 'active'}
                    onChange={(e) => { e.stopPropagation(); updateProject(project.id, { status: e.target.value }); }}
                    onClick={(e) => e.stopPropagation()}
                    className="text-[11px] font-bold uppercase tracking-wide cursor-pointer rounded-sm px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-500"
                    style={{
                      color: (project.status || 'active') === 'active' ? '#22c55e' : '#ef4444',
                      backgroundColor: '#292524',
                      border: '1px solid #44403c',
                    }}
                  >
                    <option value="active" style={{ color: '#22c55e', backgroundColor: '#1c1917' }}>Active</option>
                    <option value="inactive" style={{ color: '#ef4444', backgroundColor: '#1c1917' }}>Inactive</option>
                  </select>
                </span>
                <span className="text-xs text-stone-500">{formatDate(project.startDate)}</span>
                <span className="text-xs text-stone-500">{formatDate(project.endDate)}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setDeleteConfirm(project.id); }}
                  className="p-1 text-stone-600 hover:text-red-400 transition-colors"
                  title="Delete project"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Delete confirmation */}
        {deleteConfirm && view === 'list' && (
          <div className="mt-3 flex items-center gap-3 px-4 py-2 rounded-sm" style={{ backgroundColor: '#1c1917' }}>
            <span className="text-xs text-red-400 font-bold">Delete "{projects.find(p => p.id === deleteConfirm)?.title}"?</span>
            <button
              onClick={() => handleDeleteProject(deleteConfirm)}
              className="px-3 py-1 text-xs font-bold uppercase rounded-sm"
              style={{ backgroundColor: '#dc2626', color: '#fff' }}
            >
              Confirm
            </button>
            <button
              onClick={() => setDeleteConfirm(null)}
              className="text-xs text-stone-500 hover:text-stone-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {saveError && (
          <div className="mt-3 text-xs text-red-700 bg-red-100/50 px-3 py-2 rounded">
            {saveError}
          </div>
        )}

        {storageWarning && (
          <div className="mt-3 text-xs text-amber-700 bg-amber-100/50 px-3 py-2 rounded">
            Storage usage is high. Consider removing unused files to free up space.
          </div>
        )}
      </div>
    </div>
  );
}

// File upload / drop zone sub-component
function FileDropZone({ files, accept, onUpload, onRemove, showThumbnails }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      onUpload(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

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
          onChange={(e) => { if (e.target.files.length > 0) onUpload(e.target.files); e.target.value = ''; }}
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
  );
}
