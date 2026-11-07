// mothErrors.js — MO1 (MOTH_DESIGN §1.9): 0117's and 0118's refusal codes in the sentences a person reads. A hidden
// file and a missing one read the same on purpose (not_found), so nothing here says which it was. A name held by a
// file the person cannot see reads as any other: it is the name that is taken, and no file is named.
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
  s3_moves_off: 'A file cannot move to or from a company\'s own storage yet.',
  only_on_a_computer: 'This file is only on one computer, and that project is private, so it cannot go there.',
  needs_desktop: 'This file is on the computer that added it. Move it from there.',
  no_folder: 'That project has no folder on the office server.',
  name_taken: 'A file with this name is already there.',
  occupied: 'A file with this name is already there. Rename it, then try again.',
  copy_refused: 'This file cannot be copied to its new place, so nothing moved.',
  copy_not_needed: 'This move needs no copy. Try it again.',
  plan_changed: 'Something changed while this was being moved. Try it again.',
  pending: 'This file is still being moved. Try again in a moment.',
  already_undone: 'That move has already been undone.',
  changed_since: 'This file has changed since it was last moved, so WILSON left it where it is.',
  needs_copy: 'This needs a fresh copy of the file. Use Move to and try again.',
  moves_not_ready: 'Moves on this company\'s storage are not ready yet.',
  in_their_server_folder: 'This file is in that person\'s folder on the office server, which only they can open from WILSON. Copy it from the server by hand.',
  on_their_computer: 'This file is only on that person\'s computer, so it cannot be moved from here.',
  // The office server's own.
  bad_name: 'WILSON cannot keep a file with this name on the office server. Rename it and try again.',
  bad_entry: 'WILSON could not read this file\'s details on the office server, so it was not added.',
  bad_facts: 'WILSON could not read this file\'s details on the office server. Try again.',
  bad_request: 'WILSON asked the office server something it could not answer. Try again.',
  drive_changed: 'The office server\'s address has changed. Sign in again and try once more.',
  folder_shared: 'That folder is used by another project too, so WILSON will not move files through it. An admin can change this in Storage.',
  folders_unplaced: 'A project\'s folder is outside this company\'s office server, so WILSON will not move files until an admin fixes that in Storage.',
  too_large: 'This folder is too large to list in one go. Try again in a few minutes.',
  too_soon: 'This folder was checked moments ago. Try again in a few minutes.',
}

const FALLBACK = 'WILSON could not do that. Try it again.'

// The Error a refused call throws, or null for an error that is no refusal of Moth's.
export function mothRefusal(error) {
  const found = /(?:moth_(?:move|trash):|network_share: )([a-z][a-z0-9_ ]*)/.exec(String(error?.message ?? ''))
  if (!found) return null
  const code = found[1].trim().replace(/ /g, '_')
  const err = new Error(SENTENCES[code] ?? FALLBACK)
  err.code = code
  return err
}
