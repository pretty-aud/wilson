// MothListWidget.jsx — MO2: the list, right of the HUD (the brief §3.2): a glossary of whatever you are inside,
// with breadcrumbs to hop back up. At the top it is Session 1's islands: the projects you can see, your own space
// called yours, and nobody else's, admins included. Inside a project, a folder, a phase or a scene it lists what is
// in it, read from the same catalogue the graph draws (no money, no Legal, nothing hidden; MothPage's header).
// Ticking a file selects it for Move to and Delete, as Session 1's list did. In a tags view it lists the tags with
// how many files carry each.
// MO4: a project's or a folder's menu (New board, or why there is none), a board's folder called a board, and,
// inside one, Open board.
import { useMemo } from 'react'
import { Files } from 'lucide-react'
import { Banner, Button, EmptyState, MenuButton } from '../../../ui'
import MothIslands, { islandLabel } from './MothIslands.jsx'
import MothPersonalPanel from './MothPersonalPanel.jsx'
import { nodeId } from '../engine/model.js'

const CONTAINER = new Set(['project', 'folder', 'phase', 'scene'])
const KIND_ORDER = ['folder', 'phase', 'scene', 'file', 'asset', 'task', 'shot', 'level', 'experience']
const KIND_WORD = { folder: 'Folder', phase: 'Phase', scene: 'Scene', file: 'File', asset: 'Asset', task: 'Task', shot: 'Shot', level: 'Level', experience: 'Experience' }
export const MANAGED_ROW_SENTENCE = 'This file belongs to an asset. Change it from the asset.'
const rowOf = (id) => String(id).slice(String(id).indexOf(':') + 1)
const kindOf = (id) => String(id).slice(0, String(id).indexOf(':'))

