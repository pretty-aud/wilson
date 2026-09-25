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
//
// UI overhaul B4c, surface 5 (2026-09-25): the player is the kit Dialog
// (R4-12) on lane B4's sheet, rabbitFiles.css (`rb-vid-`) — the kit's one
// backdrop, surface, radius and shadow, the file's name as its title (as
// stored: a file name is never re-cased) and its Close. 🚨 PORTALLED into
// <body>: the kit Dialog does not portal (B4-KR-2), and of the three popups
// that host FileManager the scene popup centres itself with `transform`,
// which lays a `position: fixed` child out inside its box. On the kit's modal
// stack an Escape is the player's alone, so the layer guards the task popup
// and the asset popup kept for it are gone. Every attribute of the <video>,
// the source logic and every state message are unchanged (C1) — autoplay too.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink } from 'lucide-react'
import { Dialog, Button, Spinner } from '../../../ui'
import '../views/rabbitFiles.css'
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

  // The name as stored. The fallback only titles a row with no name at all.
  const label = file?.stored_name || file?.name || 'File'

  return createPortal(
    <Dialog
      // The form width holds the 480×270 stage; the sheet lets the dialog
      // grow to a video wider than that, so the player keeps its own size.
      width="form"
      className="rb-vid-dialog"
      title={label}
      // 🚨 CLOSE ONLY WHEN THE PRESS *STARTED* ON THE BACKDROP. Dragging the
      // native <video> scrub bar and releasing outside the panel dispatches the
      // resulting `click` on the backdrop — so a plain `onClick={onClose}` shut
      // the player every time someone scrubbed past the edge, which is the
      // single most common gesture in a video preview (found by the pre-push
      // adversarial review). The hand-rolled backdrop recorded where the press
      // began; the kit's backdrop closes on the press itself and only when
      // that press's target IS the backdrop (src/ui/Dialog.jsx), so a drag
      // that began on the scrub bar never closes it. This turns it on.
      dismissOnBackdrop
      onClose={onClose}
      // A click inside the player stays inside it, as the hand-rolled panel's
      // did: through the portal, React would otherwise carry it up through
      // FileManager into the popup that hosts it.
      onClick={(e) => e.stopPropagation()}
    >
      <div className="rb-vid-stage">
        {status === 'unavailable' ? (
          <div className="rb-vid-unavailable">
            <span className="rb-vid-detail">
              {detail}
            </span>
            {managed && onOpenExternally && (
              <Button
                variant="primary"
                size="sm"
                Icon={ExternalLink}
                onClick={() => { onOpenExternally(); onClose?.() }}
              >
                {/* ⚠️ "Show in folder", not "Open in default app". The IPC
                    behind this is rabbit:open-in-explorer →
                    shell.showItemInFolder, which REVEALS the file in
                    Explorer; it does not open it. The old label described a
                    behaviour the button does not have. */}
                Show in folder
              </Button>
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
            className="rb-vid-player"
          />
        ) : (
          // The kit's spinner, under the title that says what is loading
          // (R4-40).
          <Spinner size="lg" />
        )}
      </div>
    </Dialog>,
    document.body,
  )
}
