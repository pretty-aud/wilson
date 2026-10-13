// =============================================================================
// VersionQuestions — the questions bid versions ask (post-overhaul S5c, step
// 4). One host shows one question at a time; the Budget's Summary mounts it,
// and the Timeline's version control (S5d) mounts the same host with its own
// `ask`:
//
//   { kind: 'saveAsNew', liveShotListId, basedOnListId }
//   { kind: 'open' | 'lock', versionId, liveShotListId, basedOnListId }
//   { kind: 'manage', liveShotListId, basedOnListId }
//   { kind: 'delete', versionId, back, liveShotListId, basedOnListId }
//                                  back 'manage': the picker again after
//
// Every ask carries the person's "Based on shot list" choice
// (`liveShotListId`, undefined while untouched) and the list the bid is based
// on (`basedOnListId`), and every ask made from another passes them on: the
// unsaved question reads the first, Save as new version… names the second
// (S5c review round 1, R1-05 and R1-06).
//
// The shapes are S3b's and S3c's. Edit this version and Set budget active are
// AnswerDialog (the form width; the answer that changes nothing — Cancel —
// first and focused): their unsaved question has three answers, and the
// question after it keeps the same shape with one (Law of Similarity: two
// steps of one decision look alike). A version's delete is ListConfirm (the
// confirm width, Cancel first and focused). Manage versions… is the kit
// Dialog at the workbench width holding a kit Table, ShotListPicker's
// pattern (F5), each row's ⋯ a MenuButton. Save as new version… is a form
// that focuses its Name field — typing is the task — with Cancel first in
// its footer.
//
// None of them counts in a page's ownDialogsRef: a page's undo keys stand
// down under any kit Dialog that is not its own (S3c's "For S5"). Every step
// reaches the provider's mutators (each ONE undo step, never a reload, F12.4),
// and the steps that change the Timeline, lock, unlock or delete say what
// they did in the undo toast (ctx.runWithUndoToast): on the Budget's Summary
// that toast is the one way back, so no sentence here says "Ctrl+Z".
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CopyPlus, CheckCircle2, Pencil, FileText, Trash2 } from 'lucide-react'
import { Dialog, Button, Field, Input, Table, Th, Td, Row, StatusBadge, EmptyState } from '../../../../ui'
import CurrencyDisplay, { formatTenths } from '../../components/CurrencyDisplay'
import AnswerDialog from '../scenes/AnswerDialog'
import ListConfirm from '../scenes/ListConfirm'
import MenuButton from '../scenes/MenuButton'
import { showDate } from '../../dates'
import { readVersion, sortVersionsNewest, selectedVersionOf } from '../../state/budgetVersionModel'
import { formatShotListLabel } from '../../state/shotListModel'
import {
  unsavedQuestionWords, openQuestionWords, deleteQuestionWords, saveAsNewWords,
  openedToastWords, lockedToastWords, deletedToastWords, recordedToastWords,
} from '../../state/versionWords'
import '../rabbitBudget.css'

const q = (s) => `“${s}”`

/** A version's date as the dropdown and the picker say it (its creation: the versions' order, F13). */
export function versionDate(v) {
  return showDate(v?.created_at)
}

/** When a version was last saved into (a living version's snapshot says; an older one, its creation). */
export function versionSavedAt(v) {
  return v?.snapshot?.saved_at || v?.created_at || null
}

/**
 * Post-overhaul S3c, step 2 (D18): the shot list a bid version is based on,
 * in words — { text, note } or null. While the list is live, its own label
 * (renamed since? the new name: it is the same list); archived, or gone from
 * this client, the label frozen into the version's snapshot, noted so.
 * (Moved here from BudgetView.jsx with the versions table it served.)
 */
export function basedOnLabel(version, shotLists) {
  const frozen = version?.snapshot?.shot_list || null
  const id = version?.shot_list_id || frozen?.id || null
  if (!id) return null
  const list = (shotLists || []).find(l => l.id === id) || null
  if (list && !list.archived_at) return { text: formatShotListLabel(list), note: null }
  if (frozen?.title) return { text: formatShotListLabel(frozen), note: list ? 'archived' : 'not in this project now' }
  if (list) return { text: formatShotListLabel(list), note: 'archived' }
  return null
}

