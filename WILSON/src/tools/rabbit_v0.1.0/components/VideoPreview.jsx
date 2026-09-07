// ============================================================
// RABBIT — VideoPreview  (Session 40, NETWORK_STORAGE_DESIGN.md §5d.2)
// ============================================================
//
// Audrey, 2026-08-05: "can we add a way to preview videos on the app?"
//
// TWO SOURCES, and neither is `downloadFile`:
//
//   * MANAGED (desktop) — the Range-capable Express stream route this session
//     added. Local disk, no egress, and Range is what lets the element seek.
//   * CLOUD  — a signed URL from the provider the ROW names. `petal` can mint
//     one; `s3` cannot yet and says so.
//
// 🚨 WHY NOT downloadFile(). It returns a whole Blob. That is right for a
// download and useless here: playback needs a URL to issue Range requests
// against, and a multi-GB master cannot be held in memory at all. Pointing a
// <video> at a Blob URL of the entire file is the "hang, not a slow preview"
// failure §5d.2 names.
//
// 🚨 A FAILED SOURCE IS NAMED, NOT A BLACK RECTANGLE. Chromium plays
// H.264/AAC MP4, VP8/VP9 WebM and AV1 and cannot play ProRes, DNxHD or most
// professional MOV/MXF variants — a large share of what a studio holds. A
// silent failure reads as a broken feature; a named limitation reads as a
// considered one, and "Open in default app" is the path that actually works.
//
// 🚨 THE ERROR MEMORY IS PER-URL, NOT A BOOLEAN — S39's own review finding, one
// bucket over. A signed URL EXPIRES, so a sticky "this failed" flag pins the
// player to an error message that a fresh URL would have fixed. One re-mint on
// error, then the message. Bounded, so a codec nothing can decode does not loop.

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, ExternalLink, Loader2 } from 'lucide-react'
import { useRabbit } from '../state/RabbitProvider'
import { managedStreamUrl } from '../storage/managedVideoThumbnail'

const MAX_REMINTS = 1

