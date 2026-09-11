// =============================================================================
// Resources/ProjectFilesExplorer.jsx — FILES, under RESOURCES (demo
// 2026-09-11).
//
// Audrey, 2026-09-11, verbatim: "in the resource section of the app please
// add a way for me to view all the files in a project. allow me to choose a
// project and have a way to view folders and files. it should look
// something like window explorer. have a way to view all files and folder
// in one table, and also have a view that works like the column system in
// finder for mac os. so idea is one column is one level of folders, then
// the next column is one folder layer in and so on. … make sure to show all
// details for a file like listed before."
//
// Choose a project → its folders (0041's tree, both backends) and files
// (public.files / the local bundle, plus the Local Server's managed files)
// come straight from the adapter — no switch of the active project — and
// fileTree.js turns them into one tree. Two views over that tree: TABLE
// (every folder and file, indented, sortable by any column) and COLUMNS
// (Finder-style: each selected folder opens the next column). A selected
// file shows every detail the row carries: name, type, size, created,
// modified, duration, location, where it is stored.
//
// Read-only on purpose tonight: opening, moving and deleting stay where
// they are (the project's own Files panel and FileManager).
//
// ── UI overhaul C1 ───────────────────────────────────────────────────────────
//
// "files database for example looks atrocious" — Audrey, and the review
// agreed: 37 findings on this surface and the loudest of them are all here.
//
// Nothing about what this page DOES changed. Both views are here, every
// control is here, every column is here, nothing moved behind a disclosure,
// and no click does anything new (C1).
//
// What changed, and why each one:
//
//  · THE PAGE IS DARK (Q1, option A). It was one of six data pages on the
//    light orange, where `#f4a261` allows exactly one ink — and this page
//    needed three, so it invented a second (`MUTED #7c4f1f`, measured 3.40:1,
//    carrying six of the seven columns) and a third (a `#f5efe6` cream header
//    band: the only use of that value in the app, a near-white sheet on the
//    orange page, and the exact shape `lightSurface.test.js` already had a
//    rule against — it simply never imported the token that test guards).
//    Both are gone with the ground they were workarounds for, and so are the
//    two black input wells that sat on the orange page: a dark field on a
//    light page was the third workaround for the same problem.
//
//  · THE NAME COLUMN CAN LEFT-ALIGN NOW. It could not before: a folder drew
//    `▸` and a file drew `·`, two glyphs with different advance widths in any
//    proportional face, so inside one folder listing the names started at
//    different x positions. They are lucide icons in a slot of DECLARED width
//    now, so the text has one origin at every depth and for both kinds. This
//    is F11, and it is the most visible single line in the review.
//
//  · SIX TYPE SIZES BECAME THREE SCALE STEPS. 18 / 14 / 13 / 12 / 11 / 10
//    became Dense 13 for cells, Caption 12 for the path, Label 11 for headers.
//    The Location column no longer steps itself 2px below its own neighbours,
//    which read as a rendering fault rather than a rank (F-R32).
//
//  · THE TITLE IS PRINTED ONCE. The orange bar's PageHeader already says
//    "Files"; this page said it again 150px below in a smaller, lower-contrast
//    face, so the chrome title read as a subtitle of itself (F-R06).
//
//  · THE TWO PRIMARIES ARE REBALANCED, NOT REDUCED. One `btnStyle` helper drew
//    the Table/Columns radio pair AND the Refresh command, so the row offered
//    three identical pills for two different kinds of decision and a user
//    scanning for the view switch found one that was not a view (F-R16). Both
//    still exist and both still do exactly what they did. The view switch is a
//    Tabs — two mutually exclusive views of one dataset is what a tab bar IS,
//    and it is the component Team Members already uses for its saved views —
//    in the toolbar's left slot beside the project picker, which is this
//    page's actual primary control. Refresh is a ghost icon button in the
//    right slot beside the filter and the count. Separated by SLOT, never by
//    removal (F-R37).
//
//  · NUMERICS RIGHT-ALIGN. Size and Duration were set in monospace and then
//    left-aligned, which throws away the entire reason to use monospace: you
//    could not tell 9.8 MB from 98 MB without reading both (F-R10). Alignment
//    lives on the HEADERS array, so a header and its cells cannot disagree.
//
//  · THE INDENT STOPS LYING, BY GOING. `sortRows` reorders the flattened list
//    globally FOR EVERY KEY, name-ascending included, so a file three levels
//    deep sat 54px in beneath an unrelated root folder asserting a parentage
//    it did not have — on arrival, not only after a sort (F-R12). The row
//    order is untouched, every sort state is still reachable and every arrow
//    still honest; the indent is what goes, and the Location column carries
//    the parentage instead. The long note above `TableView` has the two wrong
//    answers that came first.
//
//  · LOADING AND EMPTY ARE DIFFERENT PICTURES. One `Empty` component served
//    "choose a project", "Loading…" and "no files", so the reader could not
//    tell a slow adapter from an empty project — which on this page is the
//    whole question (F-R13).
//
//  · THE ROWS ANSWER THE POINTER. The one table in the app whose whole job is
//    pointing at rows had no hover state and no transition at all (F-R11). The
//    rows stay plain `<tr>` elements with the onClick they already had: adding
//    `role` and `tabIndex` would be an interaction change under C1, and the
//    shared Row gives the hover fill and the pointer without one.
//
// The two views now share one set of tokens — the same 32px row, the same
// 8px/12px inset, the same hover and selected treatments, the same hairline —
// so switching between them is a change of arrangement rather than a change of
// application. The exact values are listed in this session's hand-off, because
// lane B converges FileManager, BinFileTable and ProjectFilesTable on them.
// =============================================================================

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Folder, File as FileIcon, FolderOpen, Info, RefreshCw, Search } from 'lucide-react'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import {
  Banner, Card, EmptyState, IconButton, Input, Loading, Row, Select, Table,
  Tabs, Td, Th, Toolbar,
} from '../../ui'
// `type="search"` is deliberate: the field was a `<input type="search">` and
// the browser's own clear affordance came with it. Replacing that with a
// hand-rolled clear button would be swapping one control for another under a
// constraint that says not to (C1), so the native one stays.
import { formatBytes } from '../../cloud/workspaceStorage'
import { formatDuration } from '../../tools/rabbit_v0.1.0/storage/mediaMetadata'
import { buildFileTree, flattenTree, filterFlat, columnsFor, breadcrumb, sortRows } from './fileTree'
import './resources.css'

