// =============================================================================
// Resources/FilePreviewDialog.jsx — the Files explorer's preview (post-overhaul
// S4a, Audrey's E9, E13 and E14).
//
// One Dialog, the kit's largest (`workbench`, 960 — a full-window lightbox is
// filed as a kit request, not built), over the file the person double-clicked,
// pressed Enter on, or chose Preview for. What it shows comes from
// previewKindFor (filePreview.js): an <img>, VideoPreview's own player
// (VideoStage, autoplay OFF), an <audio>, a text / markdown / code reading
// (≤ 2 MB, markup never rendered), the browser's PDF viewer, or the "no
// preview available" card. Every state that cannot show the file says why in
// a sentence (an s3 body, the dev fixtures, a format the browser cannot draw).
//
// E14, from Google Drive's preview — BORROWED: previous / next with the arrow
// keys over the list the person was looking at (and the two chevrons, for the
// pointer); the actions where the eye starts, at the top (Download — or, for
// a file already on this computer, Show in folder and Open in default app);
// the "no preview available" card with its action in it; Escape closes
// (the kit Dialog's). NOT BORROWED: the full-window dark lightbox (the kit
// has no such surface — the request is in the hand-off), "Open with" and its
// app list (the desktop has one "default app"), print, zoom, comments and
// sharing.
//
// E13: a preview is a read. The cloud logs it through log_file_downloaded,
// once per file per session (the explorer's onRead); the Local Server's
// stream route logs it itself, throttled to one a minute.
//
// The per-URL error memory and the one re-mint are VideoPreview's: a signed
// URL EXPIRES, so a failure re-mints once before it is called a format
// problem, and a success refills the budget.
//
// Laws of UX (applied): Jakob's Law — Drive's conventions above, so the
// keys and the card are already known; Fitts's Law — the chevrons sit at the
// stage's top-left, beside the position ("3 of 12"), the actions at its
// top-right, one place for every file; Doherty Threshold — the kit Spinner
// the moment a source is being fetched, then the file; Selective Attention —
// the stage is the largest thing on screen and nothing animates in it
// (no autoplay).
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, FileQuestion } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Dialog, EmptyState, IconButton, Spinner } from '../../ui'
import { useRabbit } from '../../tools/rabbit_v0.1.0/state/RabbitProvider'
import { VideoStage } from '../../tools/rabbit_v0.1.0/components/VideoPreview'
import { managedStreamUrl } from '../../tools/rabbit_v0.1.0/storage/managedVideoThumbnail'
import { formatBytes } from '../../cloud/workspaceStorage'
import {
  PREVIEW_TEXT_MAX, PREVIEW_PDF_BLOB_MAX, previewKindFor, readsWhole, tooLargeToRead,
  unavailableSentence, sameOriginUrl,
} from './filePreview'

const MAX_REMINTS = 1

/** Keys a focused control keeps for itself: arrows move the caret or seek. */
function keepsArrows(target) {
  if (!target || typeof target.closest !== 'function') return false
  return !!target.closest('input, textarea, select, video, audio, [contenteditable="true"], [role="slider"]')
}

export default function FilePreviewDialog({
  items = [],
  index = 0,
  onIndex,
  onClose,
  projectId,
  adapterMode,
  actionsFor,
  onRead,
  onReveal,
}) {
  const node = items[index] || null
  const count = items.length
  const go = useCallback((step) => {
    if (count < 2) return
    onIndex?.((index + step + count) % count)
  }, [count, index, onIndex])

  if (!node) return null
  const m = node.meta || {}
  const size = formatBytes(m.sizeBytes)
  const subtitle = [count > 1 ? `${index + 1} of ${count}` : null, m.type, size].filter(Boolean).join(' · ')
  const kind = previewKindFor(node.row).kind

  // PORTALLED into <body>, as VideoPreview is: the kit Dialog does not portal
  // (B4-KR-2), and a transformed ancestor would lay its fixed backdrop out
  // inside the host's box. React still carries the events through the tree.
  return createPortal(
    <Dialog
      width="workbench"
      title={node.name}
      subtitle={subtitle}
      onClose={onClose}
      className="fx-pv-dialog"
      data-file-preview={node.id}
      onKeyDown={(e) => {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
        if (keepsArrows(e.target)) return
        e.preventDefault()
        go(e.key === 'ArrowLeft' ? -1 : 1)
      }}
    >
      <div className="fx-pv-bar">
        <div className="fx-pv-nav">
          <IconButton size="sm" icon={ChevronLeft} title="Previous file (←)" onClick={() => go(-1)} disabled={count < 2} data-pv-prev />
          <IconButton size="sm" icon={ChevronRight} title="Next file (→)" onClick={() => go(1)} disabled={count < 2} data-pv-next />
        </div>
        <div className="fx-pv-actions">{actionsFor?.(node)}</div>
      </div>
      <div className="fx-pv-stage" data-kind={kind}>
        <PreviewStage
          key={node.id}
          node={node}
          projectId={projectId}
          adapterMode={adapterMode}
          onRead={onRead}
          onReveal={onReveal}
          onClose={onClose}
          actions={actionsFor?.(node)}
        />
      </div>
    </Dialog>,
    document.body,
  )
}

