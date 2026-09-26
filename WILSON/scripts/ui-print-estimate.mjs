// Captures the client estimate's print document (ClientViewTab.handlePrint
// writes it into a window.open() window, then prints and closes it — the walk
// cannot reach it). Stubs window.open with a sink, clicks "Print / export",
// saves the HTML it wrote, then renders that HTML at A4-ish width and
// screenshots it.
//   node scripts/ui-print-estimate.mjs <port> <outPrefix>   (B5, 2026-09-26; writes <outPrefix>.html and .png)
// It renders the document on the APP'S origin: the real print window shares
// its opener's, and a fresh about:blank page cannot load the app's fonts.
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
const [port = '5267', out = 'print'] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(`http://localhost:${port}/rabbit`)
await sleep(2500)
const click = async (text, sel = 'button, [role="tab"], a') => {
  const ok = await page.evaluate(([t, s]) => {
    const vis = (e) => e.offsetParent !== null
    const el = [...document.querySelectorAll(s)].filter(vis).find((e) => (e.textContent || '').trim() === t || e.getAttribute('title') === t || e.getAttribute('aria-label') === t)
      || [...document.querySelectorAll(s)].filter(vis).find((e) => (e.textContent || '').trim().startsWith(t))
    if (!el) return false
    el.click(); return true
  }, [text, sel])
  if (!ok) throw new Error(`no control "${text}"`)
  await sleep(1200)
}
if (!(await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.offsetParent && (b.textContent || '').includes('Control Panel'))))) {
  const proj = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && (x.textContent || '').includes('Salt Hours')); if (b) { b.click(); return true } return false })
  if (!proj) await click('R.A.B.B.I.T.')
  await sleep(1500)
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && (x.textContent || '').includes('Salt Hours')); b?.click() })
  await sleep(1500)
}
await click('Budget')
for (const label of ['Client View', 'Client view']) { try { await click(label); break } catch (e) { if (label === 'Client view') throw e } }
await page.evaluate(() => {
  window.__printed = ''
  window.open = () => ({
    document: { write: (s) => { window.__printed += s }, close: () => {} },
    focus: () => {}, print: () => {}, close: () => {},
  })
})
await click('Print')
await sleep(600)
const html = await page.evaluate(() => window.__printed)
if (!html) throw new Error('nothing was written to the print window')
writeFileSync(`${out}.html`, html)
const doc = await browser.newPage({ viewport: { width: 800, height: 1100 } })
// The print window shares its opener's origin; a fresh about:blank does not.
await doc.goto(`http://localhost:${port}/b5-print-origin`)
await doc.setContent(html, { waitUntil: 'load' })
const faces = await doc.evaluate(async () => { await document.fonts.ready; await new Promise((r) => setTimeout(r, 300)); await document.fonts.ready; return [...document.fonts].map((f) => f.family + ':' + f.status).join(', ') })
console.log('faces:', faces)
await doc.screenshot({ path: `${out}.png`, fullPage: true })
const face = await doc.evaluate(() => getComputedStyle(document.body).fontFamily)
console.log('printed', html.length, 'chars; body font:', face)
await browser.close()
