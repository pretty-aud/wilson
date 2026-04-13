// ============================================================
// Projects — list panel (all projects)
// ============================================================
//
// No card container — table flows directly on the warm page bg.
// Moderate warm brown tones for header/rows. Content uses full
// available width for a spacious feel.

import { Plus, Trash2 } from 'lucide-react'

function formatDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return iso }
}

function truncate(str, len = 40) {
  if (!str) return '—'
  return str.length > len ? str.slice(0, len) + '...' : str
}

export default function ProjectListPanel({
  projects,
  onCreate,
  onOpen,
  onUpdateStatus,
  deleteConfirm,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  saveError,
  storageWarning,
}) {
  return (
    <div className="h-full flex flex-col">
      <div style={{ maxWidth: 1100, margin: '0 auto', width: '100%', padding: '32px 40px', flex: 1 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h2 style={{
              fontSize: 18, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.06em', color: '#3a1e08',
            }}>
              Projects
            </h2>
            <p style={{ fontSize: 13, color: '#6b4423', marginTop: 4 }}>
              Create and manage your projects, upload reference documents and visual assets
            </p>
          </div>
          <button
            onClick={onCreate}
            className="flex items-center gap-2 rounded-sm transition-colors"
            style={{
              backgroundColor: '#ea580c', color: '#fff',
              padding: '10px 20px', fontSize: 13, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.04em',
            }}
          >
            <Plus size={16} />
            New Project
          </button>
        </div>

        {projects.length === 0 ? (
          /* Empty state */
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '60px 40px',
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: 'rgba(120, 70, 30, 0.4)', marginBottom: 16,
            }}>
              <Plus size={24} style={{ color: '#9a6438' }} />
            </div>
            <p style={{ fontSize: 16, color: '#3a1e08', fontWeight: 700, marginBottom: 6 }}>
              No projects yet
            </p>
            <p style={{ fontSize: 13, color: '#7c4f1f', marginBottom: 20 }}>
              Create your first project to get started
            </p>
            <button
              onClick={onCreate}
              className="rounded-sm transition-colors"
              style={{
                backgroundColor: '#ea580c', color: '#fff',
                padding: '10px 24px', fontSize: 14, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.04em',
              }}
            >
              Create Project
            </button>
          </div>
        ) : (
          /* Project table — flows on page */
          <div
            className="rounded-sm wilson-light-scroll"
            style={{ overflow: 'hidden', border: '1px solid rgba(120, 70, 30, 0.3)' }}
          >
            {/* Header row */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(180px, 2fr) minmax(120px, 1.5fr) 110px minmax(80px, 1fr) 110px 110px 44px',
              gap: 0,
              backgroundColor: 'rgba(120, 70, 30, 0.45)',
              borderBottom: '1px solid rgba(120, 70, 30, 0.3)',
              padding: '0 8px',
            }}>
              {['Title', 'Description', 'Status', 'Client', 'Start', 'End', ''].map((h, i) => (
                <span key={i} style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  letterSpacing: '0.06em', color: '#3a1e08',
                  padding: '12px 14px', fontFamily: 'ui-monospace, monospace',
                }}>
                  {h}
                </span>
              ))}
            </div>

            {/* Data rows */}
            {projects.map((project, i) => (
              <div
                key={project.id}
                onClick={() => onOpen(project.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(180px, 2fr) minmax(120px, 1.5fr) 110px minmax(80px, 1fr) 110px 110px 44px',
                  gap: 0,
                  padding: '0 8px',
                  borderBottom: '1px solid rgba(120, 70, 30, 0.15)',
                  backgroundColor: i % 2 === 0 ? 'rgba(120, 70, 30, 0.12)' : 'rgba(120, 70, 30, 0.22)',
                  cursor: 'pointer',
                  alignItems: 'center',
                  transition: 'background-color 0.12s ease',
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(120, 70, 30, 0.38)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = i % 2 === 0 ? 'rgba(120, 70, 30, 0.12)' : 'rgba(120, 70, 30, 0.22)'}
              >
                {/* Title */}
                <span style={{
                  fontSize: 15, color: '#3a1e08', fontWeight: 600,
                  padding: '14px 14px', overflow: 'hidden', textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {project.title}
                </span>

                {/* Description */}
                <span style={{
                  fontSize: 13, color: '#7c4f1f', padding: '14px 14px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {truncate(project.description)}
                </span>

                {/* Status */}
                <span style={{ padding: '14px 14px' }}>
                  <select
                    value={project.status || 'active'}
                    onChange={(e) => { e.stopPropagation(); onUpdateStatus(project.id, e.target.value) }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      fontSize: 12, fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.04em', cursor: 'pointer',
                      color: (project.status || 'active') === 'active' ? '#16a34a' : '#dc2626',
                      backgroundColor: 'rgba(120, 70, 30, 0.5)',
                      border: '1px solid rgba(120, 70, 30, 0.3)',
                      borderRadius: 2, padding: '4px 8px', outline: 'none',
                    }}
                  >
                    <option value="active" style={{ color: '#16a34a' }}>Active</option>
                    <option value="inactive" style={{ color: '#dc2626' }}>Inactive</option>
                  </select>
                </span>

                {/* Client */}
                <span style={{
                  fontSize: 13, color: '#7c4f1f', padding: '14px 14px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {project.client_name || '—'}
                </span>

                {/* Start */}
                <span style={{
                  fontSize: 12, color: '#7c4f1f', padding: '14px 14px',
                  fontFamily: 'ui-monospace, monospace',
                }}>
                  {formatDate(project.startDate || project.start_date)}
                </span>

                {/* End */}
                <span style={{
                  fontSize: 12, color: '#7c4f1f', padding: '14px 14px',
                  fontFamily: 'ui-monospace, monospace',
                }}>
                  {formatDate(project.endDate || project.end_date)}
                </span>

                {/* Delete */}
                <span style={{ padding: '14px 10px', display: 'flex', justifyContent: 'center' }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); onRequestDelete(project.id) }}
                    style={{
                      color: '#9a6438', padding: 4, borderRadius: 3,
                      border: 'none', background: 'none', cursor: 'pointer',
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                    onMouseLeave={e => e.currentTarget.style.color = '#9a6438'}
                    title="Delete project"
                  >
                    <Trash2 size={16} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Delete confirmation */}
        {deleteConfirm && (
          <div style={{
            marginTop: 12, display: 'flex', alignItems: 'center', gap: 14,
            padding: '12px 0',
          }}>
            <span style={{ fontSize: 14, color: '#dc2626', fontWeight: 700 }}>
              Delete "{projects.find(p => p.id === deleteConfirm)?.title}"?
            </span>
            <button
              onClick={() => onConfirmDelete(deleteConfirm)}
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
                padding: '8px 16px', fontSize: 13, fontWeight: 600,
                color: '#7c4f1f',
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {saveError && (
          <div style={{
            marginTop: 12, fontSize: 13, color: '#dc2626',
            backgroundColor: 'rgba(220,38,38,0.1)',
            padding: '10px 14px', borderRadius: 2,
          }}>
            {saveError}
          </div>
        )}

        {storageWarning && (
          <div style={{
            marginTop: 12, fontSize: 13, color: '#d97706',
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
