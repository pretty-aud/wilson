// mothErrors.js — MO1 (MOTH_DESIGN §1.9): 0118's refusal codes in the sentences a person reads. A hidden file
// and a missing one read the same on purpose (not_found), so nothing here says which it was.
const SENTENCES = {
  empty: 'Pick at least one file.',
  too_many: 'Move or delete up to 500 files at a time.',
  not_a_workspace_member: 'You are not a member of this company.',
  not_found: 'That file or folder is not there.',
  not_allowed: 'You cannot change this project.',
  not_allowed_source: 'You cannot change the project these files are in.',
  not_allowed_destination: 'You cannot add files to that project.',
  is_an_asset_version: 'This file is a version of an asset, so it stays with that asset.',
  has_extracted_text: 'This file has been read into its project, so it stays there.',
  body_missing: 'This file\'s stored copy is missing, so it cannot move.',
  body_shape: 'This file\'s stored copy is not where WILSON expects it, so it cannot move.',
  body_elsewhere: 'This file is stored somewhere WILSON cannot move it from here.',
  s3_moves_off: 'A file cannot move into a company\'s own storage yet.',
  only_on_a_computer: 'This file is only on one computer, and that project is private, so it cannot go there.',
  needs_desktop: 'This file is on the computer that added it. Move it from there.',
  no_folder: 'That project has no folder on the office server.',
  name_taken: 'A file with this name is already there.',
  copy_refused: 'The copy did not reach its new place, so nothing moved.',
  copy_not_needed: 'This move needs no copy. Try it again.',
  plan_changed: 'Something changed while this was being moved. Try it again.',
  pending: 'This file is still being moved. Try again in a moment.',
  already_undone: 'That move has already been undone.',
  changed_since: 'This file has changed since that move, so it cannot be undone.',
  needs_copy: 'Undoing this needs a fresh copy. Move it back with Move to.',
}

const FALLBACK = 'WILSON could not do that. Try it again.'

// The Error a refused call throws, or null for an error that is no refusal of Moth's.
export function mothRefusal(error) {
  const found = /moth_(?:move|trash):([a-z0-9_]+)/.exec(String(error?.message ?? ''))
  if (!found) return null
  const err = new Error(SENTENCES[found[1]] ?? FALLBACK)
  err.code = found[1]
  return err
}
