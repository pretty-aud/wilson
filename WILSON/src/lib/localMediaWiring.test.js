// =============================================================================
// localMediaWiring.test.js — cloud rows, local bodies (demo 2026-09-11).
//
// Audrey, 2026-09-11: "all databases need to live in the supabase storage at
// all times. the only thing local storage should be related to is just the
// media files and asset of the project. … lets also just give users the
// ability to setup private projects for themselves."
//
// Source-scan pins over the seams that make that true, in the style of
// localDemoWiring.test.js: each one names the line that, if it went missing
// in a merge, would silently send a private project's media to the cloud,
// fail every project list on an older database, or hide the routes behind
// the SPA fallback. The behaviour itself is tested in localMedia.test.js
// (routes) and localServerProvider.test.js (provider); the policy in pgTAP
// suite 80.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// CRLF-normalised: most source files here are CRLF, and several pins below
// span a line break.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').replace(/\r\n/g, '\n')

const mainCjs = read('../../electron/main.cjs')
const adapter = read('../tools/rabbit_v0.1.0/adapters/supabaseAdapter.js')
const fileManager = read('../tools/rabbit_v0.1.0/components/FileManager.jsx')
const projectsPage = read('../components/Projects/ProjectsPage.jsx')
const listPanel = read('../components/Projects/ProjectListPanel.jsx')
const storageCard = read('../components/settings/StorageConnections.jsx')
const settingsPage = read('../components/SettingsPage.jsx')
const client = read('../components/local/localDemoClient.js')
const migration = read('../../supabase/migrations/0072_private_projects.sql')
const suite = read('../../supabase/tests/rls/80_private_projects.sql')

