// =============================================================================
// Renderer-side Sentry init. Dynamic-imported so the app still boots even
// if @sentry/electron isn't installed yet (graceful degradation during the
// cloud migration). Once `npm install` has run, errors are captured
// automatically.
//
// Call initSentry() once at the top of main.jsx, before ReactDOM.createRoot.
// =============================================================================

let sentryReady = null

export async function initSentry() {
  if (sentryReady) return sentryReady
  const dsn = import.meta.env.VITE_SENTRY_DSN
  const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT || 'development'
  const release = import.meta.env.VITE_SENTRY_RELEASE
  if (!dsn || dsn.includes('REPLACE-ME')) {
    console.info('[wilson] Sentry DSN not set — skipping renderer init')
    return (sentryReady = { enabled: false })
  }
  try {
    const Sentry = await import('@sentry/electron/renderer')
    Sentry.init({
      dsn,
      environment,
      release,
      tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
      // Don't send PII by default; TPN requires explicit opt-in for anything
      // that could carry customer content.
      sendDefaultPii: false,
    })
    sentryReady = { enabled: true, Sentry }
    return sentryReady
  } catch (err) {
    console.info('[wilson] @sentry/electron not installed yet — skipping renderer init', err?.message)
    return (sentryReady = { enabled: false })
  }
}

// Used for the Session 1 verification step.
export async function sendTestException(tag = 'session1-test') {
  const ready = await initSentry()
  if (!ready?.enabled) {
    console.warn('[wilson] Sentry not enabled; test exception not sent')
    return false
  }
  try {
    throw new Error(`[wilson-test] ${tag}`)
  } catch (err) {
    ready.Sentry.captureException(err)
    return true
  }
}
