// =============================================================================
// leaveGuardWiring.test.js — post-overhaul S3c, step 7 (D12): the exits that
// live in the two shells no test mounts (Rabbit.jsx — "no test mounts
// Rabbit.jsx", ProjectContextBar.test.jsx — and App.jsx) ask the leave guard,
// read off their source as those files' other contracts are, each pin with a
// CONTROL that a mutated source fails it. The guard itself, its question and
// its answers are state/leaveGuard.test.js and editDraftsProvider.test.jsx.
// =============================================================================
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(resolve(here, rel), 'utf8').replace(/\r\n/g, '\n')
const rabbit = read('./Rabbit.jsx')
const app = read('../../App.jsx')

const TAB = {
  strip: /<ViewTabs\s+activeView=\{activeView\}\s+onChange=\{goToView\}/,
  guard: /const goToView = useCallback\(async \(view\) => \{\s*if \(!\(await leaveTab\(activeViewRef\.current, view\)\)\) return false\s*setActiveView\(view\)\s*return true\s*\}, \[\]\)/,
  jump: /subscribeNavigate\(d => \{\s*if \(!d\?\.view\) return\s*goToView\(d\.view\)\.then\(\(went\) => \{ if \(!went\) dropPendingNavigate\(d\) \}\)\s*\}\)/,
  toast: /function handleJumpToReview\(\) \{\s*goToView\('intake'\)\s*\}/,
}
const PAGE = /const navigateTo = useCallback\(\(targetPage, fromHistory = false, asked = false\) => \{\s*if \(transitionRef\.current \|\| targetPage === currentPage\) return;[\s\S]*?if \(!asked && currentPage === 'rabbit' && hasUnsavedWork\('page'\)\) \{\s*confirmLeave\('page'\)\.then\(\(go\) => \{\s*if \(go\) \{ navigateToRef\.current\(targetPage, fromHistory, true\); return; \}[\s\S]*?window\.history\.pushState\(\{ page: currentPage \}, '', urlForPage\(currentPage\)\)[\s\S]*?return;\s*\}\s*transitionRef\.current = true;/

describe('Rabbit.jsx: leaving the Scenes tab asks (the strip, a jump out, a toast\'s shortcut); automatic switches do not', () => {
  it('the strip, the cross-tab jump and the review toast all go through goToView, which asks leaveTab first', () => {
    for (const [name, re] of Object.entries(TAB)) expect(rabbit, name).toMatch(re)
  })
  it('the automatic switches stay direct: a hidden tab and a cleared project never ask (D12)', () => {
    expect(rabbit).toMatch(/if \(hiddenTabs\.has\(activeView\)\) setActiveView\('summary'\)/)
    expect(rabbit).toMatch(/if \(!activeProjectId\) \{\s*setActiveView\('summary'\)/)
  })
  it('CONTROL: the strip handed setActiveView, or a goToView that skips leaveTab, fails the pins', () => {
    expect(rabbit.replace('onChange={goToView}', 'onChange={setActiveView}')).not.toMatch(TAB.strip)
    expect(rabbit.replace('if (!(await leaveTab(activeViewRef.current, view))) return false', '')).not.toMatch(TAB.guard)
    expect(rabbit.replace('if (!went) dropPendingNavigate(d)', '')).not.toMatch(TAB.jump)
  })
})

// S3c review round 1 (R1-09): "Restart & install" quits through the updater,
// which forces the window closed — its close question never asks. So both
// Restart buttons ask the leave guard first, and install only on a go.
describe('the update restart asks first: it skips the window\'s close question', () => {
  const prompt = read('../../components/UpdatePrompt.jsx')
  const panel = read('../../components/settings/VersionPanel.jsx')
  const ASKS = /onClick=\{async \(\) => \{ if \(await confirmLeave\('close'\)\) installUpdate\(\) \}\}/
  it('both Restart buttons ask confirmLeave(\'close\') and install only on a go; neither installs directly', () => {
    for (const [name, src] of [['UpdatePrompt', prompt], ['VersionPanel', panel]]) {
      expect(src, name).toMatch(ASKS)
      expect(src, name).not.toMatch(/onClick=\{\(\) => installUpdate\(\)\}/)
      expect(src, name).toMatch(/import \{ confirmLeave \} from '(\.\.\/)+tools\/rabbit_v0\.1\.0\/state\/leaveGuard'/)
    }
  })
  it('CONTROL: the old direct install fails the pin', () => {
    expect(prompt.replace("onClick={async () => { if (await confirmLeave('close')) installUpdate() }}", 'onClick={() => installUpdate()}')).not.toMatch(ASKS)
    expect(panel.replace("onClick={async () => { if (await confirmLeave('close')) installUpdate() }}", 'onClick={() => installUpdate()}')).not.toMatch(ASKS)
  })
})

describe('App.jsx: leaving R.A.B.B.I.T. asks before the transition; the window\'s close folds the edit into its one question', () => {
  it('navigateTo asks BEFORE the transition starts (C2), only from R.A.B.B.I.T., and a back press it keeps re-stamps the address', () => {
    expect(app).toMatch(PAGE)
  })
  it('the close question reads the guards that can answer from it when it opens, and offers D12\'s three there', () => {
    // Review round 2 (R2-05): where focus was is taken first, before the
    // question renders (its first answer's autoFocus moves focus in the commit).
    expect(app).toMatch(/onCloseRequested\(\(\) => \{\s*closeOpenerRef\.current = document\.activeElement;\s*setCloseUnsaved\(unsavedForClose\(\)\);/)
    const dialog = app.slice(app.indexOf('{showCloseDialog && ('), app.indexOf('\n      )}', app.indexOf('{showCloseDialog && (')))
    expect(dialog).toMatch(/\{closeUnsaved\.length \? 'Keep editing' : 'Cancel'\}/)
    expect(dialog).toMatch(/Discard and close/)
    expect(dialog).toMatch(/\{closeUnsaved\.length \? 'Save edit and close' : 'Close'\}/)
    // Review round 1 (R1-11): its staying answer is first and focused, with
    // an edit or without.
    expect(dialog).toMatch(/<Button\s+variant="secondary"\s+autoFocus\s+disabled=\{closeBusy\}/)
    // Still the one quit question: the same heading, no second dialog for the edit.
    expect(dialog).toMatch(/>Close WILSON<\/h2>/)
    expect(app.match(/<LeaveEditDialog \/>/g)).toHaveLength(1)
    // …and of several edits it says "them" (R1-12).
    expect(dialog).toMatch(/closeCount > 1 \? 'Save them before closing, or discard them\.' : 'Save it before closing, or discard it\.'/)
  })
  // Review round 1 (R1-11): C1 is lifted for these sessions, and D12 says
  // Escape = Keep editing. The question is a dialog to a screen reader and to
  // the keyboard: on the overlay stack while it is up, Escape its first
  // answer (unless busy), Tab kept inside — bound only while it is shown.
  // Review round 2: while it is up it also follows the unsaved work (R2-01:
  // the work can go under it — a sign-out, its list archived elsewhere —
  // never re-read while its own answer runs), and when it goes focus returns
  // where it was (R2-05). Comment lines between the statements are allowed.
  const C = String.raw`(?:\s*\/\/[^\n]*)*\s*`
  const CLOSE_KEYS = new RegExp(String.raw`useEffect\(\(\) => \{\s*if \(!showCloseDialog\) return undefined;\s*const id = \{\};\s*const unregister = pushModal\(id\);\s*const onKey = \(e\) => \{\s*if \(!isTopModal\(id\)\) return;\s*if \(e\.key === 'Escape'\) \{\s*if \(e\.defaultPrevented\) return;\s*e\.preventDefault\(\);\s*if \(!closeBusyRef\.current\) setShowCloseDialog\(false\);\s*return;\s*\}\s*if \(e\.key !== 'Tab'\) return;\s*const items = focusableWithin\(closeDialogRef\.current\);[\s\S]*?document\.addEventListener\('keydown', onKey\);`
    + C + String.raw`const unfollow = subscribeLeaveGuards\(\(\) => \{\s*if \(!closeBusyRef\.current\) setCloseUnsaved\(unsavedForClose\(\)\);\s*\}\);\s*return \(\) => \{\s*document\.removeEventListener\('keydown', onKey\);\s*unfollow\(\);\s*unregister\(\);`
    + C + String.raw`const opener = closeOpenerRef\.current;\s*closeOpenerRef\.current = null;\s*if \(opener && opener !== document\.body && opener\.isConnected\) opener\.focus\?\.\(\);\s*\};\s*\}, \[showCloseDialog\]\);`)
  it('the close question takes the keyboard as a dialog does: the overlay stack, Escape = its staying answer, Tab inside; and names itself', () => {
    expect(app).toMatch(CLOSE_KEYS)
    const dialog = app.slice(app.indexOf('{showCloseDialog && ('), app.indexOf('\n      )}', app.indexOf('{showCloseDialog && (')))
    expect(dialog).toMatch(/ref=\{closeDialogRef\}\s+role="dialog"\s+aria-modal="true"\s+aria-labelledby="wilson-close-title"\s+aria-describedby="wilson-close-words"/)
    expect(dialog).toMatch(/<h2 id="wilson-close-title"/)
    expect(dialog).toMatch(/<p id="wilson-close-words"/)
  })
  it('CONTROL: no stack, an Escape that closes while busy, a listener left bound, no follow, a follow while busy, or no focus return, fails the pin', () => {
    expect(app.replace('const unregister = pushModal(id);', 'const unregister = () => {};')).not.toMatch(CLOSE_KEYS)
    expect(app.replace('if (!closeBusyRef.current) setShowCloseDialog(false);', 'setShowCloseDialog(false);')).not.toMatch(CLOSE_KEYS)
    expect(app.replace("document.removeEventListener('keydown', onKey);\n      unfollow();", 'unfollow();')).not.toMatch(CLOSE_KEYS)
    expect(app.replace('unfollow();\n      unregister();', 'unregister();')).not.toMatch(CLOSE_KEYS)
    expect(app.replace('if (!closeBusyRef.current) setCloseUnsaved(unsavedForClose());', 'setCloseUnsaved(unsavedForClose());')).not.toMatch(CLOSE_KEYS)
    expect(app.replace('opener.isConnected) opener.focus?.();', 'opener.isConnected) {}')).not.toMatch(CLOSE_KEYS)
    expect(app.replace(/onCloseRequested\(\(\) => \{\s*closeOpenerRef\.current = document\.activeElement;/, 'onCloseRequested(() => {')).not.toMatch(/onCloseRequested\(\(\) => \{\s*closeOpenerRef\.current = document\.activeElement;/)
  })
  // Review round 2 (R2-01): the answers skip work that went since the
  // question opened, and a refusal re-reads what is still unsaved.
  const CLOSE_AFTER = /for \(const g of closeUnsaved\) \{\s*if \(typeof g\.dirty === 'function' && !g\.dirty\(\)\) continue;\s*await \(how === 'save' \? g\.save\(\) : g\.discard\(\)\);\s*\}\s*setCloseBusy\(false\);\s*closeNow\(\);\s*\} catch \(err\) \{\s*setCloseBusy\(false\);\s*setCloseError\(err\?\.message \|\| String\(err\)\);(?:\s*\/\/[^\n]*)*\s*setCloseUnsaved\(unsavedForClose\(\)\);\s*\}/
  it('Save edit and close / Discard and close answer only for the work still there, and a refusal names what is left', () => {
    expect(app).toMatch(CLOSE_AFTER)
  })
  it('CONTROL: answering for gone work, or a refusal that keeps the old words, fails the pin', () => {
    expect(app.replace("if (typeof g.dirty === 'function' && !g.dirty()) continue;", '')).not.toMatch(CLOSE_AFTER)
    expect(app.replace(/(setCloseError\(err\?\.message \|\| String\(err\)\);)(?:\s*\/\/[^\n]*)*\s*setCloseUnsaved\(unsavedForClose\(\)\);/, '$1')).not.toMatch(CLOSE_AFTER)
  })
  // Review round 2 (R2-05): the question is no kit Dialog; its backdrop is
  // marked so the pages' undo keys count it (binUi's APP_QUESTION).
  it('the close question\'s backdrop carries the mark the undo keys count it by', () => {
    expect(app).toMatch(/\{showCloseDialog && \((?:\s*\/\/[^\n]*)*\s*<div data-app-question="close" style=\{\{\s*position: 'fixed', inset: 0, zIndex: 200,/)
    expect(app.replace('<div data-app-question="close" style={{', '<div style={{')).not.toMatch(/<div data-app-question="close"/)
  })
  // Step 8: the pin reaches the prompt itself (both halves Chromium needs) and
  // its listener, not only the guard's first line.
  const UNLOAD = /useEffect\(\(\) => \{\s*if \(window\.electronAPI\) return;\s*const onBeforeUnload = \(e\) => \{\s*if \(!hasUnsavedWork\('close'\)\) return;\s*e\.preventDefault\(\);\s*e\.returnValue = '';\s*\};\s*window\.addEventListener\('beforeunload', onBeforeUnload\);\s*return \(\) => window\.removeEventListener\('beforeunload', onBeforeUnload\);\s*\}, \[\]\);/
  it('the browser\'s own leave prompt only outside the desktop app (never a second prompt there)', () => {
    expect(app).toMatch(UNLOAD)
  })
  it('CONTROL: a prompt that never prevents the unload, or is never listened for, fails the pin', () => {
    expect(app.replace("e.preventDefault();\n      e.returnValue = '';", '')).not.toMatch(UNLOAD)
    expect(app.replace("window.addEventListener('beforeunload', onBeforeUnload);", '')).not.toMatch(UNLOAD)
    expect(app.replace('if (window.electronAPI) return;\n    const onBeforeUnload', 'const onBeforeUnload')).not.toMatch(UNLOAD)
  })
  it('the leave question is rendered inside RabbitProvider (it reads the provider)', () => {
    const open = app.indexOf('<RabbitProvider>')
    const close = app.indexOf('</RabbitProvider>')
    const at = app.indexOf('<LeaveEditDialog />')
    expect(open).toBeGreaterThan(0)
    expect(at).toBeGreaterThan(open)
    expect(at).toBeLessThan(close)
  })
  it('CONTROL: the guard moved after the transition lock, or asked from every page, fails the pin', () => {
    const after = app.replace(/(if \(!asked && currentPage === 'rabbit'[\s\S]*?return;\s*\}\s*)(transitionRef\.current = true;)/, '$2\n    $1')
    expect(after).not.toMatch(PAGE)
    expect(app.replace("!asked && currentPage === 'rabbit' && hasUnsavedWork('page')", "!asked && hasUnsavedWork('page')")).not.toMatch(PAGE)
  })
})
