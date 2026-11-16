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
//                    is diagnosed with a HEAD on the element's own ticket (a
//                    <video> reads no status); a ticket that aged gets a new
//                    src at the same currentTime, once per clip until a src
//                    loads; one refused while still young is the door's
//                    refusal, said, the clip backed off a minute (GW3 review
//                    round 2, finding 1); a connection that dropped while the
//                    door still serves is loaded again at the same moment,
//                    once, then said with Try again (note 11); a 404 is the
//                    clip missing at its location (the row flips), a 415 or a
//                    decode failure is NEEDS_DESKTOP_FORMAT (G7, D8)
//   the mark (D9)    over REMOTE playback only (the door the probe reached was
//                    the outside one): the viewer's display name, a six-
//                    character member code they cannot change (the first six
//                    characters of the user id; a display name is the
//                    person's own to set), and the clock time, in the kit's
//                    small label step at 70% white on a 65% dark backing (at
//                    least 4:1 over a white frame: round 2, note 7), no blur
//                    (the kit bans it), one of five positions by the clock —
//                    each 30 s of it has its own, so a player mounted again
//                    keeps the rhythm (note 14) — so a cropped recording still
//                    carries it part of the time; the name and the rest wrap
//                    apart on a narrow tile, never an ellipsis over the clock
//                    (note 6). Inside the office: no mark (G6, G8). It is a
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
import { NEEDS_DESKTOP_FORMAT, GATEWAY_LOADING, gatewayMissingSentence, refusalSentence, FULLSCREEN_KEEPS_MARK, GATEWAY_REFUSED_FRESH_TICKET, CONNECTION_DROPPED } from '../../bins/binLocations'

/** MediaError's codes: a decode failure is the format, said without asking the door; an aborted or dropped fetch is the connection. */
const MEDIA_ERR_ABORTED = 1
const MEDIA_ERR_NETWORK = 2
const MEDIA_ERR_DECODE = 3
/** "loading" is said only once a ticket has taken this long: a fast hand-over shows no flicker of it (round 2, note 16). */
export const LOADING_AFTER_MS = 300

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

/** The mark's position at a moment: each 30 s of the clock has its own, so every player shows the same and a remount keeps the rhythm (round 2, note 14). */
export function markPositionAt(t) {
  return MARK_POSITIONS[Math.floor(Number(t) / MARK_MOVE_MS) % MARK_POSITIONS.length] || MARK_POSITIONS[0]
}
/** The mark: drawn by the player when the door is `outside`, its position by the clock, the clock kept to the minute. */
export function ViewerMark({ viewer, now = () => Date.now() }) {
  const [, setTick] = useState(0)
  useEffect(() => {
    // Woken at every 15 s of the clock: the position turns on its 30 s and
    // the clock on its minute, both on the beat.
    let timer = null
    const wake = () => { setTick(t => t + 1); timer = setTimeout(wake, 15_000 - (now() % 15_000)) }
    timer = setTimeout(wake, 15_000 - (now() % 15_000))
    return () => clearTimeout(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  void CONTROLS_CLEARANCE_PX
  const at = now()
  const name = String(viewer?.name || '').trim() || 'a viewer'
  const code = memberCodeOf(viewer?.userId) || '------'
  // Three parts that wrap apart on a narrow tile (round 2, note 6); the text
  // is markWords' own.
  return (
    <span className={`bn-viewer-mark text-label uppercase rounded-control ${POSITION_CLASS[markPositionAt(at)]}`} data-testid="viewer-mark" aria-hidden="true">
      <span className="bn-mark-part">{name}</span> <span className="bn-mark-part">· {code}</span> <span className="bn-mark-part">· {clockWords(new Date(at))}</span>
    </span>
  )
}

/** True once `on` has held for `ms`: a word that would only flicker is not said (round 2, note 16). */
export function useSlowFlag(on, ms = LOADING_AFTER_MS) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!on) { setSlow(false); return undefined }
    const t = setTimeout(() => setSlow(true), ms)
    return () => clearTimeout(t)
  }, [on, ms])
  return on && slow
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
/**
 * The src a gateway player is given: the held ticket's URL; or, for the
 * player that was ALREADY showing it, the URL of its ticket that lapsed
 * while it sat idle (round 1, finding 7: no new mint until it plays again,
 * when the door's 401 earns the one fresh src). A player mounted later — a
 * clip selected minutes after its tile was hovered, Space's large player —
 * or moved to another clip never starts on a lapsed URL: it asks for a
 * fresh ticket, where the lapsed one would cost two refused requests at the
 * door (the element's, the diagnosis's) before the same fresh ticket.
 */
