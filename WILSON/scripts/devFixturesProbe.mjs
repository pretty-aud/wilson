// Visits every review page with the dev fixtures ON and OFF, and records every
// request that leaves for the Supabase host, plus console errors. Proof for the
// hand-off that no fixture path reaches Supabase.
import { chromium } from '@playwright/test'

const base = process.argv[2] || 'http://localhost:5233'
const pages = ['/', '/team-members', '/project-files', '/rate-card', '/dashboard', '/rabbit', '/otter', '/settings', '/project-manager']

async function run(mode) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (mode === 'off') {
    await context.addInitScript(() => { try { localStorage.setItem('wilson.dev-fixtures', 'off') } catch {} })
  } else {
    await context.addInitScript(() => { try { localStorage.removeItem('wilson.dev-fixtures') } catch {} })
  }
  const page = await context.newPage()
  const supa = []
  const errors = []
  page.on('request', (r) => { if (/supabase\.co/.test(r.url())) supa.push(`${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search.slice(0, 60)}`) })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)) })
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)))
  for (const p of pages) {
    await page.goto(base + p, { waitUntil: 'load' })
    await page.waitForTimeout(3500)
  }
  await browser.close()
  const counts = {}
  for (const s of supa) counts[s] = (counts[s] || 0) + 1
  console.log(`\n=== fixtures ${mode.toUpperCase()} — ${supa.length} Supabase requests across ${pages.length} pages ===`)
  for (const [k, v] of Object.entries(counts).sort()) console.log(`${String(v).padStart(3)}  ${k}`)
  const ec = {}
  for (const e of errors) ec[e] = (ec[e] || 0) + 1
  console.log(`--- console errors (${errors.length}) ---`)
  for (const [k, v] of Object.entries(ec)) console.log(`${String(v).padStart(3)}  ${k}`)
}

await run('on')
await run('off')
