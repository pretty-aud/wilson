// =============================================================================
// mountRabbit.js — the one gap-safe mount for the tests that render the real
// RabbitProvider (N1, 2026-10-27: OUTSTANDING FX14-01 and FX15-04 folded into
// one helper). Test code: only test files import it, so no build holds it.
//
// The gap. Over the dev fixtures (an adapter that answers in microtasks) ONE
// commit brings the provider its adapter and the whole project, and that
// commit's passive effects (the last used views read, which ends
// `tableViewLast.status` 'unavailable'; the views' drafts reset; the
// project's visit count) run in a later task: React asks the Scheduler for a
// paint in every commit (`requestPaint`), and the Scheduler then yields
// however short the commit was (state/gapPremise.test.jsx holds that). A test
// that renders outside act and waits for the project can resume inside that
// gap, and a change it makes there is wiped by the pending effects (FX15's
// review round 1: 101 of 131 tests red in three files with the mount forced
// into it).
//
// So the render runs inside act (React flushes those effects before act
// returns); then the file's own waits, in order (the project, the collection
// its tests read); then, where the adapter reads the last used views map, a
// status past 'unavailable', which the provider holds from its first effect
// (no adapter yet) until the effects for the adapter have run. The provider
// is untouched (FX14's judgment call 8). mountRabbit.test.jsx holds the gap
// open: the one CONTROL.
// =============================================================================
import { render, act, waitFor } from '@testing-library/react'

/**
 * @param {import('react').ReactElement} ui  the tree, with <RabbitProvider> inside it
 * @param {object} [options]
 * @param {(() => void) | Array<() => void>} [options.until]  the file's own waits, in order: assertions, as waitFor takes them
 * @param {object} [options.adapter]  the adapter the provider is given; a getTableViewLast on it adds the last wait
 * @param {() => object} [options.ctx]  the context the tree's probe last saw (useRabbit()); needed with such an adapter
 * @returns {Promise<import('@testing-library/react').RenderResult>}
 */
export async function mountRabbit(ui, { until = [], adapter = null, ctx = null } = {}) {
  const readsViews = Boolean(adapter) && typeof adapter.getTableViewLast === 'function'
  if (readsViews && typeof ctx !== 'function') throw new Error('mountRabbit: an adapter that reads the views map needs ctx, the probe\'s context')
  let rendered = null
  await act(async () => { rendered = render(ui) })
  for (const ready of [].concat(until)) await waitFor(ready)
  if (readsViews) {
    await waitFor(() => {
      const status = ctx()?.tableViewLast?.status
      if (status === undefined || status === 'unavailable') throw new Error(`tableViewLast.status is ${status}: the provider's effects for the adapter have not run`)
    })
  }
  return rendered
}
