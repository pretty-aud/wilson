// MothBloom.jsx — MO2: the hover preview (the brief §4.1: "like looking back through memories"). Rest on a dot about
// half a second and a preview blooms out; press to drag and it is gone at once (the world says so); move away and
// it fades. An image shows larger, a video plays silently, a note or a markdown file shows its first lines.
//
// What it may fetch is bounded and inert: one URL for the dot it rests on, kept for its life, so resting again asks
// nothing; text read only as far as its first few kilobytes, shown as text, never as markup. A file on the
// company's office server, in a browser, says "Preview available on the desktop app" and asks nothing (the brief
// §9), and a file kept on another computer says so too.
import { useEffect, useRef, useState } from 'react'
import { DESKTOP_PREVIEW_SENTENCE } from '../../rabbit_v0.1.0/storage/desktopFileOps.js'

export const TEXT_PEEK_BYTES = 8192
const URL_LIFE_MS = 45 * 60 * 1000
const urls = new Map() // `${kind}:${file id}` -> { url, until }
const HERE_ONLY = 'This file is kept on the computer that added it.'
const KIND_WORD = { project: 'Project', folder: 'Folder', phase: 'Phase', scene: 'Scene', shot: 'Shot', asset: 'Asset', task: 'Task', level: 'Level', experience: 'Experience', tag: 'Tag' }

export function previewKind(file) {
  const mime = String(file?.mime_type ?? '')
  const name = String(file?.name ?? '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('text/') || /\.(md|markdown|txt)$/.test(name)) return 'text'
  return file?.thumbnail_url ? 'image' : 'none'
}

/** Why there is nothing to fetch here, or null. */
export function noPreviewReason(file, { onDesktop }) {
  if (!file) return null
  if (file.storage_provider === 'network_share' && !onDesktop) return DESKTOP_PREVIEW_SENTENCE
  if (file.storage_provider === 'local_server' && !onDesktop) return HERE_ONLY
  return null
}

async function urlFor(adapter, file, kind) {
  const key = `${kind}:${file.id}`
  const kept = urls.get(key)
  if (kept && kept.until > Date.now()) return kept.url
  let url = null
  if (kind === 'thumb' && file.thumbnail_url && typeof adapter.thumbnailUrls === 'function') {
    const map = await adapter.thumbnailUrls([file.thumbnail_url], { provider: file.storage_provider })
    url = map?.get?.(file.thumbnail_url) ?? null
  } else if (typeof adapter.fileUrl === 'function') {
    url = await adapter.fileUrl(file, { stream: kind === 'video' })
  }
  if (url) urls.set(key, { url, until: Date.now() + URL_LIFE_MS })
  return url
}

/** A text file's first few kilobytes, as text: the read stops at TEXT_PEEK_BYTES whatever the file's size. */
async function peek(url, signal) {
  const res = await fetch(url, { signal, credentials: 'omit' })
  if (!res.ok || !res.body) return ''
  const reader = res.body.getReader()
  const parts = []
  let got = 0
  while (got < TEXT_PEEK_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    got += value.length
  }
  reader.cancel().catch(() => {})
  const bytes = new Uint8Array(Math.min(got, TEXT_PEEK_BYTES))
  let at = 0
  for (const p of parts) { const slice = p.subarray(0, bytes.length - at); bytes.set(slice, at); at += slice.length; if (at >= bytes.length) break }
  return new TextDecoder().decode(bytes).split(/\r?\n/).slice(0, 8).join('\n')
}

function Preview({ node, file, adapter, onDesktop }) {
  const [src, setSrc] = useState(null)
  const [text, setText] = useState('')
  const [failed, setFailed] = useState(false)
  const kind = file ? previewKind(file) : 'none'
  const reason = noPreviewReason(file, { onDesktop })
  useEffect(() => {
    if (!file || reason || kind === 'none') return undefined
    let live = true
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    ;(async () => {
      const url = await urlFor(adapter, file, kind === 'image' && file.thumbnail_url ? 'thumb' : kind)
      if (!live || !url) return
      if (kind === 'text') setText(await peek(url, ctrl?.signal))
      else setSrc(url)
    })().catch(() => { if (live) setFailed(true) })
    return () => { live = false; ctrl?.abort() }
  }, [file, kind, reason, adapter])

  if (!file) {
    return (
      <div className="moth-bloom-body">
        <span className="moth-quiet">{KIND_WORD[node?.kind] ?? ''}</span>
        <span className="moth-bloom-title">{node?.label || '(no name)'}</span>
      </div>
    )
  }
  return (
    <div className="moth-bloom-body">
      {reason && <p className="moth-quiet" data-moth-bloom-desktop>{reason}</p>}
      {!reason && kind === 'image' && src && <img className="moth-bloom-media" src={src} alt="" />}
      {!reason && kind === 'video' && src && (
        <video className="moth-bloom-media" src={src} muted autoPlay loop playsInline preload="metadata" disablePictureInPicture />
      )}
      {!reason && kind === 'text' && text && <pre className="moth-bloom-text">{text}</pre>}
      {!reason && failed && <p className="moth-quiet">No preview just now.</p>}
      <span className="moth-bloom-title">{file.name}</span>
    </div>
  )
}

/** The bloom at { x, y, r } beside its dot; when `at` goes, the last one fades before it leaves. */
export default function MothBloom({ at, node, file, adapter, onDesktop }) {
  const [shown, setShown] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const timer = useRef(null)
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (at) { setShown({ at, node, file }); setLeaving(false); return undefined }
    if (!shown) return undefined
    setLeaving(true)
    timer.current = setTimeout(() => { setShown(null); setLeaving(false) }, 220)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // A new `at` is a new bloom; the node and file travel with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])
  if (!shown) return null
  return (
    <div
      className={`moth-bloom${leaving ? ' is-leaving' : ''}`}
      style={{ left: shown.at.x + shown.at.r + 12, top: shown.at.y - 12 }}
      role="tooltip"
      data-moth-bloom
    >
      <Preview node={shown.node} file={shown.file} adapter={adapter} onDesktop={onDesktop} />
    </div>
  )
}
