// =============================================================================
// serve-web — Session 12: local static server for the WEB build (dist-web/).
//
// Mirrors the deployed shape exactly: the app lives under the /wilson path
// (locked #18) with an SPA fallback, the way the test host serves it. Used
// by `npm run preview:web` and by the Playwright web-path lane — `vite
// preview` can't serve this because the web build's base is /wilson/ while
// the config's base stays './' for Electron.
//
//   npm run build:web && npm run preview:web
//   → http://localhost:4174/wilson
//
// PORT env overrides the default 4174.
// =============================================================================

import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const distWeb = path.join(here, '..', 'dist-web')
const port = Number(process.env.PORT || 4174)

const app = express()

// Bare origin → the app path, so "open localhost:4174" just works.
app.get('/', (_req, res) => res.redirect('/wilson'))

app.use('/wilson', express.static(distWeb))

// SPA fallback for deep links (/wilson/dog, /wilson/otter, …). Express 5
// wildcard syntax, matching electron/main.cjs.
app.get('/wilson/{*splat}', (_req, res) => {
  res.sendFile(path.join(distWeb, 'index.html'))
})

app.listen(port, () => {
  console.log(`[wilson-web] serving dist-web at http://localhost:${port}/wilson`)
})
