// ============================================================
// Projects — detail panel (single project, read+write)
// ============================================================
//
// ── UI overhaul C1 ───────────────────────────────────────────────────────────
//
// Restyled through TOKENS AND KIT COMPONENTS ONLY. Track C carries +45 lines on
// this file unmerged (plan Q13), so the JSX keeps its shape — same sections in
// the same order, same two-column form, same fields, same drop zone, same
// read-only folder tree, same delete — and the later track merge conflicts on
// lines rather than on structure.
//
// The local `L` token object is gone (F-R01: every page on this surface
// defined its own, which is the mechanism underneath two thirds of the
// findings). What it held and what replaced it:
//
//   L.label     13px 700 UPPER 0.05em — the SAME typographic object this file
//               used for its BUTTONS at :114 (F-R17). Field labels are the
//               11px Label role now; buttons are 14px sentence case 600.
//   L.input     `rgba(120,70,30,0.55)` with `#fde8d0`, recorded as failing at
//               3.38:1 in lightSurface.js's own header, at 15px in MONO. One
//               kit Input, Body 14px sans (F-R08, F-R18).
//   L.select    the same, plus an inline `color` ternary that made the
//               extracted state rule unwinnable until it moved (commit 1).
//   L.section   16px 700 UPPER — SectionTitle, sentence case, hairline above.
//   L.divider   a 2px translucent brown rule at a symmetric 28px margin, which
//               at 11–13px type reads as a smudge rather than a line. One 1px
//               hairline, 32px above and 24px below (F-R25).
//
// Four more, each from its own finding:
//
//  · THE DETAIL VIEW HAS A PRIMARY ACTION NOW. Back, Open in RABBIT and Delete
//    Project were the same button at the same size — 8px 16px, 13px, 700,
//    uppercase — so the view technically had none, and Delete sat at the
//    bottom after a divider identical to every other divider on the page.
//    Back is a ghost with its chevron, Open in RABBIT is the secondary, and
//    Delete is a bounded region with a Label eyebrow so the eye stops counting
//    it among the navigation (F-R28). `#44403c`/`#fb923c`, a fourth button
//    colourway used exactly once, is retired with it.
//
//  · THE DROP ZONE STOPS MOVING THE PAGE. `transition: all 0.15s` sat on a
//    container whose padding AND margin were both conditional on `fileCount`,
//    so the first successful upload — the moment the feature proves it worked
//    — animated two layout properties and shifted everything below it by 28px.
//    Named properties, one padding and one 16px icon for both states, so the
//    jump does not exist to be animated (F-R30).
//
//  · THE FOLDER TREE STOPS DE-EMPHASISING WITH OPACITY. `opacity: 0.85` on a
//    coloured ground is a blend toward the ground — the grey-on-orange
//    mechanism the rule bans, arrived at by another route — and `#5c3415` was
//    a sixth brown ink on a surface meant to have one. Weight carries the
//    root; the indent stays, because the review's own note is that it is the
//    one thing there that works (F-R31).
//
//  · THE FILES TABLE FOLLOWS THE PAGE. `ProjectFilesTable` belongs to lane B
//    (plan §6.5) and is NOT edited here; it already ships a `variant` prop, so
//    the page asks it for `dark` instead of `warm`. Lane B converges its
//    internals on the values in this session's hand-off.
// ============================================================

import { useState, useRef } from 'react'
import {
  ChevronLeft, Rabbit as RabbitIcon, Upload, Trash2,
  Calendar, DollarSign, User, Film, Sparkles, FolderOpen,
} from 'lucide-react'
import ProjectFilesTable from '../../tools/rabbit_v0.1.0/components/ProjectFilesTable'
import { useTeamMembers } from '../TeamMembers/useTeamMembers'
import {
  Banner, Button, Field, Input, SectionTitle, Select, TextArea, Toolbar,
} from '../../ui'
import '../Resources/resources.css'

