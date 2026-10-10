// =============================================================================
// What may be served (G7, D8): browser-playable formats only, decided by the
// extension of the RESOLVED ON-DISK path (after realpath), never by a ticket
// field (review round 1, F13). Narrower than the desktop's
// safeMediaContentType on purpose: that one admits any video|audio|image
// type; this one is an explicit list, with .mov (D8). No sniffing: every
// response says nosniff, and a file whose bytes are not what its name says
// simply fails to decode in the browser.
//
// Not served (design §5): .mxf, .mkv, .avi, .wmv, .mts, .r3d, .braw, ProRes
// in any container but .mov, .exr, .dpx, .tif, .psd, .svg (scriptable) and
// everything else: the clip shows its picture and needs the desktop app.
// =============================================================================

import { extOf } from './sequence.mjs';

export const ALLOWED = Object.freeze(new Map([
  ['.mp4', 'video/mp4'], ['.m4v', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.wav', 'audio/wav'], ['.bwf', 'audio/wav'],
  ['.flac', 'audio/flac'],
  ['.ogg', 'audio/ogg'],
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.avif', 'image/avif'],
]));

const STILLS = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/** The served Content-Type for a resolved on-disk path, or null when it is not allow-listed. */
export function mediaTypeForPath(resolvedPath) {
  return ALLOWED.get(extOf(resolvedPath)) || null;
}

/** A sequence's chosen frame must itself be an allow-listed still (design §5, F17). */
export function isAllowedStill(resolvedPath) {
  return STILLS.has(mediaTypeForPath(resolvedPath));
}

// Spellings a row's mime_type may carry for the same thing (a browser's
// File.type, ffprobe, an older desktop).
const ALIASES = new Map([
  ['video/x-m4v', 'video/mp4'], ['audio/mp3', 'audio/mpeg'], ['audio/x-mpeg', 'audio/mpeg'],
  ['audio/x-m4a', 'audio/mp4'], ['audio/m4a', 'audio/mp4'], ['audio/aac-mp4', 'audio/mp4'],
  ['audio/x-wav', 'audio/wav'], ['audio/wave', 'audio/wav'], ['audio/vnd.wave', 'audio/wav'], ['audio/vnd.wav', 'audio/wav'],
  ['audio/x-flac', 'audio/flac'], ['audio/x-ogg', 'audio/ogg'], ['application/ogg', 'audio/ogg'],
  ['image/jpg', 'image/jpeg'], ['image/pjpeg', 'image/jpeg'], ['image/x-png', 'image/png'],
]);

export function canonicalMediaType(mt) {
  const base = String(mt).split(';')[0].trim().toLowerCase();
  return ALIASES.get(base) || base;
}

/**
 * Does the ticket's advisory `mt` agree with the type the file on disk has?
 * A null or empty `mt` claims nothing (0091 lets mime_type be NULL), so it
 * cannot disagree; the allow-list by the on-disk extension still decides.
 * Anything else must name the same type, parameters and aliases aside: a row
 * that says video/mp4 over a file that is now a .png is a 415 (F13).
 */
export function mtAgrees(mt, servedType) {
  if (!servedType) return false;
  if (mt === null || mt === undefined || String(mt).trim() === '') return true;
  return canonicalMediaType(mt) === servedType;
}
