// =============================================================================
// mimeTypes.js — the MIME type a managed record is given from its extension.
//
// FileManager's guesser since Session 17, lifted out in post-overhaul S4c so
// the create forms' files (entityFiles.addFilesToEntity) carry the same type
// as a file added from a popup — a record with `mime_type: null` was the
// only one of its kind, and the thumbnail and preview code read the type.
// The map is deliberately small: what the studio actually adds. Anything
// else is `application/octet-stream`, which every reader treats as "a file".
// =============================================================================

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.tiff': 'image/tiff',
  '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.psd': 'image/vnd.adobe.photoshop', '.ai': 'application/postscript',
  '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
  '.fbx': 'application/octet-stream', '.usd': 'application/octet-stream',
  '.ma': 'application/octet-stream', '.blend': 'application/octet-stream',
  '.exr': 'image/x-exr',
}

/** The MIME type for an extension (with its dot, any case); octet-stream when unknown. */
export function guessMimeType(ext) {
  return MIME_BY_EXTENSION[(ext || '').toLowerCase()] || 'application/octet-stream'
}
