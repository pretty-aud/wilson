// ⚠ UNTESTED DRAFT left by S5b at its hand-off (docs/sessions/handoffs/
// po-s5b-2026-10-05.md §4): never rendered, no CSS, no tests. Outside src/ on
// purpose, so nothing reads it. The continuation moves it to
// src/tools/rabbit_v0.1.0/views/budget/BidVersions.jsx (fixing its imports'
// depth), adds the rb-bv- lane to rabbitBudgetCss.test.js, and tests it.
// =============================================================================
// BidVersions — bid versions on the Budget Summary, and the questions they ask
// (post-overhaul S5b, steps 3–5; the Timeline's control, step 6, reuses the
// state hook and the questions).
//
// Audrey's model (F2, F9, F13; her ruling (a) of 2026-10-05): a bid version is
// a LIVING DOCUMENT. Three states, three words, never mixed:
//   OPEN      the version whose schedule is on the Timeline and Budget now.
//             Save writes back into it; "unsaved changes" when they differ.
//             Her verb for opening one is "Edit this version".
//   SELECTED  the bid the variance measures against (budget_versions.is_active).
//             The dropdown chooses it at once (F13).
//   LOCKED    "Budget active — in production": nothing opens; Save as new
//             version only records a copy (F9).
//
// Design (laws-of-ux and design-direction, loaded for this; the hand-off
// records each decision for Audrey):
//   · Jakob / Mental model — the save row reads like a document's file bar:
//     what is open and whether it is saved on the left, Save and Save as… on
//     the right, in that order.
//   · Von Restorff — ONE orange on the page: Save, while the open version has
//     unsaved changes (the kit's attention state: edge, pulse, "● Unsaved");
//     Save as new version… only when it is the one save verb (nothing open,
//     or a budget active). Never both.
//   · Proximity / Common Region — one Card, two regions on a hairline: the
//     OPEN version's save row, then the SELECTED bid (its dropdown, its
//     facts, its verbs). Each verb sits beside the state it acts on.
//   · Hick's / Choice overload — the row's verbs are the two that matter;
//     rename, the note and delete live in Manage versions…'s row menus.
//   · Working memory — every question names what it changes by count and by
//     name; the person never has to remember which tasks a version held.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Save, CopyPlus, Pencil, ShieldCheck, RotateCcw, FolderOpen, Trash2, CheckCircle2, FileText } from 'lucide-react'
import { Button, Select as KitSelect, Dialog, Table, Th, Td, Row, StatusBadge, Field, Input, EmptyState } from '../../../../ui'
import CurrencyDisplay, { formatTenths } from '../../components/CurrencyDisplay'
import AnswerDialog from '../scenes/AnswerDialog'
import ListConfirm from '../scenes/ListConfirm'
import MenuButton from '../scenes/MenuButton'
import { showDate } from '../../dates'
import {
  readVersion, snapshotFromLive, versionDiff, varianceAgainst, bidTotals, projectBudgetSettings,
  sortVersionsNewest, selectedVersionOf, deltaWords,
} from '../../state/budgetVersionModel'
import { rowsWords, joinNames, workLine } from '../../state/versionWords'

const q = (s) => `“${s}”`
const MAX_NAMES = 4

/** "A, B, C and 3 more" — names of rows, the first few. */
function someNames(rows) {
  const names = (rows || []).map(r => q(r.title || r.name || 'Untitled'))
  if (names.length <= MAX_NAMES) return joinNames(names)
  return `${names.slice(0, MAX_NAMES).join(', ')} and ${names.length - MAX_NAMES} more`
}

/** A version's date as the dropdown and the table say it. */
export function versionDate(v) {
  return showDate(v?.created_at)
}

/** "Mid ROM · 05/10/2026 · Locked" — the dropdown's words (F13). Never money (F10). */
export function versionOptionLabel(v, { lockedId, openId } = {}) {
  const parts = [v.name, versionDate(v)]
  if (v.id === lockedId) parts.push('Locked')
  else if (v.id === openId) parts.push('Open')
  return parts.join(' · ')
}