describe('main.cjs — the media root and the five routes', () => {
  it('getLocalMediaRoot: the demo folder\'s media\\ while open, app data otherwise, and a MISSING folder refuses', () => {
    const fn = mainCjs.slice(mainCjs.indexOf('function getLocalMediaRoot'), mainCjs.indexOf('function getLocalMediaRoot') + 1200)
    expect(fn).toContain("path.join(demoRoot, 'media')")
    expect(fn).toContain("path.join(getRabbitDataDir(), 'local-media')")
    expect(fn).toContain('if (state.missing)')
    expect(fn).toContain('throw new Error(')
  })
  it('the Storage card learns the media root through the same state the folder uses', () => {
    expect(mainCjs).toContain('mediaRoot = getLocalMediaRoot({ create: false })')
    expect(mainCjs).toContain("appDataDir: app.getPath('userData'), mediaRoot")
  })
  it('mounts localMedia.cjs ONCE, after the missing-folder guard and BEFORE the SPA fallback', () => {
    const mounts = mainCjs.match(/require\('\.\/localMedia\.cjs'\)\.mountLocalMedia\(/g) || []
    expect(mounts.length).toBe(1)
    const mountAt = mainCjs.indexOf("require('./localMedia.cjs').mountLocalMedia(")
    const guardAt = mainCjs.indexOf("expressApp.use('/api/rabbit', localDemoMissingGuard)")
    const spaAt = mainCjs.indexOf("expressApp.get('/{*splat}'")
    expect(guardAt).toBeGreaterThan(0)
    expect(mountAt).toBeGreaterThan(guardAt)
    expect(mountAt).toBeLessThan(spaAt)
    // injected, not re-implemented
    expect(mainCjs).toContain('getRoot: getLocalMediaRoot, resolveContainedFilePath, safeMediaContentType')
  })
})

describe('supabaseAdapter — the private branch, beside the money pin', () => {
  it('registers local_server at module load, next to supabase and s3', () => {
    expect(adapter).toContain("import { createLocalServerStorageProvider } from '../storage/localServerProvider'")
    const reg = adapter.indexOf('FILE_PROVIDERS.LOCAL_SERVER,\n  createLocalServerStorageProvider()')
    expect(reg).toBeGreaterThan(0)
  })
  it('uploadFile routes a non-financial upload on a private project to LOCAL_SERVER, and everything else exactly as before', () => {
    const up = adapter.slice(adapter.indexOf('async uploadFile('), adapter.indexOf('async listFiles('))
    expect(up).toContain('if (!scope.financial && await projectIsPrivate(client, projectId)) {')
    expect(up).toContain('storageProvider = FILE_PROVIDERS.LOCAL_SERVER;')
    // the S36 refusal and the S37 workspace read survive, inside the else
    expect(up).toContain('const storageChoice = await getWorkspaceStorageCached();')
    expect(up).toContain('activeProvider === WORKSPACE_PROVIDERS.NETWORK && !scope.financial')
    expect(up).toContain('storageProvider = fileProviderFor(activeProvider, {')
    // one decision, used twice: the thumbnail follows the same variable
    expect(up).toContain('await putThumbnailTo(storageProvider, key, thumb, { client });')
    expect(up).toContain('storage_provider: storageProvider,')
    // the private branch comes BEFORE the workspace read, never after it
    expect(up.indexOf('projectIsPrivate(client, projectId)')).toBeLessThan(up.indexOf('getWorkspaceStorageCached()'))
  })
  it('the is_private column is PROBED, never assumed — the list, the create and the reset all ride the probe', () => {
    expect(adapter).toContain('async function privateProjectsAvailable(client)')
    expect(adapter).toContain("error.code === '42703'")
    expect(adapter).toContain("const privateCol = (await privateProjectsAvailable(client)) ? ', is_private' : '';")
    expect(adapter).toContain("cover_image_url' + privateCol)")
    expect(adapter).toContain('if (row.is_private !== undefined && !(await privateProjectsAvailable(client))) delete row.is_private;')
    expect(adapter).toContain('privateColumnKnown = null;\n}')
    expect(adapter).toContain('async supportsPrivateProjects()')
  })
  it('is_private is on the projects allowlist (an allowlist entry WITH a writer)', () => {
    const cols = adapter.slice(adapter.indexOf('const PROJECT_COLUMNS'), adapter.indexOf(']);', adapter.indexOf('const PROJECT_COLUMNS')))
    expect(cols).toContain("'is_private',")
    expect(projectsPage).toContain('{ is_private: true }')
  })
})

describe('the renderer — previews, the checkbox, the badge, the copy', () => {
  it('FileManager shows a local_server row\'s preview from the local server and never asks Petal to sign it', () => {
    expect(fileManager).toContain("import { localMediaUrl } from '../storage/localServerProvider'")
    expect(fileManager).toContain("f.storage_provider === 'local_server' && f.thumbnail_url")
    expect(fileManager).toContain("localMediaUrl(f.thumbnail_url)")
    expect(fileManager).toContain(".filter(f => f.storage_provider !== 'local_server')")
    expect(fileManager).toContain('setThumbUrls(new Map([...local, ...map]))')
    // off the desktop: icons, not broken images
    expect(fileManager).toMatch(/hasLocalServer\(\)\s*\n?\s*\? assetFiles/)
  })
  it('ProjectsPage offers a private project only where it can work, and sends the flag only when ticked', () => {
    expect(projectsPage).toContain('adapter.supportsPrivateProjects()')
    expect(projectsPage).toContain('!cloud || !hasLocalServer()')
    expect(projectsPage).toContain('{privateOk && (')
    expect(projectsPage).toContain('...(privateOk && newPrivate ? { is_private: true } : {})')
    expect(projectsPage).toContain('data-private-project')
  })
  it('the list marks a private project', () => {
    expect(listPanel).toContain('{project.is_private && (')
    expect(listPanel).toContain('Private')
  })
  it('the Storage tab says it in words: demos only, databases in Supabase, media local, nothing shareable', () => {
    expect(storageCard).toContain('data-local-card="demo-only"')
    expect(storageCard).toContain('For demos only.')
    expect(storageCard).toContain('demoState?.mediaRoot')
    expect(settingsPage).toContain('Local Server is')
    expect(settingsPage).toContain('for demos only: its projects stay on this computer and cannot be shared.')
    expect(settingsPage).toContain("'For demos only — projects here stay on this computer and cannot be shared (in-app Express server, desktop only)'")
  })
  it('opening a demo folder no longer flips the backend to Local Server', () => {
    expect(client).not.toContain('pinLocalServerMode')
    expect(client).not.toContain('saveOtterSettings')
  })
})

describe('migration 0072 and suite 80', () => {
  it('adds ONE column and replaces ONE policy, keeping 0020\'s three conditions', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS is_private BOOLEAN NOT NULL DEFAULT false')
    expect(migration).toContain('DROP POLICY IF EXISTS projects_select ON public.projects;')
    expect(migration).toContain('deleted_at IS NULL')
    expect(migration).toContain('AND workspace_id = public.current_workspace_id()')
    expect(migration).toContain('AND public.has_active_membership(workspace_id)')
    expect(migration).toContain('OR created_by = auth.uid()')
    expect(migration).toContain("OR public.current_app_role() = 'admin'")
    // nothing else is touched
    expect(migration.match(/CREATE POLICY/g).length).toBe(1)
    expect(migration).not.toMatch(/ALTER TABLE public\.(files|assets|tasks|scenes|shots)/)
  })
  it('suite 80 covers the owner, the member, the admin and the child hop', () => {
    expect(suite).toContain('SELECT plan(15);')
    expect(suite).toContain('a plain member does not see the private project')
    expect(suite).toContain('the workspace admin sees the private project')
    expect(suite).toContain("'local_server'")
    expect(suite).toContain('with no files_select change')
  })
})