/** basedOnLabel as one line: "Shoot · v2", "Old cut · v4 (archived)"; null for none. */
export function basedOnWords(version, shotLists) {
  const b = basedOnLabel(version, shotLists)
  return b ? `${b.text}${b.note ? ` (${b.note})` : ''}` : null
}

/** A shot list's words for the Save as new form ("Shoot · v2", "Old cut · v4 (archived)"), or null for none. */
function listWords(ctx, id) {
  const list = id ? ((ctx?.shotLists || []).find(l => l.id === id) || null) : null
  return list ? `${formatShotListLabel(list)}${list.archived_at ? ' (archived)' : ''}` : null
}

/** The rows with work on them, as the keep answer takes them: { tasks, phases } ids. */
function keepOf(work) {
  return {
    tasks: work.filter(w => w.kind === 'tasks').map(w => w.id),
    phases: work.filter(w => w.kind === 'phases').map(w => w.id),
  }
}

// ── Save as new version… (F2: the only way a version appears; it asks for a name)
// `onCancel({ made })`: `made` when the version was made before the step
// stopped (S5c review round 2, R2-05) — the form then offers only Close, so a
// second press never makes a second version; the held toast's Undo takes the
// first back.
export function SaveAsNewDialog({ locked = false, lockedVersion = null, basedOn = null, onCancel, onSave }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [made, setMade] = useState(false)
  const ready = name.trim().length > 0 && !made
  const close = () => onCancel?.({ made })
  async function save() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), summary: note.trim() })
    } catch (err) {
      setError(err?.message || String(err))
      if (err?.versionMade) setMade(true)
      setBusy(false)
    }
  }
  return createPortal(
    <Dialog
      width="form"
      className="wilson-dark-scroll"
      title="Save as new version"
      busy={busy}
      error={error}
      onClose={close}
      footer={(
        <>
          <Button disabled={busy} onClick={close}>{made ? 'Close' : 'Cancel'}</Button>
          <Button variant="primary" Icon={CopyPlus} loading={busy} disabled={!ready} onClick={save}>Save as new version</Button>
        </>
      )}
    >
      <p className="rb-bv-q-line">{saveAsNewWords({ locked, lockedVersion })}</p>
      <p className="rb-bv-q-quiet">{basedOn ? `Based on the shot list ${q(basedOn)}.` : 'Based on no shot list.'}</p>
      <div className="rb-bv-q-fields">
        <Field label="Name">
          <Input value={name} onChange={setName} autoFocus placeholder={locked ? 'e.g. Revision after week 2' : 'e.g. Mid ROM'}
            disabled={busy || made} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        </Field>
        <Field label="Note">
          <Input value={note} onChange={setNote} placeholder="What this version is for (optional)"
            disabled={busy || made} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
        </Field>
      </div>
    </Dialog>,
    document.body,
  )
}

/** A one-field form (Rename…, Edit note…), the Save as new dialog's shape. */
function OneFieldDialog({ title, label, initial = '', required = false, verb = 'Save', onCancel, onSave }) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ready = !required || value.trim().length > 0
  async function save() {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSave(value.trim())
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }
  return createPortal(
    <Dialog width="form" title={title} busy={busy} error={error} onClose={onCancel}
      footer={(
        <>
          <Button disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!ready} onClick={save}>{verb}</Button>
        </>
      )}
    >
      <Field label={label}>
        <Input value={value} onChange={setValue} autoFocus disabled={busy} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
      </Field>
    </Dialog>,
    document.body,
  )
}

/**
 * Edit this version / Set budget active — the questions, in order (step 4):
 *   1. unsaved first (F2; constraint 8): the open version has unsaved
 *      changes → Save to X / Discard changes / Cancel; no version open and the
 *      Timeline matches no saved version → Save as new version… / Discard /
 *      Cancel. Discard says by count and name what it deletes (the rows no
 *      saved version holds), the ordinary way.
 *   2. then the step itself, naming what leaves the Timeline and what comes
 *      back, and the rows with work on them (constraint 4) with "Keep them
 *      on the Timeline in <version>", OFF by default — leaving loses nothing,
 *      while keeping makes the version unsaved at once (S5b's decision 2).
 * mode 'open' | 'lock'. A version saved before S5 ("no timeline captured")
 * locks without loading, so it never asks the unsaved question.
 */
