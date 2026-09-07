// ============================================================
// Projects — detail panel (single project, read+write)
// ============================================================
//
// No card containers — content flows directly on the page bg.
// Section dividers separate logical groups. Inputs use the
// warm brown well style from the WILSON visual language.

import { useState, useRef } from 'react'
import {
  ChevronLeft, Rabbit as RabbitIcon, Upload, Trash2,
  Calendar, DollarSign, User, Film, Sparkles, FolderOpen,
} from 'lucide-react'
import ProjectFilesTable from '../../tools/rabbit_v0.1.0/components/ProjectFilesTable'
import { useTeamMembers } from '../TeamMembers/useTeamMembers'
import { LIGHT_INK } from '../lightSurface'

/* ── Design tokens (on tan page bg) ───────────────────────── */

const L = {
  label: {
    fontSize: 13, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.05em', color: '#4a2c10', marginBottom: 6,
    display: 'flex', alignItems: 'center', gap: 5,
  },
  sublabel: {
    fontSize: 11, color: '#7c4f1f', textTransform: 'uppercase',
    letterSpacing: '0.04em', marginBottom: 5, display: 'block',
  },
  input: {
    width: '100%', padding: '10px 14px', fontSize: 15,
    fontFamily: 'ui-monospace, monospace',
    backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0',
    border: '2px solid rgba(120, 70, 30, 0.35)', borderRadius: 2,
    outline: 'none',
  },
  select: {
    padding: '10px 14px', fontSize: 15,
    fontFamily: 'ui-monospace, monospace',
    backgroundColor: 'rgba(120, 70, 30, 0.55)', color: '#fde8d0',
    border: '2px solid rgba(120, 70, 30, 0.35)', borderRadius: 2,
    outline: 'none', cursor: 'pointer', width: '100%',
    appearance: 'none',
  },
  section: {
    fontSize: 16, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.05em', color: '#3a1e08',
    marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
  },
  divider: {
    borderTop: '2px solid rgba(120, 70, 30, 0.25)',
    margin: '28px 0',
  },
}

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']

/* ── helpers ──────────────────────────────────────────────── */

function fmtDate(d) {
  if (!d) return null
  try {
    return new Date(d).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return null }
}

/* ── main component ───────────────────────────────────────── */

