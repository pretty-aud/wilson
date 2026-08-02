import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initSentry } from './cloud/sentry'
// Load the user's saved model choices into the resolver before anything can
// generate. Without this the settings dropdowns persist a value that only
// takes effect after the next launch, which reads as "the setting is broken".
import { initUserModelPrefs } from './lib/userModelPrefs'

initUserModelPrefs()

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
