// MothViewWidget.jsx — MO2: the view widget, top left of the HUD (the brief §3.1, her split of 2026-11-01).
// It holds only what changes how you view the graph: the view (pick, save, reset, a new one), what shows as dots
// and which lines join them, the layout, focus, search that flies to a match, the tags to keep, and the time
// slider; and Move to and Delete on what is selected (her §12a.8), with Undo, Redo and opening it in its own tool.
// Appearance is Settings' (the toolbar's right end), never here.
import { useMemo, useState } from 'react'
import { Button, Chip, Dialog, Field, Input, Select } from '../../../ui'
import GatedAction from '../../../permissions/GatedAction'
import { QUICK_VIEWS, DOT_CHOICES, LINE_CHOICES, TAG_WORDS, searchCatalogue, UNSAVED_LABEL } from '../state/mothViewState.js'
import MothTimeSlider from './MothTimeSlider.jsx'

export default function MothViewWidget({
  views, viewSnap, config, catalogue, index, selectedNode, pickedCount, gate, canUndo, canRedo, jump, localOnly,
  onUndo, onRedo, onMove, onDelete, onJump, onFind, onNewView, onRelayout, onError, history, livePositions = () => ({}),
  onViewDeleted = () => {},
}) {
  const [query, setQuery] = useState('')
  const [showing, setShowing] = useState(false)
  const [saving, setSaving] = useState(null) // { name, scope }
  const [renaming, setRenaming] = useState(null) // { name }
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const hits = useMemo(() => searchCatalogue(catalogue, query, { index, limit: 12 }), [catalogue, query, index])
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

  return (
    <section className="moth-hud-panel moth-view-widget" aria-label="View" data-moth-view-widget>
      <div className="moth-row">
        <Select
          aria-label="View"
          size="sm"
          value={current.key}
          options={options}
          onChange={(key) => { if (key && key !== 'unsaved') views?.select(key) }}
          data-moth-view-pick
        />
        <Button size="sm" variant="ghost" onClick={onNewView} data-moth-view-new>New</Button>
      </div>
      <div className="moth-row">
        {current.row && viewSnap?.unsaved && writableHere && (
          <Button size="sm" onClick={saveInPlace} loading={busy} loadingLabel="Saving…" data-moth-view-save>Save</Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setSaving({ name: '', scope: 'aggregate', positions: livePositions() })}
          disabled={viewSnap?.available === false} title={viewSnap?.available === false ? 'Saved views are not on this database yet.' : undefined} data-moth-view-save-as>
          Save as…
        </Button>
        <Button size="sm" variant="ghost" onClick={() => views?.reset().catch((err) => onError?.(err?.message || String(err)))} data-moth-view-reset>Reset</Button>
        <Button size="sm" variant="ghost" onClick={onRelayout} data-moth-relayout>Lay out again</Button>
      </div>
      {current.row && writableHere && (
        <div className="moth-row">
          <Button size="sm" variant="ghost" onClick={() => setRenaming({ name: current.row.name })} data-moth-view-rename>Rename…</Button>
          <Button size="sm" variant="ghost" onClick={() => setDeleting(true)} data-moth-view-delete>Delete view…</Button>
        </div>
      )}
      {viewSnap?.available === false && <p className="moth-quiet">This view lasts for this visit only.</p>}

      <div className="moth-search-box">
        <input
          className="moth-search"
          type="search"
          placeholder="Find and fly to…"
          aria-label="Find and fly to"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) { onFind(hits[0].id); setQuery('') } }}
          data-moth-find
        />
        {query && (
          <ul className="moth-find-results" data-moth-find-results>
            {hits.length === 0 && <li className="moth-quiet">Nothing has that name.</li>}
            {hits.map((h) => (
              <li key={h.id}>
                <button type="button" className="moth-link" onClick={() => { onFind(h.id); setQuery('') }}>{h.label || '(no name)'}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" className="moth-disclose" aria-expanded={showing} onClick={() => setShowing((v) => !v)} data-moth-view-show>
        What shows
      </button>
      {showing && (
        <div className="moth-view-show">
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

      <div className="moth-row">
        <Button size="sm" variant="ghost" disabled={!selectedNode} aria-pressed={!!focusOn}
          onClick={() => views?.setFocus(focusOn ? null : selectedNode?.id)} data-moth-focus>
          {focusOn ? 'Show everything' : 'Focus here'}
        </Button>
        <Select size="sm" aria-label="Focus reaches" value={String(config.focusDepth)} onChange={(v) => set({ focusDepth: Number(v) || 1 })}
          options={[{ value: '1', label: 'One step' }, { value: '2', label: 'Two steps' }]} />
      </div>

      <MothTimeSlider history={history} />

      <div className="moth-row moth-actions">
        <GatedAction allowed={gate.allowed} reason={gate.reason}>
          <Button size="sm" onClick={onMove} disabled={!gate.allowed || pickedCount === 0} data-moth-move>Move to…</Button>
        </GatedAction>
        <GatedAction allowed={gate.allowed} reason={gate.reason}>
          <Button size="sm" variant="danger" onClick={onDelete} disabled={!gate.allowed || pickedCount === 0} data-moth-delete>Delete</Button>
        </GatedAction>
        {jump && <Button size="sm" variant="ghost" onClick={onJump} data-moth-jump>{jump.label}</Button>}
      </div>
      <div className="moth-row">
        <Button size="sm" variant="ghost" onClick={onUndo} disabled={!canUndo} data-moth-undo>Undo</Button>
        <Button size="sm" variant="ghost" onClick={onRedo} disabled={!canRedo} data-moth-redo>Redo</Button>
      </div>

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
