// ============================================================
// RABBIT — Bins: the picture, large; the player, large (BC3, GW3)
// ============================================================
//
// Where nothing can play (the capability object says `stream` is false: a
// browser with no gateway reached), Space on the selected clip shows its
// picture large instead of playing a preview, so keyboard review — arrows,
// S / R / U, C, the colours — works without a player: the view is laid over
// the files pane, not on the overlay stack, so every Bins key keeps working
// under it, the clip it shows follows the current row, and Space or Escape
// closes it. The picture is the cloud's (BinPoster signs it once and keeps
// it), the whole of it inside the frame; a clip with no picture shows its
// kind's icon, never a broken image.
//
// GW3 (GATEWAY_DESIGN.md §7): where the gateway plays, the same overlay IS
// the player — the clip plays large (autoplay, the kit's controls), the
// cloud picture under it until the first frame, the viewer's mark over it
// when the door is the outside one (D9), Esc still closing it first. A
// format the browser does not play keeps the picture and says so (G7, D8);
// a clip the gateway cannot reach keeps the picture with the reach sentence.
//
// Laws of UX (laws-of-ux, BC3): Paradox of the active user — the keys that
// work are written on the view itself, not in a manual; Common region — one
// raised surface with a hairline, no card inside a card; Cognitive load —
// the name, the marks, the slate and the one sentence, nothing else.

import { useEffect } from 'react'
import { X, Unplug } from 'lucide-react'
import { C, IconBtn, MediaTag, FlagMark } from './binUi'
import BinPoster from './BinPoster'
import GatewayVideo, { usePlayerSrc } from './GatewayVideo'
import { slateLine, techLine } from '../../bins/binMedia'
import { NOT_ON_THIS_COMPUTER, NEEDS_DESKTOP_FORMAT, browserClipSentence, gatewayClipSentence, gatewayMissingSentence } from '../../bins/binLocations'
import { playabilityOf, browserCanPlayType } from '../../bins/gatewayMedia'
import { gatewayStateWord } from './BinInspector'

export default function PosterLarge({
  row, location = null, catalogue = false, onClose,
  // GW3: the gateway's player on this overlay.
  canStream = false, streamUrl = null, streamInfo = null, viewer = null, gateway = null,
  onTicketWanted = null, onRenew = null, onFreshSrc = null, onDiagnose = null,
}) {
  const notHere = !!row && row.online === false && !!row.location_id
  const play = row && gateway ? playabilityOf(row, { canPlayType: browserCanPlayType() }) : null
  const plays = !!row && canStream && !notHere && !!play?.playable && streamInfo?.refused !== 'not_playable'
  // D22: the ticket is asked for when the player opens, not before.
  // As the inspector's: a lapsed ticket's URL serves only the player that
  // was showing it (round 1, finding 7; usePlayerSrc). This overlay opens
  // on Space, so it starts on a held ticket or asks for one.
  const playerSrc = usePlayerSrc(streamUrl, streamInfo)
  const wantsTicket = plays && !playerSrc && !streamInfo?.missing && !streamInfo?.pending
  useEffect(() => { if (wantsTicket) onTicketWanted?.(row.id) }, [wantsTicket, row?.id, onTicketWanted])
  if (!row) return null
  const sentence = notHere
    ? (row.gateway_missing ? gatewayMissingSentence(location?.name) : gateway ? gatewayClipSentence(location?.name, gatewayStateWord(location, gateway)) : browserClipSentence(location?.name))
    : gateway && canStream && !plays ? NEEDS_DESKTOP_FORMAT
      : gateway && !canStream ? gatewayClipSentence(location?.name, gatewayStateWord(location, gateway))
        : !gateway && catalogue ? browserClipSentence(location?.name) : ''
  return (
    <div className="bn-poster-large absolute inset-3 z-30 flex flex-col rounded-float shadow-float overflow-hidden" role="region" aria-label={plays ? 'The clip, large' : 'The picture, large'} data-testid="poster-large" data-plays={plays ? 'true' : undefined}>
      <div className="flex items-center gap-2 px-3 py-2 flex-shrink-0 min-w-0" style={{ borderBottom: `1px solid ${C.line}` }}>
        <span className="truncate text-dense font-mono font-semibold" style={{ color: C.bright }} title={row.display_name || row.original_name}>{row.display_name || row.original_name}</span>
        <FlagMark flag={row.review_flag} circled={row.circled} size={12} />
        <MediaTag type={row.media_type} small />
        <span className="truncate text-caption" style={{ color: C.accentText }}>{slateLine(row)}</span>
        <span className="ml-auto text-caption flex-shrink-0" style={{ color: C.dim }}>Space or Esc closes · arrows move · S, R, U mark</span>
        <IconBtn Icon={X} title="Close (Space)" onClick={onClose} />
      </div>
      <div className="bn-poster-large-frame flex-1 min-h-0 flex items-center justify-center p-3">
        {plays ? (
          <GatewayVideo row={row} src={playerSrc} kind={play.kind} stream={streamInfo} viewer={viewer} poster={null} controls autoPlay
            onRenew={onRenew} onFreshSrc={onFreshSrc} onDiagnose={onDiagnose} locationName={location?.name || null}
            renewAfterMs={gateway?.renewAfterMs || undefined}
            className="w-full h-full" style={{ backgroundColor: 'transparent' }} />
        ) : (
          <BinPoster row={row} src={null} width="100%" height="100%" radius={0} iconSize={40} contain style={{ border: 'none', backgroundColor: 'transparent' }} />
        )}
      </div>
      <div className="px-3 py-2 text-caption flex items-center gap-3 flex-shrink-0 min-w-0" style={{ color: C.dim, borderTop: `1px solid ${C.line}` }}>
        <span className="truncate font-mono flex-shrink-0">{techLine(row) || row.original_name}</span>
        {notHere && <span className="inline-flex items-center gap-1 flex-shrink-0" style={{ color: C.amber }}><Unplug className="w-3 h-3" /> {NOT_ON_THIS_COMPUTER}</span>}
        <span className="truncate">{sentence}</span>
      </div>
    </div>
  )
}