export default function ProjectDetailPanel({
  project,
  onBack,
  onUpdate,
  onOpenInRabbit,
  onDelete,
  deleteConfirm,
  onRequestDelete,
  onCancelDelete,
  allFiles,
  folders = [],
  filesBusy = false,
  onFileUpdate,
  onFileDelete,
  onFileUpload,
  // C3. Drive is read-only (adapterSupportsWrites is false for it), so the
  // drop zone would only ever produce a thrown sentence — it says so instead.
  canUpload = true,
  // C3, §6 #31 trap (g). TRUE in cloud mode, where deleteFile is 0014's soft
  // delete: the row keeps deleted_at, the blob stays, and the space is held
  // for 30 days. FALSE on Local Server, where the same button unlinks the
  // body immediately and certificates it as 'purged'. The copy below is the
  // only place a person is told which one they are about to do.
  deletesAreSoft = true,
  saveError,
  storageWarning,
}) {
  const tm = useTeamMembers()
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (!canUpload) return
    if (e.dataTransfer.files.length > 0) onFileUpload?.(e.dataTransfer.files)
  }

  const fileCount = (allFiles || []).length
  const imageCount = (allFiles || []).filter(f => f.is_image).length
  const docCount = fileCount - imageCount

  return (
    <div className="h-full overflow-y-auto wilson-light-scroll">
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 40px' }}>

        {/* ── Navigation bar ──────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <button
            onClick={onBack}
            className="flex items-center gap-2 rounded-sm transition-colors"
            style={{
              backgroundColor: '#ea580c', color: '#fff',
              padding: '8px 16px', fontSize: 13, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}
          >
            <ChevronLeft size={16} />
            Back to Projects
          </button>
          {onOpenInRabbit && (
            <button
              onClick={onOpenInRabbit}
              className="flex items-center gap-2 rounded-sm transition-colors"
              style={{
                backgroundColor: '#44403c', color: '#fb923c',
                border: '1px solid #57534e',
                padding: '8px 16px', fontSize: 13, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}
              title="Open this project in RABBIT"
            >
              <RabbitIcon size={16} />
              Open in RABBIT
            </button>
          )}

          {/* Timestamps inline with nav */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 16 }}>
            {project.created_at && (
              <span style={{ fontSize: 11, color: '#7c4f1f', fontFamily: 'ui-monospace, monospace' }}>
                Created: {fmtDate(project.created_at)}
              </span>
            )}
            {project.updated_at && (
              <span style={{ fontSize: 11, color: '#7c4f1f', fontFamily: 'ui-monospace, monospace' }}>
                Updated: {fmtDate(project.updated_at)}
              </span>
            )}
          </div>
        </div>

        {/* ── Project Details ──────────────────────────── */}
        <h3 style={L.section}>Project Details</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          {/* ── Left column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={L.label}>Title</label>
              <input
                type="text"
                value={project.title || ''}
                onChange={(e) => onUpdate({ title: e.target.value })}
                style={L.input}
              />
            </div>

            <div>
              <label style={L.label}>Description</label>
              <textarea
                value={project.description || ''}
                onChange={(e) => onUpdate({ description: e.target.value })}
                rows={3}
                placeholder="Brief description of the project..."
                style={{ ...L.input, resize: 'vertical' }}
              />
            </div>

            <div>
              <label style={L.label}>
                <Film size={13} /> Director
              </label>
              <select
                value={project.director_id || ''}
                onChange={(e) => onUpdate({ director_id: e.target.value || null })}
                style={{
                  ...L.select,
                  color: project.director_id ? '#fde8d0' : LIGHT_INK,
                }}
              >
                <option value="">Select director...</option>
                {(tm.members || []).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={L.label}>
                <Sparkles size={13} /> Producer
              </label>
              <select
                value={project.producer_id || ''}
                onChange={(e) => onUpdate({ producer_id: e.target.value || null })}
                style={{
                  ...L.select,
                  color: project.producer_id ? '#fde8d0' : LIGHT_INK,
                }}
              >
                <option value="">Select producer...</option>
                {(tm.members || []).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Right column ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <label style={L.label}>Status</label>
              <select
                value={project.status || 'active'}
                onChange={(e) => onUpdate({ status: e.target.value })}
                style={{
                  ...L.select,
                  color: (project.status || 'active') === 'active' ? '#22c55e' : '#ef4444',
                }}
              >
                <option value="active" style={{ color: '#22c55e' }}>Active</option>
                <option value="inactive" style={{ color: '#ef4444' }}>Inactive</option>
              </select>
            </div>

            <div>
              <label style={L.label}>
                <Calendar size={13} /> Dates
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <span style={L.sublabel}>Start</span>
                  <input
                    type="date"
                    value={project.startDate || project.start_date || ''}
                    onChange={(e) => onUpdate({ startDate: e.target.value, start_date: e.target.value })}
                    style={{ ...L.input, colorScheme: 'dark' }}
                  />
                </div>
                <div>
                  <span style={L.sublabel}>End</span>
                  <input
                    type="date"
                    value={project.endDate || project.end_date || ''}
                    onChange={(e) => onUpdate({ endDate: e.target.value, end_date: e.target.value })}
                    style={{ ...L.input, colorScheme: 'dark' }}
                  />
                </div>
              </div>
            </div>

            <div>
              <label style={L.label}>
                <User size={13} /> Client
              </label>
              <input
                type="text"
                value={project.client_name || ''}
                onChange={(e) => onUpdate({ client_name: e.target.value })}
                placeholder="Client name..."
                style={L.input}
              />
            </div>

            <div>
              <label style={L.label}>
                <DollarSign size={13} /> Budget
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px', gap: 10 }}>
                <input
                  type="number"
                  value={project.budget_total ?? ''}
                  onChange={(e) => onUpdate({
                    budget_total: e.target.value ? Number(e.target.value) : null,
                  })}
                  placeholder="0.00"
                  style={L.input}
                />
                <select
                  value={project.budget_currency || 'USD'}
                  onChange={(e) => onUpdate({ budget_currency: e.target.value })}
                  style={L.select}
                >
                  {CURRENCY_OPTIONS.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Folder location */}
        {project.folder_root && (
          <div style={{ marginTop: 20 }}>
            <label style={L.label}>
              <FolderOpen size={13} /> Project Folder
            </label>
            <div style={{
              padding: '8px 14px', fontSize: 12,
              fontFamily: 'ui-monospace, monospace', color: '#5c3415',
              backgroundColor: 'rgba(120, 70, 30, 0.25)', borderRadius: 2,
            }}>
              {project.folder_root}
            </div>
          </div>
        )}

        {/* ── Divider ── */}
        <div style={L.divider} />

        {/* ── Project Files ───────────────────────────── */}
        <h3 style={L.section}>
          Project Files
          {fileCount > 0 && (
            <span style={{
              fontSize: 11, color: '#7c4f1f', fontWeight: 400,
              fontFamily: 'ui-monospace, monospace',
            }}>
              {fileCount} file{fileCount !== 1 ? 's' : ''}
              {imageCount > 0 && docCount > 0
                ? ` (${docCount} doc${docCount !== 1 ? 's' : ''}, ${imageCount} media)`
                : imageCount > 0
                  ? ` (${imageCount} media)`
                  : docCount > 0
                    ? ` (${docCount} doc${docCount !== 1 ? 's' : ''})`
                    : ''
              }
            </span>
          )}
        </h3>

        <p style={{ fontSize: 13, color: '#6b4423', marginBottom: 16 }}>
          Upload documents, images, and media. Mark core project files with the
          checkbox — D.O.G. treats those as the sources that define the project
          and everything else as reference.
          {' '}
          {deletesAreSoft
            ? 'Deleting moves a file to the trash and keeps it for 30 days; it '
              + 'holds storage until then.'
            : 'Deleting removes the file from this computer immediately — there '
              + 'is no trash in Local Server mode.'}
        </p>

        {/* Drop zone */}
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => { if (canUpload) inputRef.current?.click() }}
          style={{
            border: `2px dashed ${isDragging ? '#ea580c' : 'rgba(120, 70, 30, 0.45)'}`,
            borderRadius: 4,
            padding: fileCount > 0 ? '12px 24px' : '24px 32px',
            textAlign: 'center',
            cursor: canUpload ? 'pointer' : 'not-allowed',
            opacity: canUpload ? 1 : 0.55,
            marginBottom: fileCount > 0 ? 16 : 0,
            backgroundColor: isDragging ? 'rgba(234, 88, 12, 0.08)' : 'transparent',
            transition: 'all 0.15s ease',
          }}
        >
          <Upload
            size={fileCount > 0 ? 16 : 22}
            style={{ margin: '0 auto 6px', color: isDragging ? '#ea580c' : '#9a6438' }}
          />
          <p style={{ fontSize: 13, color: isDragging ? '#ea580c' : '#7c4f1f' }}>
            {!canUpload
              ? 'This backend is read-only — files cannot be uploaded to it'
              : filesBusy
                ? 'Uploading…'
                : isDragging ? 'Drop to upload' : 'Drop files here or click to browse'}
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files.length > 0) onFileUpload?.(e.target.files)
              e.target.value = ''
            }}
          />
        </div>

        {/* Files table */}
        {fileCount > 0 && (
          <ProjectFilesTable
            files={allFiles}
            onUpdate={onFileUpdate}
            onDelete={onFileDelete}
            maxHeight={380}
            variant="warm"
          />
        )}

        {/* ── Divider ── */}
        <div style={L.divider} />

        {/* ── Project folder (Session 27) ───────────────────── */}
        {/*
            Audrey, 2026-08-03: "these details of the project should also be
            seen in the project page in the resources section of wilson."

            The tree is the same one R.A.B.B.I.T. files things into, read from
            the backend the company chose. It is READ-ONLY here on purpose:
            folders follow their entities (renaming a scene moves its folder),
            so an editable tree on this page would be a second way to name the
            same thing.
        */}
        <h3 style={L.section}>
          <FolderOpen size={15} /> Project Folder
          {folders.length > 0 && (
            <span style={{
              fontSize: 11, color: '#7c4f1f', fontWeight: 400,
              fontFamily: 'ui-monospace, monospace',
            }}>
              {folders.length} folder{folders.length !== 1 ? 's' : ''}
            </span>
          )}
        </h3>

        {folders.length === 0 ? (
          <p style={{ fontSize: 13, color: '#6b4423', marginBottom: 16 }}>
            No folder structure yet. It is created the first time this project
            is opened in R.A.B.B.I.T., or when its first asset or scene is added.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 13, color: '#6b4423', marginBottom: 12 }}>
              {/* Said plainly, because the alternative is someone editing the
                  file and expecting WILSON to notice. */}
              <code style={{ fontFamily: 'ui-monospace, monospace' }}>PROJECT.json</code>{' '}
              sits at the top of this folder and describes the project — its
              settings, this folder list and who is on it. WILSON writes it;
              editing it by hand changes nothing.
            </p>
            <div style={{
              fontFamily: 'ui-monospace, monospace', fontSize: 12,
              color: '#5c3415', backgroundColor: 'rgba(120, 70, 30, 0.18)',
              borderRadius: 2, padding: '10px 14px', marginBottom: 16,
              maxHeight: 220, overflowY: 'auto',
            }}>
              {[...folders]
                .sort((a, b) => (a.path || '').localeCompare(b.path || ''))
                .map(f => (
                  <div
                    key={f.id || f.path}
                    style={{
                      // One space of indent per path segment, so the shape of
                      // the tree is visible without drawing one.
                      paddingLeft: ((f.path || '').split('/').filter(Boolean).length) * 16,
                      opacity: f.kind === 'entity' ? 0.85 : 1,
                      fontWeight: f.kind === 'root' ? 700 : 400,
                    }}
                  >
                    {f.kind === 'root' ? (f.slug || '(project root)') : f.slug}
                    {f.label && f.label !== f.slug && (
                      <span style={{ color: '#9a6438' }}>  {f.label}</span>
                    )}
                  </div>
                ))}
            </div>
          </>
        )}

        {/* ── Divider ── */}
        <div style={L.divider} />

        {/* ── Danger zone (null onRequestDelete hides it — permission-gated) ── */}
        {deleteConfirm ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 14, color: '#dc2626', fontWeight: 700 }}>
              Delete this project?
            </span>
            <button
              onClick={onDelete}
              className="rounded-sm transition-colors"
              style={{
                backgroundColor: '#dc2626', color: '#fff',
                padding: '8px 16px', fontSize: 13, fontWeight: 700,
                textTransform: 'uppercase',
              }}
            >
              Confirm
            </button>
            <button
              onClick={onCancelDelete}
              className="rounded-sm transition-colors"
              style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 700,
                textTransform: 'uppercase', color: LIGHT_INK,
              }}
            >
              Cancel
            </button>
          </div>
        ) : onRequestDelete ? (
          <button
            onClick={onRequestDelete}
            className="flex items-center gap-2 rounded-sm transition-colors"
            style={{
              backgroundColor: '#dc2626', color: '#fff',
              padding: '8px 16px', fontSize: 13, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}
          >
            <Trash2 size={15} />
            Delete Project
          </button>
        ) : null}

        {/* Errors / warnings */}
        {saveError && (
          <div style={{
            marginTop: 14, fontSize: 13, color: '#dc2626',
            backgroundColor: 'rgba(220,38,38,0.1)',
            padding: '10px 14px', borderRadius: 2,
          }}>
            {saveError}
          </div>
        )}
        {storageWarning && (
          <div style={{
            marginTop: 14, fontSize: 13, color: '#d97706',
            backgroundColor: 'rgba(217,119,6,0.1)',
            padding: '10px 14px', borderRadius: 2,
          }}>
            Storage usage is high. Consider removing unused files to free up space.
          </div>
        )}
      </div>
    </div>
  )
}
