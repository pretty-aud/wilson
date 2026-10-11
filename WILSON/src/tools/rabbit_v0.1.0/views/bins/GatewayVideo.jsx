// ============================================================
// RABBIT — Bins: the player, through the gateway (GW3)
// ============================================================
//
// One <video> (or <audio>, or <img> for a still the gateway serves), the
// kit's own, with four things around it that GATEWAY_DESIGN.md §5 and §7
// ask of a browser and a bare element cannot do:
//
//   the hand-over    the cloud picture (BinPoster, signed per read) stays
//                    on screen until the element fires `loadeddata`; then the
//                    picture goes under the video — no blank frame (Doherty)
//   the renewal      at 75 s the stream is renewed with its first ticket's
//                    jti (§5 step 7): the URL never changes, so the element
//                    keeps every byte it buffered
//   the recovery     a 401 is NEVER retried with the same ticket: the failure
//                    is diagnosed with a HEAD on a fresh ticket (a <video>
//                    reads no status), and a stale ticket gets a new src at
//                    the same currentTime, once; a 404 is the clip missing at
//                    its location (the row flips), a 415 or a decode failure
//                    is NEEDS_DESKTOP_FORMAT (G7, D8: no transcoding)
//   the mark (D9)    over REMOTE playback only (the door the probe reached was
//                    the outside one): the viewer's display name, a six-
//                    character member code they cannot change (the first six
//                    characters of the user id; a display name is the
//                    person's own to set), and the clock time, in the kit's
//                    small label step at 55% white on a soft dark backing, no
//                    blur (the kit bans it), one of five positions moved every
//                    30 s so a cropped recording still carries it part of the
//                    time. Inside the office: no mark (G6, G8). It is a
//                    visible deterrent and an attribution a determined viewer
//                    can remove with the browser's tools; the audit row (§6)
//                    is the durable record.
//
// Fullscreen goes through the wrapper (requestFullscreen on the container,
// never the element), so the mark stays; the native fullscreen button is
// therefore off (`nofullscreen`) and the wrapper offers its own; picture-in-
// picture is disabled (it would show the bare element). COSMETIC, and said
// so: `controlsList="nodownload noremoteplayback"` and the suppressed
// context menu remove the obvious Save as…, nothing more — the ticket in the
// URL is the only authority over the bytes (§5 step 6).
//
// Laws of UX (laws-of-ux, design-direction): Selective attention — the mark
// never covers the controls (the lower positions sit above the control
// strip); Jakob — the player is the kit's <video controls>, the mark its one
// addition; Doherty — the hand-over shows no blank frame; Peak-end — the
// first remote play says nothing; the audit does.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2 } from 'lucide-react'
import BinPoster from './BinPoster'
import { C, IconBtn } from './binUi'
import { RENEW_AFTER_MS } from '../../bins/gatewayDoors'
import { NEEDS_DESKTOP_FORMAT, GATEWAY_LOADING, gatewayMissingSentence } from '../../bins/binLocations'

/** The five positions (§7), in the order the mark moves through them. */
export const MARK_POSITIONS = Object.freeze(['top-left', 'top-right', 'bottom-right', 'bottom-left', 'centre'])
export const MARK_MOVE_MS = 30_000
/** A failed renewal is tried again this soon: a blip at the 75 s mark must not let the stream's authority run out. */
export const RENEW_RETRY_MS = 10_000
/** No ticket, and the cloud said why not (a clip it does not know, or it refused). */
const NO_STREAM_SENTENCE = 'This clip cannot be played here right now.'

// One gateway player sounds at a time: the inspector's preview and the large
// player (Space) can both hold the same clip, and starting one pauses the
// other (two soundtracks of one clip, or two clips, is never what was meant).
let playingMedia = null
function claimPlayback(m) {
  if (playingMedia && playingMedia !== m && !playingMedia.paused) {
    try { playingMedia.pause() } catch { /* gone */ }
  }
  playingMedia = m
}
function releasePlayback(m) { if (playingMedia === m) playingMedia = null }
/** The control strip's height the lower positions stay clear of (Selective attention). */
const CONTROLS_CLEARANCE_PX = 48

