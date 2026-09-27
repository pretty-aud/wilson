#!/usr/bin/env node
// UI overhaul — the probe lane B5b and both of its reviews measured with (2026-09-27).
//
//   node scripts/ui-probe.mjs <port> <W> <H> <evalFile> <step> [<step> …]   (run from WILSON/)
//
// Opens R.A.B.B.I.T.'s Salt Hours as ui-clips.mjs does, then clicks each step by
// name (the first visible control whose text, title or aria-label contains it,
// preferring the page to the shell); '@key:Escape' presses a key and
// '@wait:500' waits. Then runs the eval file's text in the page as an async
// function body and prints { out, errors } as JSON (errors: page errors and
// console errors). PROBE_SHOT=<png> saves a screenshot, PROBE_CLIP=x,y,w,h
// clips it. The walk opens neither a scene's nested shots, the popups' task
// form, the filter strips, saved views nor the period popovers: this does.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
const [port, W, H, evalFile, ...steps] = process.argv.slice(2)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: Number(W), height: Number(H) } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
await page.goto(`http://localhost:${port}/rabbit`)
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
  if (s.startsWith('@key:')) { await page.keyboard.press(s.slice(5)); await sleep(600); continue }
  if (s.startsWith('@wait:')) { await sleep(Number(s.slice(6))); continue }
  const ok = await page.evaluate((t) => {
    const vis = (e) => e.offsetParent !== null || getComputedStyle(e).position === 'fixed'
    const all = [...document.querySelectorAll('button, [role="tab"], [role="button"], a, [role="menuitem"], [role="option"]')].filter(vis)
    const name = (e) => [(e.textContent || '').trim(), e.getAttribute('title') || '', e.getAttribute('aria-label') || '']
    const inPage = (e) => !e.closest('.wilson-chrome')
    const cands = all.filter(inPage)
    const el = cands.find((e) => name(e).includes(t)) || cands.find((e) => name(e).some((n) => n.startsWith(t))) || all.find((e) => name(e).includes(t))
    if (!el) return false
    el.click(); return true
  }, s)
  if (!ok) { console.log(JSON.stringify({ error: `no control "${s}"` })); await browser.close(); process.exit(1) }
  await sleep(1200)
}
const body = readFileSync(evalFile, 'utf8')
const out = await page.evaluate(new Function(`return (async () => { ${body} })()`))
if (process.env.PROBE_SHOT) await page.screenshot({ path: process.env.PROBE_SHOT, clip: process.env.PROBE_CLIP ? (([x, y, w, h]) => ({ x, y, width: w, height: h }))(process.env.PROBE_CLIP.split(",").map(Number)) : undefined })
console.log(JSON.stringify({ out, errors }, null, 1))
await browser.close()
