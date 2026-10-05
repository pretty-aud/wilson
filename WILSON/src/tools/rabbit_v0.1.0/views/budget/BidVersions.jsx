// =============================================================================
// BidVersions — the Budget Summary's versions block (post-overhaul S5c, step
// 3; F3, F5, F6, F7, F8, F11, F13), and the state it and the Timeline read.
//
// Audrey's model (F2, F9, F13; her ruling (a) of 2026-10-05): a bid version is
// a LIVING DOCUMENT. Three states, three words, never mixed:
//   OPEN      the version the Timeline and Budget show now. Save writes back
//             into it; "unsaved changes" when they differ. Her verb for
//             opening one is "Edit this version".
//   SELECTED  the bid the variance measures against (budget_versions.is_active,
//             a misnamed column). The dropdown chooses it at once (F13).
//   LOCKED    "Budget active — in production": nothing opens; Save as new
//             version only records a copy (F9).
//
// Design (laws-of-ux and design-direction, loaded for this; S5c's hand-off
// records each decision for Audrey):
//   · Jakob / Mental model — the first region reads like a document's file
//     bar: what is open and whether it is saved on the left, then the list it
//     is based on, then Save and Save as new version… at the right, in that
//     order.
//   · Von Restorff — ONE orange: Save, while the open version has unsaved
//     changes (the kit's attention state: edge, pulse, "● Unsaved");
//     Save as new version… only when it is the one save verb (no version
//     open, or a budget active). Never both, and none when nothing waits.
//   · Common Region / Proximity — one section, two regions on a hairline: the
//     OPEN version's save row, then the SELECTED bid (its dropdown, its facts,
//     its verbs, the variance against it). Each verb sits beside the state it
//     acts on, so no control has to say which of the three it means.
//   · Hick's — the Summary carries the two verbs that matter (Edit this
//     version, Set budget active); rename, the note and delete live in Manage
//     versions…'s row menus.
//   · Working memory — both totals labelled where they are read (F7), the
//     timeline's dates in its tooltip (F6), the note and the automatic line
//     (F8) beside the facts they describe.
// =============================================================================

import { useMemo, useState } from 'react'
import { Save, CopyPlus, Pencil, ShieldCheck, FolderOpen } from 'lucide-react'
import { Button, Select as KitSelect, StatusBadge } from '../../../../ui'
import CurrencyDisplay, { formatMoney, formatTenths } from '../../components/CurrencyDisplay'
import { showDate } from '../../dates'
import {
  readVersion, snapshotFromLive, versionDiff, varianceAgainst, sortVersionsNewest, selectedVersionOf, deltaWords,
} from '../../state/budgetVersionModel'
import { sortShotLists, formatShotListLabel } from '../../state/shotListModel'
import { versionDate, versionSavedAt, basedOnWords } from './VersionQuestions'
import '../rabbitBudget.css'

const q = (s) => `“${s}”`

/**
 * Are the live rates the project's yet? null when they are, else the
 * sentence that says why not. A bid version is compared against them
 * ("unsaved changes") and saved with them, so until they are read — the
 * first read (a hook's first render is "not loading" before any read has
 * started), and the read after an open wrote a version's rates as project
 * overrides (the provider's rateOverridesEpoch) — the block calls nothing
 * unsaved and greys the verbs that write a snapshot. A hook that does not
 * report (a test's stub) is taken as read.
 */
export function ratesPendingFrom({ rateCard, rateOverrides, epoch = 0 }) {
  if (rateCard?.settled === false) {
    return rateCard.error ? `The rate card could not be read: ${rateCard.error}` : 'Reading the rate card…'
  }
  const stale = rateOverrides?.loadedEpoch !== undefined && rateOverrides.loadedEpoch !== epoch
  if (rateOverrides?.loading === true || stale) {
    return rateOverrides.error ? `The project’s rates could not be read: ${rateOverrides.error}` : 'Reading the project’s rates…'
  }
  return null
}

/** "Mid ROM · 05/10/2026 · Locked" — the dropdown's words (F13). Never money (F10). The selected bid is the dropdown's own value. */
export function versionOptionLabel(v, { lockedId = null, openId = null } = {}) {
  const parts = [v.name, versionDate(v)]
  if (v.id === lockedId) parts.push('Locked')
  else if (v.id === openId) parts.push('Open')
  return parts.join(' · ')
}

/**
 * Where the versions stand: the open, the selected and the locked one, and
 * whether the open one has unsaved changes (step 5: one pure diff,
 * budgetVersionModel.versionDiff, of its saved snapshot against the live
 * rows). `liveShotListId` — the "Based on shot list" the person chose, or
 * undefined while untouched (then the list is not compared: Save keeps the
 * version's). While `ratesPending` (a sentence, or null) the live rates are
 * not the project's yet — the first read, or the read after an open wrote
 * the version's rates — and nothing is called unsaved off them.
 */