/**
 * Where the versions stand, for the Summary and the Timeline: the open, the
 * selected and the locked version, and whether the open one has unsaved
 * changes (step 5: one pure diff, budgetVersionModel.versionDiff).
 */
export function useBidVersionState(ctx, roleRates, liveShotListId) {
  const versions = ctx?.budgetVersions
  const project = ctx?.project
  const tasks = ctx?.tasks
  const phases = ctx?.phases
  const milestones = ctx?.milestones
  return useMemo(() => {
    const list = versions || []
    const locked = project?.budget_active === true
    const lockedId = locked ? (project?.budget_active_version_id || null) : null
    const open = list.find(v => v.id === (project?.open_budget_version_id || null)) || null
    const selected = selectedVersionOf(list)
    const live = snapshotFromLive({ tasks: tasks || [], phases: phases || [], milestones: milestones || [], project, roleRates: roleRates || {} })
    const listed = open && liveShotListId !== undefined ? { shotListId: open.shot_list_id ?? null, liveShotListId } : {}
    const diff = open ? versionDiff(open.snapshot, live, listed) : null
    return {
      versions: sortVersionsNewest(list),
      locked, lockedId, open, selected,
      dirty: !!diff?.isDirty, diff,
      live,
    }
  }, [versions, project, tasks, phases, milestones, roleRates, liveShotListId])
}

// ── Save as new version… (F2: the only way a version appears; asks for a name)
export function SaveAsNewDialog({ locked = false, onCancel, onSave }) {
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try { await onSave({ name: name.trim(), summary: note.trim() }) } catch (err) { setError(err?.message || String(err)); setBusy(false) }
  }
  return createPortal(
    <Dialog
      width="form"
      title="Save as new version"
      busy={busy}
      error={error}
      onClose={onCancel}
      footer={(
        <>
          <Button disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant="primary" Icon={CopyPlus} loading={busy} disabled={!name.trim()} onClick={save}>Save as new version</Button>
        </>
      )}
    >
      <p className="rb-bv-q-line">
        {locked
          ? 'The schedule on the Timeline now is saved as a new bid version — a record of production changes. It is not opened or selected, and the budget stays locked to its bid.'
          : 'The schedule on the Timeline now is saved as a new bid version. It becomes the open version, and the selected bid.'}
      </p>
      <Field label="Name">
        <Input value={name} onChange={setName} autoFocus placeholder={locked ? 'e.g. Revision after week 2' : 'e.g. Mid ROM'}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
      </Field>
      <Field label="Note">
        <Input value={note} onChange={setNote} placeholder="What this version is for (optional)"
          onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
      </Field>
    </Dialog>,
    document.body,
  )
}

/** A one-field form (Rename…, Edit note…), the Save as new dialog's shape. */
function OneFieldDialog({ title, label, initial = '', required = false, verb = 'Save', onCancel, onSave }) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function save() {
    if ((required && !value.trim()) || busy) return
    setBusy(true)
    setError(null)
    try { await onSave(value.trim()) } catch (err) { setError(err?.message || String(err)); setBusy(false) }
  }
  return createPortal(
    <Dialog width="form" title={title} busy={busy} error={error} onClose={onCancel}
      footer={(
        <>
          <Button disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={required && !value.trim()} onClick={save}>{verb}</Button>
        </>
      )}
    >
      <Field label={label}>
        <Input value={value} onChange={setValue} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
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
 *      Cancel. Discard says which rows it deletes (those in no saved version).
 *   2. then the step itself, naming what leaves and what returns, and the
 *      rows with work on them (constraint 4) with "Keep these on the
 *      Timeline", off by default (setting aside is the answer that loses
 *      nothing; keeping makes the version unsaved at once).
 * mode: 'open' | 'lock'. One kit Dialog at a time; Cancel first and focused.
 */
