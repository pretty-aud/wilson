import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initSentry } from './cloud/sentry'
// Load saved model choices into the resolver before anything can generate.
// Without this the settings dropdowns persist a value that only takes effect
// after the next launch, which reads as "the setting is broken".
//
// Session 20: the tiers now live in Supabase, but resolution is synchronous and
// the queries are not — so the cached tiers are applied here, first and without
// awaiting anything, and `loadModelSources()` overwrites them from the database
// once there is a session (see App.jsx). A generation fired in that window would
// otherwise silently use the built-in floor and report nothing, because an
// ABSENT tier is not a misconfigured one and produces no warning.
//
// initUserModelPrefs still runs for anyone whose choices have not been migrated
// into the database yet; hydrate wins where both have a value, since it is the
// newer of the two.
import { initUserModelPrefs } from './lib/userModelPrefs'
import { hydrateModelSourcesFromCache } from './lib/modelSources'

initUserModelPrefs()
hydrateModelSourcesFromCache()

// Kick off Sentry init immediately; it resolves async and doesn't block render.
// Exposed on window for the Session 1 verification test:
//   > await window.wilsonSendTestException()
initSentry().then((ready) => {
  window.wilsonSendTestException = async () => {
    const { sendTestException } = await import('./cloud/sentry')
    return sendTestException('renderer-' + new Date().toISOString())
  }
  if (!ready?.enabled) {
    console.info('[wilson] Sentry disabled; set VITE_SENTRY_DSN in .env.development to enable.')
  }
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