function PreviewStage({ node, projectId, adapterMode, onRead, onReveal, onClose, actions }) {
  const row = node.row || {}
  const managed = node.meta?.source === 'managed'
  const pk = useMemo(() => previewKindFor(row), [row])
  if (pk.kind === 'none') {
    return <NoPreview reason={pk.reason} actions={actions} />
  }
  if (pk.kind === 'video') {
    return (
      <div className="fx-pv-video">
        <VideoStage
          file={row}
          projectId={projectId}
          managed={managed}
          autoPlay={false}
          onClose={onClose}
          onOpenExternally={managed ? () => onReveal?.(node) : undefined}
          onSourceReady={() => onRead?.(row)}
        />
      </div>
    )
  }
  if (tooLargeToRead(row, pk.kind)) {
    return <NoPreview reason={`This file is too large to preview here (over ${formatBytes(PREVIEW_TEXT_MAX)}).`} actions={actions} />
  }
  return <SourcedStage node={node} pk={pk} projectId={projectId} adapterMode={adapterMode} onRead={onRead} actions={actions} />
}

/** Drive's "no preview available" card: the icon, the reason, the action. */
function NoPreview({ reason, actions }) {
  return (
    <EmptyState Icon={FileQuestion} title="No preview available" body={reason}>
      {actions}
    </EmptyState>
  )
}

function SourcedStage({ node, pk, projectId, adapterMode, onRead, actions }) {
  const ctx = useRabbit()
  const row = node.row || {}
  const managed = node.meta?.source === 'managed'
  const signFileUrl = ctx?.fileUrl
  // The row OBJECT changes on every refetch; the source must not (a new URL
  // would reload the stage). Depend on what identifies the body.
  const rowRef = useRef(row)
  rowRef.current = row
  const onReadRef = useRef(onRead)
  onReadRef.current = onRead
  const remints = useRef(0)
  const [state, setState] = useState({ status: 'loading', url: null, detail: null })

  const resolve = useCallback(async () => {
    if (managed) return managedStreamUrl(projectId, rowRef.current.id)
    if (!signFileUrl) return null
    return await signFileUrl(rowRef.current)
  }, [managed, projectId, row.id, row.storage_path, signFileUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setState({ status: 'loading', url: null, detail: null })
    try {
      const url = await resolve()
      if (!url) {
        setState({ status: 'unavailable', url: null, detail: unavailableSentence(rowRef.current, adapterMode) })
        return
      }
      setState({ status: 'ready', url, detail: null })
      onReadRef.current?.(rowRef.current)
    } catch (err) {
      // A signing refusal is a real answer, not a format problem.
      setState({ status: 'unavailable', url: null, detail: err?.message || 'Could not open this file.' })
    }
  }, [resolve, adapterMode])

  useEffect(() => { load() }, [load])

  const fail = useCallback(() => {
    if (!managed && remints.current < MAX_REMINTS) {
      remints.current += 1
      load()
      return
    }
    setState({
      status: 'unavailable',
      url: null,
      detail: managed
        ? 'Preview isn\'t available for this file. Open it from its folder instead.'
        : 'Preview isn\'t available for this file. Download it to view it.',
    })
  }, [managed, load])
  const ok = useCallback(() => { remints.current = 0 }, [])

  if (state.status === 'loading') return <div className="fx-pv-center"><Spinner size="lg" /></div>
  if (state.status === 'unavailable') return <NoPreview reason={state.detail} actions={actions} />

  const url = state.url
  if (pk.kind === 'image') {
    return <img src={url} alt={node.name} className="fx-pv-image" onError={fail} onLoad={ok} data-pv-image />
  }
  if (pk.kind === 'audio') {
    return (
      <div className="fx-pv-center">
        <audio src={url} controls className="fx-pv-audio" onError={fail} onLoadedData={ok} data-pv-audio />
      </div>
    )
  }
  if (pk.kind === 'pdf') return <PdfStage url={url} name={node.name} onFail={fail} actions={actions} />
  if (readsWhole(pk.kind)) return <TextStage url={url} pk={pk} name={node.name} onFail={fail} onOk={ok} actions={actions} />
  return <NoPreview reason="There is no preview for this kind of file." actions={actions} />
}