/** The six-character member code: the first six characters of the user id, which the viewer cannot change (R13). */
export function memberCodeOf(userId) {
  return String(userId || '').replace(/[^0-9a-zA-Z]/g, '').slice(0, 6).toLowerCase()
}
export function clockWords(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
/** "Priya Nair · 3f9a2c · 14:02" — never the email. */
export function markWords(viewer, date = new Date()) {
  const name = String(viewer?.name || '').trim() || 'a viewer'
  const code = memberCodeOf(viewer?.userId) || '------'
  return `${name} · ${code} · ${clockWords(date)}`
}

// The five positions as classes (bins.css draws them; the lower two sit
// above the control strip, CONTROLS_CLEARANCE_PX, so the mark never covers a
// control — Selective attention).
export const POSITION_CLASS = Object.freeze({
  'top-left': 'bn-mark-tl', 'top-right': 'bn-mark-tr', 'bottom-right': 'bn-mark-br', 'bottom-left': 'bn-mark-bl', centre: 'bn-mark-c',
})

/** The mark: drawn by the player when the door is `outside`, moved every 30 s, the clock kept to the minute. */
export function ViewerMark({ viewer, now = () => Date.now() }) {
  const [pos, setPos] = useState(0)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const move = setInterval(() => setPos(p => (p + 1) % MARK_POSITIONS.length), MARK_MOVE_MS)
    const clock = setInterval(() => setTick(t => t + 1), 15_000)
    return () => { clearInterval(move); clearInterval(clock) }
  }, [])
  void tick
  void CONTROLS_CLEARANCE_PX
  return (
    <span className={`bn-viewer-mark text-label uppercase rounded-control ${POSITION_CLASS[MARK_POSITIONS[pos]]}`} data-testid="viewer-mark" aria-hidden="true">
      {markWords(viewer, new Date(now()))}
    </span>
  )
}

/**
 * @param row        the clip row (for the poster and its kind)
 * @param src        the stream URL (null while the ticket is on its way: the picture and "loading")
 * @param kind       'video' | 'audio' | 'image'
 * @param stream     { door: 'inside'|'outside', jti, refused, missing, ticketError } (gatewayStreamInfo)
 * @param viewer     { name, userId } for the mark
 * @param onRenew    (id) → { ok }      §5 step 7, every renewAfterMs
 * @param onFreshSrc (id) → url|null   a stale ticket: a new src at the same currentTime
 * @param onDiagnose (id) → { verdict } what a <video> could not say
 */
