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
