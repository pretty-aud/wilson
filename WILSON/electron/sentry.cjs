// =============================================================================
// Main-process Sentry init (graceful if @sentry/electron not yet installed).
// Required so uncaught exceptions in the Electron main process (IPC handlers,
// Express server, sharp crashes) make it to Sentry too.
// =============================================================================

function initMainSentry() {
  const dsn = process.env.VITE_SENTRY_DSN;
  const environment = process.env.VITE_SENTRY_ENVIRONMENT || 'development';
  const release = process.env.VITE_SENTRY_RELEASE;
  if (!dsn || dsn.includes('REPLACE-ME')) {
    console.info('[wilson-main] Sentry DSN not set — skipping main init');
    return { enabled: false };
  }
  try {
    const Sentry = require('@sentry/electron/main');
    Sentry.init({
      dsn,
      environment,
      release,
      tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
      sendDefaultPii: false,
    });
    return { enabled: true, Sentry };
  } catch (err) {
    console.info('[wilson-main] @sentry/electron not installed — skipping main init', err?.message);
    return { enabled: false };
  }
}

module.exports = { initMainSentry };
