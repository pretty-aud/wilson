// ============================================================
// RABBIT — a cloud clip's picture (BC2, Audrey's B4)
// ============================================================
//
// "if the user allows external access pictures are fine. never take images
// when external access is denied."
//
// On the desktop signed in a poster is made and kept on THIS computer for
// every clip it can reach (the desktop's poster cache). It goes to the cloud
// (rabbit-thumbnails) only while the company's switch is on — the provider
// asks first, and 0091's RESTRICTIVE policy refuses regardless. These two
// are shared by the provider (the switch-gated upload) and the Bins tab (the
// catch-up, its count).

// The media a poster can be made of: the desktop's thumbnail route answers
// audio, documents and "other" with no picture.
const POSTER_MEDIA = new Set(['video', 'still', 'sequence', 'vfx', 'graphic'])

/** A cloud clip this computer can reach that has no picture in the cloud yet. */
export function needsCloudPoster(f) {
  return !!f && !!f.location_id && f.online === true && !f.poster_path && POSTER_MEDIA.has(f.media_type)
}

/** What a person reads when the switch is off and pictures stay here. */
export const BIN_POSTERS_OFF_SENTENCE = 'This company has not allowed files to be viewed from outside the office network, so the pictures of its clips stay on this computer and none goes to the cloud. A workspace admin can turn that on in Settings, Storage.'