export function VersionFlow({ ctx, mode = 'open', versionId, roleRates, liveShotListId, basedOnListId, onDone }) {
  const step = ctx?.runWithUndoToast || ((run) => run())
  const preview = (opts) => ctx?.previewOpenBudgetVersion?.(versionId, { roleRates, liveShotListId, ...opts }) || null
  // The question is about the moment it was asked: the unsaved question reads
  // this, so a Save landing under it cannot empty it before its answer ends.
  const [first] = useState(() => preview({}))
  const [stage, setStage] = useState(() => {
    if (!first) return 'gone'
    return first.unsaved && (mode === 'open' || readVersion(first.version).hasTimeline) ? 'unsaved' : 'go'
  })
  const [discard, setDiscard] = useState(false)
  const [keepWork, setKeepWork] = useState(false)
  const [running, setRunning] = useState(false)
  // While the step runs its words stay as they were when it was pressed (the
  // rows move under it, one write at a time).
  const [frozen, setFrozen] = useState(null)
  // The version was gone (another window deleted it) when this was asked.
  useEffect(() => { if (stage === 'gone') onDone?.() }, [stage, onDone])
  if (stage === 'gone') return null

  if (stage === 'newName') {
    return (
      <SaveAsNewDialog
        key="newName"
        // S5c review round 1 (R1-05): the list it is saved on, said — it
        // read "Based on no shot list." and saved on the active list.
        basedOn={listWords(ctx, basedOnListId)}
        // Made, then stopped (R2-05): the unsaved question it answered no
        // longer holds — the flow ends there, the toast its way back.
        onCancel={({ made } = {}) => (made ? onDone?.() : setStage('unsaved'))}
        onSave={async ({ name, summary }) => {
          await step(() => ctx.createBudgetVersion({ name, summary, roleRates, basedOnListId }), null)
          setStage('go')
        }}
      />
    )
  }

  if (stage === 'unsaved') {
    const p = first
    const target = p.version
    const words = unsavedQuestionWords({ mode, unsaved: p.unsaved, target })
    const isOpen = p.unsaved.kind === 'open'
    return (
      <AnswerDialog
        key="unsaved"
        title={words.title}
        stayLabel="Cancel"
        onStay={() => onDone?.()}
        answers={[
          { label: words.discard, variant: 'danger', onClick: async () => { setDiscard(true); setStage('go') } },
          isOpen
            ? {
              label: words.save,
              variant: 'primary',
              onClick: async () => {
                // R2-05: stopped part way, the toast is its way back.
                await step(() => ctx.saveBudgetVersion(p.unsaved.version.id, { roleRates, basedOnListId: liveShotListId }), null)
                setStage('go')
              },
            }
            : { label: words.save, variant: 'primary', onClick: async () => setStage('newName') },
        ]}
      >
        {words.sentences.map((s, i) => <p key={i} className="rb-bv-q-line">{s}</p>)}
      </AnswerDialog>
    )
  }

  // stage 'go': the step itself. `base` is what the step would do with no
  // row kept — its rows with work stay the checkbox's even once it is ticked
  // (kept, they no longer leave, and the box would vanish under the pointer).
  const now = frozen || (() => {
    const b = preview({ discard })
    if (!b) return null
    const k = keepWork && b.work.length ? keepOf(b.work) : null
    return { base: b, keep: k, p: k ? preview({ discard, keep: k }) : b }
  })()
  if (!now) return null
  const { base, keep, p } = now
  const read = readVersion(p.version)
  // Review round 1's smaller ones: an open version with unsaved changes that
  // a lock of an OLD version closes without asking (it loads nothing), and a
  // version edited from Manage that is not the selected bid yet — both said.
  const words = openQuestionWords({
    mode, preview: p, work: base.work, read, discard,
    openUnsaved: first?.unsaved?.kind === 'open',
    selected: selectedVersionOf(ctx?.budgetVersions)?.id === versionId,
  })
  async function go() {
    setFrozen(now)
    setRunning(true)
    try {
      const opts = { roleRates, discard, keep }
      const toast = mode === 'lock'
        ? lockedToastWords(p.version)
        : openedToastWords({ version: p.version, leaving: p.leaving, returning: p.returning })
      await step(() => (mode === 'lock' ? ctx.activateBudget(versionId, opts) : ctx.openBudgetVersion(versionId, opts)), toast)
      onDone?.()
    } catch (err) {
      // Refused, or stopped part way: the question stays, its words those of
      // the schedule as it is now, the refusal in its error slot.
      setFrozen(null)
      throw err
    } finally {
      setRunning(false)
    }
  }
  return (
    <AnswerDialog
      key="go"
      title={words.title}
      stayLabel="Cancel"
      onStay={() => onDone?.()}
      answers={[{ label: words.verb, variant: 'primary', onClick: go }]}
    >
      {words.sentences.map((s, i) => <p key={i} className="rb-bv-q-line">{s}</p>)}
      {words.keepLabel && (
        <label className="rb-bv-q-keep">
          <input
            type="checkbox"
            className="rb-bv-q-check"
            checked={keepWork}
            disabled={running}
            onChange={(e) => setKeepWork(e.target.checked)}
          />
          <span>{words.keepLabel}</span>
        </label>
      )}
    </AnswerDialog>
  )
}

