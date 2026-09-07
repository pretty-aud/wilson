// ============================================================
// RABBIT — FileThumbnail
// ============================================================
// Renders a thumbnail preview for a file row, on either tier.
//
// TWO SOURCES, and they are not interchangeable:
//
//   * CLOUD (`thumbnailUrl` prop) — a SIGNED URL into the private
//     rabbit-thumbnails bucket, minted in a batch by the parent
//     (S39). The bucket is private because a public one would be
//     TPN-CLOUD-004 repeated for frames of pre-release content,
//     so there is no stable URL to build here.
//   * DESKTOP (`projectId` + a managed file) — the Express route
//     serving sharp's on-disk 256px JPEG. Local Server only; that
//     server does not exist in a browser.
//
// 🚨 WHY THIS COMPONENT SHOWED NOTHING IN CLOUD, AND IT WAS NOT
// THE 404 HANDLER. The old gate was
// `IMAGE_EXTS.has(file.extension)`, and a cloud `files` row has NO
// `extension` COLUMN AT ALL (0000:221-236; supabaseAdapter.js:404
// lists it among the deliberately absent fields). So `isImage` was
// false, the <img> branch was never entered, and NO REQUEST WAS
// EVER MADE — the onError fallback is dead code on the web. Fixing
// the error path would have changed nothing. The gate was the bug.
//
// The same absence made every cloud file render the SAME generic
// File glyph with a blank extension label, because iconForExt was
// being handed undefined. Both are fixed by deriving the extension
// from the row's name when the column is missing.

import { useState } from 'react'
import {
  File, FileText, FileVideo2, FileAudio, FileCode2,
  FileSpreadsheet, FileImage, FileArchive,
} from 'lucide-react'
// Session 40: the ONE definition of "this row is a video", shared with the
// upload notices and mirrored (unavoidably, CJS vs ESM) in electron/main.cjs.
import { VIDEO_EXTENSIONS as VIDEO_THUMB_EXTS } from '../storage/videoThumbnails'
// One definition of the desktop preview route. It was hand-built here and in
// managedVideoThumbnail.js, which is how two copies of a URL start disagreeing
// about a path only one of them gets updated for.
import { managedThumbnailUrl } from '../storage/managedVideoThumbnail'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tiff', '.tif', '.bmp', '.avif'])

function iconForExt(ext) {
  const e = (ext || '').toLowerCase()
  if (['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm'].includes(e)) return FileVideo2
  if (['.mp3', '.wav', '.aac', '.flac', '.ogg', '.m4a'].includes(e)) return FileAudio
  if (['.js', '.jsx', '.ts', '.tsx', '.py', '.cpp', '.c', '.h', '.cs', '.java', '.rb', '.go', '.rs'].includes(e)) return FileCode2
  if (['.pdf', '.doc', '.docx', '.txt', '.md', '.rtf'].includes(e)) return FileText
  if (['.xls', '.xlsx', '.csv', '.tsv'].includes(e)) return FileSpreadsheet
  if (['.psd', '.ai', '.svg', '.eps', '.indd', '.sketch', '.fig', '.xd'].includes(e)) return FileImage
  if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(e)) return FileArchive
  return File
}

// A managed row carries `extension`; a cloud row carries only `name`. One
// definition so the icon, the label and the image gate cannot disagree about
// what this file is.
export function extensionOf(file) {
  if (!file) return ''
  if (file.extension) return String(file.extension).toLowerCase()
  const name = file.file_name || file.name || ''
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

export default function FileThumbnail({ file, size = 'small', projectId, thumbnailUrl = null }) {
  // 🚨 REMEMBER WHICH URL FAILED, NOT THAT ONE DID. A boolean here is sticky
  // for the life of the component, and a signed URL EXPIRES (1 hour). Tiles
  // below the fold are loading="lazy", so scrolling an hour after the batch was
  // signed fires their FIRST request against an expired token; with a boolean,
  // that tile is pinned to a generic icon forever and a later valid URL — a new
  // prop, same component instance — cannot repair it. Comparing against the
  // failing src makes recovery automatic and needs no effect.
  //
  // (A `key` on the <img> does NOT solve this: the flag lives here, and when it
  // is set the <img> is not rendered at all.)
  const [erroredSrc, setErroredSrc] = useState(null)
  const ext = extensionOf(file)
  const px = size === 'large' ? 120 : 32
  const iconPx = size === 'large' ? 40 : 16
  const label = ext.replace('.', '').toUpperCase()
  const alt = file.file_name || file.name || 'file'

  // Cloud first: a signed URL is proof the caller may SEE this thumbnail. RLS
  // decides that — a non-manager asking for an invoice's thumbnail simply gets
  // no URL back, and falls through to the icon.
  //
  // 🚨 SESSION 40: VIDEO ROWS NOW ENTER THIS BRANCH TOO, and forgetting that is
  // how the whole feature would have gone invisible. The Express route grew an
  // ffmpeg arm and a renderer-supplied-frame arm, but this gate decided whether
  // a request was ever MADE — the same shape as the original cloud bug above,
  // where `IMAGE_EXTS.has(file.extension)` meant no request was issued and the
  // onError fallback was dead code.
  //
  // The 404/415 path stays honest: a video with no cached frame (no ffmpeg
  // installed, or a codec nothing could read) answers 415 and `erroredSrc`
  // falls the tile back to the FileVideo2 icon — which is exactly the state
  // before this session, not a broken image.
  const desktopThumbable = IMAGE_EXTS.has(ext) || VIDEO_THUMB_EXTS.has(ext)
  const src = thumbnailUrl
    ? thumbnailUrl
    : (desktopThumbable && projectId && file.extension
        ? managedThumbnailUrl(projectId, file.id)
        : null)

  if (src && erroredSrc !== src) {
    return (
      <div
        className="rounded-sm overflow-hidden flex items-center justify-center"
        style={{
          width: px,
          height: px,
          backgroundColor: '#1c1917',
          border: '1px solid #44403c',
          flexShrink: 0,
        }}
      >
        <img
          key={src}
          src={src}
          alt={alt}
          onError={() => setErroredSrc(src)}
          className="object-cover"
          style={{ width: '100%', height: '100%' }}
          loading="lazy"
        />
      </div>
    )
  }

  const Icon = iconForExt(ext)
  return (
    <div
      className="rounded-sm flex flex-col items-center justify-center gap-0.5"
      style={{
        width: px,
        height: px,
        backgroundColor: '#1c1917',
        border: '1px solid #44403c',
        flexShrink: 0,
      }}
    >
      <Icon style={{ width: iconPx, height: iconPx, color: '#a8a29e' }} />
      {size === 'large' && label && (
        <span className="text-[8.5px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>
          {label}
        </span>
      )}
    </div>
  )
}