export default function MothListWidget({
  snap, catalogue, index, inside, picked, gate, localOnly, onDesktop, officeRoot, onNetworkStorage, tagsView, adapter,
  onInside, onPickFile, onSelect, onRetry, onAdd, onTrash, pickedCount, onChanged, NetworkShareBanner, filesById, openFolder,
  search = '', onSearch = () => {},
  folderMenu = null, folderMenuTitle = 'More for this folder', isBoard = () => false, insideBoard = null, onOpenBoard = () => {},
}) {
  const setSearch = onSearch
  const islands = snap.islands
  const projectId = inside ? index.rows.get(inside)?.projectId ?? (kindOf(inside) === 'project' ? rowOf(inside) : null) : null
  const island = islands?.find((r) => r.id === projectId) ?? null
  const read = projectId ? snap.project(projectId) : null

  // Children of every container, once per catalogue.
  const children = useMemo(() => {
    const out = new Map()
    for (const [id, p] of index.parent) {
      if (!out.has(p)) out.set(p, [])
      out.get(p).push(id)
    }
    return out
  }, [index])
  const trail = useMemo(() => {
    if (!inside) return []
    const out = [inside]
    for (let a = index.parent.get(inside), steps = 0; a != null && steps < 80; a = index.parent.get(a), steps++) out.unshift(a)
    return out
  }, [inside, index])
  const rows = useMemo(() => {
    if (!inside) return []
    const words = search.trim().toLowerCase()
    return (children.get(inside) || [])
      .map((id) => index.rows.get(id))
      .filter(Boolean)
      .filter((r) => !words || String(r.label ?? '').toLowerCase().includes(words))
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || String(a.label).localeCompare(String(b.label)))
  }, [inside, children, index, search])
  const tagRows = useMemo(() => {
    if (!tagsView) return []
    return [...index.tagFiles.entries()].map(([id, n]) => ({ id, label: rowOf(id), n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  }, [tagsView, index])
  const filesHere = rows.filter((r) => r.kind === 'file')
  const pickedHere = filesHere.filter((r) => picked.has(r.rowId)).length
  const pickedHidden = pickedCount - pickedHere

  const label = (id) => {
    const r = index.rows.get(id)
    if (!r) return '…'
    if (r.kind === 'project') {
      const isle = islands?.find((x) => x.id === r.rowId)
      return isle ? islandLabel(isle, { localOnly }) : r.label
    }
    return r.label || '(no name)'
  }

  return (
    <aside className="moth-hud-panel moth-list-widget" aria-label="List" data-moth-list>
      <div className="moth-list-head">
        <nav className="moth-crumbs" aria-label="Where you are" data-moth-crumbs>
          <button type="button" className="moth-link" onClick={() => { setSearch(''); onInside(null) }}>Everything</button>
          {trail.map((id) => (
            <span key={id}>
              <span aria-hidden="true"> › </span>
              <button type="button" className="moth-link" onClick={() => { setSearch(''); onInside(id) }} aria-current={id === inside ? 'location' : undefined}>{label(id)}</button>
            </span>
          ))}
        </nav>
        {inside && folderMenu?.length > 0 && <MenuButton title={folderMenuTitle} items={folderMenu} minWidth={240} />}
      </div>
      {inside && insideBoard && (
        <Button size="sm" onClick={() => onOpenBoard(insideBoard)} data-moth-open-board>Open board</Button>
      )}

      {!inside && (
        <>
          {islands && <MothIslands islands={islands} openId={null} localOnly={localOnly} onOpen={(id) => onInside(nodeId('project', id))} />}
          {snap.total > 0 && !snap.complete && <p className="moth-quiet" data-moth-reading>Reading {snap.ready + snap.failed} of {snap.total} projects…</p>}
          {tagsView && tagRows.length > 0 && (
            <ul className="moth-rows" data-moth-tags>
              {tagRows.map((t) => (
                <li key={t.id} className="moth-row">
                  <button type="button" className="moth-link moth-row-name" onClick={() => onSelect(t.id)}>{t.label}</button>
                  <span className="moth-quiet">{t.n}</span>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="moth-island" onClick={onTrash} data-moth-trash-open>Trash</button>
        </>
      )}

      {inside && (
        <>
          {officeRoot && openFolder?.id === projectId && NetworkShareBanner && (
            <NetworkShareBanner key={projectId} adapter={adapter} project={openFolder} canCheck={gate.allowed} deniedReason={gate.reason} onChanged={onChanged} />
          )}
          {read?.status === 'failed' && (
            <Banner tone="danger" data-moth-read-failed>
              Could not read this project just now.{' '}
              {read.error && <span data-moth-read-error>{read.error}</span>}{' '}
              <Button variant="ghost" size="sm" onClick={() => onRetry(projectId)} data-moth-read-again>Try again</Button>
            </Banner>
          )}
          {read?.truncated && <p className="moth-quiet" data-moth-truncated>This project is larger than M.O.T.H. maps at once: some of it is not shown.</p>}
          {island?.is_mine && kindOf(inside) === 'project' && (
            <MothPersonalPanel island={island} gate={gate} onDesktop={onDesktop} onOfficeServer={Boolean(officeRoot)} cannotHoldFiles={onNetworkStorage && !officeRoot} onAdd={onAdd} />
          )}
          <input
            className="moth-search"
            type="search"
            placeholder="Search here"
            aria-label="Search these files"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {pickedCount > 0 && (
            <span className="moth-quiet" data-moth-ticked>
              {pickedCount} ticked{pickedHidden > 0 ? `, ${pickedHidden} not shown here` : ''}
            </span>
          )}
          {read?.status === 'loading' && <p className="moth-quiet">Looking…</p>}
          {read?.status === 'ready' && rows.length === 0 && (
            <EmptyState Icon={Files} title="Nothing here" body={search ? 'Nothing here has that name.' : 'There is nothing here you can see.'} compact />
          )}
          <ul className="moth-rows" data-moth-files>
            {rows.map((r) => {
              const file = r.kind === 'file' ? filesById?.(r.rowId) : null
              return (
                <li key={r.id} className="moth-row" data-kind={r.kind}>
                  {r.kind === 'file' ? (
                    <label className="moth-row-name">
                      <input type="checkbox" checked={picked.has(r.rowId)} onChange={() => onPickFile(r.rowId)}
                        disabled={Boolean(file?.managed)} title={file?.managed ? MANAGED_ROW_SENTENCE : undefined} />
                      {' '}
                      <button type="button" className="moth-link" onClick={() => onSelect(r.id)}>{r.label}</button>
                    </label>
                  ) : CONTAINER.has(r.kind) ? (
                    <button type="button" className="moth-link moth-row-name" onClick={() => { setSearch(''); onInside(r.id) }} data-board={r.kind === 'folder' && isBoard(r.rowId) ? 'true' : undefined}>
                      <span className="moth-quiet">{r.kind === 'folder' && isBoard(r.rowId) ? 'Board' : KIND_WORD[r.kind]}</span> {r.label || '(no name)'}
                    </button>
                  ) : (
                    <button type="button" className="moth-link moth-row-name" onClick={() => onSelect(r.id)}>
                      <span className="moth-quiet">{KIND_WORD[r.kind]}</span> {r.label || '(no name)'}
                    </button>
                  )}
                  {file?.share_missing_since && <span className="moth-quiet">Not found on the server at the last check</span>}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </aside>
  )
}
