// ============================================================
// Projects — list panel (all projects)
// ============================================================
//
// onCreate / onRequestDelete are nullable (Session 6): null hides the
// affordance — cloud mode gates them by app role, local mode passes both.
//
// ── UI overhaul C1 ───────────────────────────────────────────────────────────
//
// The table was a CSS grid whose seven-column template was written out twice —
// once for the header and once per row — so a column change had to be made in
// two places or the header silently detached from the body (alignment list
// #9). It is the shared `Table` now: a real `<table>` with `table-layout:
// fixed`, where the header row IS the grid. Same seven columns, same order,
// same click-to-open, same delete, same status control.
//
// THE STATUS COLUMN was the worst measured defect on the whole surface. It
// painted `#16a34a` or `#dc2626` on `rgba(120,70,30,0.5)` over a zebra row
// over `#f4a261`; composited, that is green at 1.33:1 and red at 1.10:1, at
// 12px bold uppercase — below the threshold at which the glyphs resolve at all
// (F-R02). It was also the only colour-coded signal in the view. On the dark
// ground (Q1 option A) the semantic tokens measure, and the select KEEPS being
// the control: its face reads as the state, the word carries the state, and
// colour only reinforces it. Colour never carries it alone.
//
// Also gone: the zebra (F-R07 — a stripe is a second signal competing with
// hover, selection and focus), the JS `onMouseEnter`/`onMouseLeave` pair that
// wrote the hover inline so it could never answer `:focus-within` (F-R20), the
// 9px Private badge (F-R29), the second in-page title (F-R06), and the 56px
// circle on the empty state, which the review keeps as the canonical shape
// minus exactly that circle (F-R13).
//
// 🚨 `{project.is_private && (` and the word `Private` are pinned by
// `src/lib/localMediaWiring.test.js`. The badge is a kit `Badge` now; the
// branch and the word stay.
// ============================================================

import { Plus, Trash2, FolderKanban } from 'lucide-react'
import {
  Badge, Banner, Button, Card, EmptyState, HoverActions, IconButton, Row,
  Select, Table, Td, Th, Toolbar,
} from '../../ui'
import '../Resources/resources.css'

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

// `table-layout: fixed` reads the header row, so the columns are DECLARED
// rather than emerging from whichever cell happened to be longest — and the
// template is written ONCE, which is alignment list #9.
// 🚨 Sums to exactly 100: 24 + 25 + 12 + 14 + 10 + 10 + 5.
//
// The action column is 5 and not the 4 it had: one 28px icon button plus the
// 24px cell inset needs 52px, and 4 percent of this table is 49 at the 1280px
// minimum window. Measured, not guessed.
const COL = {
  title: '24%', description: '25%', status: '12%',
  client: '14%', start: '10%', end: '10%', actions: '5%',
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

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
  const pending = deleteConfirm ? projects.find(p => p.id === deleteConfirm) : null

  return (
    <div className="rs-page">
      {/* The in-page title is gone: the orange bar already says "Projects",
          and this said it again 150px below in a smaller, lower-contrast face
          (F-R06). What sat beside it — the one primary action — is what the
          toolbar keeps. */}
      <Toolbar
        right={onCreate ? (
          <Button variant="primary" size="sm" onClick={onCreate}>
            <Plus aria-hidden="true" /> New project
          </Button>
        ) : null}
      >
        <span className="rs-count">
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </span>
      </Toolbar>

      <div className="rs-body">
        <p className="rs-lede">
          Create and manage your projects, upload reference documents and visual assets
        </p>

        {saveError && <Banner tone="danger">{saveError}</Banner>}
        {storageWarning && (
          <Banner tone="warning">
            Storage usage is high. Consider removing unused files to free up space.
          </Banner>
        )}

        {/* The delete confirmation keeps its shape: an in-flow strip, not a
            dialog. Promoting it would change the modality of a destructive
            action, which is an interaction change (C1); the review asked for
            the INK, which on the dark ground is the danger token measuring
            properly instead of `#dc2626` at 2.34:1 on orange (F-R14). */}
        {pending && (
          <Banner
            tone="danger"
            action={(
              <>
                <Button variant="danger" size="sm" onClick={() => onConfirmDelete(deleteConfirm)}>Delete</Button>
                <Button variant="ghost" size="sm" onClick={onCancelDelete}>Cancel</Button>
              </>
            )}
          >
            Delete “{pending.title}”? This cannot be undone.
          </Banner>
        )}

        {projects.length === 0 ? (
          // The canonical empty state of the surface, minus the 56px circle
          // the review named (F-R13). It is the only one with an action, and
          // the action is the same one the toolbar offers.
          <EmptyState
            Icon={FolderKanban}
            title="No projects yet"
            body="Create your first project to get started."
          >
            {onCreate && (
              <Button variant="primary" onClick={onCreate}>
                <Plus aria-hidden="true" /> New project
              </Button>
            )}
          </EmptyState>
        ) : (
          <Card pad={false} className="pl-card">
            <Table
              aria-label="Projects"
              head={(
                <Row>
                  <Th width={COL.title}>Title</Th>
                  <Th width={COL.description}>Description</Th>
                  <Th width={COL.status}>Status</Th>
                  <Th width={COL.client}>Client</Th>
                  <Th width={COL.start} numeric>Start</Th>
                  <Th width={COL.end} numeric>End</Th>
                  <Th width={COL.actions}><span className="rs-sr">Actions</span></Th>
                </Row>
              )}
            >
              {projects.map((project) => (
                <Row key={project.id} interactive onClick={() => onOpen(project.id)}>
                  <Td>
                    <span className="pj-title-cell">
                      <span className="pj-title-text">{project.title}</span>
                      {project.is_private && (
                        <Badge title="Private project — only you and workspace admins see it; its media stays on the computer that added it">
                          Private
                        </Badge>
                      )}
                    </span>
                  </Td>
                  <Td>{truncate(project.description)}</Td>
                  <Td>
                    {/* The control stays a select; only its face changed.
                        `data-status` drives the ink, and the WORD carries the
                        state, so colour is reinforcement and never the signal
                        on its own (F-R02). */}
                    <Select
                      size="sm"
                      className="pl-status"
                      data-status={project.status || 'active'}
                      value={project.status || 'active'}
                      onChange={(v) => onUpdateStatus(project.id, v ?? 'active')}
                      onClick={(e) => e.stopPropagation()}
                      options={STATUS_OPTIONS}
                      aria-label={`Status of ${project.title}`}
                    />
                  </Td>
                  <Td>{project.client_name || '—'}</Td>
                  <Td numeric>{formatDate(project.startDate || project.start_date)}</Td>
                  <Td numeric>{formatDate(project.endDate || project.end_date)}</Td>
                  <Td align="right">
                    {/* The slot is reserved whether or not the control renders,
                        so a permission-hidden delete cannot shift the column
                        (the old code kept an empty span for the same reason).
                        `always`: a destructive control that is already visible
                        does not go behind a hover — hiding a secondary control
                        is allowed under C1, but this one is the row's only
                        write and it stays where it was. */}
                    <HoverActions always>
                      {onRequestDelete && (
                        <IconButton
                          icon={Trash2}
                          size="sm"
                          title={`Delete ${project.title}`}
                          onClick={(e) => { e.stopPropagation(); onRequestDelete(project.id) }}
                        />
                      )}
                    </HoverActions>
                  </Td>
                </Row>
              ))}
            </Table>
          </Card>
        )}
      </div>
    </div>
  )
}