export function VersionFlow({ ctx, mode, versionId, roleRates, liveShotListId, onDone }) {
  const [stage, setStage] = useState('start')
  const [discard, setDiscard] = useState(false)
  const [keepWork, setKeepWork] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const preview = ctx?.previewOpenBudgetVersion?.(versionId, { roleRates, discard, liveShotListId }) || null
  const v = preview?.version || null
  const read = v ? readVersion(v) : null
  useEffect(() => {
    if (stage !== 'start' || !preview) return
    setStage(preview.unsaved && (mode === 'open' || read?.hasTimeline) ? 'unsaved' : 'go')
  }, [stage, preview, mode, read?.hasTimeline])
  if (!v || stage === 'start') return null

  if (stage === 'newName') {
    return (
      <SaveAsNewDialog
        locked={false}
        onCancel={() => setStage('unsaved')}
        onSave={async ({ name, summary }) => {
          await ctx.createBudgetVersion({ name, summary, roleRates })
          setStage('go')
        }}
      />
    )
  }

  if (stage === 'unsaved') {
    const u = preview.unsaved
    const none = u.inNoVersion
    const n = (none.tasks.length + none.phases.length + none.milestones.length)
    const discardLine = n
      ? `Discard deletes the ${rowsWords(none)} no saved version holds (${someNames([...none.tasks, ...none.phases, ...none.milestones])}) — Undo (Ctrl+Z) brings them back${none.milestones.length ? ', and key dates also go to Recently deleted' : ''} — and puts every other change back as it was saved.`
      : 'Discard puts every change back as it was saved.'
    const work = u.work || []
    return (
      <AnswerDialog
        title={u.kind === 'open' ? `Save the changes to ${q(u.version.name)} first?` : 'The Timeline holds changes no bid version has'}
        stayLabel="Cancel"
        onStay={onDone}
        answers={[
          { label: u.kind === 'open' ? 'Discard changes' : 'Discard', variant: 'danger', onClick: async () => { setDiscard(true); setStage('go') } },
          u.kind === 'open'
            ? { label: `Save to ${q(u.version.name)}`, variant: 'primary', onClick: async () => { await ctx.saveBudgetVersion(u.version.id, { roleRates, basedOnListId: liveShotListId }); setStage('go') } }
            : { label: 'Save as new version…', variant: 'primary', onClick: async () => setStage('newName') },
        ]}
      >
        <p className="rb-bv-q-line">
          {u.kind === 'open'
            ? `${q(u.version.name)} has unsaved changes. ${mode === 'lock' ? 'The budget locks a version as it was SAVED' : `Editing ${q(v.name)} replaces what the Timeline shows`}, so save them into ${q(u.version.name)} or discard them first.`
            : `What the Timeline shows now is not saved in any bid version. ${mode === 'lock' ? 'Setting a version active' : `Editing ${q(v.name)}`} replaces it, so save it as a new version or discard it first.`}
        </p>
        <p className="rb-bv-q-line">{discardLine}</p>
        {work.length > 0 && <p className="rb-bv-q-line">{`Work is on ${work.length === 1 ? 'one of them' : `${work.length} of them`}: ${joinNames(work.map(workLine))}.`}</p>}
      </AnswerDialog>
    )
  }

  // stage 'go'
  const leaving = preview.leaving
  const returning = preview.returning
  const work = preview.work || []
  const keep = keepWork && work.length ? { tasks: work.filter(w => w.kind === 'tasks').map(w => w.id), phases: work.filter(w => w.kind === 'phases').map(w => w.id) } : null
  const lines = []
  const openNow = preview.open?.id === v.id
  if (mode === 'lock') {
    lines.push(`${q(v.name)} becomes the approved bid: the budget is locked to it as it was saved, and the variance measures against it.`)
    if (!read.hasTimeline) lines.push(`${q(v.name)} was saved before versions kept their schedule (no timeline captured), so the Timeline stays as it is.`)
    else if (openNow && !discard) lines.push(`It is the open version, so the Timeline already shows it. You keep editing the live Timeline during production; Save as new version records those changes without touching the lock.`)
    else lines.push(`The Timeline and Budget become ${q(v.name)}'s schedule first. You keep editing the live Timeline during production; Save as new version records those changes without touching the lock.`)
  } else {
    lines.push(`Its phases, dates, days, roles and rates replace what the Timeline and Budget show now, and it becomes the open version: Save writes your changes back into it.`)
  }
  if (read.hasTimeline) {
    const away = rowsWords(leaving)
    const back = rowsWords(returning)
    if (away || back) {
      lines.push(`${away ? `${away[0].toUpperCase()}${away.slice(1)} ${(leaving.tasks.length + leaving.phases.length + leaving.milestones.length) === 1 ? 'is' : 'are'} not part of it and ${(leaving.tasks.length + leaving.phases.length + leaving.milestones.length) === 1 ? 'is' : 'are'} set aside` : ''}${away && back ? '; ' : ''}${back ? `${back} of its own ${(returning.tasks.length + returning.phases.length + returning.milestones.length) === 1 ? 'returns' : 'return'}` : ''}. Nothing on a set-aside row is lost: it comes back, with its comments, files and logged time, when you edit a version that holds it.`)
    }
  }
  async function go() {
    setBusy(true)
    setError(null)
    try {
      const opts = { roleRates, discard, keep }
      if (mode === 'lock') await ctx.activateBudget(v.id, opts)
      else await ctx.openBudgetVersion(v.id, opts)
      onDone?.()
    } catch (err) {
      setError(err?.message || String(err))
      setBusy(false)
    }
  }
  return createPortal(
    <Dialog
      width="form"
      title={mode === 'lock' ? `Set ${q(v.name)} active?` : `Edit ${q(v.name)}?`}
      busy={busy}
      error={error}
      onClose={onDone}
      footer={(
        <>
          <Button autoFocus disabled={busy} onClick={onDone}>Cancel</Button>
          <Button variant="primary" Icon={mode === 'lock' ? ShieldCheck : Pencil} loading={busy} onClick={go}>
            {mode === 'lock' ? 'Set budget active' : 'Edit this version'}
          </Button>
        </>
      )}
    >
      {lines.map((line, i) => <p key={i} className="rb-bv-q-line">{line}</p>)}
      {work.length > 0 && (
        <div className="rb-bv-q-work">
          <p className="rb-bv-q-line">{`${work.length === 1 ? 'One row' : `${work.length} rows`} to be set aside ${work.length === 1 ? 'has' : 'have'} work on ${work.length === 1 ? 'it' : 'them'}: ${joinNames(work.map(workLine))}.`}</p>
          <label className="rb-bv-q-keep">
            <input type="checkbox" checked={keepWork} onChange={(e) => setKeepWork(e.target.checked)} disabled={busy} />
            <span>{`Keep ${work.length === 1 ? 'it' : 'them'} on the Timeline in ${q(v.name)} (${work.length === 1 ? 'it becomes an unsaved change' : 'they become unsaved changes'})`}</span>
          </label>
        </div>
      )}
    </Dialog>,
    document.body,
  )
}

