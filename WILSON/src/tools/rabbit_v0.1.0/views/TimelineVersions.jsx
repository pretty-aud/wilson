// =============================================================================
// TimelineVersions — the Timeline's bid version bar (post-overhaul S5d, step
// 6 of the first S5 brief; F2, F9, F10, F13). Rendered ONLY past the money
// gate (Rabbit.jsx's canSeeMoneyHere, handed to TimelineView as
// `canSeeMoney`): for everyone else nothing of it exists — no bar, no rates
// read, no questions mounted (F10).
//
// Audrey's model, the Summary's (views/budget/BidVersions.jsx): a bid version
// is a living document. One is OPEN (the live Timeline holds exactly its
// schedule; Save writes back into it), one is SELECTED (the variance's
// baseline), one may be LOCKED (the active budget: nothing opens, this bar is
// greyed with the reason, Save as new version… only records a copy). Viewing
// a version is read-only and writes nothing (F2's first sentence): the bar
// says so while it lasts.
//
// Where it sits, and why (MEASURED, S5d, the dev fixtures in Chromium): the
// gantt's toolbar has 18px left at 1280x700 with six Group-by tabs and the
// "Shot list:" label (S3c's 1100px of other controls), 116px with four tabs
// grouped by phase; the smallest control that says a version is unsaved and
// saves it is about 290px (a 140px dropdown, the 62px "● Unsaved", Save, their
// gaps) before a word of state. So the bar is the toolbar's second row — rendered
// by DetailZoomToolbar under its first, which keeps every control S3c
// measured — rather than four of the first row's labelled buttons turned
// into icons. Design (laws-of-ux and design-direction, loaded for S5d; the
// hand-off records each decision for Audrey):
//   · Jakob / Mental model — the Summary's save row again: what you are
//     looking at, its state, then the save verbs at the right; one region on
//     a hairline, the gantt's own (Common Region without a box).
//   · Von Restorff — the Timeline's one filled orange stays "+ Task", its
//     everyday verb. Save carries the kit's attention state while unsaved (the
//     signal edge, the slow ring, "● Unsaved") as S3c's Save edit does on the
//     Scenes bar: isolated without a second fill. Save as new version… is
//     never filled here.
//   · Proximity / Similarity — the state words sit between the dropdown and
//     the verbs they explain; the greyed bar says why in words (F9), the
//     Summary's sentence.
//   · Hick's — the dropdown chooses what the gantt shows (Current or a
//     version) and carries the one rare command, Manage versions… (rename,
//     note, delete live in its rows, as on the Summary).
//   · Selective attention — while VIEWING, the bar takes the kit Banner's
//     info tint and says "Viewing bid version: …"; the save verbs leave it (they act
//     on the live schedule, which is not on screen) for Edit this version and
//     Current. The dropdown never moves under the pointer between states.
// =============================================================================

import { useId, useLayoutEffect, useMemo, useState } from 'react'
import { Save, CopyPlus, Pencil, ArrowLeft, Eye, X, AlertTriangle } from 'lucide-react'
import { Banner } from '../../../ui/Banner'
import { Button } from '../../../ui/Button'
import { IconButton } from '../../../ui/IconButton'
import { Select as KitSelect } from '../../../ui/Select'
import { useRateCard } from '../../../components/RateCard/useRateCard'
import { useProjectRateOverrides } from '../../../components/Budget/useProjectRateOverrides'
import { buildRoleRates } from '../../../components/Budget/budgetMath'
import { readVersion } from '../state/budgetVersionModel'
import { useBidVersionState, ratesPendingFrom, versionOptionLabel, basedOnDefault, savedWords, LOCKED_WHY } from './budget/BidVersions'
import { versionDate } from './budget/VersionQuestions'
import './rabbitTimeline.css'

/** The dropdown's two values that are not a version. */
export const CURRENT = '__current__'
export const MANAGE = '__manage__'

const q = (s) => `“${s}”`

/** Two role → rate maps hold the same rates. */
export function sameRates(a, b) {
  if (a === b) return true
  const ka = Object.keys(a || {})
  const kb = Object.keys(b || {})
  return ka.length === kb.length && ka.every(k => Object.is(a[k], b?.[k]))
}

/**
 * The rates a bid is compared with and saved with, read ONLY past the money
 * gate (F10): TimelineView mounts this only there, and it hands up
 * `{ projectId, roleRates, ratesPending }` — the Summary's arithmetic
 * (buildRoleRates over the rate card and the project's overrides) and its
 * "are these the project's yet" (ratesPendingFrom). Renders nothing.
 */
