import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { initSentry } from './cloud/sentry'

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
