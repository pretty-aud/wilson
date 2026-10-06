// =============================================================================
// entityFiles.js — post-overhaul S4c: files picked on a CREATE form, added
// to the row once it exists.
//
// The level and experience create forms (EntityListView.CreateEntityPopup)
// let a person pick files before the row is made. Until S4c the list rode
// into the row as `files` and nothing read it. This adds them the way
// FileManager's Add files does, one store or the other
// (ctx.supportsManagedFiles decides; never window.electronAPI alone):
//
//   cloud    ctx.uploadFile(file, { levelId | experienceId }) — the adapter
//            files the body into the entity's prefix and the row carries
//            the link and its folder (0043).
//   managed  ctx.addManagedFile(record) for the record (the server answers
//            folder_path from the entity's folder row), then the desktop's
//            streamed copy into that folder — FileManager's handleAddManaged
//            path, without its notices.
//
// Pure of React: a plain async function the form awaits, so a test drives
// it with a fake ctx and a fake desktop bridge. One file's failure never
// abandons the rest (FileManager's rule): the names that failed come back.
// =============================================================================

import { fileSlugify } from '../entityNaming'
import { guessMimeType } from './mimeTypes'

const EXT_RE = /\.[^./\\]+$/

function extensionOf(name) {
  const m = EXT_RE.exec(String(name || ''))
  return m ? m[0] : ''
}

function leafOf(p) {
  return String(p || '').replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'file'
}

/** The scope key for the entity type (uploadFile's and the managed record's). */
export function entityScope(entityType, entityId) {
  if (entityType === 'level') return { levelId: entityId }
  if (entityType === 'experience') return { experienceId: entityId }
  if (entityType === 'scene') return { sceneId: entityId }
  if (entityType === 'shot') return { shotId: entityId }
  if (entityType === 'asset') return { assetId: entityId }
  return {}
}

function managedLink(entityType, entityId) {
  if (entityType === 'level') return { level_id: entityId }
  if (entityType === 'experience') return { experience_id: entityId }
  if (entityType === 'scene') return { scene_id: entityId }
  if (entityType === 'shot') return { shot_id: entityId }
  if (entityType === 'asset') return { asset_id: entityId }
  return {}
}

/**
 * @param {object} args
 * @param {object} args.ctx        the R.A.B.B.I.T. context (uploadFile,
 *   addManagedFile, supportsManagedFiles, project)
 * @param {string} args.entityType 'level' | 'experience' | 'scene' | 'shot' | 'asset'
 * @param {object} args.entity     the created row (id, name)
 * @param {{ name: string, file?: File, path?: string }[]} args.picked
 * @param {object} [args.api]      the desktop bridge (window.electronAPI.rabbit)
 * @returns {Promise<{ added: number, failed: string[] }>}
 */
export async function addFilesToEntity({ ctx, entityType, entity, picked = [], api = globalThis.window?.electronAPI?.rabbit } = {}) {
  const failed = []
  let added = 0
  if (!ctx || !entity?.id || picked.length === 0) return { added, failed }
  const managed = ctx.supportsManagedFiles === true
  const scope = entityScope(entityType, entity.id)
  for (const p of picked) {
    try {
      if (!managed) {
        if (!p.file) throw new Error('no file bytes to upload')
        if (typeof ctx.uploadFile !== 'function') throw new Error('this backend cannot upload')
        await ctx.uploadFile(p.file, scope)
        added += 1
        continue
      }
      if (!p.path) throw new Error('no path on this computer')
      if (!api || typeof ctx.addManagedFile !== 'function') throw new Error('the desktop app is needed to add files on this storage')
      const stats = await api.getFileStats({ filePath: p.path })
      if (!stats || !stats.isFile) throw new Error('not a file')
      const originalName = leafOf(p.path)
      const ext = extensionOf(originalName)
      const baseName = ext ? originalName.slice(0, -ext.length) : originalName
      const record = await ctx.addManagedFile({
        ...managedLink(entityType, entity.id),
        file_name:     baseName,
        original_name: originalName,
        extension:     ext,
        mime_type:     guessMimeType(ext),
        size_bytes:    stats.size,
        notes:         '',
      })
      const project = ctx.project
      const folderRel = String(record?.folder_path || '').replace(/\/+$/, '')
      if (!folderRel) throw new Error('the record names no folder')
      let destDir = null
      if (project?.folder_root) {
        destDir = project.folder_root.replace(/\\/g, '/') + '/' + folderRel
      } else if (typeof api.readFilesConfig === 'function') {
        const cfg = await api.readFilesConfig()
        const rootBase = cfg?.effectiveRootDir || cfg?.defaultRootDir
        const projectSlug = project?.folder_slug || fileSlugify(project?.title || 'Untitled')
        if (rootBase) destDir = rootBase.replace(/\\/g, '/') + '/' + projectSlug + '/' + folderRel
      }
      if (!destDir) throw new Error('no project folder on this computer')
      await api.copyFile({ sourcePath: p.path, destDir: destDir.replace(/\//g, '\\'), destFileName: record.stored_name })
      added += 1
    } catch (err) {
      failed.push(`${p.name || 'a file'}: ${err?.message || String(err)}`)
    }
  }
  return { added, failed }
}
