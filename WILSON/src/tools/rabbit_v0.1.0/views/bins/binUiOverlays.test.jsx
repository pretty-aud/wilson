/** @vitest-environment jsdom */
// =============================================================================
// binUiOverlays.test.jsx — post-overhaul S3c review round 2 (R2-05): the
// window's close question (App.jsx's own, not a kit Dialog) is a dialog over
// the page to every page's keys. The helpers the keys ask count kit Dialog
// backdrops; the close question's backdrop carries `data-app-question`, and
// they count that too. (The pages' own key tests: timelineShotLists,
// rabbitBudgetRender, scenesEdits.)
// =============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { pushModal } from '../../../../ui/overlay'
import { visibleDialogCount, visibleOverlayOpen, appQuestionOnScreen, APP_QUESTION } from './binUi'

const put = (attrs) => {
  const el = document.createElement('div')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  document.body.appendChild(el)
  return el
}
const undo = []
afterEach(() => { while (undo.length) undo.pop()() })

describe('the window\'s close question counts as a dialog on screen', () => {
  it('visibleDialogCount counts its marked backdrop beside the kit\'s', () => {
    const q = put({ 'data-app-question': 'close' })
    undo.push(() => q.remove())
    expect(visibleDialogCount()).toBe(1)
    const kit = put({ class: 'ui-dialog-backdrop' })
    undo.push(() => kit.remove())
    expect(visibleDialogCount()).toBe(2)
  })
  it('visibleOverlayOpen (the Bins keys) sees it while it is on the overlay stack, as App puts it', () => {
    const q = put({ 'data-app-question': 'close' })
    undo.push(() => q.remove())
    const unregister = pushModal({})
    undo.push(unregister)
    expect(visibleOverlayOpen({ dialogsOnly: true })).toBe(true)
    expect(visibleOverlayOpen()).toBe(true)
  })
  it('appQuestionOnScreen says so; the mark is the one App writes', () => {
    expect(APP_QUESTION).toBe('[data-app-question]')
    expect(appQuestionOnScreen()).toBe(false)
    const q = put({ 'data-app-question': 'close' })
    undo.push(() => q.remove())
    expect(appQuestionOnScreen()).toBe(true)
  })
  it('CONTROL: the same element without the mark is no dialog to them', () => {
    const q = put({ role: 'dialog', 'aria-modal': 'true' })
    undo.push(() => q.remove())
    const unregister = pushModal({})
    undo.push(unregister)
    expect(visibleDialogCount()).toBe(0)
    expect(visibleOverlayOpen({ dialogsOnly: true })).toBe(false)
    expect(appQuestionOnScreen()).toBe(false)
  })
})