const VIEW_PANEL_ID = 'fx-view-panel'

const PROVIDER_LABEL = {
  supabase: 'Petal cloud',
  s3: 'Your own bucket',
  local_server: 'This computer',
  local_managed: 'The project folder on this computer',
  google_drive: 'Google Drive',
}

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function safeList(fn, id) {
  if (typeof fn !== 'function') return Promise.resolve([])
  try { return Promise.resolve(fn(id)).then(v => (Array.isArray(v) ? v : [])).catch(() => []) } catch { return Promise.resolve([]) }
}

export default function ProjectFilesExplorer() {
  const ctx = useRabbit()
  const projects = useMemo(
    () => Object.values(ctx?.projectsIndex || {}).sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' })),
    [ctx?.projectsIndex],
  )
  const [projectId, setProjectId] = useState('')
  const activeProjectId = ctx?.activeProjectId
  useEffect(() => {
    // Land on the project that is already open, once, so the page is never blank on arrival.
    if (!projectId && activeProjectId) setProjectId(activeProjectId)
  }, [activeProjectId, projectId])

  const [view, setView] = useState('columns')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [reloads, setReloads] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [tree, setTree] = useState(null)
  const [selected, setSelected] = useState([])
  const [selectedFile, setSelectedFile] = useState(null)
  const getAdapter = ctx?.getAdapter

  useEffect(() => {
    if (!projectId) { setTree(null); setError(''); return }
    const adapter = getAdapter?.()
    if (!adapter) return
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([
      safeList(adapter.listFolders?.bind(adapter), projectId),
      safeList(adapter.listFiles?.bind(adapter), projectId),
      safeList(adapter.listManagedFiles?.bind(adapter), projectId),
    ]).then(([folders, files, managedFiles]) => {
      if (cancelled) return
      setTree(buildFileTree({ folders, files, managedFiles }))
      setSelected([])
      setSelectedFile(null)
      setLoading(false)
    }).catch((err) => {
      if (cancelled) return
      setError(err?.message || 'the project files could not be loaded')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [projectId, getAdapter, reloads])

  const flat = useMemo(() => (tree ? flattenTree(tree.root) : []), [tree])
  const tableRows = useMemo(() => sortRows(filterFlat(flat, query), sortKey, sortDir), [flat, query, sortKey, sortDir])
  const cols = useMemo(() => (tree ? columnsFor(tree.root, selected) : []), [tree, selected])

  const onSort = useCallback((key) => {
    setSortDir(d => (sortKey === key ? (d === 'asc' ? 'desc' : 'asc') : 'asc'))
    setSortKey(key)
  }, [sortKey])

  const openFolder = useCallback((depth, id) => {
    setSelected(prev => [...prev.slice(0, depth), id])
    setSelectedFile(null)
  }, [])
  const pickFile = useCallback((depth, node) => {
    setSelected(prev => prev.slice(0, depth))
    setSelectedFile(node)
  }, [])

  const project = projects.find(p => p.id === projectId) || null

  return (
    <div className="rs-page" data-files-explorer data-view={view}>
      {/* One 44px toolbar, every child 28px, left and right slots. It replaced
          a wrapping flex row holding an 18px heading, two 38px fields, three
          27px buttons and a 12px string, in which nothing sat on a baseline
          and the view switch was the control that wrapped away (F-R16,
          F-R37). `wrap` is opt-in and taken here: six heterogeneous controls
          genuinely do not fit at the 1280px minimum width, and a toolbar that
          wraps by default hides the fact that it is over-full. */}
      <Toolbar
        wrap
        right={(
          <>
            <span className="rs-search">
              <Search className="rs-toolbar-glyph" aria-hidden="true" />
              <Input
                size="sm"
                type="search"
                value={query}
                onChange={setQuery}
                placeholder="Filter by name or path"
                aria-label="Filter"
              />
            </span>
            <IconButton
              icon={RefreshCw}
              size="sm"
              title="Reload this project's folders and files"
              onClick={() => setReloads(n => n + 1)}
              disabled={!projectId || loading}
            />
            {tree && (
              <span className="rs-count">
                {tree.folderCount} folder{tree.folderCount === 1 ? '' : 's'} · {tree.fileCount} file{tree.fileCount === 1 ? '' : 's'}
                {project ? ` · ${project.title}` : ''}
              </span>
            )}
          </>
        )}
      >
        <Select
          size="sm"
          value={projectId}
          onChange={(v) => setProjectId(v ?? '')}
          placeholder="Choose a project…"
          options={projects.map(p => ({
            value: p.id,
            label: `${p.title || 'Untitled'}${p.is_private ? ' · private' : ''}`,
          }))}
          aria-label="Project"
        />
        <Tabs
          label="View"
          panelId={VIEW_PANEL_ID}
          items={[{ id: 'table', label: 'Table' }, { id: 'columns', label: 'Columns' }]}
          value={view}
          onChange={setView}
        />
      </Toolbar>

      <div
        className="rs-body"
        data-fill
        id={VIEW_PANEL_ID}
        role="tabpanel"
        aria-label={view === 'table' ? 'Table view' : 'Columns view'}
        // A tabpanel with no focusable descendant needs its own tab stop, or a
        // keyboard user moves from the last tab straight past it. The three
        // states below are exactly that; both views bring their own.
        tabIndex={!projectId || loading || flat.length === 0 ? 0 : undefined}
      >
        {error && <Banner tone="danger">{error}</Banner>}

        {/* Three states that used to be one component with three strings, so a
            slow adapter and an empty project drew the same picture (F-R13). */}
        {!projectId && (
          <EmptyState
            Icon={FolderOpen}
            title="No project chosen"
            body="Choose a project above to see its folders and files."
          />
        )}
        {projectId && loading && <Loading rows={10} columns={7} label="Loading this project's files" />}
        {projectId && !loading && tree && flat.length === 0 && !error && (
          <EmptyState
            Icon={Folder}
            title="Nothing filed yet"
            body="This project has no folders or files. They appear here as R.A.B.B.I.T. files things into it."
          />
        )}

        {projectId && !loading && tree && flat.length > 0 && (
          // One hairline region around BOTH views and the details panel. The
          // two views were two different objects — a bordered table beside an
          // unbordered column strip — and they are one file browser seen two
          // ways, so they get one frame, one gutter and one set of tokens.
          <Card pad={false} className="fx-card">
            <div className="fx-split">
              <div className="fx-main">
                {view === 'table'
                  ? <TableView rows={tableRows} sortKey={sortKey} sortDir={sortDir} onSort={onSort} onPick={(node) => setSelectedFile(node)} selectedId={selectedFile?.id || null} />
                  : <ColumnsView cols={cols} selected={selected} selectedFile={selectedFile} onOpenFolder={openFolder} onPickFile={pickFile} />}
              </div>
              <DetailsPanel node={selectedFile} />
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

// The seven columns, their widths, their alignment and their type, declared
// once. `table-layout: fixed` reads the header row, so these ARE the grid
// rather than an emergent property of whichever cell happened to be longest.
//
// 🚨 They sum to exactly 100. A percentage table that over-sums is not a
// declared table at all: the browser reconciles the excess and every column
// lands somewhere other than where it was written (F2 hit this twice building
// Team Members). 30 + 10 + 8 + 14 + 14 + 8 + 16 = 100.
//
// `numeric` is the kit's one switch for "this is a figure": right alignment,
// the mono, and tabular figures, together. Declaring it here rather than per
// cell is F-R10's real fix — a header and its cells cannot disagree about
// alignment when only one of them says anything about it.
// 🚨 MEASURED AT 1280, NOT CHOSEN. Size and Duration were 8 percent, which at
// Electron's minimum window is a 50px content box — and "12.4 GB" needs 55px
// and "1:02:33" needs 55px, so both ellipsised away the part that carries the
// meaning: the unit, and the seconds. A file size rendered "12.4 …" is worse
// than no file size at all. The Duration HEADER did not fit its own label
// either, at 1280 or at 1440.
//
// Name gives up the four points, because it is the column with slack: it
// ellipsises a NAME, whose tail the Location column and the details panel both
// still carry.
const HEADERS = [
  ['name', 'Name', { width: '26%' }],
  ['type', 'Type', { width: '10%' }],
  ['size', 'Size', { width: '10%', numeric: true }],
  ['created', 'Created', { width: '14%', numeric: true }],
  ['modified', 'Modified', { width: '14%', numeric: true }],
  ['duration', 'Duration', { width: '10%', numeric: true }],
  ['path', 'Location', { width: '16%' }],
]

// 🚨 THE TABLE VIEW DOES NOT INDENT, AND THIS TOOK THREE GOES TO GET RIGHT.
//
// F-R12: `sortRows` re-sorts the FLATTENED list globally, so a file three
// levels deep lands wherever its name or its size puts it while keeping the
// indent it had in the tree — claiming a parent it does not have. What the
// review did not say, and what turned out to matter, is that `sortRows` runs
// for EVERY key INCLUDING name-ascending, which is the default. So the page
// opened in a lying state and there was never an arrangement where the indent
// was true.
//
// The second attempt made the default case skip `sortRows`, so tree order WAS
// the default. That fixed the indent and broke two other things: the Name
// header still rendered `aria-sort="ascending"` and an up arrow over rows that
// were not in name order, and a flat A-to-Z listing stopped being reachable at
// all, because clicking Name then cycled tree-order against flat-Z-to-A. It
// traded a lying indent for a lying header, and lost a state the user had.
//
// So the ordering is exactly what it always was — every sort state reachable,
// every arrow honest, nothing about the view changed — and the INDENT is what
// goes, because the indent is the part that was never true.
//
// Parentage is not lost with it. The Location column carries the full path on
// every row, which is what the review itself prescribes for the flattened case
// ("show the path in the Location column rather than silently removing
// indentation"), and the Columns view beside it is the actual tree.
function TableView({ rows, sortKey, sortDir, onSort, onPick, selectedId }) {
  return (
    <Table
        aria-label="Project folders and files"
        dense
        data-files-table
        head={(
          <Row>
            {HEADERS.map(([key, label, opts]) => (
              <Th
                key={key}
                width={opts.width}
                numeric={opts.numeric}
                sort={sortKey === key ? sortDir : null}
                onSort={() => onSort(key)}
              >
                {label}
              </Th>
            ))}
          </Row>
        )}
      >
        {rows.map(({ node }) => {
            const isFolder = node.kind === 'folder'
            const m = node.meta || {}
            return (
              <Row
                key={node.id}
                className="fx-row"
                onClick={() => { if (!isFolder) onPick(node) }}
                data-node-kind={node.kind}
                interactive={!isFolder}
                selected={node.id === selectedId}
              >
                <Td>
                  {/* The icon slot is a declared width, so the name text has
                      one x origin at every depth and for both kinds. The
                      indent is on the SLOT, not on the text, so the two move
                      together and the column keeps one inset per depth (F11). */}
                  <span className="fx-name">
                    {isFolder
                      ? <Folder className="fx-name-icon" aria-hidden="true" />
                      : <FileIcon className="fx-name-icon" aria-hidden="true" />}
                    <span className="fx-name-text">{node.name}</span>
                  </span>
                </Td>
                <Td>{isFolder ? 'Folder' : m.type}</Td>
                <Td numeric>{isFolder ? '' : formatBytes(m.sizeBytes)}</Td>
                <Td numeric>{isFolder ? '' : fmtDate(m.createdAt)}</Td>
                <Td numeric>{isFolder ? '' : fmtDate(m.modifiedAt)}</Td>
                <Td numeric>{isFolder ? '' : formatDuration(m.durationSec)}</Td>
                <Td>
                  {/* Truncated from the LEFT, which is what Finder does: the
                      leaf folder is the part that identifies a path, and an
                      end-ellipsis eats exactly that part (F-R32). */}
                  <span className="fx-path"><bdi>{isFolder ? node.path : (node.parent && !node.parent.isRoot ? node.parent.path : '')}</bdi></span>
                </Td>
              </Row>
            )
        })}
    </Table>
  )
}

function ColumnsView({ cols, selected, selectedFile, onOpenFolder, onPickFile }) {
  return (
    <div className="fx-columns" data-files-columns>
      {cols.map((col, depth) => (
        <div key={col.folder ? col.folder.id : depth} className="fx-column" data-column={depth}>
          <div className="fx-column-head">
            {col.folder && !col.folder.isRoot ? col.folder.name : 'Project'}
          </div>
          {col.items.length === 0 && (
            <EmptyState compact Icon={Folder} title="Empty folder" body="Nothing is filed in here." />
          )}
          {col.items.map((node) => {
            const isFolder = node.kind === 'folder'
            const isSel = isFolder ? selected[depth] === node.id : selectedFile?.id === node.id
            return (
              <button
                key={node.id}
                type="button"
                className="fx-col-item"
                onClick={() => (isFolder ? onOpenFolder(depth, node.id) : onPickFile(depth, node))}
                data-node-kind={node.kind}
                data-selected={isSel || undefined}
              >
                {isFolder
                  ? <Folder className="fx-name-icon" aria-hidden="true" />
                  : <FileIcon className="fx-name-icon" aria-hidden="true" />}
                <span className="fx-col-name">{node.name}</span>
                {isFolder
                  ? <span className="fx-col-chevron" aria-hidden="true">›</span>
                  : <span className="fx-col-meta">{formatBytes(node.meta?.sizeBytes)}</span>}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function DetailsPanel({ node }) {
  if (!node) {
    return (
      <div className="fx-details" data-file-details="none">
        <div className="fx-details-title"><Info className="rs-toolbar-glyph" aria-hidden="true" />Details</div>
        <p className="fx-details-empty">Select a file to see its details.</p>
      </div>
    )
  }
  const m = node.meta || {}
  const isMedia = m.kind === 'video' || m.kind === 'audio'
  // 🚨 THE SHAPE OF THIS ARRAY IS PINNED. `src/lib/localMediaWiring.test.js`
  // asserts the eight literals `['Name'` … `['Stored'` appear in this file —
  // they are the eight facts Audrey asked to see for a file. Keep the pairs.
  const rows = [
    ['Name', node.name],
    ['Type', m.type || '—'],
    ['Size', formatBytes(m.sizeBytes)],
    ['Created', fmtDate(m.createdAt)],
    ['Modified', fmtDate(m.modifiedAt)],
    ['Duration', isMedia ? (formatDuration(m.durationSec) || 'not read') : '—'],
    ['Location', breadcrumb(node.parent) || 'Project'],
    ['Stored', PROVIDER_LABEL[m.provider] || m.provider || '—'],
  ]
  return (
    <div className="fx-details" data-file-details={node.id}>
      <div className="fx-details-title"><Info className="rs-toolbar-glyph" aria-hidden="true" />Details</div>
      {/* Eight pairs that stacked label-over-value at a 0:10px proximity ratio
          — no gap inside a pair, 10px between pairs — and filled 290px of a
          300px panel. A two-column definition grid reads them in about half
          that, and the pairs are held together by position rather than by a
          type difference the dark ground was about to reduce (F-R33). The
          numeric facts take the mono with tabular figures; the prose ones
          do not. */}
      <dl className="fx-details-grid">
        {rows.map(([k, v]) => (
          <div key={k} className="fx-details-pair">
            <dt>{k}</dt>
            <dd data-numeric={DETAIL_NUMERIC.has(k) || undefined}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

const DETAIL_NUMERIC = new Set(['Size', 'Created', 'Modified', 'Duration'])
