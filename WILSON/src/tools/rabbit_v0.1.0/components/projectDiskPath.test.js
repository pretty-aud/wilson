// =============================================================================
// projectDiskPath.test.js — F9 item 2 (A1's renderer half): the one helper in
// place of the four places that built a project's disk path. The tip's four
// expressions are kept below, word for word, as the control: on every project
// the desktop holds (its folder_slug set) the helper answers the same path.
// The copy fence's half (the helper's answer accepted or refused by the real
// fence) is in storage/projectFolders.test.js.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectDiskPath } from './projectDiskPath'
import { fileSlugify } from '../entityNaming'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(path.join(here, name), 'utf8').replace(/\r\n/g, '\n')

// The tip's four (81df858b): FileManager.jsx's add (:729-745), download
// (:870-882) and open folder (:917-929); entityFiles.js's add (:104-112).
async function tipAddDest(project, api, folderRel) {
  const projectSlug = project?.folder_slug || fileSlugify(project?.title || 'Untitled')
  let destDir
  if (project?.folder_root) destDir = project.folder_root.replace(/\\/g, '/') + '/' + folderRel
  else {
    const cfg = await api.readFilesConfig()
    const rootBase = cfg?.effectiveRootDir || cfg?.defaultRootDir
    if (rootBase) destDir = rootBase.replace(/\\/g, '/') + '/' + projectSlug + '/' + folderRel
  }
  return destDir ? destDir.replace(/\//g, '\\') : null
}
async function tipDownload(project, api, folderRelSlashes, storedName) {
  const projectSlug = project?.folder_slug || fileSlugify(project?.title || 'Untitled')
  const folderRel = folderRelSlashes.replace(/\//g, '\\')
  let filePath
  if (project?.folder_root) filePath = project.folder_root + '\\' + folderRel + '\\' + storedName
  else {
    const cfg = await api.readFilesConfig()
    const rootBase = cfg?.effectiveRootDir || cfg?.defaultRootDir
    if (rootBase) filePath = rootBase + '\\' + projectSlug + '\\' + folderRel + '\\' + storedName
  }
  return filePath ? filePath.replace(/\//g, '\\') : null
}
async function tipOpenFolder(project, api, entityFolderRel) {
  const projectSlug = project?.folder_slug || fileSlugify(project?.title || 'Untitled')
  const folderRel = entityFolderRel.replace(/\//g, '\\')
  let folderPath
  if (project?.folder_root) folderPath = project.folder_root + '\\' + folderRel
  else {
    const cfg = await api.readFilesConfig()
    const rootBase = cfg?.effectiveRootDir || cfg?.defaultRootDir
    if (rootBase) folderPath = rootBase + '\\' + projectSlug + '\\' + folderRel
  }
  return folderPath ? folderPath.replace(/\//g, '\\') : null
}
async function tipEntityFilesDest(project, api, folderPath) {
  const folderRel = String(folderPath || '').replace(/\/+$/, '')
  let destDir = null
  if (project?.folder_root) destDir = project.folder_root.replace(/\\/g, '/') + '/' + folderRel
  else if (typeof api.readFilesConfig === 'function') {
    const cfg = await api.readFilesConfig()
    const rootBase = cfg?.effectiveRootDir || cfg?.defaultRootDir
    const projectSlug = project?.folder_slug || fileSlugify(project?.title || 'Untitled')
    if (rootBase) destDir = rootBase.replace(/\\/g, '/') + '/' + projectSlug + '/' + folderRel
  }
  return destDir ? destDir.replace(/\//g, '\\') : null
}

const same = (p) => (p == null ? p : path.win32.normalize(p))
const api = (cfg) => ({ readFilesConfig: async () => cfg })
const PROJECTS = [
  { folder_root: 'D:\\Studio\\Salt-Hours', folder_slug: 'Salt-Hours', title: 'Salt Hours' },
  { folder_root: 'D:/Studio/Salt-Hours/', folder_slug: 'Salt-Hours', title: 'Salt Hours' },
  { folder_root: '\\\\nas\\share\\Projects\\Salt-Hours', folder_slug: 'Salt-Hours', title: 'Salt Hours' },
  { folder_root: null, folder_slug: 'Salt-Hours', title: 'Salt Hours' },
  { folder_root: null, folder_slug: 'Moon-Rise', title: 'Moon Rise' },
]
const CONFIGS = [
  { effectiveRootDir: 'E:\\Projects', defaultRootDir: 'C:\\Old' },
  { defaultRootDir: 'C:\\Users\\me\\WILSON' },
  { effectiveRootDir: '\\\\nas\\share\\Projects\\' },
  {},
]

describe('projectDiskPath: the four old answers, once', () => {
  it('the copy\'s destination (FileManager and entityFiles), download\'s file and open folder: the same path on every desktop project', async () => {
    for (const project of PROJECTS) for (const cfg of CONFIGS) {
      const a = api(cfg)
      const label = JSON.stringify({ project, cfg })
      expect(same(await projectDiskPath({ project, api: a, rel: 'SCENES/Dawn/Shot-010' })), label).toBe(same(await tipAddDest(project, a, 'SCENES/Dawn/Shot-010')))
      expect(same(await projectDiskPath({ project, api: a, rel: 'ASSETS/Hero/' })), label).toBe(same(await tipEntityFilesDest(project, a, 'ASSETS/Hero/')))
      expect(same(await projectDiskPath({ project, api: a, rel: 'ASSETS/Hero', leaf: 'Salt-Hours_Hero_v002.png' })), label)
        .toBe(same(await tipDownload(project, a, 'ASSETS/Hero', 'Salt-Hours_Hero_v002.png')))
      expect(same(await projectDiskPath({ project, api: a, rel: 'LEVELS/Cave' })), label).toBe(same(await tipOpenFolder(project, a, 'LEVELS/Cave')))
    }
  })
  it('a UNC root keeps its server\'s name', async () => {
    expect(await projectDiskPath({ project: { folder_slug: 'Salt-Hours' }, api: api({ effectiveRootDir: '\\\\nas\\share\\Projects' }), rel: 'ASSETS/Hero' }))
      .toBe('\\\\nas\\share\\Projects\\Salt-Hours\\ASSETS\\Hero')
  })
  it('no root on this computer, or no desktop bridge: null', async () => {
    expect(await projectDiskPath({ project: { folder_slug: 'Salt-Hours' }, api: api({}), rel: 'ASSETS/Hero' })).toBeNull()
    expect(await projectDiskPath({ project: { folder_slug: 'Salt-Hours' }, api: null, rel: 'ASSETS/Hero' })).toBeNull()
  })
  it('the one difference: a project with no slug and no title is the main process\'s Untitled-Project, not the renderer\'s Untitled', async () => {
    const project = { folder_root: null, folder_slug: null, title: '' }
    const a = api({ effectiveRootDir: 'E:\\Projects' })
    expect(await projectDiskPath({ project, api: a, rel: 'ASSETS/Hero' })).toBe('E:\\Projects\\Untitled-Project\\ASSETS\\Hero')
    // CONTROL: the tip's renderer said `Untitled`, a folder the main process
    // never makes, so its copy fence refused the copy.
    expect(await tipAddDest(project, a, 'ASSETS/Hero')).toBe('E:\\Projects\\Untitled\\ASSETS\\Hero')
  })
})

describe('the callers ask the helper, and build no path of their own', () => {
  const manager = read('FileManager.jsx')
  const entityFiles = read('entityFiles.js')
  it('FileManager: the add, Download and Open folder (was three builders)', () => {
    expect(manager.match(/await projectDiskPath\(\{/g)).toHaveLength(3)
    expect(manager).not.toMatch(/readFilesConfig\(/)
    expect(manager).not.toMatch(/fileSlugify\(project\?\.title \|\| 'Untitled'\)/)
    expect(manager).not.toMatch(/folderRoot\s*\+\s*'\\\\'/)
  })
  it('entityFiles: the create form\'s add (was one builder)', () => {
    expect(entityFiles.match(/await projectDiskPath\(\{/g)).toHaveLength(1)
    expect(entityFiles).not.toMatch(/readFilesConfig\(/)
    expect(entityFiles).not.toMatch(/'Untitled'/)
  })
})
