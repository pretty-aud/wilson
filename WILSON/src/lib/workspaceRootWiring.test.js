// =============================================================================
// workspaceRootWiring.test.js — Session 34.
//
// Source-scan wiring guards, in the validatorSave.test.js /
// quizWiring.test.js tradition: a green unit test proves code is CORRECT,
// never that it RUNS. Six features in this repo have shipped complete with
// zero callers — S31's settings half did it with the antidote in hand — so
// every export the storage-root feature added is pinned here to its actual
// call site, and every resolver in main.cjs is pinned to the shared
// definition rather than a re-derived comparison.
//
// These scans fail when someone deletes a call site, re-derives the root
// resolution locally, or unwires the IPC — the regressions that would leave
// the feature green, tested, and dead.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

const mainCjs = read('../../electron/main.cjs')
const preloadCjs = read('../../electron/preload.cjs')
const appJsx = read('../App.jsx')
const storageSection = read('../components/AdminTerminal/StorageSection.jsx')
const adminTerminalPage = read('../components/AdminTerminal/AdminTerminalPage.jsx')
const storageConnections = read('../components/settings/StorageConnections.jsx')
const settingsPage = read('../components/SettingsPage.jsx')
const fileManager = read('../tools/rabbit_v0.1.0/components/FileManager.jsx')
// Session 41 — the Petal-cloud quota plane's two UI surfaces and the upload
// classifier they share.
const companiesSection = read('../admin/CompaniesSection.jsx')
const uploadNotices = read('../tools/rabbit_v0.1.0/storage/uploadNotices.js')