export function usePlayerSrc(streamUrl, streamInfo) {
  // The URL names the clip and carries the ticket: the same URL is the same
  // clip's same ticket, shown by this player last.
  const shownRef = useRef(null)
  const lapsed = streamInfo?.lapsedUrl || null
  const src = streamUrl || (lapsed && lapsed === shownRef.current ? lapsed : null)
  useEffect(() => { if (src) shownRef.current = src }, [src])
  return src
}

export default function GatewayVideo({
  row, src, kind = 'video', stream = null, viewer = null, poster = null,
  controls = true, autoPlay = false, muted = false, loop = false, preload = 'metadata', playsInline = true,
  mediaRef = null, onPlay, onPause, onLoaded, onFailed, onRenew, onFreshSrc, onDiagnose,
  renewAfterMs = RENEW_AFTER_MS, locationName = null, className = '', style = {}, fit = 'contain', children = null,
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(null) // null | 'format' | 'ticket' | 'missing' | 'unreachable' | 'busy' | 'no_stream' | 'refused'
  const [override, setOverride] = useState(null) // the fresh src after a stale ticket
  const [guard, setGuard] = useState(false) // the bare element was taken fullscreen or into picture-in-picture
  const containerRef = useRef(null)
  const frameFullRef = useRef(false) // the frame (the container) is fullscreen
  const ownRef = useRef(null)
  const recoveredRef = useRef(false)
  const resumeAtRef = useRef(null)
  const resumePlayRef = useRef(false)
  const refusedReasonRef = useRef(null)
  // Whether the element played since the last renewal: an idle player is not
  // renewed (round 1, finding 7) — its ticket lapses, and the next play is
  // answered by the recovery's one fresh src at the same moment.
  const playedSinceRenewRef = useRef(false)
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

  // A new clip or a new src from the parent: the picture back on top; the
  // same clip resumes where it was. The one fresh src is per clip until a src
  // loads — a new src from the parent (the fresh one this player asked for
  // among them) never hands the recovery back, or a door refusing every
  // ticket would be asked again at network speed (round 2, finding 1).
  const prevRowRef = useRef(row?.id)
  useEffect(() => {
    // The parent now hands the very URL this player switched to: the
    // element already has it (and may have drawn its first frame).
    if (override && src === override && prevRowRef.current === row?.id) { setOverride(null); return }
    if (prevRowRef.current !== row?.id) { recoveredRef.current = false; prevRowRef.current = row?.id }
    const last = lastRef.current
    const same = !!row?.id && last.id === row.id && last.t > 0
    setLoaded(false); setFailed(null); setOverride(null); setGuard(false)
    resumeAtRef.current = same ? last.t : null
    resumePlayRef.current = same && last.playing
    playedSinceRenewRef.current = false
  }, [row?.id, src]) // eslint-disable-line react-hooks/exhaustive-deps
  const remember = (m, playing) => {
    if (!m || !row?.id) return
    const isPlaying = playing ?? !m.paused
    if (isPlaying) playedSinceRenewRef.current = true
    lastRef.current = { id: row.id, t: Number.isFinite(m.currentTime) ? m.currentTime : 0, playing: isPlaying }
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
    // A still is fetched once: nothing streams, nothing to renew.
    if (!effectiveSrc || !stream?.door || !canRenew || failed || kind === 'image') return undefined
    let live = true
    let timer = null
    const run = () => {
      const m = el()
      const playingNow = !!(m && !m.paused)
      if (!playedSinceRenewRef.current && !playingNow) {
        // Idle since the last renewal: no mint, no POST; look again later.
        timer = setTimeout(run, renewAfterMs)
        return
      }
      playedSinceRenewRef.current = playingNow
      let p
      try { p = Promise.resolve(onRenewRef.current?.(row.id)) } catch { p = Promise.resolve({ ok: false }) }
      p.catch(() => ({ ok: false })).then((r) => {
        if (!live) return
        timer = setTimeout(run, r && r.ok === false ? Math.min(RENEW_RETRY_MS, renewAfterMs) : renewAfterMs)
      })
    }
    timer = setTimeout(run, renewAfterMs)
    return () => { live = false; if (timer) clearTimeout(timer) }
  }, [effectiveSrc, stream?.door, canRenew, renewAfterMs, row?.id, failed, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  const onLoadedData = useCallback(() => {
    setLoaded(true)
    recoveredRef.current = false // a src that loads: the next stale ticket may be recovered again
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
    const wasPlaying = lastRef.current.id === row?.id && lastRef.current.playing
    const code = m && m.error ? m.error.code : null
    // A decode failure is the format, without a request (G7).
    if (code === MEDIA_ERR_DECODE) { setFailed('format'); onFailed?.('format'); return }
    // Anything else a <video> cannot explain: ask the door (the element's own ticket first).
    const r = typeof onDiagnose === 'function' ? await Promise.resolve(onDiagnose(row.id)).catch(() => ({ verdict: 'unreachable' })) : { verdict: 'format' }
    const verdict = r?.verdict || 'unreachable'
    if (verdict === 'ticket' && !recoveredRef.current && typeof onFreshSrc === 'function') {
      // Never the same ticket again: a fresh one, a new src at the same
      // currentTime, playing if it was, once.
      recoveredRef.current = true
      const fresh = await Promise.resolve(onFreshSrc(row.id)).catch(() => null)
      if (fresh) { resumeAtRef.current = at; resumePlayRef.current = wasPlaying; setLoaded(false); setOverride(fresh); return }
      setFailed('ticket'); onFailed?.('ticket'); return
    }
    if (verdict === 'ok') {
      // The door serves the bytes. A fetch that dropped (or was aborted) is
      // the connection: loaded again at the same moment, once, then said
      // with Try again (round 2, note 11). Anything else is the browser not
      // decoding them: the format (G7).
      if (code === MEDIA_ERR_NETWORK || code === MEDIA_ERR_ABORTED) {
        if (!recoveredRef.current && m && typeof m.load === 'function') {
          recoveredRef.current = true
          resumeAtRef.current = at; resumePlayRef.current = wasPlaying; setLoaded(false)
          try { m.load() } catch { /* gone */ }
          return
        }
        setFailed('network'); onFailed?.('network'); return
      }
      setFailed('format'); onFailed?.('format'); return
    }
    if (verdict === 'refused') refusedReasonRef.current = r?.reason || null
    setFailed(verdict); onFailed?.(verdict)
  }, [onDiagnose, onFreshSrc, onFailed, row?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Try again after a dropped connection: the element back, at the moment it stopped, playing. */
  const retry = useCallback(() => {
    const last = lastRef.current
    resumeAtRef.current = last.id === row?.id ? last.t : null
    resumePlayRef.current = true
    setLoaded(false); setFailed(null)
  }, [row?.id])

  const fullscreen = useCallback(() => {
    const c = containerRef.current
    if (!c) return
    if (document.fullscreenElement) { document.exitFullscreen?.(); return }
    // The CONTAINER, never the element: the mark stays over the picture.
    c.requestFullscreen?.()
  }, [])

  const remote = stream?.door === 'outside'
  // The mark leaves with the bare element: Firefox and Safari ignore
  // `controlsList` and draw their own fullscreen control, which takes the
  // ELEMENT fullscreen; Safari's picture-in-picture shows it too; iOS opens
  // its native player. Through the outside door any of those pauses the clip,
  // undoes itself, and says where fullscreen is (review round 1, finding 4).
  useEffect(() => {
    if (!remote || !effectiveSrc || kind === 'image' || typeof document === 'undefined') return undefined
    const m = el()
    const stop = () => {
      const mm = el()
      try { mm?.pause?.() } catch { /* gone */ }
      setGuard(true)
    }
    const exit = () => { try { (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {}) } catch { /* not ours */ } }
    const onFullscreen = () => {
      const fe = document.fullscreenElement || document.webkitFullscreenElement || null
      const mm = el()
      // The frame's own fullscreen: the mark is on it; whatever the guard said is history.
      if (fe && fe === containerRef.current) { frameFullRef.current = true; setGuard(false); return }
      if (!fe) { frameFullRef.current = false; return }
      if (!mm || fe !== mm) return
      // The element's own control used INSIDE the frame's fullscreen (Firefox
      // and Safari draw it there too): back to the frame, the mark on it — no
      // pause, nothing said (round 2, note 15).
      if (frameFullRef.current) { exit(); return }
      stop()
      exit()
    }
    const onPip = () => {
      stop()
      try { document.exitPictureInPicture?.()?.catch?.(() => {}) } catch { /* not ours */ }
    }
    const onNativeBegin = () => {
      stop()
      try { m?.webkitExitFullscreen?.() } catch { /* not ours */ }
    }
    document.addEventListener('fullscreenchange', onFullscreen)
    document.addEventListener('webkitfullscreenchange', onFullscreen)
    m?.addEventListener?.('enterpictureinpicture', onPip)
    m?.addEventListener?.('webkitbeginfullscreen', onNativeBegin)
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreen)
      document.removeEventListener('webkitfullscreenchange', onFullscreen)
      m?.removeEventListener?.('enterpictureinpicture', onPip)
      m?.removeEventListener?.('webkitbeginfullscreen', onNativeBegin)
    }
  }, [remote, effectiveSrc, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  // No src and the cloud refused this clip's ticket (the viewer removed or
  // signed out, the switch off; the renewal failed the same way), refused the
  // clip by a reason, or named it missing: the refusal's own sentence, not
  // "loading" for good. D22's one word is for a ticket on its way.
  const refusedTicket = !effectiveSrc && !failed && !stream?.pending
    ? (stream?.ticketError || (stream?.refused ? refusalSentence(stream.refused) : (stream?.missing ? NO_STREAM_SENTENCE : null)))
    : null
  const sentence = failed === 'format' ? NEEDS_DESKTOP_FORMAT
    : failed === 'door_refused' ? (stream?.ticketError || GATEWAY_REFUSED_FRESH_TICKET)
    : failed === 'network' ? CONNECTION_DROPPED
    : failed === 'missing' ? gatewayMissingSentence(locationName)
      : failed === 'ticket' ? (stream?.ticketError || 'The clip\'s ticket could not be renewed; sign in again if this keeps happening.')
        : failed === 'busy' ? 'The gateway is busy; try again in a moment.'
          : failed === 'unreachable' ? 'This browser cannot reach the gateway just now.'
            : failed === 'refused' ? refusalSentence(refusedReasonRef.current || stream?.refused)
              : failed === 'no_stream' ? NO_STREAM_SENTENCE
                : refusedTicket || (guard ? FULLSCREEN_KEEPS_MARK : null)
  const loadingSlow = useSlowFlag(!effectiveSrc && !failed && !refusedTicket)
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
          onPlay={(e) => { claimPlayback(e.currentTarget); remember(e.currentTarget, true); setGuard(false); onPlay?.(e) }} onPause={(e) => { remember(e.currentTarget, false); onPause?.(e) }}
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
      {loadingSlow && (
        <span className="bn-scrim bn-gateway-note absolute bottom-1 left-1 px-1 rounded-control text-caption" data-testid="gateway-loading" role="status" style={{ color: C.muted }}>{GATEWAY_LOADING}</span>
      )}
      {remote && effectiveSrc && !failed && <ViewerMark viewer={viewer} />}
      {kind === 'video' && effectiveSrc && !failed && controls && (
        <span className="bn-gateway-fullscreen absolute top-1 right-1">
          <IconBtn Icon={Maximize2} title="Fullscreen" onClick={fullscreen} />
        </span>
      )}
      {sentence && (
        <span className="bn-scrim bn-gateway-note absolute inset-x-0 bottom-0 px-2 py-1 text-dense" data-testid="gateway-sentence" role="status" style={{ color: C.text }}>
          {sentence}
          {failed === 'network' && (
            <>{' '}<button type="button" className="underline" style={{ color: C.accentText }} onClick={retry} data-testid="gateway-retry">Try again</button></>
          )}
        </span>
      )}
      {children}
    </div>
  )
}