export function VersionRates({ epoch = 0, projectId = null, onRates }) {
  const rateCard = useRateCard()
  const rateOverrides = useProjectRateOverrides()
  const entries = rateCard?.entries
  const overrides = rateOverrides?.overrides
  const roleRates = useMemo(() => buildRoleRates(entries || [], overrides || []), [entries, overrides])
  const ratesPending = ratesPendingFrom({ rateCard, rateOverrides, epoch })
  useLayoutEffect(() => { onRates?.({ projectId, roleRates, ratesPending }) }, [onRates, projectId, roleRates, ratesPending])
  return null
}

/**
 * The dropdown's entries: Current first (the live schedule — the open
 * version's, when one is open), then the versions newest first in F13's
 * words, a version saved before versions kept their schedule greyed with that
 * reason (it cannot be viewed), then Manage versions….
 */
export function versionMenu(state) {
  const versions = state.versions.map((v) => {
    const label = versionOptionLabel(v, { lockedId: state.lockedId, openId: state.open?.id })
    return readVersion(v).hasTimeline
      ? { value: v.id, label }
      : { value: v.id, label: `${label} · no timeline captured`, disabled: true }
  })
  return [
    { value: CURRENT, label: 'Current' },
    ...(versions.length ? [{ label: 'Bid versions', options: versions }] : []),
    { value: MANAGE, label: 'Manage versions…' },
  ]
}

/**
 * The bar. `viewedId` is the version the gantt shows read-only (TimelineView's
 * state: it feeds the gantt's memos), null at Current. `onView(id | null)`
 * changes it; `onAsk(ask)` opens one of VersionQuestions' questions (its
 * shapes: views/budget/VersionQuestions.jsx). While a bid version step runs
 * (the provider's `versionStep`: this Save, or a step begun on the Summary or
 * in a question) the bar's verbs wait, and the Timeline takes no change
 * (review round 1, R1-02; round 2, R2-01: the bar's own `busy` went when the
 * tab was left and came back mid-Save, and a second Save could start).
 */