export function useBidVersionState(ctx, roleRates, { liveShotListId, ratesPending = null } = {}) {
  const versions = ctx?.budgetVersions
  const project = ctx?.project
  const tasks = ctx?.tasks
  const phases = ctx?.phases
  const milestones = ctx?.milestones
  return useMemo(() => {
    const list = versions || []
    const locked = project?.budget_active === true
    const lockedId = locked ? (project?.budget_active_version_id || null) : null
    const openId = project?.open_budget_version_id || null
    const open = openId ? (list.find(v => v.id === openId) || null) : null
    let diff = null
    if (open && !ratesPending) {
      const live = snapshotFromLive({ tasks: tasks || [], phases: phases || [], milestones: milestones || [], project, roleRates: roleRates || {} })
      diff = versionDiff(open.snapshot, live, liveShotListId === undefined ? {} : { shotListId: open.shot_list_id ?? null, liveShotListId })
    }
    return {
      versions: sortVersionsNewest(list),
      locked,
      lockedId,
      lockedVersion: lockedId ? (list.find(v => v.id === lockedId) || null) : null,
      open,
      selected: selectedVersionOf(list),
      dirty: !!diff?.isDirty,
      diff,
      pending: ratesPending || null,
    }
  }, [versions, project, tasks, phases, milestones, roleRates, liveShotListId, ratesPending])
}

/**
 * The Summary's versions block. Two regions on a hairline:
 *   1. the save row — the OPEN version, its state, the "Based on shot list"
 *      Select (D18), Save and Save as new version…;
 *   2. the SELECTED bid — the dropdown (choosing selects at once, F13),
 *      Manage versions…, its facts (both totals, F7; the timeline's length,
 *      F6; the note and the automatic line, F8), Edit this version and Set
 *      budget active, then the variance against it.
 * The lock's banner and Reset to bidding stay above the tiles (F11).
 * `liveTotals` is bidTotals of the live rows (the waterfall's figures);
 * `onAsk(ask)` opens a question (VersionQuestions' `ask`).
 */
