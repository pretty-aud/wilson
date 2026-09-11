// =============================================================================
// scripts/screenshot.mjs — before/after screenshots for the UI overhaul
// hand-offs (plan §7: "screenshots before and after into
// docs/sessions/handoffs/img/ (small PNGs, committed)").
//
// Uses the Playwright Chromium the e2e suite already installs. The dev server
// must be running (`npm run dev`, port 5203). Without credentials only the
// sign-in screen is reachable; a signed-in session (Audrey, in the Browser
// pane) is what the page-by-page captures need — pass `--storage <json>`
// exported from such a session to reuse it, or capture what is visible.
//
//   node scripts/screenshot.mjs --out docs/sessions/handoffs/img/f1-after \
//        [--url http://localhost:5203] [--pages root,/settings,/dog] \
//        [--sizes 1440x900,1280x700] [--wait 6000] [--storage state.json]
//
// `root` means `/` — Git Bash rewrites a bare `/` argument into the MSYS
// install path, so the alias exists to keep the command copy-pasteable.
//
// Writes <out>-<page>-<w>x<h>.png, JPEG-quality-free PNGs at device scale 1
// so a diff between before and after is pixel-honest.
// =============================================================================

import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}

const url = opt('url', 'http://localhost:5203')
const out = opt('out', 'docs/sessions/handoffs/img/shot')
const pages = opt('pages', 'root').split(',').map((p) => p.trim()).filter(Boolean).map((p) => (p === 'root' ? '/' : p))
const sizes = opt('sizes', '1440x900').split(',').map((s) => s.trim().split('x').map(Number))
const wait = Number(opt('wait', '6000'))
const storage = opt('storage', null)

mkdirSync(dirname(out), { recursive: true })

const browser = await chromium.launch()
try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      ...(storage ? { storageState: storage } : {}),
    })
    const page = await context.newPage()
    for (const path of pages) {
      const slug = path === '/' ? 'root' : path.replace(/^\//, '').replace(/[^a-z0-9-]+/gi, '_')
      await page.goto(new URL(path, url).toString(), { waitUntil: 'load' })
      await page.waitForTimeout(wait)
      const file = `${out}-${slug}-${width}x${height}.png`
      await page.screenshot({ path: file, fullPage: false })
      console.log(file)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