/** Delete a version (constraint 10): the set-aside rows only it holds go with it, named first. */
export function DeleteVersionQuestion({ ctx, versionId, onDone }) {
  const p = ctx?.previewDeleteBudgetVersion?.(versionId)
  if (!p) return null
  const only = p.only
  const rows = [...only.tasks, ...only.phases, ...only.milestones]
  return (
    <ListConfirm
      title={`Delete ${q(p.version.name)}?`}
      confirmLabel="Delete version"
      onCancel={onDone}
      onConfirm={async () => { await ctx.deleteBudgetVersion(versionId); onDone?.() }}
    >
      <p className="rb-bv-q-line">The bid version is deleted.</p>
      {p.count > 0 && (
        <p className="rb-bv-q-line">{`${rowsWords(only)[0].toUpperCase()}${rowsWords(only).slice(1)} only it holds go with it — set aside now, so no other version could ever bring ${rows.length === 1 ? 'it' : 'them'} back: ${someNames(rows)}. ${rows.length === 1 ? 'It is' : 'They are'} deleted the ordinary way.`}</p>
      )}
      {p.work.length > 0 && <p className="rb-bv-q-line">{`Work is on ${p.work.length === 1 ? 'one of them' : `${p.work.length} of them`}: ${joinNames(p.work.map(workLine))}.`}</p>}
      <p className="rb-bv-q-line">Undo (Ctrl+Z) brings back the version{p.count ? ' and them' : ''}.</p>
    </ListConfirm>
  )
}