/** Delete a version (constraint 10): the set-aside rows only it holds go with it, named first. */
export function DeleteVersionQuestion({ ctx, versionId, onDone }) {
  const step = ctx?.runWithUndoToast || ((run) => run())
  // Read once, when asked: the delete removes the version from memory before
  // its request answers, and the question must stay (busy, then any refusal
  // in its error slot) until the step ends.
  const [asked] = useState(() => {
    const preview = ctx?.previewDeleteBudgetVersion?.(versionId) || null
    if (!preview) return null
    return {
      preview,
      isOpen: (ctx?.project?.open_budget_version_id || null) === preview.version.id,
      isSelected: selectedVersionOf(ctx?.budgetVersions)?.id === preview.version.id,
    }
  })
  useEffect(() => { if (!asked) onDone?.() }, [asked, onDone])
  if (!asked) return null
  const { preview } = asked
  const v = preview.version
  const words = deleteQuestionWords(asked)
  return (
    <ListConfirm
      title={words.title}
      confirmLabel={words.verb}
      onCancel={() => onDone?.()}
      onConfirm={async () => {
        await step(() => ctx.deleteBudgetVersion(versionId), deletedToastWords({ version: v, only: preview.only }))
        onDone?.()
      }}
    >
      {words.sentences.map((s, i) => <p key={i} className="rb-bv-q-line">{s}</p>)}
    </ListConfirm>
  )
}

/**
 * Manage versions… (F3, F5: the shot-list picker's pattern): every version,
 * newest first, its state in words (Locked / Open / Selected — the selected
 * bid is also the kit's selected row, the one selection treatment), its
 * dates, both totals (F7: the overall WITH the agency fee, the before-agency
 * beside it), bid days, the timeline's length (F6) and the note; rename, the
 * note and delete in each row's ⋯ (Hick's: the Summary keeps two verbs).
 */
