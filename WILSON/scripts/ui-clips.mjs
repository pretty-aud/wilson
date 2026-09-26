// Lists the elements the walk counts as `clip` on a screen: text wider than
// its box with overflow not visible (the walk's own rule, block boxes only).
//   node scripts/ui-clips.mjs <port> <W> <H> <step> [<step> …]   (`?game` first for the game fixtures)
import { chromium } from '@playwright/test'
const [port, W, H, ...steps] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) } })
const game = steps[0] === '?game'
if (game) steps.shift()
await page.goto(`http://localhost:${port}/rabbit${game ? '?fixtures=game' : ''}`)
await sleep(2500)
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
for (const s of steps) {
  const ok = await page.evaluate((t) => {
    const vis = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed'
    const all = [...document.querySelectorAll('button, [role="tab"], [role="button"], a')].filter(vis)
    const name = (e) => [(e.textContent || '').trim(), e.getAttribute('title') || '', e.getAttribute('aria-label') || '']
    const el = all.find((e) => name(e).includes(t)) || all.find((e) => name(e).some((n) => n.startsWith(t)))
    if (!el) return false
    el.click(); return true
  }, s)
  if (!ok) throw new Error(`no control "${s}"`)
  await sleep(1200)
}
const found = await page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.wilson-chrome, [data-testid="dev-fixtures-badge"]')) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.overflowX === 'visible') continue
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && (el.textContent || '').trim()) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) continue
      out.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${el.clientWidth}/${el.scrollWidth} "${(el.textContent || '').trim().slice(0, 50)}"`)
    }
  }
  return out
})
console.log(found.join('\n') || '(none)')
await browser.close()