// `onOpenExternally` is passed in rather than resolved here: the
// rabbit:open-in-explorer IPC takes a FILE PATH, and the only code that can
// build one is FileManager's own handleDownload — it already folds in
// project.folder_root, the S34 workspace root and the parent-type folder. A
// second path builder in this component is how the two start disagreeing.
export default function VideoPreview({ file, projectId, managed, onClose, onOpenExternally }) {
  const ctx = useRabbit()
  const [src, setSrc] = useState(null)
  const [status, setStatus] = useState('loading') // loading | playing | unavailable
  const [detail, setDetail] = useState(null)
  const remints = useRef(0)
  const backdropPress = useRef(false)

  // 🚨 DEPEND ON THE METHOD, NOT ON `ctx` — S39's review finding, and it is
  // worse here than it was there. RabbitProvider rebuilds its context value
  // with a useMemo whose deps include `bundle`, `presentUsers` and
  // `realtimeStatus`, so `ctx` gets a new identity on ANY state change at all:
  // a collaborator's presence ping, an unrelated optimistic update. Depending
  // on the whole object makes resolveSrc → load → the effect all re-fire, which
  // re-mints the signed URL and hands the <video> a NEW src — restarting
  // playback from the beginning, mid-view, for a reason the viewer cannot see.
  // The useCallback'd method is stable.
  const signFileUrl = ctx?.fileUrl
  const resolveSrc = useCallback(async () => {
    if (managed) return managedStreamUrl(projectId, file.id)
    if (!signFileUrl) return null
    return await signFileUrl(file)
  }, [managed, projectId, file, signFileUrl])

  const load = useCallback(async () => {
    setStatus('loading')
    setDetail(null)
    try {
      const url = await resolveSrc()
      if (!url) {
        setStatus('unavailable')
        // The s3 case, stated rather than mystifying. Same deferral as S44's
        // thumbnail display, and for the same two measured reasons.
        setDetail('Playback isn\'t available yet for media stored in your own bucket.')
        return
      }
      setSrc(url)
    } catch (err) {
      setStatus('unavailable')
      // A signing refusal is a real answer and must not be dressed up as a
      // codec problem.
      setDetail(err?.message || 'Could not open this file.')
    }
  }, [resolveSrc])

  useEffect(() => { load() }, [load])

  const handleError = useCallback(() => {
    // A signed URL that expired between minting and playing looks exactly like
    // an undecodable codec from here — both are just an 'error' event. Re-mint
    // once: if it was expiry the new URL plays, and if it was the codec the
    // second failure is the honest answer.
    if (!managed && remints.current < MAX_REMINTS) {
      remints.current += 1
      setSrc(null)
      load()
      return
    }
    setStatus('unavailable')
    // ⚠️ THE SENTENCE MATCHES THE CONTROL THAT IS ACTUALLY RENDERED. The
    // "open it elsewhere" button only exists for a managed file — a cloud row
    // is a blob in a bucket with nothing on this machine to open — so telling a
    // cloud user to do that was an instruction with no control behind it.
    setDetail(managed
      ? 'Preview isn\'t available for this format. Open it from its folder instead.'
      : 'Preview isn\'t available for this format. Download it to view it.')
  }, [managed, load])

  const label = file?.stored_name || file?.name || 'file'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ backgroundColor: 'rgba(0,0,0,0.72)' }}
      // 🚨 CLOSE ONLY WHEN THE PRESS *STARTED* ON THE BACKDROP. Dragging the
      // native <video> scrub bar and releasing outside the panel dispatches the
      // resulting `click` on the backdrop — so a plain `onClick={onClose}` shut
      // the player every time someone scrubbed past the edge, which is the
      // single most common gesture in a video preview. Recording where the
      // press began separates "clicked the backdrop to dismiss" from "finished
      // a drag out here". Found by the pre-push adversarial review.
      onMouseDown={(e) => { backdropPress.current = e.target === e.currentTarget }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropPress.current) onClose?.()
        backdropPress.current = false
      }}
    >
      <div
        className="rounded-sm overflow-hidden flex flex-col"
        style={{
          backgroundColor: '#1c1917',
          border: '1px solid #44403c',
          maxWidth: '90vw',
          maxHeight: '86vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between gap-4 px-3 py-1.5"
          style={{ borderBottom: '1px solid #44403c', backgroundColor: '#292524' }}
        >
          <span className="text-[10px] font-mono uppercase tracking-wider truncate" style={{ color: '#fb923c' }}>
            {label}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="p-0.5 rounded-sm hover:bg-stone-700"
            style={{ color: '#a8a29e' }}
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center justify-center" style={{ minWidth: 480, minHeight: 270 }}>
          {status === 'unavailable' ? (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <span className="text-[11px] font-mono" style={{ color: '#d6d3d1', maxWidth: 380 }}>
                {detail}
              </span>
              {managed && onOpenExternally && (
                <button
                  type="button"
                  onClick={() => { onOpenExternally(); onClose?.() }}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-sm hover:brightness-110"
                  style={{ color: '#fff7ed', backgroundColor: '#ea580c', border: '1px solid #c2410c' }}
                >
                  <ExternalLink className="w-3 h-3" />
                  {/* ⚠️ "Show in folder", not "Open in default app". The IPC
                      behind this is rabbit:open-in-explorer →
                      shell.showItemInFolder, which REVEALS the file in
                      Explorer; it does not open it. The old label described a
                      behaviour the button does not have. */}
                  Show in folder
                </button>
              )}
            </div>
          ) : src ? (
            <video
              key={src}
              src={src}
              controls
              autoPlay
              // Same reason as the thumbnail path: set BEFORE the source is
              // fetched, and required the day an s3 presigned URL lands here.
              crossOrigin="anonymous"
              onError={handleError}
              // A successful load means the previous failure was transient, so
              // the re-mint budget refills. Without this, MAX_REMINTS is a
              // budget for the whole modal session: one early hiccup and the
              // NEXT expiry — an hour into a long cut — is reported to the
              // viewer as a codec problem, which it is not.
              onLoadedData={() => { remints.current = 0; setStatus('playing') }}
              style={{ maxWidth: '86vw', maxHeight: '72vh', display: 'block', backgroundColor: '#000' }}
            />
          ) : (
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: '#78716c' }} />
          )}
        </div>
      </div>
    </div>
  )
}