export function ManageVersionsDialog({ ctx, currency, ratesPending = null, onClose, onEdit, onDelete }) {
  const [form, setForm] = useState(null)
  const [error, setError] = useState(null)
  const project = ctx?.project
  const versions = sortVersionsNewest(ctx?.budgetVersions)
  const locked = project?.budget_active === true
  const lockedId = locked ? (project?.budget_active_version_id || null) : null
  const openId = project?.open_budget_version_id || null
  const selectedId = selectedVersionOf(ctx?.budgetVersions)?.id || null
  async function select(id) {
    setError(null)
    try { await ctx.selectBudgetVersion(id) } catch (err) { setError(err?.message || String(err)) }
  }
  return createPortal(
    <>
      <Dialog
        width="workbench"
        className="wilson-dark-scroll"
        title="Bid versions"
        subtitle="The selected bid is the one the variance measures against; the open version is the one the Timeline and Budget show and Save writes into; the locked one is the budget in production."
        error={error}
        onClose={onClose}
        footer={<Button onClick={onClose}>Close</Button>}
      >
        {versions.length === 0 ? (
          <EmptyState title="No bid versions yet" body="Save as new version, on the Budget's Summary or in the Timeline's bid version bar, keeps what the Timeline and Budget show as a bid." />
        ) : (
          <Table className="rb-bv-table" head={(
            <Row>
              <Th width="var(--rb-bv-col-state)"><span className="sr-only">State</span></Th>
              <Th>Name</Th>
              <Th width="var(--rb-bv-col-date)">Created</Th>
              <Th width="var(--rb-bv-col-money)" numeric>Overall</Th>
              <Th width="var(--rb-bv-col-before)" numeric>Before agency</Th>
              <Th width="var(--rb-bv-col-days)" numeric>Bid days</Th>
              <Th width="var(--rb-bv-col-span)" numeric>Timeline</Th>
              <Th>Note</Th>
              <Th width="var(--rb-bv-col-acts)" align="right"><span className="sr-only">Actions</span></Th>
            </Row>
          )}>
            {versions.map((v) => {
              const r = readVersion(v)
              const isLocked = v.id === lockedId
              const isOpen = v.id === openId
              const isSelected = v.id === selectedId
              const based = basedOnWords(v, ctx?.shotLists)
              const editWhy = locked ? 'budget active'
                : (!r.hasTimeline ? 'no timeline captured'
                  : (isOpen ? 'open now' : (ratesPending ? 'reading the rates' : undefined)))
              const items = [
                { label: 'Select as the bid', Icon: CheckCircle2, disabled: locked || isSelected, hint: locked ? 'budget active' : (isSelected ? 'selected' : undefined), onClick: () => select(v.id) },
                { label: 'Edit this version', Icon: Pencil, disabled: !!editWhy, hint: editWhy, onClick: () => onEdit(v.id) },
                { label: 'Rename…', Icon: FileText, onClick: () => setForm({ kind: 'rename', v }) },
                { label: 'Edit note…', Icon: FileText, onClick: () => setForm({ kind: 'note', v }) },
                { label: 'Delete…', Icon: Trash2, danger: true, disabled: isLocked, hint: isLocked ? 'locked' : undefined, onClick: () => onDelete(v.id) },
              ]
              return (
                <Row key={v.id} selected={isSelected}>
                  <Td>
                    {isLocked ? <StatusBadge tone="success" label="Locked" />
                      : isOpen ? <StatusBadge tone="neutral" label="Open" />
                        : isSelected ? <StatusBadge tone="neutral" label="Selected" /> : null}
                  </Td>
                  <Td className="rb-bv-name-cell" title={`${v.name}${based ? `\nBased on shot list ${based}` : ''}`}>{v.name}</Td>
                  <Td className="rb-bv-figure">{versionDate(v)}</Td>
                  <Td numeric title={r.overallKnown ? undefined : 'Saved before versions kept the agency fee'}>
                    {r.overallKnown ? <CurrencyDisplay value={r.overall} currency={currency} /> : '—'}
                  </Td>
                  <Td numeric className="rb-bv-quiet"><CurrencyDisplay value={r.beforeAgency} currency={currency} /></Td>
                  <Td numeric className="rb-bv-quiet">{r.totalBidDays == null ? '—' : formatTenths(r.totalBidDays)}</Td>
                  <Td numeric className="rb-bv-quiet"
                    title={r.span ? `${showDate(r.span.start)} – ${showDate(r.span.end)}` : (r.hasTimeline ? undefined : 'No timeline captured')}>
                    {r.spanDays == null ? '—' : `${r.spanDays} d`}
                  </Td>
                  <Td className="rb-bv-note-cell" title={v.summary || undefined} data-empty={v.summary ? undefined : 'true'}>{v.summary || '—'}</Td>
                  <Td align="right"><MenuButton title={`Actions for ${q(v.name)}`} items={items} minWidth={220} /></Td>
                </Row>
              )
            })}
          </Table>
        )}
      </Dialog>
      {form?.kind === 'rename' && (
        <OneFieldDialog title={`Rename ${q(form.v.name)}`} label="Name" initial={form.v.name} required verb="Rename"
          onCancel={() => setForm(null)} onSave={async (name) => { await ctx.renameBudgetVersion(form.v.id, name); setForm(null) }} />
      )}
      {form?.kind === 'note' && (
        <OneFieldDialog title={`Note on ${q(form.v.name)}`} label="Note" initial={form.v.summary || ''}
          onCancel={() => setForm(null)} onSave={async (note) => { await ctx.updateBudgetVersionSummary(form.v.id, note); setForm(null) }} />
      )}
    </>,
    document.body,
  )
}

