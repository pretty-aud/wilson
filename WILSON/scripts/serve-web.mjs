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
// PORT env overrides the default 4174 (PORT=0 takes any free port; the line
// printed at start says which). HOST env, when set, is the one address it
// listens on (unset, as `npm run preview:web` leaves it: every address of
// this computer, as before).
//
// F12 (2026-11-18): the fallback is electron/spaFallback.cjs's, root-relative.
// It used to send `path.join(distWeb, 'index.html')`, an ABSOLUTE path,
// which `send` refuses when any folder on it starts with a dot: from a
// session's worktree (…/.claude/worktrees/…) every deep link answered 404
// while /wilson/ itself still worked. The app is exported so
// src/lib/spaFallback.test.js can serve it from such a folder, and the script
// listens only when it is run, not when it is imported.
// =============================================================================

import express from 'express'
import path from 'node:path'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { sendSpaIndex } = createRequire(import.meta.url)('../electron/spaFallback.cjs')

/** The web preview's app over a web build's folder (dist-web/ beside this folder, by default). */
export function webPreviewApp(distWeb = path.join(here, '..', 'dist-web')) {
  const app = express()

  // Bare origin → the app path, so "open localhost:4174" just works.
  app.get('/', (_req, res) => res.redirect('/wilson'))

  app.use('/wilson', express.static(distWeb))

  // SPA fallback for deep links (/wilson/dog, /wilson/otter, …). Express 5
  // wildcard syntax and the same handler as electron/main.cjs.
  app.get('/wilson/{*splat}', sendSpaIndex(distWeb))

  return app
}

// Real paths on both sides, as scripts/build-electron-rules.mjs does: node
// resolves the entry through a junction, a symlink or a subst drive, so a
// plain comparison could leave the script silent when it is run.
const real = (p) => { try { return realpathSync(p) } catch { return path.resolve(p) } }
const runAsScript = Boolean(process.argv[1]) && real(process.argv[1]) === real(fileURLToPath(import.meta.url))

if (runAsScript) {
  const port = Number(process.env.PORT || 4174)
  // Express hands a failed listen (a port already taken) to this callback as
  // its argument; say so and stop, rather than print an address nobody serves.
  const started = (err) => {
    if (err) {
      console.error(`[wilson-web] cannot listen on port ${port}: ${err.message}`)
      process.exit(1)
    }
    console.log(`[wilson-web] serving dist-web at http://localhost:${server.address().port}/wilson`)
  }
  const where = process.env.HOST ? [port, process.env.HOST] : [port]
  const server = webPreviewApp().listen(...where, started)
}