/**
 * The browser's own PDF viewer. A signed cloud URL goes straight into the
 * frame. The desktop's loopback server answers anything that is not media as
 * an opaque download (safeMediaContentType — a same-origin execution defence),
 * so a PDF from it is read into memory (bounded) and handed to the viewer as
 * a typed blob instead of weakening that rule.
 */
function PdfStage({ url, name, onFail, actions }) {
  const [frameSrc, setFrameSrc] = useState(sameOriginUrl(url) ? null : url)
  const [tooLarge, setTooLarge] = useState(false)
  useEffect(() => {
    if (!sameOriginUrl(url)) { setFrameSrc(url); return undefined }
    const ctrl = new AbortController()
    let made = null
    ;(async () => {
      try {
        const res = await fetch(url, { credentials: 'same-origin', signal: ctrl.signal })
        if (!res.ok) { onFail(); return }
        const declared = Number(res.headers.get('content-length'))
        if (Number.isFinite(declared) && declared > PREVIEW_PDF_BLOB_MAX) { setTooLarge(true); ctrl.abort(); return }
        const blob = await res.blob()
        if (blob.size > PREVIEW_PDF_BLOB_MAX) { setTooLarge(true); return }
        made = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }))
        setFrameSrc(made)
      } catch (err) {
        if (err?.name !== 'AbortError') onFail()
      }
    })()
    return () => { ctrl.abort(); if (made) URL.revokeObjectURL(made) }
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  if (tooLarge) return <NoPreview reason={`This PDF is too large to preview here (over ${formatBytes(PREVIEW_PDF_BLOB_MAX)}).`} actions={actions} />
  if (!frameSrc) return <div className="fx-pv-center"><Spinner size="lg" /></div>
  return <iframe src={frameSrc} title={name} className="fx-pv-frame" data-pv-pdf />
}

/** Text, markdown and code: read whole (≤ 2 MB), never rendered as markup. */
function TextStage({ url, pk, name, onFail, onOk, actions }) {
  const [text, setText] = useState(null)
  const [tooLarge, setTooLarge] = useState(false)
  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const res = await fetch(url, { credentials: sameOriginUrl(url) ? 'same-origin' : 'omit', signal: ctrl.signal })
        if (!res.ok) { onFail(); return }
        const declared = Number(res.headers.get('content-length'))
        if (Number.isFinite(declared) && declared > PREVIEW_TEXT_MAX) { setTooLarge(true); ctrl.abort(); return }
        const blob = await res.blob()
        if (blob.size > PREVIEW_TEXT_MAX) { setTooLarge(true); return }
        setText(await blob.text())
        onOk()
      } catch (err) {
        if (err?.name !== 'AbortError') onFail()
      }
    })()
    return () => ctrl.abort()
  }, [url]) // eslint-disable-line react-hooks/exhaustive-deps
  if (tooLarge) return <NoPreview reason={`This file is too large to preview here (over ${formatBytes(PREVIEW_TEXT_MAX)}).`} actions={actions} />
  if (text == null) return <div className="fx-pv-center"><Spinner size="lg" /></div>
  if (pk.kind === 'markdown') {
    return (
      <div className="fx-pv-reading" data-pv-markdown>
        {/* No raw HTML (skipHtml); links are shown, not followed (a click
            would navigate the app's own window); images are named, not
            fetched (a preview must not make requests on a file's behalf). */}
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            a: ({ children, href }) => <span className="fx-pv-link" title={href || undefined}>{children}</span>,
            img: ({ alt }) => <span className="fx-pv-img-alt">{alt ? `[image: ${alt}]` : '[image]'}</span>,
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    )
  }
  if (pk.kind === 'code') {
    return (
      <div className="fx-pv-code" data-pv-code={pk.language}>
        <SyntaxHighlighter language={pk.language} style={oneDark} wrapLongLines customStyle={{ margin: 0, background: 'var(--color-paper-recessed)' }}>
          {text}
        </SyntaxHighlighter>
      </div>
    )
  }
  // Plain text, and the markup that is never rendered (.html, .svg): React
  // writes it as text nodes.
  return <pre className="fx-pv-text" data-pv-text={pk.escaped ? 'escaped' : 'plain'} aria-label={name}>{text}</pre>
}