export default function GatewayVideo({
  row, src, kind = 'video', stream = null, viewer = null, poster = null,
  controls = true, autoPlay = false, muted = false, loop = false, preload = 'metadata', playsInline = true,
  mediaRef = null, onPlay, onPause, onLoaded, onFailed, onRenew, onFreshSrc, onDiagnose,
  renewAfterMs = RENEW_AFTER_MS, locationName = null, className = '', style = {}, fit = 'contain', children = null,
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(null) // null | 'format' | 'ticket' | 'missing' | 'unreachable' | 'busy' | 'no_stream'
  const [override, setOverride] = useState(null) // the fresh src after a stale ticket
  const containerRef = useRef(null)
  const ownRef = useRef(null)
  const recoveredRef = useRef(false)
  const resumeAtRef = useRef(null)
  const resumePlayRef = useRef(false)
  // Where this clip was and whether it played, kept across a src change: a
  // fresh ticket for the SAME clip (the held one reached its margin) gives
  // a new URL, and the viewer goes on from the same moment, not from zero.
  const lastRef = useRef({ id: null, t: 0, playing: false })
  const el = () => (mediaRef && 'current' in mediaRef ? mediaRef.current : ownRef.current)
  const setEl = (node) => {
    if (!node && ownRef.current) releasePlayback(ownRef.current)
    ownRef.current = node
    if (mediaRef && 'current' in mediaRef) mediaRef.current = node
  }
  const effectiveSrc = override || src

  // A new clip or a new src from the parent: the picture back on top, the
  // recovery allowed again; the same clip resumes where it was.
  useEffect(() => {
    const last = lastRef.current
    const same = !!row?.id && last.id === row.id && last.t > 0
    setLoaded(false); setFailed(null); setOverride(null); recoveredRef.current = false
    resumeAtRef.current = same ? last.t : null
    resumePlayRef.current = same && last.playing
  }, [row?.id, src])
  const remember = (m, playing) => {
    if (!m || !row?.id) return
    lastRef.current = { id: row.id, t: Number.isFinite(m.currentTime) ? m.currentTime : 0, playing: playing ?? !m.paused }
  }

  // §5 step 7: the renewal, while a stream plays through a door: every
  // renewAfterMs after a success, again in RENEW_RETRY_MS after a failure.
  // The callback is read through a ref: the parent hands a new function on
  // every provider update (the tab's 60 s re-read among them), and a timer
  // keyed on it would start again from zero each time and never reach 75 s
  // (measured against GW2's gateway: no renewal in 80 s).
  const onRenewRef = useRef(onRenew)
  onRenewRef.current = onRenew
  const canRenew = typeof onRenew === 'function'
  useEffect(() => {
    if (!effectiveSrc || !stream?.door || !canRenew || failed) return undefined
    let live = true
    let timer = null
    const run = () => {
      let p
      try { p = Promise.resolve(onRenewRef.current?.(row.id)) } catch { p = Promise.resolve({ ok: false }) }
      p.catch(() => ({ ok: false })).then((r) => {
        if (!live) return
        timer = setTimeout(run, r && r.ok === false ? Math.min(RENEW_RETRY_MS, renewAfterMs) : renewAfterMs)
      })
    }
    timer = setTimeout(run, renewAfterMs)
    return () => { live = false; if (timer) clearTimeout(timer) }
  }, [effectiveSrc, stream?.door, canRenew, renewAfterMs, row?.id, failed])

  const onLoadedData = useCallback(() => {
    setLoaded(true)
    const m = el()
    if (m && resumeAtRef.current != null) {
      try { m.currentTime = resumeAtRef.current } catch { /* not seekable yet */ }
      if (resumePlayRef.current && typeof m.play === 'function') Promise.resolve().then(() => m.play()).catch(() => {})
      resumeAtRef.current = null
      resumePlayRef.current = false
    }
    onLoaded?.()
  }, [onLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const onError = useCallback(async () => {
    const m = el()
    const at = m && Number.isFinite(m.currentTime) ? m.currentTime : 0
    // A <video> says nothing about why: ask the door with a fresh ticket.
    const r = typeof onDiagnose === 'function' ? await Promise.resolve(onDiagnose(row.id)).catch(() => ({ verdict: 'unreachable' })) : { verdict: 'format' }
    const verdict = r?.verdict || 'unreachable'
    if (verdict === 'ticket' && !recoveredRef.current && typeof onFreshSrc === 'function') {
      // Never the same ticket again: a fresh one, a new src at the same currentTime, once.
      recoveredRef.current = true
      const fresh = await Promise.resolve(onFreshSrc(row.id)).catch(() => null)
      if (fresh) { resumeAtRef.current = at; setLoaded(false); setOverride(fresh); return }
      setFailed('ticket'); onFailed?.('ticket'); return
    }
    if (verdict === 'ok') {
      // The door serves the bytes and the browser could not decode them: the format (G7).
      setFailed('format'); onFailed?.('format'); return
    }
    setFailed(verdict); onFailed?.(verdict)
  }, [onDiagnose, onFreshSrc, onFailed, row?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const fullscreen = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    if (document.fullscreenElement) { document.exitFullscreen?.(); return }
    // The CONTAINER, never the element: the mark stays over the picture.
    c.requestFullscreen?.()
  }, [])

  // No src and the cloud refused this clip's ticket (the viewer removed or
  // signed out, the switch off; the renewal failed the same way) or named
  // the clip missing: the refusal's own sentence, not "loading" for good.
  // D22's one word is for a ticket on its way.
  const refusedTicket = !effectiveSrc && !failed && !stream?.pending
    ? (stream?.ticketError || (stream?.missing ? NO_STREAM_SENTENCE : null))
    : null
  const sentence = failed === 'format' ? NEEDS_DESKTOP_FORMAT
    : failed === 'missing' ? gatewayMissingSentence(locationName)
      : failed === 'ticket' ? (stream?.ticketError || 'The clip\'s ticket could not be renewed; sign in again if this keeps happening.')
        : failed === 'busy' ? 'The gateway is busy; try again in a moment.'
          : failed === 'unreachable' ? 'This browser cannot reach the gateway just now.'
            : failed === 'no_stream' ? NO_STREAM_SENTENCE : refusedTicket
  const remote = stream?.door === 'outside'
  const showPoster = !loaded || !!failed || kind !== 'video'
  // The element is transparent until its first frame (bins.css, by the
  // data-loaded state), so the picture under it shows: the hand-over.
  const mediaClass = `bn-gateway-media absolute inset-0 w-full h-full ${fit === 'contain' ? 'object-contain' : 'object-cover'}`
  // Cosmetic, and said so (the header): no Save as…, no cast, no PiP; the ticket is the authority.
  const cosmetic = { controlsList: 'nodownload noremoteplayback nofullscreen', disablePictureInPicture: true, disableRemotePlayback: true, onContextMenu: (e) => e.preventDefault() }

  return (
    <div ref={containerRef} className={`bn-gateway-player relative overflow-hidden ${className}`} style={style}
      data-testid="gateway-player" data-loaded={loaded && !failed ? 'true' : undefined}
      onDoubleClick={kind === 'video' ? fullscreen : undefined}>
      {showPoster && (
        <BinPoster row={row} src={poster} width="100%" height="100%" radius={0} iconSize={40} contain={fit === 'contain'} style={{ border: 'none', position: 'absolute', inset: 0, zIndex: 0, backgroundColor: 'transparent' }} />
      )}
      {effectiveSrc && !failed && kind === 'video' && (
        <video ref={setEl} key={effectiveSrc} src={effectiveSrc} controls={controls} autoPlay={autoPlay} muted={muted} loop={loop} preload={preload} playsInline={playsInline}
          onLoadedData={onLoadedData} onError={onError} onTimeUpdate={(e) => remember(e.currentTarget)}
          onPlay={(e) => { claimPlayback(e.currentTarget); remember(e.currentTarget, true); onPlay?.(e) }} onPause={(e) => { remember(e.currentTarget, false); onPause?.(e) }}
          className={mediaClass} {...cosmetic} />
      )}
      {effectiveSrc && !failed && kind === 'audio' && (
        <audio ref={setEl} key={effectiveSrc} src={effectiveSrc} controls={controls} autoPlay={autoPlay} muted={muted} loop={loop} preload={preload}
          onLoadedData={onLoadedData} onError={onError} onTimeUpdate={(e) => remember(e.currentTarget)}
          onPlay={(e) => { claimPlayback(e.currentTarget); remember(e.currentTarget, true); onPlay?.(e) }} onPause={(e) => { remember(e.currentTarget, false); onPause?.(e) }}
          className="bn-gateway-media bn-gateway-audio w-full absolute left-0 right-0 bottom-0" {...cosmetic} />
      )}
      {effectiveSrc && !failed && kind === 'image' && (
        <img key={effectiveSrc} src={effectiveSrc} alt="" draggable={false} onLoad={onLoadedData} onError={onError} className={mediaClass} onContextMenu={(e) => e.preventDefault()} />
      )}
      {!effectiveSrc && !failed && !refusedTicket && (
        <span className="bn-scrim bn-gateway-note absolute bottom-1 left-1 px-1 rounded-control text-caption" data-testid="gateway-loading" style={{ color: C.muted }}>{GATEWAY_LOADING}</span>
      )}
      {remote && effectiveSrc && !failed && <ViewerMark viewer={viewer} />}
      {kind === 'video' && effectiveSrc && !failed && controls && (
        <span className="bn-gateway-fullscreen absolute top-1 right-1">
          <IconBtn Icon={Maximize2} title="Fullscreen" onClick={fullscreen} />
        </span>
      )}
      {sentence && (
        <span className="bn-scrim bn-gateway-note absolute inset-x-0 bottom-0 px-2 py-1 text-dense" data-testid="gateway-sentence" style={{ color: C.text }}>{sentence}</span>
      )}
      {children}
    </div>
  )
}
