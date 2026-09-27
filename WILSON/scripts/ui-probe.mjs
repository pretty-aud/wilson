#!/usr/bin/env node
// UI overhaul — the probe lane B5b and both of its reviews measured with (2026-09-27).
//
//   node scripts/ui-probe.mjs <port> <W> <H> <evalFile|-> <step> [<step> …]   (run from WILSON/)
//
// Opens R.A.B.B.I.T.'s Salt Hours as ui-clips.mjs does, then clicks each step by
// name (the first visible control whose text, title or aria-label is it, then
// starts with it, preferring the page to the shell); '@key:Escape' presses a
// key and '@wait:500' waits. Then runs the eval file's text in the page as an
// async function body and prints { out, errors } as JSON (errors: page errors
// and console errors). PROBE_SHOT=<png> saves a screenshot, PROBE_CLIP=x,y,w,h
// clips it. The walk opens neither a scene's nested shots, the popups' task
// form, the filter strips, saved views nor the period popovers: this does.
//
// V2 (2026-09-27) — three switches, so the probe reaches what the walk does
// not on EVERY page, and measures it the walk's way:
//   PROBE_PATH=/otter      open that route instead; no project is opened
//                          (PROBE_PATH=/rabbit keeps the Salt Hours opener)
//   PROBE_QUERY=?fixtures=game   appended to the route, read once at load
//   @type:<text>           type into whatever has focus
//   @hover: @click: @rclick:<css>   point at, click or right-click the first
//                          visible element the selector matches
//   PROBE_MEASURE=1        after the steps, the walk's own census on the page
//                          as it stands (ui-measure.mjs, the same functions):
//                          one line in ui-walk's format, then each face, C6,
//                          clip and contrast row. An evalFile of `-` runs no
//                          eval, for a measure-only probe.
import { chromium } from '@playwright/test'
import { readFileSync } from 'node:fs'
import {
  pageCensus, typeCensus, renderedFaces, typeRules, openDialog, unnamedControls, stopPointCensus, formFields, nestedButtons,
} from './ui-measure.mjs'
const [port, W, H, evalFile, ...steps] = process.argv.slice(2)
const PATH = process.env.PROBE_PATH || '/rabbit'
const QUERY = process.env.PROBE_QUERY || ''
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: Number(W), height: Number(H) } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
await page.goto(`http://localhost:${port}${PATH}${QUERY}`)
await sleep(2500)
for (let i = 0; PATH === '/rabbit' && i < 8; i++) {
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
  // V2: '@type:<text>' types into whatever has focus (the sign-in screens'
  // company field; never a credential).
  if (s.startsWith('@type:')) { await page.keyboard.type(s.slice(6)); await sleep(400); continue }
  // V2: '@hover:<css selector>' puts the pointer on the first visible match —
  // a real pointer, so `:hover` matches (script cannot fake it) — and
  // '@click:<css>' / '@rclick:<css>' press it (a control with no name, a
  // context menu).
  const pointer = /^@(hover|click|rclick):/.exec(s)
  if (pointer) {
    const sel = s.slice(pointer[0].length)
    const box = await page.evaluate((q) => {
      const el = [...document.querySelectorAll(q)].find((e) => e.getBoundingClientRect().width > 0)
      if (!el) return null
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }, sel)
    if (!box) { console.log(JSON.stringify({ error: `nothing matches "${sel}"` })); await browser.close(); process.exit(1) }
    if (pointer[1] === 'hover') await page.mouse.move(box.x, box.y)
    else await page.mouse.click(box.x, box.y, { button: pointer[1] === 'rclick' ? 'right' : 'left' })
    await sleep(pointer[1] === 'hover' ? 600 : 1200); continue
  }
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
let out = null
if (evalFile !== '-') {
  const body = readFileSync(evalFile, 'utf8')
  out = await page.evaluate(new Function(`return (async () => { ${body} })()`))
}
if (process.env.PROBE_MEASURE) {
  /* The walk's census, in the walk's order (ui-walk.mjs `visit`): fonts laid
     out first, or the platform-font query answers nothing (V1 trap 4). */
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('DOM.enable')
  await cdp.send('CSS.enable')
  await page.evaluate(() => document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))))
  const info = await page.evaluate(pageCensus)
  const rows = await page.evaluate(typeCensus)
  const faces = await renderedFaces(cdp, rows)
  const rules = typeRules(rows)
  const dlg = await page.evaluate(openDialog)
  const anon = await page.evaluate(unnamedControls)
  const census = await page.evaluate(stopPointCensus)
  const fields = await page.evaluate(formFields)
  const nested = await page.evaluate(nestedButtons)
  /* An orange ground, by hue — ui-walk.mjs's `isOrange`, verbatim. */
  const isOrange = (h) => { const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return r > 180 && g > 50 && g < 175 && b < 110 && r - b > 100 }
  const c6 = census.contrast.filter((d) => { const m = d.match(/ on #([0-9a-f]{6}) /); return m && isOrange(m[1]) })
  const formFace = fields.filter((f) => !/^Geist( Mono)?$/.test(f.family))
  const dl = dlg ? ` dlg=${dlg.kind}:${dlg.bg}/r${dlg.radius}/${dlg.box[2]}x${dlg.box[3]}${dlg.fits ? '' : ' OFF-SCREEN'}${dlg.scrolls.length ? ' scrolls' : ''}` : ''
  console.log(`probe ${PATH} ${steps.join(' > ')}`.slice(0, 120))
  console.log(`  err=${errors.length} ovf=${info.overflow ? 'Y' : 'n'} off=${info.offScale} clip=${info.clipped}`
    + ` face=${faces.off.length}${faces.unmeasured ? ` (UNMEASURED ${faces.unmeasured})` : ''} form=${formFace.length} wt=${rules.weight.length} up=${rules.upper.length} trk=${rules.tracking.length} anon=${anon.length} c6=${c6.length} nest=${nested}`
    + ` b2=${census.border.length} rad=${census.radius.length} white=${census.white.length} cr=${census.contrast.length} brk=${census.broken.length} caps=${census.typedCaps.length}${dl}`)
  for (const r of faces.off) console.log(`    face ${r.used} x${r.glyphs} <${r.tag}> "${r.text}"`)
  for (const f of formFace) console.log(`    form declares ${f.family} <${f.tag}> "${f.value}"`)
  for (const d of c6) console.log(`    c6   ${d}`)
  for (const d of census.contrast.filter((x) => !c6.includes(x)).slice(0, 12)) console.log(`    cr   ${d}`)
  for (const r of rules.weight) console.log(`    wt   ${r.weight} ${r.px}px <${r.tag}.${r.cls}> "${r.text}"`)
  for (const r of rules.upper) console.log(`    up   ${r.px}px <${r.tag}.${r.cls}> "${r.text}"`)
  for (const a of anon.slice(0, 8)) console.log(`    anon ${a}`)
  for (const d of [...census.white, ...census.broken, ...census.typedCaps].slice(0, 8)) console.log(`    note ${d}`)
  if (dlg) console.log(`    dlg  ${JSON.stringify(dlg)}`)
}
if (process.env.PROBE_SHOT) await page.screenshot({ path: process.env.PROBE_SHOT, clip: process.env.PROBE_CLIP ? (([x, y, w, h]) => ({ x, y, width: w, height: h }))(process.env.PROBE_CLIP.split(",").map(Number)) : undefined })
if (evalFile !== '-' || errors.length) console.log(JSON.stringify({ out, errors }, null, 1))
await browser.close()
