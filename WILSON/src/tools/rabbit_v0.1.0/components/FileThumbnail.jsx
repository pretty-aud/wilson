// ============================================================
// RABBIT — FileThumbnail
// ============================================================
// Renders a thumbnail preview for managed files. Image files
// load from the Express thumbnail endpoint (sharp-generated
// 256px JPEG). Non-image files show a file-type icon with the
// extension label below.

import { useState } from 'react'
import {
  File, FileText, FileVideo2, FileAudio, FileCode2,
  FileSpreadsheet, FileImage, FileArchive,
} from 'lucide-react'

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

export default function FileThumbnail({ file, size = 'small', projectId }) {
  const [imgError, setImgError] = useState(false)
  const isImage = IMAGE_EXTS.has((file.extension || '').toLowerCase())
  const px = size === 'large' ? 120 : 32
  const iconPx = size === 'large' ? 40 : 16
  const ext = (file.extension || '').replace('.', '').toUpperCase()

  if (isImage && !imgError && projectId) {
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
          src={`/api/rabbit/projects/${projectId}/managed-files/${file.id}/thumbnail`}
          alt={file.file_name}
          onError={() => setImgError(true)}
          className="object-cover"
          style={{ width: '100%', height: '100%' }}
          loading="lazy"
        />
      </div>
    )
  }

  const Icon = iconForExt(file.extension)
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
      {size === 'large' && ext && (
        <span className="text-[8.5px] font-mono uppercase tracking-wider" style={{ color: '#78716c' }}>
          {ext}
        </span>
      )}
    </div>
  )
}
