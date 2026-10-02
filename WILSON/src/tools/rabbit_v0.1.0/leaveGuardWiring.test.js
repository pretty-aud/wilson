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

describe('App.jsx: leaving R.A.B.B.I.T. asks before the transition; the window\'s close folds the edit into its one question', () => {
  it('navigateTo asks BEFORE the transition starts (C2), only from R.A.B.B.I.T., and a back press it keeps re-stamps the address', () => {
    expect(app).toMatch(PAGE)
  })
  it('the close question reads the guards that can answer from it when it opens, and offers D12\'s three there', () => {
    expect(app).toMatch(/onCloseRequested\(\(\) => \{\s*setCloseUnsaved\(unsavedForClose\(\)\);/)
    const dialog = app.slice(app.indexOf('{showCloseDialog && ('), app.indexOf('\n      )}', app.indexOf('{showCloseDialog && (')))
    expect(dialog).toMatch(/\{closeUnsaved\.length \? 'Keep editing' : 'Cancel'\}/)
    expect(dialog).toMatch(/Discard and close/)
    expect(dialog).toMatch(/\{closeUnsaved\.length \? 'Save edit and close' : 'Close'\}/)
    expect(dialog).toMatch(/autoFocus=\{closeUnsaved\.length > 0\}/)
    // Still the one quit question: the same heading, no second dialog for the edit.
    expect(dialog).toMatch(/>Close WILSON<\/h2>/)
    expect(app.match(/<LeaveEditDialog \/>/g)).toHaveLength(1)
  })
  it('the browser\'s own leave prompt only outside the desktop app (never a second prompt there)', () => {
    expect(app).toMatch(/useEffect\(\(\) => \{\s*if \(window\.electronAPI\) return;\s*const onBeforeUnload = \(e\) => \{\s*if \(!hasUnsavedWork\('close'\)\) return;/)
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