export function TimelineVersionBar({ ctx, roleRates, ratesPending = null, viewedId = null, onView, onAsk }) {
  const state = useBidVersionState(ctx, roleRates, { ratesPending })
  const [busy, setBusy] = useState(false)
  const stepRunning = busy || ctx?.versionStep != null
  const [error, setError] = useState(null)
  const wordsId = useId()
  const viewed = viewedId ? (state.versions.find(v => v.id === viewedId) || null) : null
  const mode = state.locked ? 'locked' : (viewed ? 'viewing' : 'current')
  const basedOn = basedOnDefault(ctx)
  const options = useMemo(() => versionMenu(state), [state])
  const value = mode === 'locked'
    ? (state.lockedVersion ? state.lockedId : CURRENT)
    : (viewed ? viewed.id : CURRENT)

  function choose(val) {
    setError(null)
    if (val === MANAGE) { onAsk?.({ kind: 'manage', basedOnListId: basedOn }); return }
    // The open version IS what Current shows: choosing it is Current.
    if (!val || val === CURRENT || val === state.open?.id) { onView?.(null); return }
    onView?.(val)
  }
  // The Summary's Save: the same mutator into the open version, its shot list
  // kept (no list control here), and the undo toast only when it stops part
  // way (S5c round 2, R2-05) — the words beside it say "Saved" when it ends
  // well. A refusal (an Undo still running, R2-03) is said, not swallowed.
  // The Timeline stands still while it runs (R1-02; the provider tracks the
  // step, R2-01): a drag made then joined the step, so its Undo — or the
  // "Stopped part way" toast's — took the drag back with it.
  async function save() {
    if (!state.open || stepRunning) return
    setBusy(true)
    setError(null)
    const step = ctx?.runWithUndoToast || ((run) => run())
    try {
      await step(() => ctx.saveBudgetVersion(state.open.id, { roleRates }), null)
    } catch (err) {
      setError(err?.message || String(err))
    } finally {
      setBusy(false)
    }
  }
  const ask = (kind, extra = {}) => { setError(null); onAsk?.({ kind, basedOnListId: basedOn, ...extra }) }

  // The words in pieces (review round 1, R1-05): where room runs out only the
  // version's NAME gives way, to an ellipsis — "Open:", the state after it
  // ("Unsaved changes", "Saved …", why nothing can be saved yet) and the
  // viewed version's date stay whole. As one clipped line the state went
  // first: at 1280 the bar read "Open: Bid v1 (fund …". The one-sentence
  // states clip at their end. Round 2 (R2-06): a LONG state — the rates not
  // read yet, or not readable — is `data-long` and gives way too, with the
  // name, so neither collapses to nothing.
  let words
  if (mode === 'locked') {
    words = <span className="rb-tl-ver-state" id={wordsId}><span className="rb-tl-ver-line">{LOCKED_WHY}</span></span>
  } else if (mode === 'viewing') {
    words = (
      <span className="rb-tl-ver-state" id={wordsId}>
        <Eye className="rb-tl-ver-icon" aria-hidden="true" />
        <span className="rb-tl-ver-lead">{'Viewing bid version: '}</span>
        <span className="rb-tl-ver-name">{viewed.name}</span>
        <span className="rb-tl-ver-tail">{` · ${versionDate(viewed)}`}</span>
        <span className="rb-tl-ver-quiet">Read-only</span>
      </span>
    )
  } else if (state.open) {
    words = (
      <span className="rb-tl-ver-state" id={wordsId}>
        <span className="rb-tl-ver-lead">{'Open: '}</span>
        <span className="rb-tl-ver-name">{state.open.name}</span>
        <span className="rb-tl-ver-tail" data-long={state.pending ? 'true' : undefined}>
          {' · '}
          <span className="rb-tl-ver-status" data-dirty={state.dirty ? 'true' : undefined}>
            {state.pending ? state.pending : (state.dirty ? 'Unsaved changes' : savedWords(state.open))}
          </span>
        </span>
      </span>
    )
  } else {
    words = <span className="rb-tl-ver-state" id={wordsId}><span className="rb-tl-ver-line">No version is open.</span></span>
  }
  const editWhy = mode === 'viewing' ? state.pending : null

  // A greyed verb's reason is a piece of its own before the verbs, beside the
  // verb it explains, and it gives way to an ellipsis (R2-06): inside the verbs,
  // which never shrink, a long reason pushed Current past the window's edge.
  // A refusal or a stop part way is said on a line of its own under the bar,
  // the kit's in-flow danger Banner, wrapping (R1-05): squeezed into the bar
  // it showed "an Undo is still runni" at 1280 and its Dismiss was clipped
  // out of reach.
  return (
    <>
      <div className="rb-tl-ver-bar" data-mode={mode} aria-label="Bid versions" role="group">
        <span className="ui-field-label">Bid version</span>
        <KitSelect
          className="rb-tl-ver-select"
          size="sm"
          value={value}
          options={options}
          onChange={choose}
          disabled={state.locked || stepRunning}
          aria-label="Bid version"
          aria-describedby={wordsId}
        />
        {words}
        {editWhy && <span className="rb-tl-ver-why">{`Edit this version: ${editWhy}`}</span>}
        <span className="rb-tl-ver-verbs">
          {mode === 'viewing' ? (
            <>
              <Button size="sm" Icon={Pencil} disabled={!!editWhy || stepRunning}
                title={editWhy ? undefined : `Load ${q(viewed.name)} into the Timeline and Budget, and keep editing it`}
                onClick={() => ask('open', { versionId: viewed.id })}>
                Edit this version
              </Button>
              <Button size="sm" variant="ghost" Icon={ArrowLeft} title="Back to the live schedule" onClick={() => onView?.(null)}>
                Current
              </Button>
            </>
          ) : (
            <>
              {state.open && !state.locked && (
                <Button
                  size="sm"
                  Icon={Save}
                  attention={state.dirty}
                  attentionLabel={`${q(state.open.name)} has unsaved changes`}
                  disabled={!state.dirty || stepRunning || !!state.pending}
                  loading={busy}
                  onClick={save}
                  title={state.pending || (state.dirty ? `Save the changes into ${q(state.open.name)}` : `${q(state.open.name)} has no unsaved changes`)}
                >
                  Save
                </Button>
              )}
              <Button size="sm" Icon={CopyPlus} disabled={stepRunning || !!state.pending} title={state.pending || undefined}
                onClick={() => ask('saveAsNew')}>
                Save as new version…
              </Button>
            </>
          )}
        </span>
      </div>
      {error && (
        <Banner tone="danger" Icon={AlertTriangle} data-version-error=""
          action={<IconButton size="sm" icon={X} title="Dismiss" aria-label="Dismiss" onClick={() => setError(null)} />}>
          {error}
        </Banner>
      )}
    </>
  )
}

export default TimelineVersionBar
