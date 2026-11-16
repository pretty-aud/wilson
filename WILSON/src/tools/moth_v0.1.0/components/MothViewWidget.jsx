// MothViewWidget.jsx — MO2: the view widget, top left of the HUD (the brief §3.1, her split of 2026-11-01).
// It holds only what changes how you view the graph: the view (pick, save, reset, a new one), what shows as dots
// and which lines join them, the layout, focus, search that flies to a match, the tags to keep, and the time
// slider; and Move to and Delete on what is selected (her §12a.8), with Undo, Redo and opening it in its own tool.
// Appearance is Settings' (the toolbar's right end), never here.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BookmarkPlus, Crosshair, ExternalLink, FolderInput, History as HistoryIcon, Redo2, Save, Search as SearchIcon,
  SlidersHorizontal, Trash2, Undo2,
} from 'lucide-react'
import { Button, Chip, Dialog, Field, IconButton, Input, MenuButton, Select } from '../../../ui'
import GatedAction from '../../../permissions/GatedAction'
import { QUICK_VIEWS, DOT_CHOICES, LINE_CHOICES, TAG_WORDS, searchCatalogue, UNSAVED_LABEL } from '../state/mothViewState.js'
import MothTimeSlider from './MothTimeSlider.jsx'

export default function MothViewWidget({
  views, viewSnap, config, catalogue, index, selectedNode, pickedCount, gate, canUndo, canRedo, jump, localOnly,
  onUndo, onRedo, onMove, onDelete, onJump, onFind, onNewView, onRelayout, onError, history, livePositions = () => ({}),
  onViewDeleted = () => {}, extra = null,
}) {
  const [query, setQuery] = useState('')
  const [showing, setShowing] = useState(false)
  const showButton = useRef(null)
  // Where the bar ends, for what sits below it (the notices): a narrow window wraps it onto a second row (round 1).
  const barRef = useRef(null)
  useLayoutEffect(() => {
    const bar = barRef.current
    const hud = bar?.parentElement
    if (!bar || !hud?.style) return undefined
    const tell = () => { if (bar.offsetHeight > 0) hud.style.setProperty('--moth-bar-bottom', `${bar.offsetTop + bar.offsetHeight}px`) }
    tell()
    if (typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(tell)
    ro.observe(bar)
    return () => { ro.disconnect(); hud.style.removeProperty('--moth-bar-bottom') }
  }, [])
  const [saving, setSaving] = useState(null) // { name, scope }
  const [renaming, setRenaming] = useState(null) // { name }
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  // Only what this view can draw is offered, so a pick always has a dot to fly to (MO2 review round 2).
  const hits = useMemo(() => searchCatalogue(catalogue, query, { index, limit: 40 })
    .filter((h) => config.nodeKinds.includes(h.kind)).slice(0, 12), [catalogue, query, index, config.nodeKinds])
  const current = viewSnap?.current ?? { key: 'q:folders', row: null }
  const saved = viewSnap?.views ?? []
  const options = [
    { label: 'Quick starts', options: Object.entries(QUICK_VIEWS).map(([value, v]) => ({ value, label: v.name })) },
    ...(saved.length ? [{ label: 'Saved views', options: saved.map((v) => ({ value: v.id, label: v.scope_kind === 'project' ? `${v.name} (shared)` : v.name })) }] : []),
    ...(current.key === 'unsaved' ? [{ value: 'unsaved', label: UNSAVED_LABEL }] : []),
  ]
  const set = (patch) => views?.setConfig(patch)
  const toggle = (list, k) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k])
  const projectOfSelection = selectedNode?.projectId ?? null
  const writableHere = !!views?.writable?.()
  const canSaveShared = !!projectOfSelection && !localOnly && !!views?.canWriteProject?.(projectOfSelection)
  const focusOn = viewSnap?.focusId && viewSnap.focusId === selectedNode?.id

  const doSave = async () => {
    if (!saving) return
    setBusy(true)
    try {
      await views.save({
        name: saving.name,
        scope: saving.scope,
        projectId: saving.scope === 'project' ? projectOfSelection : null,
        positions: saving.positions,
      })
      setSaving(null)
    } catch (err) {
      onError?.(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }
  const doRename = async () => {
    if (!renaming || !current.row) return
    setBusy(true)
    try { await views.rename(current.row.id, renaming.name); setRenaming(null) } catch (err) { onError?.(err?.message || String(err)) } finally { setBusy(false) }
  }
  const doDelete = async () => {
    if (!current.row) return
    const name = current.row.name
    setBusy(true)
    try { const undo = await views.remove(current.row.id); setDeleting(false); if (undo) onViewDeleted(undo, name) } catch (err) { onError?.(err?.message || String(err)) } finally { setBusy(false) }
  }
  const saveInPlace = async () => {
    setBusy(true)
    try { await views.save({ positions: livePositions() }) } catch (err) { onError?.(err?.message || String(err)) } finally { setBusy(false) }
  }

  // MO5 (her item 2): "more of a bar with options than a window with options stacked on top of each other ... use icons
  // where possible". One row along the top of the map: the view and its menu, Find, What shows, Focus, Look back, what
  // to do with what is ticked, Undo and Redo. Every icon says its name to a screen reader and in its tooltip; what does
  // not fit in a row is in the view's menu (New view, Save, Rename, Delete view, Reset, Lay out again) or opens below
  // the bar (What shows). Nothing the stacked card held is lost.
  const viewMenu = [
    { label: 'New view…', onClick: onNewView },
    ...(current.row && viewSnap?.unsaved && writableHere ? [{ label: 'Save', onClick: saveInPlace }] : []),
    ...(current.row && writableHere ? [
      { label: 'Rename…', onClick: () => setRenaming({ name: current.row.name }) },
      { label: 'Delete view…', danger: true, onClick: () => setDeleting(true) },
    ] : []),
    { divider: true },
    { label: 'Reset', onClick: () => views?.reset().catch((err) => onError?.(err?.message || String(err))) },
    { label: 'Lay out again', onClick: onRelayout },
    ...(viewSnap?.available === false ? [{ header: 'This view lasts for this visit only.' }] : []),
  ]
  return (
    <section ref={barRef} className="moth-hud-panel moth-view-bar" aria-label="View" data-moth-view-widget>
      <div className="moth-bar-group" role="group" aria-label="The view">
        <Select
          aria-label="View"
          size="sm"
          value={current.key}
          options={options}
          onChange={(key) => { if (key && key !== 'unsaved') views?.select(key) }}
          data-moth-view-pick
          className="moth-bar-view"
        />
        {current.row && viewSnap?.unsaved && writableHere && (
          <IconButton size="sm" Icon={Save} title="Save this view" onClick={saveInPlace} disabled={busy} data-moth-view-save />
        )}
        {/* Greyed, it says why, as the card's Save as did (round 1): the name stays, the reason is its description. */}
        <IconButton size="sm" Icon={BookmarkPlus} aria-label="Save as…"
          title={viewSnap?.available === false ? 'Saved views are not on this database yet.' : 'Save as…'}
          onClick={() => setSaving({ name: '', scope: 'aggregate', positions: livePositions() })}
          disabled={viewSnap?.available === false} data-moth-view-save-as />
        <MenuButton title="More for this view" items={viewMenu} minWidth={200} />
      </div>
      <span className="moth-bar-rule" aria-hidden="true" />
      <div className="moth-search-box moth-bar-find">
        <SearchIcon size={14} aria-hidden="true" className="moth-bar-find-icon" />
        <input
          className="moth-search"
          type="search"
          placeholder="Find and fly to…"
          aria-label="Find and fly to"
          title="Find and fly to"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && hits[0]) { onFind(hits[0].id); setQuery('') }
            if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery('') }
          }}
          data-moth-find
        />
        {query && (
          <ul className="moth-find-results moth-bar-pop" data-moth-find-results>
            {hits.length === 0 && <li className="moth-quiet">Nothing has that name.</li>}
            {hits.map((h) => (
              <li key={h.id}>
                <button type="button" className="moth-link" onClick={() => { onFind(h.id); setQuery('') }}>{h.label || '(no name)'}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="moth-bar-group moth-bar-anchor">
        {/* A button that opens a pop: expanded or not, never a toggle that is pressed (round 1). */}
        <IconButton ref={showButton} size="sm" Icon={SlidersHorizontal} title="What shows" aria-expanded={showing} active={showing}
          aria-pressed={undefined} onClick={() => setShowing((v) => !v)} data-moth-view-show />
        <IconButton size="sm" Icon={Crosshair} title={focusOn ? 'Show everything' : 'Focus here'} aria-pressed={!!focusOn} active={!!focusOn}
          disabled={!selectedNode} onClick={() => views?.setFocus(focusOn ? null : selectedNode?.id)} data-moth-focus />
        <Select size="sm" aria-label="Focus reaches" value={String(config.focusDepth)} onChange={(v) => set({ focusDepth: Number(v) || 1 })}
          options={[{ value: '1', label: 'One step' }, { value: '2', label: 'Two steps' }]} className="moth-bar-reach" />
        {showing && (
          <div className="moth-view-show moth-bar-pop" role="group" aria-label="What shows"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowing(false); showButton.current?.focus() } }}>
          <p className="moth-label">Dots</p>
          <div className="moth-chips">
            {DOT_CHOICES.map(([k, words]) => (
              <Chip key={k} active={config.nodeKinds.includes(k)} onClick={() => set({ nodeKinds: toggle(config.nodeKinds, k) })}
                disabled={k === 'tag' && !config.nodeKinds.includes('file')} title={k === 'tag' && !config.nodeKinds.includes('file') ? 'Tags show with their files.' : undefined}>
                {words}
              </Chip>
            ))}
          </div>
          <p className="moth-label">Lines</p>
          <div className="moth-chips">
            {LINE_CHOICES.map(([k, words]) => (
              <Chip key={k} active={config.edgeKinds.includes(k)} onClick={() => set({ edgeKinds: toggle(config.edgeKinds, k) })}>{words}</Chip>
            ))}
          </div>
          <Field label="Layout">
            <Select size="sm" value={config.layout} onChange={(v) => set({ layout: v || 'force' })}
              options={[{ value: 'force', label: 'Free' }, { value: 'radial', label: 'Radial tree' }]} />
          </Field>
          <p className="moth-label">Tags to keep</p>
          <div className="moth-chips">
            {TAG_WORDS.map((t) => (
              <Chip key={t} active={config.tags.includes(t)} onClick={() => set({ tags: toggle(config.tags, t) })}>{t}</Chip>
            ))}
          </div>
          </div>
        )}
      </div>
      <span className="moth-bar-rule" aria-hidden="true" />
      <div className="moth-bar-group moth-bar-time">
        <HistoryIcon size={14} aria-hidden="true" className="moth-bar-time-icon" />
        <MothTimeSlider history={history} compact />
      </div>
      <span className="moth-bar-rule" aria-hidden="true" />
      <div className="moth-bar-group" role="group" aria-label="What is ticked">
        <GatedAction allowed={gate.allowed} reason={gate.reason}>
          <IconButton size="sm" Icon={FolderInput} title="Move to…" onClick={onMove} disabled={!gate.allowed || pickedCount === 0} data-moth-move />
        </GatedAction>
        <GatedAction allowed={gate.allowed} reason={gate.reason}>
          <IconButton size="sm" Icon={Trash2} title="Delete" danger onClick={onDelete} disabled={!gate.allowed || pickedCount === 0} data-moth-delete />
        </GatedAction>
        {jump && <IconButton size="sm" Icon={ExternalLink} title={jump.label} onClick={onJump} data-moth-jump />}
      </div>
      <span className="moth-bar-rule" aria-hidden="true" />
      <div className="moth-bar-group" role="group" aria-label="Undo and redo">
        <IconButton size="sm" Icon={Undo2} title="Undo" onClick={onUndo} disabled={!canUndo} data-moth-undo />
        <IconButton size="sm" Icon={Redo2} title="Redo" onClick={onRedo} disabled={!canRedo} data-moth-redo />
      </div>
      {extra}

      {renaming && (
        <Dialog
          width="confirm"
          title="Rename this view"
          onClose={() => setRenaming(null)}
          busy={busy}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setRenaming(null)} disabled={busy}>Cancel</Button>
              <Button onClick={doRename} loading={busy} loadingLabel="Saving…" disabled={!renaming.name.trim()} data-moth-view-rename-confirm>Rename</Button>
            </>
          )}
        >
          <Field label="Name">
            <Input value={renaming.name} onChange={(v) => setRenaming({ name: typeof v === 'string' ? v : v?.target?.value ?? '' })} autoFocus data-moth-view-rename-name />
          </Field>
        </Dialog>
      )}
      {deleting && current.row && (
        <Dialog
          width="confirm"
          title={`Delete "${current.row.name}"?`}
          onClose={() => setDeleting(false)}
          busy={busy}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setDeleting(false)} disabled={busy}>Cancel</Button>
              <Button variant="danger" onClick={doDelete} loading={busy} loadingLabel="Deleting…" data-moth-view-delete-confirm>Delete</Button>
            </>
          )}
        >
          <p>{current.row.scope_kind === 'project' ? 'Everyone on the project loses this view and where its dots were.' : 'Where its dots were goes with it.'} You can undo this straight after.</p>
        </Dialog>
      )}
      {saving && (
        <Dialog
          width="confirm"
          title="Save this view"
          onClose={() => setSaving(null)}
          busy={busy}
          footer={(
            <>
              <Button variant="ghost" onClick={() => setSaving(null)} disabled={busy}>Cancel</Button>
              <Button onClick={doSave} loading={busy} loadingLabel="Saving…" disabled={!saving.name.trim()} data-moth-view-save-confirm>Save</Button>
            </>
          )}
        >
          <Field label="Name">
            <Input value={saving.name} onChange={(v) => setSaving((s) => ({ ...s, name: typeof v === 'string' ? v : v?.target?.value ?? '' }))} autoFocus data-moth-view-name />
          </Field>
          <Field label="Who sees it">
            <Select
              value={saving.scope}
              onChange={(v) => setSaving((s) => ({ ...s, scope: v || 'aggregate' }))}
              options={[
                { value: 'aggregate', label: 'Just me, across my projects' },
                ...(canSaveShared ? [{ value: 'project', label: 'Everyone on the project of what is selected' }] : []),
              ]}
              data-moth-view-scope
            />
          </Field>
        </Dialog>
      )}
    </section>
  )
}
