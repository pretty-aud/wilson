// =============================================================================
// Resources/filePreview.js — what the Files explorer's preview can SHOW for a
// row (post-overhaul S4a, Audrey's E9: "inline previews for images, video
// (the existing player, autoplay OFF), audio, text / markdown / code (≤ 2 MB;
// .md rendered with react-markdown without raw HTML; code via
// react-syntax-highlighter; .html / .svg / .htm shown as escaped text only),
// PDF (the browser's own viewer …); everything else an icon plus Download"),
// and E6 ("remove 3d files viewing for now").
//
// The model is BinInspector's `previewKindFor` (binMedia.js): a closed set of
// kinds, each with what it needs, and 'none' carrying the sentence that says
// why — never a blank stage.
//
// 🚨 MARKUP IS NEVER RENDERED. .html, .htm, .xhtml and .svg (and their mime
// types) are 'text' with `escaped: true`: React writes them as text nodes.
// An SVG is an image format that can carry script, and an HTML file served
// as a document runs on whatever origin serves it — the desktop's loopback
// server is the app's own origin.
// =============================================================================

import { extensionOf } from '../../tools/rabbit_v0.1.0/storage/mediaMetadata'
import { isVideoExtension } from '../../tools/rabbit_v0.1.0/storage/videoThumbnails'

/** E9: text, markdown and code are read whole, up to 2 MB. */
export const PREVIEW_TEXT_MAX = 2 * 1024 * 1024

/** A PDF read into memory (the desktop's own server, below) is capped too. */
export const PREVIEW_PDF_BLOB_MAX = 100 * 1024 * 1024

// What Chromium draws in an <img>. TIFF, PSD, EXR, HEIC and camera raw are
// images it cannot.
const IMAGE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'bmp', 'ico'])
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon', 'image/vnd.microsoft.icon'])
const IMAGE_NOT_DRAWN = new Set(['tif', 'tiff', 'psd', 'psb', 'exr', 'heic', 'heif', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'dpx', 'tga', 'hdr'])
const AUDIO = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba'])
const MARKDOWN = new Set(['md', 'markdown', 'mdown', 'mkd'])
const ESCAPED = new Set(['html', 'htm', 'xhtml', 'svg'])
const ESCAPED_MIME = new Set(['text/html', 'application/xhtml+xml', 'image/svg+xml'])
const THREE_D = new Set(['fbx', 'obj', 'blend', 'ma', 'mb', 'max', 'c4d', 'usd', 'usda', 'usdc', 'usdz', 'abc', 'gltf', 'glb', '3ds', 'stl', 'ply', 'uasset', 'umap'])
const PLAIN = new Set(['txt', 'text', 'log', 'csv', 'tsv', 'fountain', 'srt', 'vtt', 'nfo'])

// Prism's language names (react-syntax-highlighter); unknown → plain text.
export const CODE_LANGUAGE = Object.freeze({
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', tsx: 'tsx', py: 'python', json: 'json', css: 'css',
  scss: 'scss', less: 'less', sh: 'bash', bash: 'bash', zsh: 'bash',
  ps1: 'powershell', bat: 'batch', cmd: 'batch', sql: 'sql', yaml: 'yaml',
  yml: 'yaml', xml: 'markup', fdx: 'markup', java: 'java', c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', cs: 'csharp', go: 'go', rs: 'rust', rb: 'ruby',
  php: 'php', lua: 'lua', glsl: 'glsl', toml: 'toml', ini: 'ini', cfg: 'ini',
  swift: 'swift', kt: 'kotlin', gd: 'gdscript', r: 'r', vb: 'vbnet',
})

const NO_PREVIEW = 'There is no preview for this kind of file.'

function nameOf(row) {
  return row?.name || row?.file_name || row?.original_name || row?.stored_name || ''
}

/**
 * @returns {{ kind: 'image'|'video'|'audio'|'pdf'|'markdown'|'code'|'text'|'none',
 *             language?: string, escaped?: boolean, reason?: string }}
 */
export function previewKindFor(row) {
  const ext = extensionOf(nameOf(row))
  const mime = String(row?.mime_type || row?.type || '').toLowerCase().split(';')[0].trim()
  if (ESCAPED.has(ext) || ESCAPED_MIME.has(mime)) return { kind: 'text', escaped: true }
  if (ext === 'pdf' || mime === 'application/pdf') return { kind: 'pdf' }
  if (IMAGE_NOT_DRAWN.has(ext)) {
    return { kind: 'none', reason: 'WILSON cannot draw this image format here. Open it in its own app.' }
  }
  if (IMAGE.has(ext) || IMAGE_MIME.has(mime)) return { kind: 'image' }
  if (THREE_D.has(ext)) return { kind: 'none', reason: 'There is no 3D preview yet. Download the file to open it.' }
  if (isVideoExtension(`.${ext}`) || mime.startsWith('video/')) return { kind: 'video' }
  if (AUDIO.has(ext) || mime.startsWith('audio/')) return { kind: 'audio' }
  if (MARKDOWN.has(ext) || mime === 'text/markdown') return { kind: 'markdown' }
  if (CODE_LANGUAGE[ext]) return { kind: 'code', language: CODE_LANGUAGE[ext] }
  if (PLAIN.has(ext) || mime.startsWith('text/')) return { kind: 'text' }
  return { kind: 'none', reason: NO_PREVIEW }
}

/** Text kinds are read whole, so they are bounded (E9: ≤ 2 MB). */
export function readsWhole(kind) {
  return kind === 'text' || kind === 'markdown' || kind === 'code'
}

/** True when a row's stored size already says it is past the bound. */
export function tooLargeToRead(row, kind) {
  if (!readsWhole(kind)) return false
  const n = Number(row?.size_bytes)
  return Number.isFinite(n) && n > PREVIEW_TEXT_MAX
}

/**
 * Why there is no URL to show, in words — never a spinner (the brief: "every
 * unavailable state is a sentence"). The provider documents a null fileUrl as
 * "this backend or provider cannot mint one".
 */
export function unavailableSentence(row, adapterMode) {
  if (row?.storage_provider === 's3') return 'Preview isn\'t available yet for files stored in your own bucket. Download it to view it.'
  if (adapterMode === 'fixtures') return 'The dev fixtures hold no file bytes, so there is nothing to preview here.'
  return 'This backend cannot show a preview of this file. Download it to view it.'
}

/** A URL on this app's own origin (the desktop's loopback server). */
export function sameOriginUrl(url) {
  return typeof url === 'string' && url.startsWith('/')
}
