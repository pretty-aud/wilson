// A screenshot of a scrolled part of a screen the walk cannot frame.
//   node scripts/ui-shot-scrolled.mjs <port> <W> <H> <out.png> <scrollToText|-> <step> [<step> …]
// Steps are visible control texts (exact, then prefix), as the walk's; the
// project is opened first. `?game` as the first step loads the game fixtures.
import { chromium } from '@playwright/test'
const [port, W, H, out, scrollTo, ...steps] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) } })
const game = steps[0] === '?game'
if (game) steps.shift()
await page.goto(`http://localhost:${port}/rabbit${game ? '?fixtures=game' : ''}`)
await sleep(2500)
const click = async (text) => {
  const ok = await page.evaluate((t) => {
    const vis = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed'
    const all = [...document.querySelectorAll('button, [role="tab"], [role="button"], a')].filter(vis)
    const name = (e) => [(e.textContent || '').trim(), e.getAttribute('title') || '', e.getAttribute('aria-label') || '']
    const el = all.find((e) => name(e).includes(t)) || all.find((e) => name(e).some((n) => n.startsWith(t)))
    if (!el) return false
    el.click(); return true
  }, text)
  if (!ok) throw new Error(`no control "${text}"`)
  await sleep(1200)
}
// Open Salt Hours from Summary's project list (the walk's @proj).
for (let i = 0; i < 8; i++) {
  const open = await page.evaluate(() => {
    const vis = (b) => b.offsetParent !== null
    const bs = [...document.querySelectorAll('button, [role="tab"]')].filter(vis)
    if (bs.some((b) => (b.textContent || '').trim() === 'Control Panel')) return true
    const proj = bs.find((b) => (b.textContent || '').includes('Salt Hours'))
    if (proj) { proj.click(); return false }
    bs.find((b) => (b.textContent || '').trim() === 'Summary')?.click()
    return false
  })
  if (open) break
  await sleep(1000)
}
for (const s of steps) await click(s)
if (scrollTo && scrollTo !== '-') {
  const found = await page.evaluate((t) => {
    const same = (e) => e.offsetParent !== null && (e.textContent || '').trim() === t; const el = [...document.querySelectorAll('body *')].find((e) => same(e) && ![...e.children].some(same))
    if (!el) return false
    el.scrollIntoView({ block: 'start' }); return true
  }, scrollTo)
  if (!found) { console.log('h2s:', await page.evaluate(() => [...document.querySelectorAll('h1,h2,h3')].filter((e) => e.offsetParent).map((e) => e.textContent.trim()).join(' | '))); await page.screenshot({ path: out }); throw new Error('no text ' + scrollTo) }
  await sleep(500)
}
await page.screenshot({ path: out })
console.log('saved', out)
await browser.close()