/** Manage versions… (F3/F5: the shot-list picker's shape): every version, its facts, a menu per row. */
export function ManageVersionsDialog({ ctx, state, currency, onClose, onEdit, onDelete }) {
  const [form, setForm] = useState(null)
  return createPortal(
    <>
      <Dialog width="workbench" title="Bid versions" onClose={onClose}
        footer={<Button onClick={onClose}>Close</Button>}>
        {state.versions.length === 0 ? (
          <EmptyState title="No bid versions yet" body="Save as new version on the Budget's Summary keeps the schedule as a bid." />
        ) : (
          <Table className="rb-bv-table" head={(
            <Row>
              <Th>Name</Th>
              <Th width="var(--rb-bv-col-date)">Saved</Th>
              <Th width="var(--rb-bv-col-money)" numeric>Total</Th>
              <Th width="var(--rb-bv-col-days)" numeric>Bid days</Th>
              <Th width="var(--rb-bv-col-span)" numeric>Timeline</Th>
              <Th>Note</Th>
              <Th width="var(--rb-bv-col-acts)" align="right"><span className="sr-only">Actions</span></Th>
            </Row>
          )}>
            {state.versions.map((v) => {
              const r = readVersion(v)
              const isLocked = v.id === state.lockedId
              const isOpen = v.id === state.open?.id
              const items = [
                { label: 'Select as the bid', Icon: CheckCircle2, disabled: state.locked || v.is_active, hint: state.locked ? 'budget active' : undefined, onClick: () => ctx.selectBudgetVersion(v.id) },
                { label: 'Edit this version', Icon: Pencil, disabled: state.locked || !r.hasTimeline || isOpen, hint: state.locked ? 'budget active' : (!r.hasTimeline ? 'no timeline captured' : (isOpen ? 'open now' : undefined)), onClick: () => onEdit(v.id) },
                { label: 'Rename…', Icon: FileText, onClick: () => setForm({ kind: 'rename', v }) },
                { label: 'Edit note…', Icon: FileText, onClick: () => setForm({ kind: 'note', v }) },
                { label: 'Delete…', Icon: Trash2, danger: true, disabled: isLocked, hint: isLocked ? 'locked' : undefined, onClick: () => onDelete(v.id) },
              ]
              return (
                <Row key={v.id} selected={v.is_active}>
                  <Td>
                    <span className="rb-bv-name">
                      <span className="rb-bv-name-text">{v.name}</span>
                      {isLocked && <StatusBadge tone="success" label="Locked" />}
                      {isOpen && <StatusBadge tone="neutral" label="Open" />}
                      {v.is_active && !isLocked && <StatusBadge tone="neutral" label="Selected" />}
                    </span>
                  </Td>
                  <Td className="rb-bv-quiet">{versionDate(v)}</Td>
                  <Td numeric><CurrencyDisplay value={r.overall ?? 0} currency={currency} /></Td>
                  <Td numeric className="rb-bv-quiet">{r.totalBidDays == null ? '—' : formatTenths(r.totalBidDays)}</Td>
                  <Td numeric className="rb-bv-quiet" title={r.span ? `${showDate(r.span.start)} – ${showDate(r.span.end)}` : (r.hasTimeline ? undefined : 'No timeline captured')}>{r.spanDays == null ? '—' : `${r.spanDays} d`}</Td>
                  <Td className="rb-bv-quiet rb-bv-note-cell" title={v.summary || undefined}>{v.summary || '—'}</Td>
                  <Td align="right"><MenuButton title={`More for ${v.name}`} items={items} /></Td>
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
 * The questions the versions ask, one at a time — the Summary's and the
 * Timeline's (step 6). `ask` { kind: 'saveAsNew' | 'manage' | 'open' |
 * 'lock' | 'delete', versionId?, liveShotListId?, basedOnListId?, back? }.
 * None of them counts in a page's ownDialogsRef: the page's undo keys stand
 * down under a question (S3c's "For S5").
 */
export function VersionQuestions({ ctx, ask, setAsk, roleRates, currency }) {
  const state = useBidVersionState(ctx, roleRates, ask?.liveShotListId)
  const done = () => setAsk(null)
  if (!ask) return null
  if (ask.kind === 'saveAsNew') {
    return (
      <SaveAsNewDialog locked={state.locked} onCancel={done}
        onSave={async ({ name, summary }) => { await ctx.createBudgetVersion({ name, summary, roleRates, basedOnListId: ask.basedOnListId }); done() }} />
    )
  }
  if (ask.kind === 'manage') {
    return (
      <ManageVersionsDialog ctx={ctx} state={state} currency={currency} onClose={done}
        onEdit={(id) => setAsk({ kind: 'open', versionId: id })}
        onDelete={(id) => setAsk({ kind: 'delete', versionId: id, back: 'manage' })} />
    )
  }
  if (ask.kind === 'open' || ask.kind === 'lock') {
    return <VersionFlow ctx={ctx} mode={ask.kind} versionId={ask.versionId} roleRates={roleRates} liveShotListId={ask.liveShotListId} onDone={done} />
  }
  if (ask.kind === 'delete') {
    return <DeleteVersionQuestion ctx={ctx} versionId={ask.versionId} onDone={() => setAsk(ask.back === 'manage' ? { kind: 'manage' } : null)} />
  }
  return null
}

/**
 * The Summary's versions block (step 3; F11's order puts it between the day
 * tiles and the Cost breakdown). Two regions on a hairline:
 *   1. the save row — the OPEN version, its state, the "Based on shot list"
 *      Select (D18), Save and Save as new version…;
 *   2. the SELECTED bid — the dropdown (choosing selects at once, F13),
 *      Manage versions…, the selected bid's facts (both totals, F7; the
 *      timeline length, F6; the note and the automatic line, F8) and its two
 *      verbs, then the variance against it.
 * The lock's banner and Reset to bidding stay above the tiles (F11).
 * `onAsk` opens a question: { kind: 'saveAsNew' | 'manage' | 'open' | 'lock', … }.
 */
export function BidVersionsBlock({ ctx, roleRates, currency, onAsk }) {
  const project = ctx?.project
  const shotLists = ctx?.shotLists
  const liveLists = useMemo(() => [...(shotLists || [])].filter(l => !l.archived_at), [shotLists])
  const openId = project?.open_budget_version_id || null
  const openRow = (ctx?.budgetVersions || []).find(v => v.id === openId) || null
  const activeListId = project?.active_shot_list_id || null
  const defaultListId = openRow
    ? (openRow.shot_list_id || openRow.snapshot?.shot_list?.id || null)
    : (liveLists.some(l => l.id === activeListId) ? activeListId : null)
  const [basedOnChoice, setBasedOnChoice] = useState(undefined)
  // A different open version is a different default (the choice was about the old one).
  useEffect(() => { setBasedOnChoice(undefined) }, [openId])
  const basedOnId = basedOnChoice === undefined ? defaultListId : basedOnChoice
  const state = useBidVersionState(ctx, roleRates, basedOnId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const sel = state.selected
  const selRead = sel ? readVersion(sel) : null
  const variance = sel ? varianceAgainst(state.live.totals, selRead) : null
  const money = (n) => <CurrencyDisplay value={n} currency={currency} />
  const moneyWords = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(n)

  async function run(fn) {
    setBusy(true)
    setError(null)
    try { await fn() } catch (err) { setError(err?.message || String(err)) } finally { setBusy(false) }
  }
  const saveOpen = () => run(() => ctx.saveBudgetVersion(state.open.id, { roleRates, basedOnListId: basedOnId }))

  const listOptions = liveLists.map(l => ({ value: l.id, label: `${l.title}${l.version != null ? ` · v${l.version}` : ''}${l.id === activeListId ? ' (active)' : ''}` }))
  const editReason = state.locked ? 'While the budget is active no version is opened — Reset to bidding first'
    : (!selRead?.hasTimeline ? 'Saved before versions kept their schedule (no timeline captured)'
      : (sel?.id === state.open?.id ? 'This is the open version' : null))

  return (
    <section className="rb-bv" aria-label="Bid versions">
      {/* 1 · the OPEN version's save row */}
      <div className="rb-bv-save" data-state={state.locked ? 'locked' : state.open ? (state.dirty ? 'unsaved' : 'saved') : 'none'}>
        <div className="rb-bv-state">
          <span className="ui-field-label">{state.locked ? 'Budget active' : 'Open version'}</span>
          {state.locked ? (
            <span className="rb-bv-state-line">Production changes are kept by Save as new version, which records the schedule without touching the lock.</span>
          ) : state.open ? (
            <span className="rb-bv-state-line">
              <span className="rb-bv-open-name">{state.open.name}</span>
              <span className="rb-bv-open-status">{state.dirty ? ' — unsaved changes' : ` — saved ${showDate(state.open.snapshot?.saved_at || state.open.updated_at, { hour: '2-digit', minute: '2-digit' })}`}</span>
            </span>
          ) : (
            <span className="rb-bv-state-line">None — what the Timeline and Budget show is not saved in any bid version.</span>
          )}
        </div>
        {!state.locked && (
          <Field label="Based on shot list" className="rb-bv-basedon">
            <KitSelect value={basedOnId || ''} onChange={(val) => setBasedOnChoice(val || null)} placeholder="No shot list"
              options={listOptions} disabled={busy} aria-label="Based on shot list" />
          </Field>
        )}
        <div className="rb-bv-save-verbs">
          {state.open && !state.locked && (
            <Button variant={state.dirty ? 'primary' : 'secondary'} Icon={Save} attention={state.dirty || undefined}
              disabled={!state.dirty || busy} onClick={saveOpen}
              title={state.dirty ? `Save the changes into ${q(state.open.name)}` : `${q(state.open.name)} is saved`}>
              Save
            </Button>
          )}
          <Button variant={state.open && !state.locked ? 'secondary' : 'primary'} Icon={CopyPlus} disabled={busy}
            onClick={() => onAsk({ kind: 'saveAsNew', basedOnListId: basedOnId })}>
            Save as new version…
          </Button>
        </div>
      </div>

      {/* 2 · the SELECTED bid */}
      <div className="rb-bv-pick">
        <Field label="Selected bid" className="rb-bv-pick-field">
          <KitSelect value={sel?.id || ''} placeholder="Choose a bid version"
            options={state.versions.map(v => ({ value: v.id, label: versionOptionLabel(v, { lockedId: state.lockedId, openId: state.open?.id }) }))}
            disabled={state.locked || busy || state.versions.length === 0}
            title={state.locked ? 'While the budget is active the selected bid is the locked one — Reset to bidding to choose another' : undefined}
            onChange={(val) => run(() => ctx.selectBudgetVersion(val || null))} aria-label="Selected bid" />
        </Field>
        <Button variant="ghost" Icon={FolderOpen} disabled={state.versions.length === 0} onClick={() => onAsk({ kind: 'manage' })}>Manage versions…</Button>
      </div>
      {error && <p className="rb-bv-error" role="alert">{error}</p>}

      {sel ? (
        <div className="rb-bv-details">
          <dl className="rb-bv-facts">
            <div><dt>Saved</dt><dd>{versionDate(sel)}</dd></div>
            <div>
              <dt>{selRead.overallKnown ? (selRead.agencyEnabled ? `Overall total (with ${selRead.agencyPct}% agency)` : 'Overall total') : 'Total before agency'}</dt>
              <dd className="rb-bv-fact-money">{selRead.overallKnown ? money(selRead.overall ?? 0) : money(selRead.beforeAgency ?? 0)}</dd>
            </div>
            {selRead.overallKnown && (
              <div><dt>Before agency</dt><dd>{money(selRead.beforeAgency ?? 0)}</dd></div>
            )}
            <div><dt>Bid days</dt><dd>{selRead.totalBidDays == null ? '—' : formatTenths(selRead.totalBidDays)}</dd></div>
            <div>
              <dt>Timeline length</dt>
              <dd title={selRead.span ? `${showDate(selRead.span.start)} – ${showDate(selRead.span.end)}` : (selRead.hasTimeline ? undefined : 'No timeline captured')}>
                {selRead.spanDays == null ? '—' : `${selRead.spanDays} d`}
              </dd>
            </div>
          </dl>
          <p className="rb-bv-note">
            {sel.summary ? <span className="rb-bv-note-text">{sel.summary}</span> : <span className="rb-bv-quiet">No note.</span>}
            {selRead.delta && <span className="rb-bv-delta">{deltaWords(selRead.delta, { money: moneyWords, days: (n) => formatTenths(n) })}</span>}
          </p>
          <div className="rb-bv-verbs">
            {sel.id === state.lockedId && <StatusBadge tone="success" label="Locked" />}
            <Button Icon={Pencil} disabled={!!editReason || busy} title={editReason || `Load ${q(sel.name)} into the Timeline and Budget and keep editing it`}
              onClick={() => onAsk({ kind: 'open', versionId: sel.id, liveShotListId: basedOnId })}>
              Edit this version
            </Button>
            {!state.locked && (
              <Button Icon={ShieldCheck} disabled={busy} onClick={() => onAsk({ kind: 'lock', versionId: sel.id, liveShotListId: basedOnId })}>
                Set budget active
              </Button>
            )}
          </div>
          {variance && (
            <div className="rb-bv-vs">
              <span className="ui-field-label">{`Variance vs the selected bid${variance.basis === 'beforeAgency' ? ' (before agency: this bid never stored its agency fee)' : ''}`}</span>
              <span className="rb-bv-vs-value" data-tone={Math.abs(variance.diff) < 0.01 ? undefined : variance.diff > 0 ? 'danger' : 'success'}>
                <CurrencyDisplay value={variance.diff} currency={currency} signed />
              </span>
              <span className="rb-bv-quiet">{`(${formatTenths(variance.pctChange, { signed: true })}%)`}</span>
              <span className="rb-bv-quiet">Bid {money(variance.bidTotal)} · Now {money(variance.currentTotal)}</span>
            </div>
          )}
        </div>
      ) : (
        <p className="rb-bv-quiet rb-bv-none">{state.versions.length ? 'No bid is selected: choose one to measure the variance against.' : 'No bid versions yet. Save as new version keeps what the Timeline and Budget show now as a bid.'}</p>
      )}
    </section>
  )
}