const CURRENCY_OPTIONS = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY']

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
]

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
  saveError,
  storageWarning,
}) {
  const tm = useTeamMembers()
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) onFileUpload?.(e.dataTransfer.files)
  }

  const fileCount = (allFiles || []).length
  const imageCount = (allFiles || []).filter(f => f.is_image).length
  const docCount = fileCount - imageCount

  const memberOptions = (tm.members || []).map(m => ({ value: m.id, label: m.name }))

  return (
    <div className="rs-page">
      {/* ── Navigation ──────────────────────────────────────
          One primary per region, and this region's is "go back to the list" —
          which is navigation, so it is the GHOST, and the region's filled
          primary is none. Three equal-weight buttons meant the view had no
          primary at all (F-R28). */}
      <Toolbar
        right={(
          <div className="pj-meta">
            {project.created_at && (
              <span>Created <span className="pj-meta-value">{fmtDate(project.created_at)}</span></span>
            )}
            {project.updated_at && (
              <span>Updated <span className="pj-meta-value">{fmtDate(project.updated_at)}</span></span>
            )}
          </div>
        )}
      >
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft aria-hidden="true" /> Back to projects
        </Button>
        {onOpenInRabbit && (
          <Button size="sm" onClick={onOpenInRabbit} title="Open this project in R.A.B.B.I.T.">
            <RabbitIcon aria-hidden="true" /> Open in R.A.B.B.I.T.
          </Button>
        )}
      </Toolbar>

      <div className="rs-body pj-scroll">
        {saveError && <Banner tone="danger">{saveError}</Banner>}
        {storageWarning && (
          <Banner tone="warning">
            Storage usage is high. Consider removing unused files to free up space.
          </Banner>
        )}

        {/* ── Project details ──────────────────────────── */}
        <SectionTitle rule={false}>Project details</SectionTitle>

        <div className="pj-form">
          {/* ── Left column ── */}
          <div className="pj-form-col">
            <Field label="Title">
              <Input value={project.title || ''} onChange={(v) => onUpdate({ title: v })} />
            </Field>

            <Field label="Description">
              <TextArea
                value={project.description || ''}
                onChange={(v) => onUpdate({ description: v })}
                rows={3}
                placeholder="Brief description of the project"
              />
            </Field>

            <Field label={<><Film aria-hidden="true" /> Director</>}>
              <Select
                value={project.director_id || ''}
                onChange={(v) => onUpdate({ director_id: v })}
                placeholder="Select director"
                options={memberOptions}
              />
            </Field>

            <Field label={<><Sparkles aria-hidden="true" /> Producer</>}>
              <Select
                value={project.producer_id || ''}
                onChange={(v) => onUpdate({ producer_id: v })}
                placeholder="Select producer"
                options={memberOptions}
              />
            </Field>
          </div>

          {/* ── Right column ── */}
          <div className="pj-form-col">
            <Field label="Status">
              <Select
                className="pl-status"
                data-status={project.status || 'active'}
                value={project.status || 'active'}
                onChange={(v) => onUpdate({ status: v ?? 'active' })}
                options={STATUS_OPTIONS}
              />
            </Field>

            <Field label={<><Calendar aria-hidden="true" /> Dates</>}>
              <div className="pj-pair">
                <Input
                  type="date"
                  value={project.startDate || project.start_date || ''}
                  onChange={(v) => onUpdate({ startDate: v, start_date: v })}
                  aria-label="Start date"
                />
                <Input
                  type="date"
                  value={project.endDate || project.end_date || ''}
                  onChange={(v) => onUpdate({ endDate: v, end_date: v })}
                  aria-label="End date"
                />
              </div>
            </Field>

            <Field label={<><User aria-hidden="true" /> Client</>}>
              <Input
                value={project.client_name || ''}
                onChange={(v) => onUpdate({ client_name: v })}
                placeholder="Client name"
              />
            </Field>

            <Field label={<><DollarSign aria-hidden="true" /> Budget</>}>
              <div className="pj-budget">
                <Input
                  type="number"
                  value={project.budget_total ?? ''}
                  onChange={(v) => onUpdate({ budget_total: v ? Number(v) : null })}
                  placeholder="0.00"
                  aria-label="Budget total"
                />
                <Select
                  value={project.budget_currency || 'USD'}
                  onChange={(v) => onUpdate({ budget_currency: v ?? 'USD' })}
                  options={CURRENCY_OPTIONS}
                  aria-label="Budget currency"
                />
              </div>
            </Field>
          </div>
        </div>

        {/* Folder location */}
        {project.folder_root && (
          <div className="pj-section">
            <Field label={<><FolderOpen aria-hidden="true" /> Project folder</>}>
              <div className="pj-path">{project.folder_root}</div>
            </Field>
          </div>
        )}

        {/* ── Project files ───────────────────────────── */}
        <div className="pj-section">
          <SectionTitle
            description="Upload documents, images, and media. Mark core project files with the checkbox."
            actions={fileCount > 0 ? (
              <span className="rs-count">
                {fileCount} file{fileCount !== 1 ? 's' : ''}
                {imageCount > 0 && docCount > 0
                  ? ` · ${docCount} doc${docCount !== 1 ? 's' : ''}, ${imageCount} media`
                  : imageCount > 0
                    ? ` · ${imageCount} media`
                    : docCount > 0
                      ? ` · ${docCount} doc${docCount !== 1 ? 's' : ''}`
                      : ''
                }
              </span>
            ) : null}
          >
            Project files
          </SectionTitle>

          {/* Drop zone — one padding and one icon size for both states, so the
              first upload does not shift the page under the pointer. */}
          <button
            type="button"
            className="pj-drop"
            data-dragging={isDragging || undefined}
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="pj-drop-icon" aria-hidden="true" />
            <span className="pj-drop-text">
              {filesBusy
                ? 'Uploading…'
                : isDragging ? 'Drop to upload' : 'Drop files here or click to browse'}
            </span>
          </button>
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

          {/* Files table — lane B's file (plan §6.5); it takes the page's
              surface through the prop it already had. */}
          {fileCount > 0 && (
            <ProjectFilesTable
              files={allFiles}
              onUpdate={onFileUpdate}
              onDelete={onFileDelete}
              maxHeight={380}
              variant="dark"
            />
          )}
        </div>

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
        <div className="pj-section">
          <SectionTitle
            actions={folders.length > 0 ? (
              <span className="rs-count">{folders.length} folder{folders.length !== 1 ? 's' : ''}</span>
            ) : null}
          >
            Project folder
          </SectionTitle>

          {folders.length === 0 ? (
            <p className="rs-lede">
              No folder structure yet. It is created the first time this project
              is opened in R.A.B.B.I.T., or when its first asset or scene is added.
            </p>
          ) : (
            <>
              <p className="rs-lede">
                {/* Said plainly, because the alternative is someone editing the
                    file and expecting WILSON to notice. */}
                <code>PROJECT.json</code>{' '}
                sits at the top of this folder and describes the project — its
                settings, this folder list and who is on it. WILSON writes it;
                editing it by hand changes nothing.
              </p>
              <div className="pj-tree">
                {[...folders]
                  .sort((a, b) => (a.path || '').localeCompare(b.path || ''))
                  .map(f => (
                    <div
                      key={f.id || f.path}
                      className="pj-tree-row"
                      data-kind={f.kind}
                      style={{
                        // One step of indent per path segment, so the shape of
                        // the tree is visible without drawing one.
                        paddingLeft: ((f.path || '').split('/').filter(Boolean).length) * 16,
                      }}
                    >
                      {f.kind === 'root' ? (f.slug || '(project root)') : f.slug}
                      {f.label && f.label !== f.slug && (
                        <span className="pj-tree-label">  {f.label}</span>
                      )}
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>

        {/* ── Danger zone (null onRequestDelete hides it — permission-gated) ──
            Bounded, with its own eyebrow and a heavier gap above than any
            other section, so Delete stops being counted among the navigation
            (F-R28). The control, the confirmation and the two outcomes are
            exactly what they were. */}
        {(deleteConfirm || onRequestDelete) && (
          <div className="pj-danger">
            <span className="pj-danger-eyebrow">Danger zone</span>
            {deleteConfirm ? (
              <>
                <span className="pj-danger-question">Delete this project? This cannot be undone.</span>
                <Button variant="danger" size="sm" onClick={onDelete}>Delete project</Button>
                <Button variant="ghost" size="sm" onClick={onCancelDelete}>Cancel</Button>
              </>
            ) : (
              <Button variant="ghost" size="sm" onClick={onRequestDelete}>
                <Trash2 aria-hidden="true" /> Delete project
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