export function BidVersionsBlock({ ctx, roleRates, currency, liveTotals, ratesPending = null, onAsk }) {
  const project = ctx?.project
  const shotLists = ctx?.shotLists
  const openId = project?.open_budget_version_id || null
  const openRow = (ctx?.budgetVersions || []).find(v => v.id === openId) || null
  const activeListId = project?.active_shot_list_id || null
  const liveLists = useMemo(() => sortShotLists((shotLists || []).filter(l => !l.archived_at)), [shotLists])

  // "Based on shot list" (D18). Untouched (undefined): Save keeps the open
  // version's list and "unsaved" does not compare it; Save as new takes the
  // default — the open version's list, else the project's active one (S3c).
  // Another open version is another default: the choice was about the old.
  // Held WITH the open version it was made for, so it is dropped in the very
  // render the open version changes (review round 1: an effect cleared it a
  // render late, and that render compared the old choice with the new open
  // version — a frame of "Unsaved changes").
  const [choice, setChoice] = useState({ openId, value: undefined })
  const listChoice = choice.openId === openId ? choice.value : undefined
  const setListChoice = (value) => setChoice({ openId, value })
  const listDefault = openRow
    ? (openRow.shot_list_id ?? null)
    : (liveLists.some(l => l.id === activeListId) ? activeListId : null)
  const basedOnId = listChoice === undefined ? listDefault : listChoice
  const state = useBidVersionState(ctx, roleRates, { liveShotListId: listChoice, ratesPending })
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  const listOptions = liveLists.map(l => ({ value: l.id, label: `${formatShotListLabel(l)}${l.id === activeListId ? ' (active)' : ''}` }))
  // The open version's own list when it is no longer live (archived, gone):
  // still what it is based on, so still what the Select shows.
  if (listDefault && !liveLists.some(l => l.id === listDefault)) {
    listOptions.push({ value: listDefault, label: basedOnWords(openRow, shotLists) || 'Its shot list' })
  }

  // `busy` names the step running ('save', 'select'): every control waits for
  // it, and only its own button shows the spinner.
  async function run(what, fn) {
    setBusy(what)
    setError(null)
    try { await fn() } catch (err) { setError(err?.message || String(err)) } finally { setBusy(null) }
  }
  const saveOpen = () => run('save', async () => {
    await ctx.saveBudgetVersion(state.open.id, { roleRates, basedOnListId: listChoice })
    setListChoice(undefined)
  })
  const ask = (kind, extra = {}) => onAsk({ kind, liveShotListId: listChoice, basedOnListId: basedOnId, ...extra })

  const sel = state.selected
  const selRead = sel ? readVersion(sel) : null
  const variance = sel && liveTotals ? varianceAgainst(liveTotals, selRead) : null
  const selLocked = !!sel && sel.id === state.lockedId
  const selBased = sel ? basedOnWords(sel, shotLists) : null
  const deltaLine = selRead?.delta ? deltaWords(selRead.delta, { money: (n) => formatMoney(n, currency), days: (n) => formatTenths(n) }) : ''
  const editWhy = state.locked ? 'While the budget is active no version is opened: Reset to bidding first.'
    : (!selRead?.hasTimeline ? 'Edit this version: it was saved before versions kept their schedule (no timeline captured), so it cannot be opened.'
      : (sel?.id === state.open?.id ? 'Edit this version: it is open already — the Timeline and Budget show it now.'
        : state.pending))
  const lockWhy = state.pending
  const saveAsNewPrimary = !state.open || state.locked

  return (
    <section className="rb-bv-block" aria-label="Bid versions">
      {/* 1 · the OPEN version's save row */}
      <div className="rb-bv-save">
        <div className="rb-bv-state">
          <span className="ui-field-label">{state.locked ? 'Budget active' : 'Open version'}</span>
          {state.locked ? (
            <span className="rb-bv-state-line">
              {`Production changes are kept with Save as new version; the budget stays locked${state.lockedVersion ? ` to ${q(state.lockedVersion.name)}` : ''}.`}
            </span>
          ) : state.open ? (
            <span className="rb-bv-state-line">
              <span className="rb-bv-open-name">{state.open.name}</span>
              <span className="rb-bv-open-status" data-dirty={state.dirty ? 'true' : undefined}>
                {/* Review round 1 (R1-07): the pending sentence itself —
                    "Reading …" said a read was under way after one had failed. */}
                {state.pending ? state.pending
                  : (state.dirty ? 'Unsaved changes' : `Saved ${showDate(versionSavedAt(state.open), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`)}
              </span>
            </span>
          ) : (
            <span className="rb-bv-state-line">No version is open.</span>
          )}
        </div>
        <div className="rb-bv-field rb-bv-basedon">
          <span className="ui-field-label">Based on shot list</span>
          <KitSelect
            value={basedOnId || ''}
            onChange={(val) => setListChoice(val || null)}
            placeholder="No shot list"
            options={listOptions}
            disabled={!!busy}
            aria-label="Based on shot list"
          />
        </div>
        <div className="rb-bv-save-verbs">
          {state.open && !state.locked && (
            <Button
              variant={state.dirty ? 'primary' : 'secondary'}
              Icon={Save}
              attention={state.dirty}
              attentionLabel={`${q(state.open.name)} has unsaved changes`}
              disabled={!state.dirty || !!busy || !!state.pending}
              loading={busy === 'save'}
              onClick={saveOpen}
              title={state.pending || (state.dirty ? `Save the changes into ${q(state.open.name)}` : `${q(state.open.name)} has no unsaved changes`)}
            >
              Save
            </Button>
          )}
          <Button
            variant={saveAsNewPrimary ? 'primary' : 'secondary'}
            Icon={CopyPlus}
            disabled={!!busy || !!state.pending}
            title={state.pending || undefined}
            onClick={() => ask('saveAsNew')}
          >
            Save as new version…
          </Button>
        </div>
      </div>

      {/* 2 · the SELECTED bid */}
      <div className="rb-bv-pick">
        <div className="rb-bv-pick-head">
          <div className="rb-bv-field rb-bv-pick-field">
            <span className="ui-field-label">Selected bid</span>
            <KitSelect
              value={sel?.id || ''}
              placeholder="Choose a bid version"
              options={state.versions.map(v => ({ value: v.id, label: versionOptionLabel(v, { lockedId: state.lockedId, openId: state.open?.id }) }))}
              disabled={state.locked || !!busy || state.versions.length === 0}
              title={state.locked ? 'While the budget is active the selected bid is the locked one: Reset to bidding to choose another.' : undefined}
              onChange={(val) => run('select', () => ctx.selectBudgetVersion(val || null))}
              aria-label="Selected bid"
            />
          </div>
          {selLocked && <StatusBadge tone="success" label="Locked" />}
          <Button variant="ghost" Icon={FolderOpen} disabled={state.versions.length === 0}
            onClick={() => ask('manage')}>
            Manage versions…
          </Button>
        </div>
        {error && <p className="rb-bv-error" role="alert">{error}</p>}

        {sel ? (
          <div className="rb-bv-details">
            <dl className="rb-bv-facts">
              <div className="rb-bv-fact">
                <dt className="ui-field-label">Overall total</dt>
                <dd className="rb-bv-fact-money" title={selRead.overallKnown ? undefined : 'Saved before versions kept the agency fee'}>
                  {selRead.overallKnown ? <CurrencyDisplay value={selRead.overall} currency={currency} /> : 'Not recorded'}
                  {selRead.overallKnown && selRead.agencyEnabled && (
                    <span className="rb-bv-fact-note">{`with ${selRead.agencyPct}% agency`}</span>
                  )}
                </dd>
              </div>
              {(!selRead.overallKnown || selRead.agencyEnabled) && (
                <div className="rb-bv-fact">
                  <dt className="ui-field-label">Before agency</dt>
                  <dd className="rb-bv-fact-figure"><CurrencyDisplay value={selRead.beforeAgency} currency={currency} /></dd>
                </div>
              )}
              <div className="rb-bv-fact">
                <dt className="ui-field-label">Bid days</dt>
                <dd className="rb-bv-fact-figure">{selRead.totalBidDays == null ? '—' : formatTenths(selRead.totalBidDays)}</dd>
              </div>
              <div className="rb-bv-fact">
                <dt className="ui-field-label">Timeline</dt>
                <dd className="rb-bv-fact-figure"
                  title={selRead.span ? `${showDate(selRead.span.start)} – ${showDate(selRead.span.end)}` : (selRead.hasTimeline ? undefined : 'No timeline captured')}>
                  {selRead.spanDays == null ? '—' : `${selRead.spanDays} d`}
                </dd>
              </div>
              <div className="rb-bv-fact">
                <dt className="ui-field-label">Last saved</dt>
                <dd className="rb-bv-fact-figure">{showDate(versionSavedAt(sel))}</dd>
              </div>
              <div className="rb-bv-fact">
                <dt className="ui-field-label">Shot list</dt>
                <dd className="rb-bv-fact-words" data-empty={selBased ? undefined : 'true'}>{selBased || 'None'}</dd>
              </div>
            </dl>
            <p className="rb-bv-note" data-empty={sel.summary ? undefined : 'true'}>{sel.summary || 'No note.'}</p>
            {deltaLine && <p className="rb-bv-delta">{deltaLine}</p>}
            {/* A verb that cannot run now is greyed WITH the reason shown
                (F9: "greyed out with the reason shown") — a line of words
                beside it, not a tooltip a disabled button may never show. */}
            <div className="rb-bv-verbs">
              <Button Icon={Pencil} disabled={!!busy || !!editWhy}
                aria-describedby={editWhy ? 'rb-bv-why' : undefined}
                title={editWhy ? undefined : `Load ${q(sel.name)} into the Timeline and Budget, and keep editing it`}
                onClick={() => ask('open', { versionId: sel.id })}>
                Edit this version
              </Button>
              {!state.locked && (
                <Button Icon={ShieldCheck} disabled={!!busy || !!lockWhy}
                  aria-describedby={lockWhy ? 'rb-bv-why' : undefined}
                  title={lockWhy ? undefined : `Lock ${q(sel.name)} as the budget in production`}
                  onClick={() => ask('lock', { versionId: sel.id })}>
                  Set budget active
                </Button>
              )}
              {(editWhy || lockWhy) && <span id="rb-bv-why" className="rb-bv-why">{editWhy || lockWhy}</span>}
            </div>
            {variance && (
              <div className="rb-bv-vs">
                <span className="ui-field-label">
                  {variance.basis === 'beforeAgency' ? 'Variance vs the selected bid, before agency' : 'Variance vs the selected bid'}
                </span>
                <span className="rb-bv-vs-figures">
                  <span className="rb-bv-vs-value" data-tone={Math.abs(variance.diff) < 0.01 ? undefined : (variance.diff > 0 ? 'danger' : 'success')}>
                    <CurrencyDisplay value={variance.diff} currency={currency} signed />
                  </span>
                  <span className="rb-bv-vs-pct">{`(${formatTenths(variance.pctChange, { signed: true })}%)`}</span>
                  <span className="rb-bv-vs-detail">
                    {'Bid '}<CurrencyDisplay value={variance.bidTotal} currency={currency} />
                    {' · Now '}<CurrencyDisplay value={variance.currentTotal} currency={currency} />
                  </span>
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="rb-bv-none">
            {state.versions.length
              ? 'No bid is selected: choose one to measure the variance against.'
              : 'No bid versions yet. Save as new version keeps what the Timeline and Budget show as a bid.'}
          </p>
        )}
      </div>
    </section>
  )
}

export default BidVersionsBlock