describe('main.cjs — one definition of the configured root, consulted everywhere', () => {
  it('resolveConfiguredRootDir is defined exactly once', () => {
    expect(mainCjs.match(/function resolveConfiguredRootDir\(/g)).toHaveLength(1)
  })
  it('every resolver consults it instead of re-deriving (4 call sites)', () => {
    // resolveProjectFolder, the project-create route, the rename-root
    // fallback, and resolveProjectFolderRoot. A fifth caller appearing is
    // fine; one DISAPPEARING means a resolver went back to reading
    // defaultRootDir directly and the workspace root silently stopped
    // applying there.
    const calls = mainCjs.match(/resolveConfiguredRootDir\(\)/g) || []
    expect(calls.length).toBeGreaterThanOrEqual(4)
  })
  it('no resolver reads defaultRootDir beside a slug-join anymore', () => {
    // The pre-S34 shape was `path.join(cfg.defaultRootDir, ...)`. Its
    // reappearance means a resolver bypasses the workspace root.
    expect(mainCjs).not.toMatch(/path\.join\(\s*cfg\.defaultRootDir/)
  })
  it('isUserAuthorizedRelinkDir pushes the workspace root into its roots', () => {
    const fn = mainCjs.slice(
      mainCjs.indexOf('function isUserAuthorizedRelinkDir'),
      mainCjs.indexOf('function rabbitLogFileEvent'),
    )
    expect(fn).toContain('roots.push(workspaceRootDir)')
    // and the comparison still rides the shared containment module.
    expect(fn).toContain('isPathInside(root, resolved)')
  })
  it('both IPC handlers are registered', () => {
    expect(mainCjs).toContain("ipcMain.handle('rabbit:set-workspace-root'")
    expect(mainCjs).toContain("ipcMain.handle('rabbit:probe-storage-root'")
  })
  it('read-files-config serves the computed effectiveRootDir and the write handler strips it', () => {
    // FileManager's renderer-side path building must agree with main's
    // resolvers (S34 review) — and the computed key must never be persisted
    // by a caller that spreads a read back into a write.
    expect(mainCjs).toMatch(/effectiveRootDir: resolveConfiguredRootDir\(\)/)
    expect(mainCjs).toMatch(/const \{ effectiveRootDir: _computed, \.\.\.rest \} = cfg/)
  })
})

describe('FileManager — renderer path building rides the effective root', () => {
  it('all three fallback sites consult effectiveRootDir before defaultRootDir', () => {
    const sites = fileManager.match(/cfg\?\.effectiveRootDir \|\| cfg\?\.defaultRootDir/g) || []
    expect(sites.length).toBeGreaterThanOrEqual(3)
    // and no site reads defaultRootDir alone for path building anymore
    expect(fileManager).not.toMatch(/if \(cfg\?\.defaultRootDir\) \{/)
  })
})

describe('preload — the bridge exposes both handlers', () => {
  it('setWorkspaceRoot and probeStorageRoot ride the rabbit namespace', () => {
    expect(preloadCjs).toContain("ipcRenderer.invoke('rabbit:set-workspace-root'")
    expect(preloadCjs).toContain("ipcRenderer.invoke('rabbit:probe-storage-root'")
  })
})

describe('call sites — every export the feature added has a caller', () => {
  it('App.jsx fetches workspace storage and pushes the root to main', () => {
    expect(appJsx).toContain('fetchWorkspaceStorage()')
    expect(appJsx).toContain('setWorkspaceRoot({ rootPath')
  })
  it('StorageSection consumes the classifier, the probe, and both cloud ops', () => {
    expect(storageSection).toContain('canonicalizeRoot(')
    expect(storageSection).toContain('classifyRoot(')
    expect(storageSection).toContain('probeStorageRoot(')
    expect(storageSection).toContain('fetchWorkspaceStorage()')
    expect(storageSection).toContain('saveWorkspaceStorage(')
  })
  it('the Admin Terminal registers and renders the Storage section', () => {
    expect(adminTerminalPage).toMatch(/key:\s*'storage'/)
    expect(adminTerminalPage).toContain('<StorageSection')
  })

  // 🚨 S37: the storage-choice cache decides which provider receives a new
  // body, and it is ONE module-level slot. If a refactor drops this call, no
  // suite anywhere goes red — and a user signing out of an s3 workspace into
  // a Petal-cloud one keeps the first workspace's provider, routing the
  // second tenant's media at the first tenant's bucket. Every other guard in
  // this file exists for the same reason: a green test over a dead wire.
  // Found by S37's adversarial review, which noted this call site was the
  // only new one with no pin.
  it('App.jsx clears the storage-choice cache when the workspace changes', () => {
    expect(appJsx).toContain('clearWorkspaceStorageCache()')
    // and it must be keyed on the workspace, not mounted once: the effect's
    // dependency array is what makes a workspace SWITCH re-read.
    const effect = appJsx.slice(
      appJsx.indexOf('clearWorkspaceStorageCache()'),
      appJsx.indexOf('clearWorkspaceStorageCache()') + 200,
    )
    expect(effect).toContain('perms.workspaceId')
  })

  // ── Session 41: the Petal-cloud quota plane ───────────────────────────────
  // Same reason as every pin above: NINE features have shipped or nearly
  // shipped in this repo with no caller. Each export 0055's UI layer added gets
  // one here.

  it('the Admin Terminal storage card reads live usage, and NOT through the cache', () => {
    expect(storageSection).toContain('fetchStorageUsage(')
    // 🚨 getWorkspaceStorageCached is ONE module-level slot with no TTL,
    // invalidated only on sign-out or a workspace switch. Correct for a storage
    // CHOICE, wrong for a figure that moves on every upload — a usage bar served
    // from it would freeze at its first reading for the whole session and look
    // entirely healthy doing it.
    expect(storageSection).not.toContain('getWorkspaceStorageCached')
  })

  it('the operator console reads plans and calls all four write actions', () => {
    expect(companiesSection).toContain('listStoragePlans(')
    expect(companiesSection).toContain('setStoragePlan(')
    expect(companiesSection).toContain('setStoragePlanSuspended(')
    expect(companiesSection).toContain('clearStoragePlan(')
  })

  it('the cloud upload path passes the plan into classifyUpload', () => {
    expect(fileManager).toContain('fetchStorageUsage(')
    expect(fileManager).toMatch(/classifyUpload\([^)]*storagePlan/s)
    // ...and classifyUpload actually reads it, rather than accepting a dead
    // option. The block arms are the executable form; asserting the option NAME
    // alone would pass against a destructured parameter nothing consults.
    expect(uploadNotices).toContain("code: 'over_quota'")
    expect(uploadNotices).toContain("code: 'storage_suspended'")
  })

  // 🚨 AN ORDERING PIN, AND THE ONLY TEST IN THIS FILE THAT IS ONE.
  //
  // S40's close-out recorded that its worst defect — an `await` inserted ahead
  // of `Array.from(fileList)`, which turned EVERY cloud upload into a silent
  // no-op because the picker's `value = ''` empties that FileList object in
  // place — was invisible to wiring tests "because they grep source text and
  // this is an ORDERING property". That is half true: a source-text scanner
  // cannot see execution order, but it CAN see the order of two statements in
  // one function, which is exactly what this defect was.
  //
  // S41 added a SECOND await on that path (fetchStorageUsage). This asserts both
  // reads still sit after the snapshot. It fails the moment someone hoists
  // either one to the top "because it decides the ceiling" — which is precisely
  // the reasoning that produced the S40 bug.
  //
  // ⚠️ THE FIRST TWO DRAFTS OF THIS TEST DID NOT FIRE, both for the same
  // reason, and both were caught by running the S40 defect against it as a
  // deliberate breaker rather than by reading it.
  //
  // The function this scans carries a long comment that QUOTES the very
  // expressions being located — it has to, because it is explaining the bug.
  // So `indexOf('Array.from(fileList)')` found prose sitting ABOVE the real
  // statement, and a hoisted await compared as "after" it; moving to the
  // executable `const incoming = ...` fixed that operand and the OTHER one
  // then failed the same way, because the same comment says "S40 introduced an
  // `await getWorkspaceStorageCached()` ahead of it".
  //
  // This is the house's standing trap in a new costume — S37's review shipped
  // two `not.toContain` assertions that matched the comment explaining why the
  // form was wrong. Chasing it operand by operand is a losing game, because any
  // future comment can quote any form. Strip the prose instead.
  //
  // 🚨 ONE ALTERNATING PASS, BLOCK ALTERNATIVE FIRST. S39 lost 40 lines of real
  // code to a stripper that ran block comments in a SEPARATE earlier pass: a
  // LINE comment containing `/*` then opened a block that ate everything to the
  // next `*/`. Alternation in a single pass cannot do that, because whichever
  // marker appears first wins and consumes its own form.
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

  it('every await on the cloud upload path stays AFTER the synchronous FileList snapshot', () => {
    const start = fileManager.indexOf('const handleAddCloudFiles')
    expect(start).toBeGreaterThan(-1)
    // Slice generously BEFORE stripping — the comments in this function are
    // longer than the code, so 6000 raw chars is roughly 2000 of statements.
    const body = stripComments(fileManager.slice(start, start + 6000))
    const snapshot = body.indexOf('Array.from(fileList)')
    expect(snapshot).toBeGreaterThan(-1)
    for (const call of ['getWorkspaceStorageCached(', 'fetchStorageUsage(']) {
      const at = body.indexOf(call)
      // A -1 here fails loudly rather than silently comparing -1 > snapshot,
      // so an over-eager stripper reports itself instead of passing vacuously.
      expect(at).toBeGreaterThan(-1)
      expect(at).toBeGreaterThan(snapshot)
    }
  })
})

describe('S35 — folder_root is contained and gated (TPN-NET-015)', () => {
  const summaryView = read('../tools/rabbit_v0.1.0/views/ProjectSummaryView.jsx')
  const roleMatrix = read('../permissions/projectRoleMatrix.js')
  const supabaseAdapter = read('../tools/rabbit_v0.1.0/adapters/supabaseAdapter.js')

  it('the seat exists and ProjectSummaryView actually consumes it (S31: exports need callers)', () => {
    expect(roleMatrix).toContain('export function canSetProjectFolder')
    expect(roleMatrix).toContain('export function projectFolderDeniedReason')
    expect(summaryView).toContain('canSetProjectFolder(folderGateCtx)')
    expect(summaryView).toContain('projectFolderDeniedReason(folderGateCtx)')
    // The gate is keyed on workspaceId — cloud only. Without this a local /
    // signed-out desktop greys a control that works and that nothing below
    // refuses (S35 review, HIGH regression).
    expect(summaryView).toMatch(/workspaceId:\s*perms\?\.workspaceId/)
  })
  it('both Change buttons are greyed-with-reason, desktop-gated, handlers refuse independently', () => {
    const gated = summaryView.match(/GatedAction allowed=\{canSetFolder\}/g) || []
    expect(gated.length).toBeGreaterThanOrEqual(2)
    const refusals = summaryView.match(/if \(!canSetFolder\) return/g) || []
    expect(refusals.length).toBeGreaterThanOrEqual(2)
    // Both render only when the OS picker exists — on the web an enabled
    // button that silently did nothing is the shape GatedAction's own header
    // calls the worst outcome (S35 review).
    const desktopGates = summaryView.match(/\{canPickFolder && \(/g) || []
    expect(desktopGates.length).toBeGreaterThanOrEqual(2)
  })
  it('both buttons ride the ONE pick-and-set flow, and it surfaces refusals', () => {
    expect(summaryView.match(/function pickAndSetProjectFolder\(/g)).toHaveLength(1)
    const calls = summaryView.match(/await pickAndSetProjectFolder\(ctx, project\)/g) || []
    expect(calls.length).toBeGreaterThanOrEqual(2)
    const fn = summaryView.slice(
      summaryView.indexOf('async function pickAndSetProjectFolder'),
      summaryView.indexOf('export default function ProjectSummaryView'),
    )
    // 🚨 WRITE FIRST, mkdir second (S35 review): the authoritative refusal is
    // the write — the 0049 guard can refuse on the seat or on "no byos drive"
    // for reasons the local IPC preflight cannot see, and creating the folder
    // first stranded an empty directory whenever the two rules diverged.
    expect(fn.indexOf('updateProject')).toBeLessThan(fn.indexOf('ensureProjectFolder'))
    // the depth check still carries main's refusal back…
    expect(fn).toContain('ensured.ok === false')
    // …and the write's own refusal is caught, not swallowed (S30 rule).
    expect(fn).toContain('catch (err)')
  })
  it('the cloud adapter lets folder_root through — the write shipped WITH its 0049 guard', () => {
    const cols = supabaseAdapter.slice(
      supabaseAdapter.indexOf('const PROJECT_COLUMNS'),
      supabaseAdapter.indexOf(']);', supabaseAdapter.indexOf('const PROJECT_COLUMNS')),
    )
    expect(cols).toContain("'folder_root'")
    // folder_slug stays out: nothing in cloud mode writes it.
    expect(cols).not.toContain("'folder_slug'")
  })
})

describe('TPN-AUTH-009 — the machine-root writers are gated', () => {
  it('StorageConnections gates its Change folder control', () => {
    expect(storageConnections).toContain('canEditMachineRoot')
    expect(storageConnections).toMatch(/GatedAction allowed=\{canEditMachineRoot\}/)
    // the handler refuses independently of the rendering (S29 rule: the
    // logic needs the boolean, not just the greyed control).
    expect(storageConnections).toMatch(/if \(!canEditMachineRoot\) return/)
  })
  it('SettingsPage gates all three root-dir controls and both handlers', () => {
    expect(settingsPage).toContain('canEditMachineRoot')
    const gated = settingsPage.match(/GatedAction allowed=\{canEditMachineRoot\}/g) || []
    expect(gated.length).toBeGreaterThanOrEqual(3)
    const refusals = settingsPage.match(/if \(!canEditMachineRoot\) return/g) || []
    expect(refusals.length).toBeGreaterThanOrEqual(2)
  })
  it('the gate fails closed while permissions load in both files', () => {
    for (const src of [storageConnections, settingsPage]) {
      expect(src).toMatch(/perms\.ready && \(!perms\.workspaceId \|\| perms\.role === 'admin'\)/)
    }
  })
})