/**
 * The host: the question `ask` names, one at a time. Focus goes back, when
 * the last question closes, to whatever had it when the first opened (a
 * question that follows another remembers the one before it, which is gone
 * by then).
 */
export function VersionQuestions({ ctx, ask, setAsk, roleRates, currency, ratesPending = null }) {
  const openerRef = useRef(null)
  const wasOpen = useRef(false)
  if (ask && !wasOpen.current && typeof document !== 'undefined') openerRef.current = document.activeElement
  wasOpen.current = !!ask
  useEffect(() => {
    if (ask) return undefined
    const opener = openerRef.current
    openerRef.current = null
    if (opener && opener !== document.body && opener.isConnected && !opener.disabled) opener.focus?.({ preventScroll: true })
    return undefined
  }, [ask])
  const done = () => setAsk(null)
  if (!ask) return null
  const project = ctx?.project
  const locked = project?.budget_active === true
  const lockedVersion = locked ? (ctx?.budgetVersions || []).find(v => v.id === project?.budget_active_version_id) || null : null
  const step = ctx?.runWithUndoToast || ((run) => run())

  if (ask.kind === 'saveAsNew') {
    return (
      <SaveAsNewDialog
        locked={locked}
        lockedVersion={lockedVersion}
        basedOn={listWords(ctx, ask.basedOnListId)}
        onCancel={done}
        onSave={async ({ name, summary }) => {
          // F9: under a lock it only records — nothing on screen changes, so
          // the toast says it happened (and Undo takes it back). Otherwise no
          // toast when it ends well (the version opens before the person's
          // eyes), and the held one when it stops part way (R2-05).
          await step(
            () => ctx.createBudgetVersion({ name, summary, roleRates, basedOnListId: ask.basedOnListId }),
            locked ? recordedToastWords({ name }) : null,
          )
          done()
        }}
      />
    )
  }
  if (ask.kind === 'manage') {
    return (
      <ManageVersionsDialog
        ctx={ctx}
        currency={currency}
        ratesPending={ratesPending}
        onClose={done}
        onEdit={(id) => setAsk({ kind: 'open', versionId: id, liveShotListId: ask.liveShotListId, basedOnListId: ask.basedOnListId })}
        // S5c review round 1 (R1-06): the person's list choice rides along,
        // there and back — dropped, the picker's Edit afterwards skipped the
        // unsaved question and lost the choice.
        onDelete={(id) => setAsk({ kind: 'delete', versionId: id, back: 'manage', liveShotListId: ask.liveShotListId, basedOnListId: ask.basedOnListId })}
      />
    )
  }
  if (ask.kind === 'open' || ask.kind === 'lock') {
    return (
      <VersionFlow
        key={`${ask.kind}-${ask.versionId}`}
        ctx={ctx}
        mode={ask.kind}
        versionId={ask.versionId}
        roleRates={roleRates}
        liveShotListId={ask.liveShotListId}
        basedOnListId={ask.basedOnListId}
        onDone={done}
      />
    )
  }
  if (ask.kind === 'delete') {
    return (
      <DeleteVersionQuestion
        key={`delete-${ask.versionId}`}
        ctx={ctx}
        versionId={ask.versionId}
        onDone={() => setAsk(ask.back === 'manage' ? { kind: 'manage', liveShotListId: ask.liveShotListId, basedOnListId: ask.basedOnListId } : null)}
      />
    )
  }
  return null
}

export default VersionQuestions
