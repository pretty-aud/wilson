// =============================================================================
// electron/env.cjs
// Loads the correct environment variables for the main process.
//
// Development: reads .env.development from the repo root (via dotenv).
// Packaged:    reads app.getPath('userData')/env.json so operators can swap
//              envs without a rebuild.
//
// These values reach the MAIN PROCESS ONLY — loadEnv() writes them into
// process.env below, and electron/sentry.cjs reads VITE_SENTRY_* from there.
// There is NO env bridge in preload.cjs: the renderer's `import.meta.env.VITE_*`
// reads are compile-time constants substituted by Vite at build time, so
// swapping userData/env.json changes main-process behaviour only — never the
// renderer's Supabase URL or anon key.
// =============================================================================

const fs = require('fs');
const path = require('path');

function parseDotenv(contents) {
  const out = {};
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadDev(repoRoot) {
  const file = path.join(repoRoot, '.env.development');
  if (!fs.existsSync(file)) return {};
  return parseDotenv(fs.readFileSync(file, 'utf-8'));
}

function loadPackaged(userDataDir) {
  const file = path.join(userDataDir, 'env.json');
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

// Public API.
// app is the Electron `app` module; repoRoot is used only in dev.
function loadEnv(app, repoRoot) {
  const isPackaged = !!app?.isPackaged;
  const env = isPackaged
    ? loadPackaged(app.getPath('userData'))
    : loadDev(repoRoot);

  // Sensible defaults.
  if (!env.WILSON_ENV) env.WILSON_ENV = isPackaged ? 'production' : 'development';

  // Write into process.env for ergonomics in main.cjs.
  for (const [k, v] of Object.entries(env)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }

  return env;
}

module.exports = { loadEnv };
