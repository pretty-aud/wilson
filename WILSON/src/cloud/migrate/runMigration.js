// =============================================================================
// runMigration — single-user → cloud data migration runner.
//
// Reads every RABBIT project from the local_server Express backend
// (/api/rabbit/projects) which serves JSON bundles persisted under
// {userData}/rabbit-data/projects/{id}/project.json. The Session 2 scope
// mentions "IndexedDB"; no RABBIT code uses IndexedDB — that term in the
// original prompt referred to the Express-backed JSON store.
//
// Writes to Supabase via the shared authenticated client, scoped by RLS
// to the target workspace. Tables, in order: projects, phases, milestones
// (M1), assets, tasks, task_dependencies + phase_dependencies (Track A A2 —
// the edges were dropped on the floor before 2026-09-06), comments (M1),
// then — BC3 (Audrey's B9, "bins move with the project") — scenes and
// shots; then — M1, night 3 of docs/sessions/PLAN_TO_1_0.md — shot_lists
// with their shot_list_items and edits (the active list and the archived
// ones through 0084's functions), folders, and files (each filed in its
// folder, so after them); then bins, bin_locations, bin_files, shot_takes,
// a task's items (FX2, 0096), the project's saved views and groupings
// (VW1c, 0098, through the cloud adapter's own INSERTs), and the clips'
// pictures to rabbit-thumbnails while the company's switch is on. Part 2
// (M2, night 4) carries the levels and experiences (before the assets, the
// folders, the files, a task's items and the groupings that name them), the
// links on tasks, and the budgets — bid versions after the shot lists, then
// the lines, their actuals, the expenses and the role rates, then the
// project's locked and open bid versions — behind the money gate (0037); a
// later run (night 5) carries the team. The migration is:
//   - idempotent: already-migrated rows are detected by id and skipped
//   - resumable: a mid-flight failure leaves the cloud in a consistent
//                state; re-running picks up only the missing rows
//   - faithful to the cloud (M2): each run adds what it carried to a record
//                in the desktop's bundle, and an id in it is never inserted
//                again, so a row a teammate removed stays removed
//   - dry-runnable: { dryRun: true } returns the same report without
//                   performing any writes
//
// The runner accepts an onProgress callback so the UI can stream per-project
// status (useful for large workspaces where a full migration takes minutes).
// =============================================================================

import { supabase } from '../auth/supabaseClient'
// The edge tables' routing rule and column allowlist come from the adapter
// that owns them — one vocabulary, not a restatement (Track A A2, 2026-09-06).
import { DEPENDENCY_TABLE, dependencyKind, toColumns, supabaseAdapter } from '../../tools/rabbit_v0.1.0/adapters/supabaseAdapter'
// B3 (Track B): the desktop loopback API refuses /api without the per-launch
// token; localFetch attaches it (same-origin URLs only).
import { localFetch } from '../../lib/localServerFetch.js'
import { isLegalFile, LEGAL_SEGMENT, LEGAL_UNAVAILABLE } from '../../tools/rabbit_v0.1.0/fileTags'
// BC3 (B9): the bins' part — the roots, the question's answers, the cloud
// row shape — is pure and lives beside this file.
import {
  binRootsOf, mergeRoots, pathKey, resolveRootAnswer, cloudBinFileRow, cloudRowOf, binsParentsFirst, takesToLand, takePairKey, notCarriedOf, notCarriedLabel, notCarriedLater, POSTER_MEDIA,
} from './binsMigration'
// M1 (night 3): the project row, the five kinds' rows and the orders their
// keys need — pure, beside this file as the bins' part is. M2 (night 4):
// part 2's rows, the receipts, and the record of what each run carried.
import {
  projectRowForCloud, projectLeftAtHome, milestoneRowForCloud, COMMENT_TARGETS, commentRowForCloud,
  isArchived, shotListRowForCloud, shotListItemRowForCloud, editRowForCloud, listLabel, itemsInListOrder,
  editsParentsFirst, foldersParentsFirst, folderRowForCloud, folderDecision, cloudFolderIndex, desktopFolderOfFile,
  budgetVersionRowForCloud, budgetLineRowForCloud, budgetActualRowForCloud, expenseRowForCloud, rateOverrideRowForCloud,
  levelRowForCloud, taskLinkRowForCloud, receiptFileIds, isLegacyAttachment, isMemberRate, phasesParentsFirst, carriedRecordOf, LINE_PCTS,
  peopleMapOf, projectMemberRowForCloud, rateCardRowForCloud, rateCardEntryRowForCloud, taskTemplateRowForCloud,
  managedFileRowForCloud, managedFileName, managedVersionLabel, desktopFolderOfManagedFile, MANAGED_LINKS, isUuid,
} from './migrationRows'
// M3 (night 5): where a managed file's body goes — the company's storage rule
// as the upload path reads it (one read, cached; fails closed), the registered
// provider, the resumable threshold its Supabase put switches at, the s3
// single-PUT bound, and the thumbnail an upload makes.
import { getStorageProvider, activeWorkspaceProvider, fileProviderFor, WORKSPACE_PROVIDERS, FILE_PROVIDERS } from '../../tools/rabbit_v0.1.0/storage/index.js'
import { getWorkspaceStorageCached } from '../workspaceStorage'
import { RESUMABLE_THRESHOLD_BYTES } from '../../tools/rabbit_v0.1.0/storage/resumableUpload.js'
import { S3_MAX_SINGLE_PUT_BYTES } from '../../tools/rabbit_v0.1.0/storage/uploadNotices.js'
import { canThumbnail, generateThumbnail, thumbnailKeyFor, putThumbnailTo, THUMBNAIL_BUCKET } from '../../tools/rabbit_v0.1.0/storage/thumbnails.js'

const RABBIT_BASE = '/api/rabbit'
const POSTER_BUCKET = 'rabbit-thumbnails'
const POSTER_MAX_BYTES = 262144 // the bucket's own cap (0053)
// M3 (night 5). The desktop's seed workspace id, under which a signed-out
// desktop writes its workspace stores (RabbitProvider's DEFAULT_WORKSPACE_ID,
// not imported: that module is the whole provider); never sent anywhere.
const DESKTOP_SEED_WORKSPACE = '00000000-0000-0000-0000-000000000001'
// The Petal bucket's per-file cap (0057: 50 GiB); the dashboard's global
// limit wins and is read by nobody here, so a lower one is met at upload and
// said per file.
const PETAL_FILE_CAP_BYTES = 53_687_091_200
const RABBIT_FILES_BUCKET = 'rabbit-files'

// The sentences the bins' part says (the panel and the tests quote them).
export const BINS_LEFT_BEHIND = (n) => `${n} clip${n === 1 ? '' : 's'} left on this computer: name ${n === 1 ? 'its' : 'their'} footage location and run the migration again`
export const POSTERS_SWITCH_OFF = 'pictures stay on this computer: the company has not allowed files to be viewed from outside the office network (a workspace admin can turn that on in App settings, Storage)'
// A take of a shot or clip removed on this computer (the desktop keeps the
// row for undo, and shows it to nobody) is not carried, and not an error
// (review round 2: every such row failed every run, so an ordinary project
// never reached Done).
export const ORPHAN_TAKES = (n) => `${n} take${n === 1 ? '' : 's'} of a shot or clip removed on this computer (kept there for undo) not carried`
// What the migration does not carry, said under the report BEFORE the
// archive is offered (review round 2) — since M1, what a later run of the
// migration carries apart from what no migration carries (`later`; since M2
// the later run is night 5's).
export const NOT_CARRIED_SENTENCE = (list) => {
  const words = (xs) => xs.map(x => `${x.count} ${x.label}`).join(', ')
  const later = list.filter(x => x.later)
  const never = list.filter(x => !x.later)
  return [
    later.length ? `Stays on this computer for now (a later run of the migration carries it): ${words(later)}.` : '',
    never.length ? `Stays on this computer (the migration does not carry it): ${words(never)}.` : '',
    'Archive and clear local keeps a copy in the archive file only.',
  ].filter(Boolean).join(' ')
}
// VW1c (0098): the views' part's sentences (the panel and the tests quote them).
export const TABLE_VIEWS_NOT_IN_CLOUD = (views, groupings) => `${views} saved view${views === 1 ? '' : 's'} and ${groupings} grouping${groupings === 1 ? '' : 's'} stay on this computer: this cloud does not keep saved views yet (migration 0098) — run the migration again once it does`
export const TABLE_VIEWS_UNREAD = (message) => `could not read the saved views and groupings already in the cloud, so none was written (run the migration again): ${message}`
// M1 (night 3): the project row's and the five kinds' sentences (the panel
// and the tests quote them). A project's folder on this computer stays this
// computer's (measured: the cloud takes a project folder only from an admin
// or a manager, inside the company's storage drive).
export const PROJECT_FOLDER_STAYS = (n) => `${plural(n, 'project folder')} on this computer ${n === 1 ? 'stays' : 'stay'} this computer's setting: in the cloud a workspace admin or manager sets a project's folder, inside the company's storage drive`
// Review round 1 (M1): a status the cloud's type does not have refused the
// whole project; it is left out, so the cloud's default applies, and said.
// Since 0103 (M2) the cloud has the desktop's eight; a cloud without it
// still refuses Draft, Wrapped and Inactive, and the runner sends the
// project again without its status.
export const STATUS_NOT_IN_CLOUD = (n, statuses) => `${plural(n, 'project')} ${n === 1 ? 'has' : 'have'} a status the cloud does not have (${statuses.join(', ')}): ${n === 1 ? 'it arrives' : 'they arrive'} as active`
// Review round 2: a value the cloud's column cannot hold (a number past its
// room, an unreadable date, a person that is no id) is left out; said, in
// the project settings' own words, for a project that arrives.
export const VALUES_NOT_IN_CLOUD = (n, words) => `${plural(n, 'project')} ${n === 1 ? 'has a value' : 'have values'} the cloud cannot hold (${words.join(', ')}): left out, so the field is empty or at the cloud's default`
export const KEY_DATES_PHASE_LET_GO = (n) => `${plural(n, 'key date')} ${n === 1 ? 'arrives' : 'arrive'} without ${n === 1 ? 'its' : 'their'} phase: removed on this computer, in the cloud's trash, or not this project's there`
export const EDITS_CHAIN_TAKEN = (n) => `${plural(n, 'edit')} not carried: the shot list's one chain of edits already has an edit in ${n === 1 ? 'its' : 'their'} place (made in the cloud since, or a second chain an older version kept on this computer), and an edit cannot be moved`
export const FILE_LINKS_LET_GO = (n) => `${plural(n, 'link')} of a file to a row removed on this computer, in the cloud's trash, or not this project's there let go`
export const KEY_DATES_TRASHED = (n) => `${plural(n, 'key date')} in this computer's Recently deleted not carried`
export const COMMENTS_REMOVED = (n) => `${plural(n, 'comment')} marked removed on this computer not carried`
export const COMMENTS_ON_GONE_ROWS = (n) => `${plural(n, 'comment')} on a row removed on this computer, or in the cloud's trash, not carried`
export const ITEMS_ON_GONE_ROWS = (n) => `${plural(n, 'item')} of a shot list on a scene or shot removed on this computer not carried`
export const FOLDERS_OF_GONE_ROWS = (n) => `${plural(n, 'folder')} of a row removed on this computer, or in the cloud's trash, not carried`
export const FOLDERS_TAKEN = (n) => `${plural(n, 'folder')} not carried: the cloud has another row's folder in ${n === 1 ? 'its' : 'their'} place, so ${n === 1 ? 'its' : 'their'} files sit at the project's top there`
export const FILES_PLACED = (n) => `${plural(n, 'file')} filed in ${n === 1 ? 'its folder' : 'their folders'}, as on this computer`
export const ARCHIVED_AGAIN = (labels) => `Archived on this computer, so archived in the cloud once carried: ${labels.join(', ')} (a workspace admin or the project's manager can; anyone else, only a list or edit nobody has saved or built on)`
export const LIVE_IN_CLOUD = (n) => `${n} ${n === 1 ? 'shot list or edit' : 'shot lists or edits'} archived on this computer ${n === 1 ? 'is' : 'are'} live in the cloud: a run archives only what it carries (archive ${n === 1 ? 'it' : 'them'} on the Scenes tab)`
export const SHOT_LIST_NAME_TAKEN = (label) => `a shot list called "${label}" is already in the cloud under another id (made there since), so this one was not carried: rename it on this computer and run again`
export const EDIT_NAME_TAKEN = (label) => `this shot list already has an edit called "${label}" in the cloud (made there since), so this one was not carried: rename it on this computer and run again`
// M2 (night 4): part 2's sentences (the panel and the tests quote them).
// A row an earlier run carried that the cloud no longer shows: a teammate
// removed it (or put it in the cloud's trash), and no run brings it back.
export const REMOVED_SINCE_LAST_RUN = (words) => `Removed in the cloud since an earlier run, so not carried again: ${words}`
// The money gate (0037): only a workspace admin or the project's manager sees
// its budget, and anyone else's rows are refused one by one (42501 —
// measured), so none is sent; said, never a failed project.
export const MONEY_GATE_LEFT = (n, rows) => `${n === 1 ? "1 project's budget" : `${n} projects' budgets`} (${plural(rows, 'row')}, with ${n === 1 ? 'its' : 'their'} receipts) ${n === 1 ? 'stays' : 'stay'} on this computer: in the cloud only a workspace admin or the project's manager sees its budget, and you are neither (a workspace admin can make you the project's manager; then run again)`
export const ROW_LINKS_LET_GO = (n) => `${plural(n, 'link')} of a phase, asset, task, shot, clip or bid version to a row removed on this computer, removed in the cloud (or in its trash), or not this project's there let go`
export const ACTUALS_ON_GONE_LINES = (n) => `${plural(n, 'actual')} on a budget line removed on this computer, removed in the cloud since an earlier run, or not this project's there, not carried`
export const TASK_LINKS_ON_GONE_TASKS = (n) => `${plural(n, 'link')} on a task removed on this computer, or in the cloud's trash, not carried`
export const RECEIPTS_GATED = (n) => `${plural(n, 'receipt')} kept as an ordinary file on this computer ${n === 1 ? 'goes' : 'go'} up behind the money gate, as the expense or actual naming ${n === 1 ? 'it' : 'them'} does`
export const SET_ASIDE_AGAIN = (n) => `${plural(n, 'row')} of the schedule set aside by the open bid version, as on this computer`
export const RECORD_NOT_KEPT = (why) => `this computer could not keep its record of what this run carried (${why}): a later run may bring back a row a teammate removes in the cloud`
// Review round 1 (M2): a project whose id the cloud holds outside this
// workspace (the same desktop moved into a second company) or out of this
// person's sight is not this run's to fill — and was recorded, then called
// removed by the next run. Review round 2: the cloud's trash hides one too.
export const PROJECT_NOT_OURS = "a project with this id is in the cloud, but not one you can see in this workspace (another company's, a private one, or one in the cloud's trash — restored, it carries on the next run), so none of it was written"
// A line's own percentage the cloud's column cannot hold refused the line and
// every actual on it, on every run (budget_lines_pct_nonneg, NUMERIC(7,3)'s
// room — measured): left out, so the line takes the project's, said.
export const LINE_PCTS_LEFT_OUT = (n) => `${plural(n, 'budget line')} ${n === 1 ? 'has its own percentage' : 'have their own percentage'} (margin, contingency or agency fee) the cloud cannot hold — below zero, past 9,999.999, or no number: left out, so ${n === 1 ? 'it takes' : 'they take'} the project's`
// A key's place another row holds (review round 1): no run can change it, so
// counted and said, never an error.
export const ACTUALS_TAKEN = (n) => `${plural(n, 'actual')} not carried: the cloud has another for the same budget line and period (entered there since)`
export const RATES_TAKEN = (n) => `${plural(n, 'rate')} not carried: the cloud has another rate for the same role or person on this project (set there since)`
// A receipt an earlier build carried as an ordinary file (before M2 routed
// receipts as money): said on every run while it stays open, never recorded
// as carried (review round 1); kept apart in the record, so its removal
// there stands (review round 2).
// M3: the move behind the gate is made (moveReceipt); one that did not take
// is said with its reason among the errors, and this line stays.
export const RECEIPTS_LEFT_OPEN = (n) => `${plural(n, 'receipt')} an earlier run carried as ${n === 1 ? 'an ordinary file' : 'ordinary files'} ${n === 1 ? 'is' : 'are'} still open to every member of the project in the cloud: the move behind the money gate did not take this run (the errors say why) — run again, or a workspace admin can remove ${n === 1 ? 'it' : 'them'} there, and no later run brings ${n === 1 ? 'it' : 'them'} back`
// M3 (night 5): the people, the roster, the rate cards, the templates, the
// files kept with rows, the receipts moved (the panel and the tests quote
// them). A person is named by their desktop name, never their email.
export const PEOPLE_MATCHED = (matched, total) => `${matched} of ${plural(total, 'desktop team member')} matched a company account by email`
export const PEOPLE_WHY = Object.freeze({ no_account: 'no WILSON account yet', no_email: 'no email on this computer', inactive: 'account deactivated' })
export const PEOPLE_NOT_MATCHED = (unmatched) => {
  const groups = Object.entries(PEOPLE_WHY).map(([why, words]) => [words, unmatched.filter(u => u.why === why).map(u => u.name)]).filter(([, names]) => names.length)
  return `${plural(unmatched.length, 'desktop team member')} not matched to a company account (${groups.map(([words, names]) => `${words}: ${names.join(', ')}`).join('; ')}): their seats, crew lines, rates and tasks arrive without the person until they join (no email is sent)`
}
export const PEOPLE_SHARED = (n) => `${n} desktop team entries share one company account (the same person added twice): both name it`
export const PEOPLE_NEED_ADMIN = "the team stays on this computer: in the cloud only a workspace admin or manager may read the company's emails, which the migration matches your desktop team by (ask one to run it)"
export const PEOPLE_UNREAD = (why) => `could not read the company's directory, so no desktop team member was matched and every person column arrives empty (run again): ${why}`
export const MANAGERS_SEATED = (names) => `${plural(names.length, 'person', 'people')} seated as a project's manager — as on this computer, or as its producer, whom the cloud seats so: in the cloud a project manager sees its budget and sets its roster (make them members in the browser if that is too much): ${names.join(', ')}`
export const ROSTER_LEFT = (n) => `${plural(n, 'seat')} not given: in the cloud a project's roster is set by a workspace admin or manager, or the project's manager, and you are none of these for this project`
export const ROLES_LEFT = (n) => `${plural(n, 'seat')} given as member: the cloud's roles are manager, reviewer and member, and the desktop's role for ${n === 1 ? 'it' : 'them'} is none of these`
export const DEFAULTS_LEFT = (n) => `${plural(n, 'rate card')} ${n === 1 ? 'arrives' : 'arrive'} not as the default of ${n === 1 ? 'its' : 'their'} type: the cloud already has its own default of that type (set yours as the default in the browser if you prefer ${n === 1 ? 'it' : 'them'})`
export const PEOPLE_SET = (n) => `${plural(n, 'row')} an earlier run carried without ${n === 1 ? 'its' : 'their'} person (budget lines, tasks, the producer and director) now ${n === 1 ? 'names' : 'name'} them`
export const RATE_CARDS_NEED_RIGHT = (n) => `${plural(n, 'rate card')} ${n === 1 ? 'stays' : 'stay'} on this computer: in the cloud rate card entries are written by a workspace admin or someone with the rate card edit grant, and you are neither`
export const CARD_NOT_OURS = (name) => `rate card "${name}": a card with this id is in the cloud, but not one you can see (in the cloud's trash, or another company's — restored, it carries on the next run), so it was not written`
export const TEMPLATE_NOT_OURS = (name) => `task template "${name}": a template with this id is in the cloud, but not one you can see (another company's), so it was not written`
export const ENTRIES_NEED_GRANT = (n) => `${plural(n, 'rate card entry', 'rate card entries')} not carried: entries are written by a workspace admin or someone with the rate card edit grant`
export const EMPTY_CARDS = (n) => `${plural(n, 'empty rate card')} (no entries, no department defaults) not carried: the cloud makes its own General and Internal cards`
export const TEMPLATES_LEFT = (n) => `${plural(n, 'task template')} ${n === 1 ? 'stays' : 'stay'} on this computer: in the cloud templates are written by a workspace admin or manager, and a template pinned to a project by its manager`
export const TEMPLATES_ORPHAN = (n) => `${plural(n, 'task template')} pinned to a project not on this computer not carried`
export const ASSET_TEMPLATES_LINKED = (n) => `${plural(n, 'asset')} linked to ${n === 1 ? 'its' : 'their'} task template in the cloud`
export const MANAGED_WORDS = 'kept with assets, scenes, shots, levels and experiences'
export const MANAGED_FILES_WILL_UPLOAD = (n, bytes) => `${plural(n, 'file')} ${MANAGED_WORDS} (${(bytes / 1_000_000).toFixed(1)} MB) will upload to the company's storage`
export const MANAGED_FILES_UPLOADED = (n, bytes) => `${plural(n, 'file')} ${MANAGED_WORDS} (${(bytes / 1_000_000).toFixed(1)} MB) uploaded to the company's storage`
export const SERVER_MEDIA_STAY = (n) => `${plural(n, 'file')} ${MANAGED_WORDS} ${n === 1 ? 'stays' : 'stay'} on this computer: this company keeps its media on its own server, and the browser says where the files are`
export const PRIVATE_MEDIA_STAY = (n) => `${plural(n, 'file')} ${MANAGED_WORDS} ${n === 1 ? 'stays' : 'stay'} on this computer: a private project's media lives on the computer that added it`
export const BODIES_GONE = (n) => `${plural(n, 'file')} ${MANAGED_WORDS} ${n === 1 ? 'has' : 'have'} no body on this computer right now (a drive not mounted, a folder moved, or removed on disk): not carried — make the folder reachable and run again`
export const MANAGED_OVER_CAP = (n) => `${plural(n, 'file')} ${MANAGED_WORDS} past the cloud bucket's 50 GiB cap not carried`
export const MANAGED_OVER_BOUND = (n) => `${plural(n, 'file')} ${MANAGED_WORDS} past 5 GiB not carried: the company's bucket takes a file in one piece`
export const RECEIPTS_MOVED = (n) => `${plural(n, 'receipt')} an earlier run carried as ${n === 1 ? 'an ordinary file' : 'ordinary files'} now behind the money gate, moved to INVOICES with ${n === 1 ? 'its' : 'their'} picture`
export const RECEIPTS_WILL_MOVE = (n) => `${plural(n, 'receipt')} an earlier run carried as ${n === 1 ? 'an ordinary file' : 'ordinary files'} will be put behind the money gate`


// The words for a row of each table the record names (REMOVED_SINCE_LAST_RUN).
const TABLE_WORDS = {
  projects: ['project'], phases: ['phase'], milestones: ['key date'], levels: ['level'], experiences: ['experience'],
  assets: ['asset'], tasks: ['task'], task_dependencies: ['task dependency', 'task dependencies'],
  phase_dependencies: ['phase dependency', 'phase dependencies'], task_links: ['link on a task', 'links on tasks'],
  comments: ['comment'], scenes: ['scene'], shots: ['shot'], shot_lists: ['shot list'], shot_list_items: ['shot list item'],
  edits: ['edit'], folders: ['folder'], files: ['file'], budget_versions: ['bid version'], budget_lines: ['budget line'],
  budget_actuals: ['actual'], expenses: ['expense'], project_rate_overrides: ['role rate'], bins: ['bin'],
  bin_files: ['clip'], shot_takes: ['take'], task_items: ["task's item", "tasks' items"],
  table_views: ['saved view'], item_groupings: ['grouping'],
  // M3 (night 5): the roster's seats (by person), the company's cards, entries and templates.
  project_members: ['roster seat'], rate_cards: ['rate card'], rate_card_entries: ['rate card entry', 'rate card entries'], task_templates: ['task template'],
}
/** "2 tasks, 1 clip": the counts of `byTable`, in the words of each table's rows. */
export const removedWords = (byTable) => Object.entries(byTable || {}).filter(([, n]) => n > 0)
  .map(([t, n]) => { const [one, many] = TABLE_WORDS[t] || [t]; return `${n} ${n === 1 ? one : (many || `${one}s`)}` }).join(', ')

// The panel's line for the lists and edits archived as on this computer.
export const ARCHIVED_IN_CLOUD = (lists, edits, dry) => {
  const what = [lists ? plural(lists, 'shot list') : '', edits ? plural(edits, 'edit') : ''].filter(Boolean).join(' and ')
  return dry ? `${what} archived on this computer: archived in the cloud too, once carried` : `${what} archived in the cloud too, as on this computer`
}

async function fetchLocalProjectsList() {
  const res = await localFetch(`${RABBIT_BASE}/projects`)
  if (!res.ok) throw new Error(`list projects failed: HTTP ${res.status}`)
  return res.json()
}

async function fetchLocalProject(projectId) {
  const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}`)
  if (!res.ok) throw new Error(`load project ${projectId} failed: HTTP ${res.status}`)
  return res.json()
}

// The Local Server's body route is /files/:id/download. Until S4b's review
// round 1 this asked /files/:id, which no route serves — the SPA fallback
// answered index.html with a 200, so every migrated "file" was the app's own
// page (R1-BEH-01, found in passing). The download is a read, so the desktop
// records one 'downloaded' event per file, as any other read does.
//
// Review round 2 (R2-BEH-02): a body the desktop cannot read (410 — the NAS
// offline, the LEGAL folder locked to this account as LEGAL_LOCAL_NOTE asks;
// any other refusal) is a FAILURE with its reason, never a quiet "skipped":
// skipped reads as "already in the cloud", and a clean report offers to
// archive and clear the desktop's copy.
async function fetchLocalFileBlob(projectId, fileId) {
  const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}/files/${fileId}/download`)
  if (!res.ok) return { blob: null, status: res.status }
  return { blob: await res.blob(), status: res.status }
}

// Already in the cloud? Asked BEFORE any byte moves (review round 2,
// R2-BEH-06): a re-run used to upload the body again and only then meet the
// row's 23505 — and for an invoice or a Legal file, whose key changed in
// round 1, that left an orphan object at the new key. A row this person
// cannot read (another's Legal file) answers nothing, and the upload is then
// refused by the storage policies like any other write they may not make.
// An ERROR is not "not there" (review round 2's re-check, R3-BEH-02): the
// file is then failed with the reason, not uploaded on a guess.
// M2 (review round 1): with its project and its money flag, so another
// project's file is never taken as this one's (nor recorded), and a receipt
// an earlier build carried ungated is said.
async function cloudFileRow(fileId) {
  try {
    const { data, error } = await supabase.from('files').select('id, storage_path, project_id, is_financial, thumbnail_url').eq('id', fileId).maybeSingle()
    return error ? { error } : { row: data || null }
  } catch (err) {
    return { error: err }
  }
}

// Post-overhaul S4b (0088): a Legal file may only land in the cloud under its
// LEGAL folder, and only where that folder is LOCKED — asked of the database
// itself, as supabaseAdapter's probe asks (only a `true` counts). Before 0088
// a LEGAL key is an ordinary folder every member can read, so a Legal file is
// not migrated there at all; the report says why.
// S4d (0092): and the Legal GATE must be there too — can_access_project_legal
// asked with the nil project, the same probe the cloud adapter makes — so
// the migration files Legal files only where the adapter would, and its
// refusal names the same two migrations as LEGAL_UNAVAILABLE does. On a
// 0088-only cloud a Legal file would land locked for the money audience
// and a workspace manager running the migration would meet a raw refusal
// instead (review round 2, finding 11).
async function cloudLocksLegal() {
  try {
    const { data, error } = await supabase.rpc('rabbit_money_segment', { seg: LEGAL_SEGMENT })
    if (error || data !== true) return false
    const gate = await supabase.rpc('can_access_project_legal', { p_project: '00000000-0000-0000-0000-000000000000' })
    return !gate?.error
  } catch {
    return false
  }
}

/**
 * Where a desktop file's body goes in the cloud, by the gate it must stay
 * behind: a Legal file under LEGAL, money under INVOICES (0042's money
 * policies key on that third segment — under `files` an invoice's body was
 * readable by every project member), anything else under `files`. `money`:
 * the file is an invoice, or a receipt an expense or an actual names (M2:
 * routed by the row's own flag alone, a receipt uploaded before C4, flagged
 * false, landed ungated — the handbook's §12.9, residual 3).
 */
function cloudObjectPathFor(projectId, f, money = f?.is_financial === true) {
  const safeName = (f?.name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_')
  const segment = isLegalFile(f) ? LEGAL_SEGMENT : money ? 'INVOICES' : 'files'
  return `projects/${projectId}/${segment}/${f?.id}/${safeName}`
}

// Supabase .insert throws 23505 on pk conflict; we treat that as "already
// migrated" and skip the row silently. Any other error bubbles up.
// Post-overhaul S5b (0090): a desktop row set aside by an open bid version
// arrives LIVE: carrying the stamp before its version is in would hide the
// row for good if the version did not land (and 0090's guard refuses the
// stamp to anyone past the money gate's reach). M2: once this run has
// carried the open version and set the project's pointer to it, the rows it
// set aside are set aside again through set_aside_schedule_rows() (0090).
function withoutSetAside(row) {
  if (!row || typeof row !== 'object' || !('set_aside_at' in row)) return row
  const { set_aside_at: _dropped, ...rest } = row
  return rest
}

// `ours(row)`, when the caller read what the cloud holds for this project:
// a duplicate is "already in the cloud" only if it is this project's row. An
// id that belongs to another project's row (a copied project file; the same
// desktop moved into a second company) is a FAILURE with its reason, never a
// quiet skip that reads as done (review round 2).
//
// M1: `keys`, for a table with unique keys besides its id. A duplicate on
// one of those is ANOTHER row of this project holding the key (a list's
// name, a list's scene, an edit's place in its chain), never "this row is
// already there": `keys[name]` is 'skip' (the cloud holds the same fact) or
// the sentence of a failure. Postgres names the key in its message, which
// PostgREST passes on; a key the map does not name falls to the id rule.
//
// M2 review round 1: `byId` on a skip says whether the row's OWN id was met.
// A key that holds a pair of the row's references (a dependency's two rows,
// an item's task and row, a take's shot and clip) is the cloud holding the
// same fact under another id: skipped, but this id is not in the cloud, so
// the record must not name it (a later run would call it removed).
async function insertOrSkip(table, row, ours = null, keys = null) {
  const { error } = await supabase.from(table).insert(row)
  if (!error) return { status: 'inserted' }
  if (error.code === '23505') { // unique_violation
    const key = uniqueKeyOf(error)
    if (keys && key && keys[key]) {
      if (keys[key] === 'skip') return { status: 'skipped', byId: false }
      // The key's place belongs to a row made in the cloud since, which no
      // run can move: the caller counts it, never as an error (review round 1).
      if (keys[key] === 'taken') return { status: 'taken' }
      throw new Error(`${table}: ${keys[key]}`)
    }
    const byId = key == null || key === `${table}_pkey` || key === `${table}_id_project_key`
    if (!ours || ours(row)) return { status: 'skipped', byId }
    // M2: marked, so what hangs on this row lets its link go (as on a row
    // removed on this computer) rather than wait for a run that never comes.
    const err = new Error(`${table}: a row with this id is in the cloud but is not this project's, so nothing was written for it (${error.message})`)
    err.notOurs = true
    throw err
  }
  throw new Error(`${table}: ${error.message}`)
}

/** The unique key a 23505 names ("…violates unique constraint "shot_lists_pkey""), or null. */
function uniqueKeyOf(error) {
  const m = /unique constraint "([^"]+)"/.exec(String(error?.message || ''))
  return m ? m[1] : null
}

/**
 * Whether insertOrSkip's answer puts the row's id in the record (M2 review
 * round 1): it landed, or its own id was met in the cloud and — where the
 * caller reads the project's rows first — known to be this project's row
 * (`verified`). An id met while that read failed may be another project's,
 * which a later run, not seeing it, would call removed.
 */
const keepsId = (r, verified = true) => r.status === 'inserted' || (r.status === 'skipped' && r.byId !== false && verified)

/** A database function's answer, never a throw: `{ data, error }`. */
async function callRpc(fn, args) {
  try {
    return await supabase.rpc(fn, args)
  } catch (err) {
    return { data: null, error: err }
  }
}

// VW1c (0098): a view or grouping write the cloud adapter refused, said as
// insertOrSkip says its own. Its ids are read first (a row of THIS project is
// skipped without a write), so a duplicate key here is another project's row.
function viewWriteMessage(table, err) {
  if (err?.code === '23505') return `${table}: a row with this id is in the cloud but is not this project's, so nothing was written for it (${err.message})`
  return `${table}: ${err?.message || err}`
}
const hasId = (row) => row?.id != null && row.id !== ''
const isObj = (r) => r != null && typeof r === 'object' && !Array.isArray(r)
const named = (v) => v != null && v !== ''
const idSet = (rows) => new Set((Array.isArray(rows) ? rows : []).filter(isObj).map(r => r.id))
const NO_ID = 'no id recorded, so it was not carried (a second run could not tell it apart from a new one)'


// FX2 review round 1 (R1-2): a desktop task goes up WITHOUT its scene, shot,
// level and experience links. The cloud has no level or experience column (a
// key it does not know refuses the whole insert, PGRST204), and the tasks land
// before the scenes and shots (BC3) while tasks_scene_fk / tasks_shot_fk are
// not deferrable (23503). VW1m (2026-10-16, her ruling: a task's items are its
// items): WITHOUT ITS ASSET too. The five fields on a desktop row are only the
// older builds' copy of its first item of each kind; every item, its assets
// included, arrives as an item after the rows it names (itemsToCarry), and
// 0097 §4 writes the cloud's copy from them. So a task whose first asset
// failed to go up is no longer refused whole by tasks.asset_id's key: the
// task lands, and only that asset's item fails, in the report. Every other
// key goes up as it always has.
// M3 (night 5): its assignee and reviewer are the desktop's team members,
// named by the people map or nobody (a raw desktop id named no one — measured).
function taskRowForCloud(t, people = null) {
  const row = withoutSetAside(t)
  if (!row || typeof row !== 'object') return row
  const {
    asset_id: _asset, scene_id: _scene, shot_id: _shot, level_id: _level, experience_id: _experience, ...rest
  } = row
  if (people) for (const k of ['assignee_id', 'reviewer_id']) if (k in rest && rest[k] != null) rest[k] = people.userOf(rest[k])
  return rest
}

// VW1e (0099, 2026-10-25): an asset's level and experience links are two
// arrays, no foreign key, so nothing in the cloud would refuse an id of a
// row it does not hold — the asset would sit in a level nobody can open.
// Since M2 the levels and experiences land first, and an asset keeps the
// ids the caller names (`keep`: those this run knows to be this project's
// rows in the cloud); an empty list is left out (the column's default).
// Its task template stays here (M2, measured: the company's templates are a
// later run's, and assets_task_template_id_fkey refused the whole asset,
// 23503). Its scene and shot links go up as they always have (BC3 carries
// both).
export function assetRowForCloud(a, keep = {}) {
  if (!a || typeof a !== 'object') return a
  const { level_ids: _levels, experience_ids: _experiences, task_template_id: _template, ...rest } = a
  if (keep.level_ids?.length) rest.level_ids = keep.level_ids
  if (keep.experience_ids?.length) rest.experience_ids = keep.experience_ids
  return rest
}

// The items a project's move carries (and counts): the bundle's own, plus one
// for an asset, a scene, a shot, a level or an experience a task row names
// that no item does (a bundle no Local Server reconciled), so
// taskRowForCloud's dropping the column loses nothing.
function itemsToCarry(bundle) {
  const items = Array.isArray(bundle?.taskItems) ? bundle.taskItems.filter(i => i && typeof i === 'object') : []
  const named = new Set(items.map(i => `${i.task_id}|${i.entity_type}|${i.entity_id}`))
  const extra = []
  for (const t of Array.isArray(bundle?.tasks) ? bundle.tasks : []) {
    if (!t || t.id == null) continue
    for (const [field, kind] of [['asset_id', 'asset'], ['scene_id', 'scene'], ['shot_id', 'shot'], ['level_id', 'level'], ['experience_id', 'experience']]) {
      const id = t[field]
      if (id == null || id === '') continue
      const key = `${t.id}|${kind}|${id}`
      if (named.has(key)) continue
      named.add(key)
      extra.push({ task_id: t.id, entity_type: kind, entity_id: id, position: 0 })
    }
  }
  return [...items, ...extra]
}

// ── BC3 (B9): the bins' reads and writes ──────────────────────────────────

// PostgREST answers at most `max_rows` (1,000 in supabase/config.toml) and
// says nothing about the rest: every list read here is paged by id until a
// page comes back short (review round 1: an unpaged read of a project's
// clips would have re-uploaded every picture past the thousandth).
const PAGE = 1000

/** The rows of `table` where `column` = `value`, every page, or `{ error }` (a read that fails is said, never read as "none"). */
// M3: `orderBy`, for a table with no `id` (project_members pages by user_id).
async function listCloud(table, column, value, columns = '*', orderBy = 'id') {
  const rows = []
  try {
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select(columns).eq(column, value).order(orderBy).range(from, from + PAGE - 1)
      if (error) return { error }
      const page = Array.isArray(data) ? data : []
      rows.push(...page)
      if (page.length < PAGE) break
    }
    return { rows }
  } catch (err) {
    return { error: err }
  }
}

/** The ids `table` already holds for a project, as a Set, or `{ error }`. */
async function cloudIds(table, projectId) {
  const r = await listCloud(table, 'project_id', projectId, 'id')
  return r.error ? r : { ids: new Set(r.rows.map(x => x.id)) }
}

// M2: a filter on a list of values goes in the URL (PostgREST's `in.(…)`),
// so a long list is asked a hundred at a time (a hundred ids is ~3,700
// characters; a page of answers is under PostgREST's thousand).
const IN_CHUNK = 100

/** The rows of `table` whose `column` is one of `values`, every chunk, or `{ error }`. */
async function listCloudIn(table, column, values, columns = 'id') {
  const rows = []
  const all = [...new Set([...(values || [])].filter(v => v != null && v !== '').map(String))]
  try {
    for (let i = 0; i < all.length; i += IN_CHUNK) {
      const { data, error } = await supabase.from(table).select(columns).in(column, all.slice(i, i + IN_CHUNK))
      if (error) return { error }
      rows.push(...(Array.isArray(data) ? data : []))
    }
    return { rows }
  } catch (err) {
    return { error: err }
  }
}

/** The company's footage locations: `[{ id, name, unc_path }]`, or `{ error }`. */
async function cloudLocations(workspaceId) {
  const r = await listCloud('bin_locations', 'workspace_id', workspaceId, 'id, name, unc_path')
  return r.error ? r : { rows: r.rows }
}

/**
 * The company's switch (B4, B5a), read once per run. An error reads as OFF
 * (fail closed: not a byte of a picture leaves while the answer is unknown),
 * and the report says the read failed.
 */
async function remoteViewingOn(workspaceId) {
  try {
    const { data, error } = await supabase.from('workspaces').select('remote_viewing_enabled').eq('id', workspaceId).maybeSingle()
    if (error) return { on: false, error }
    return { on: data?.remote_viewing_enabled === true }
  } catch (err) {
    return { on: false, error: err }
  }
}

/** The desktop's picture of a clip (its own poster cache, made on demand): JPEG bytes, or null with the reason. */
async function fetchLocalPoster(projectId, fileId) {
  const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}/bin-files/${fileId}/thumbnail`)
  if (!res.ok) return { bytes: null, why: `HTTP ${res.status}` }
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.length < 3 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) return { bytes: null, why: 'not a JPEG' }
  if (buf.length > POSTER_MAX_BYTES) return { bytes: null, why: `${buf.length} bytes, over the ${POSTER_MAX_BYTES}-byte cap` }
  return { bytes: buf }
}

/**
 * One clip's picture to the cloud, the way BC2's upload does it: the key
 * under the clip's own project (0091's shape), upsert off, the row's
 * `poster_path` PATCHed after; an object whose row refuses it is taken back.
 */
async function uploadPoster(projectId, fileId, bytes) {
  const key = `projects/${projectId}/bin_files/${fileId}/${Date.now()}-poster.jpg`
  const { error: upErr } = await supabase.storage.from(POSTER_BUCKET).upload(key, bytes, { contentType: 'image/jpeg', upsert: false })
  if (upErr) throw new Error(/row-level security|petal_bin_posters/.test(upErr.message || '') ? 'the company has not allowed files to be viewed from outside the office network' : `storage upload: ${upErr.message}`)
  // The row must be THIS project's (review round 1, security: an id the
  // bundle shares with another project's row matches nothing here, and the
  // object would have sat under this project's prefix for ever).
  const { data: rows, error: rowErr } = await supabase.from('bin_files').update({ poster_path: key }).eq('id', fileId).eq('project_id', projectId).select('id')
  if (rowErr || !Array.isArray(rows) || rows.length !== 1) {
    try { await supabase.storage.from(POSTER_BUCKET).remove([key]) } catch { /* the refusal below is the answer */ }
    throw new Error(rowErr ? `bin_files: ${rowErr.message}` : 'bin_files: the clip\'s row is no longer in the cloud under this project (removed meanwhile), so its picture was taken back')
  }
  return key
}

const BINS_BUCKETS = ['scenes', 'shots', 'bins', 'binLocations', 'binFiles', 'shotTakes']

function makeReport() {
  return {
    dryRun: false,
    workspaceId: null,
    projects:      { total: 0, inserted: 0, skipped: 0, failed: 0 },
    phases:        { total: 0, inserted: 0, skipped: 0, failed: 0 },
    assets:        { total: 0, inserted: 0, skipped: 0, failed: 0 },
    tasks:         { total: 0, inserted: 0, skipped: 0, failed: 0 },
    // M2: a task's dependencies on other tasks (was `taskLinks`, the name of
    // the bundle's links on tasks — below — before part 2 carried those).
    taskDependencies: { total: 0, inserted: 0, skipped: 0, failed: 0 },
    phaseLinks:    { total: 0, inserted: 0, skipped: 0, failed: 0 },
    // M2 (night 4): part 2. `taskLinks`: a task's links (0000's task_links);
    // `orphans`, a link on a task removed on this computer. The money tables
    // are carried only past the money gate (`moneyLeft` below); a line priced
    // for one of this computer's team members goes up without the person, and
    // a team member's rate stays here (notCarried's lineTeamMembers,
    // memberRates); `budgetActuals.orphans`: on a line removed on this computer.
    levels:        { total: 0, inserted: 0, skipped: 0, failed: 0 },
    experiences:   { total: 0, inserted: 0, skipped: 0, failed: 0 },
    taskLinks:     { total: 0, inserted: 0, skipped: 0, failed: 0, orphans: 0 },
    budgetVersions: { total: 0, inserted: 0, skipped: 0, failed: 0 },
    // Review round 1: `pctsLeftOut`, lines whose own percentage the cloud
    // cannot hold (LINE_PCTS_LEFT_OUT); `taken`, an actual or a role rate
    // whose place another row holds (ACTUALS_TAKEN, RATES_TAKEN).
    budgetLines:   { total: 0, inserted: 0, skipped: 0, failed: 0, pctsLeftOut: 0 },
    budgetActuals: { total: 0, inserted: 0, skipped: 0, failed: 0, orphans: 0, taken: 0 },
    expenses:      { total: 0, inserted: 0, skipped: 0, failed: 0 },
    rateOverrides: { total: 0, inserted: 0, skipped: 0, failed: 0, taken: 0 },
    // `receiptsOpen` (review round 1): receipts an earlier build carried as
    // ordinary files, said on every run (RECEIPTS_LEFT_OPEN).
    files:         { total: 0, inserted: 0, skipped: 0, failed: 0, bytes: 0, placed: 0, linksLetGo: 0, receiptsGated: 0, receiptsOpen: 0 },
    // BC3 (B9): the bins' part. `binFiles.leftBehind` counts the clips whose
    // root nobody named (listed in `clipsLeftBehind`, never dropped);
    // `posters` counts the pictures (uploaded only while the switch is on).
    scenes:        { total: 0, inserted: 0, skipped: 0, failed: 0 },
    shots:         { total: 0, inserted: 0, skipped: 0, failed: 0 },
    bins:          { total: 0, inserted: 0, skipped: 0, failed: 0 },
    binLocations:  { total: 0, inserted: 0, skipped: 0, failed: 0 },
    binFiles:      { total: 0, inserted: 0, skipped: 0, failed: 0, leftBehind: 0 },
    // `orphans`: takes of a shot or clip removed on this computer — not
    // carried, not counted in `total`, not an error (ORPHAN_TAKES).
    shotTakes:     { total: 0, inserted: 0, skipped: 0, failed: 0, leftBehind: 0, orphans: 0 },
    // FX2 (0096): a task's items (the assets, scenes, shots and, since M2,
    // the levels and experiences it is about).
    taskItems:     { total: 0, inserted: 0, skipped: 0, failed: 0 },
    // VW1c (0098): the saved views and groupings (since M2 the groupings of
    // levels and experiences too).
    tableViews:    { total: 0, inserted: 0, skipped: 0, failed: 0 },
    itemGroupings: { total: 0, inserted: 0, skipped: 0, failed: 0 },
    // M1 (night 3). A row the run does not try to carry is counted beside
    // `total`, never in it: `trashed` (in this computer's Recently deleted,
    // or marked removed), `orphans` (on a row removed on this computer, or in
    // the cloud's trash), `leftBehind` (a kind the cloud cannot hold), a
    // folder whose place is `taken`. `archived`: the lists and edits
    // archived in the cloud as on this computer; `files.placed`: the files
    // filed in a folder.
    milestones:    { total: 0, inserted: 0, skipped: 0, failed: 0, trashed: 0, phaseLetGo: 0 },
    comments:      { total: 0, inserted: 0, skipped: 0, failed: 0, trashed: 0, orphans: 0, leftBehind: 0 },
    shotLists:     { total: 0, inserted: 0, skipped: 0, failed: 0, archived: 0 },
    shotListItems: { total: 0, inserted: 0, skipped: 0, failed: 0, orphans: 0 },
    edits:         { total: 0, inserted: 0, skipped: 0, failed: 0, archived: 0, taken: 0, orphans: 0 },
    folders:       { total: 0, inserted: 0, skipped: 0, failed: 0, orphans: 0, taken: 0 },
    // What the project rows leave on this computer (projectRowForCloud): how
    // many name a folder, the statuses the cloud does not have (status →
    // projects) and the values it cannot hold (how many projects; word →
    // projects), these two only for a project that arrives; and the lists
    // and edits archived here that the cloud holds live.
    projectsLeftAtHome: { folders: 0, statuses: {}, withValues: 0, values: {} },
    liveInCloud: 0,
    // M2. `moneyLeft`: the projects whose budget stays here because the
    // person running the move cannot see it in the cloud (0037's gate), with
    // their money rows and receipts. `rowLinksLetGo`: a phase's, asset's,
    // task's or bid version's link to a row removed on this computer, in the
    // cloud's trash, or not this project's there (ROW_LINKS_LET_GO).
    // `setAside`: rows set aside again by the open bid version. `removed`:
    // the rows earlier runs carried that the cloud no longer shows (a
    // teammate removed them): per table, and each named — never inserted
    // again (the record, `recordKept` false when this computer could not
    // keep it).
    moneyLeft: { projects: 0, rows: 0, receipts: 0 },
    rowLinksLetGo: 0,
    setAside: 0,
    removed: { byTable: {}, rows: [] },
    recordKept: true,
    // M3 (night 5). `projectMembers`: the roster's seats (`unmatched`: of
    // people without an account; `datesLeft`, `rolesLeft`: what a seat has no
    // column for; `left`: seats the cloud refused this person). `rateCards`
    // and `rateCardEntries` (`empty`: the desktop's own shells; `defaultsLeft`;
    // `unmatched`, `left`), `taskTemplates` (`orphans`: pinned to a project not
    // on this computer; `left`: refused). `managedFiles`: the files kept with
    // rows (`bodiesGone`: 410 on this computer; `server`, `privateHome`: stay
    // by rule; `overCap`, `overBound`; `versions`: labels left). `people`: the
    // map's answer, the managers seated, the people set on earlier rows.
    // `needsRights`: what this person could not do, so the run is not done.
    projectMembers:  { total: 0, inserted: 0, skipped: 0, failed: 0, unmatched: 0, datesLeft: 0, rolesLeft: 0, left: 0 },
    rateCards:       { total: 0, inserted: 0, skipped: 0, failed: 0, empty: 0, defaultsLeft: 0, left: 0 },
    rateCardEntries: { total: 0, inserted: 0, skipped: 0, failed: 0, unmatched: 0, left: 0 },
    taskTemplates:   { total: 0, inserted: 0, skipped: 0, failed: 0, orphans: 0, left: 0 },
    managedFiles:    { total: 0, inserted: 0, skipped: 0, failed: 0, uploaded: 0, bytes: 0, placed: 0, linksLetGo: 0, bodiesGone: 0, server: 0, privateHome: 0, overCap: 0, overBound: 0, versions: 0 },
    people: { canMatch: null, desktop: 0, matched: 0, unmatched: [], shared: 0, managersSeated: [], set: 0, needAdmin: false, unread: null },
    needsRights: { rateCards: false, templates: false, roster: false },
    receiptsMoved: 0,
    assetTemplatesLinked: 0,
    posters:       { total: 0, uploaded: 0, skipped: 0, failed: 0, switchOff: 0 },
    // What the bundles hold that the runner does not carry (notCarriedOf),
    // summed over the projects: `[{ key, label, count }]`.
    notCarried: [],
    // The question: every distinct root of every project's clips, with what
    // the answers (if any) resolved it to — `[{ root, key, kind, count,
    // projects, resolved }]` — and the company's locations it was asked
    // against, so the panel can resolve a typed answer the same way.
    footageRoots: [],
    footageLocations: [],
    clipsLeftBehind: [],
    remoteViewing: null,
    errors: [],
    startedAt: new Date().toISOString(),
    finishedAt: null,
  }
}

// The desktop bundle carries task→task and phase→phase edges in ONE array,
// told apart by `kind` (literally 'phase', or anything else = task) — the
// adapter's dependencyKind is the rule.
function countLinks(dependencies) {
  const out = { task: 0, phase: 0 }
  for (const dep of dependencies ?? []) out[dependencyKind(dep)]++
  return out
}
const plural = (n, noun, many = `${noun}s`) => `${n} ${n === 1 ? noun : many}`

function bumpInserted(bucket) { bucket.total++; bucket.inserted++ }
function bumpSkipped(bucket)  { bucket.total++; bucket.skipped++ }
function bumpFailed(bucket)   { bucket.total++; bucket.failed++ }

/**
 * Migrate local RABBIT data into the given workspace.
 *
 * @param {object} opts
 * @param {string} opts.workspaceId Target workspace UUID.
 * @param {boolean} [opts.dryRun]   If true, enumerate only; no writes.
 * @param {(msg: string) => void} [opts.onProgress] Progress callback.
 * @param {object} [opts.locations] BC3 (B9): the answers to "Which footage
 *   location is this?", keyed by the root's key (binsMigration.pathKey):
 *   `{ unc_path, name? }` names a location (an existing one by address, or
 *   a new one), `{ skip: true }` leaves the root's clips on this computer.
 *   The dry run lists the roots to ask about (`report.footageRoots`).
 * @returns {Promise<object>} Report object with per-table counters.
 */
export async function runMigration({ workspaceId, dryRun = false, onProgress, locations = {} }) {
  if (!workspaceId) throw new Error('workspaceId required')
  const report = makeReport()
  report.dryRun      = dryRun
  report.workspaceId = workspaceId

  const note = (m) => { try { onProgress?.(m) } catch { /* swallow */ } }
  // BC3: the company's locations (read once, when a project has clips), the
  // switch (read once, when a clip could have a picture), the roots of every
  // project (the question), and the locations made in this run.
  const binsState = { locations: null, locationsError: null, switch: null, roots: [], answers: locations || {} }
  const notCarried = new Map()
  // One line of the not-carried sentence, summed over the projects: its
  // words from NOT_CARRIED (binsMigration.js), `later` when a later run of
  // the migration carries it (M1: the panel says the two apart).
  const addNotCarried = (key, count) => {
    if (!count) return
    const e = notCarried.get(key) || { key, count: 0 }
    e.count += count
    e.label = notCarriedLabel(key, e.count)
    e.later = notCarriedLater(key)
    notCarried.set(key, e)
  }
  const countNotCarried = (bundle) => {
    for (const { key, count } of notCarriedOf(bundle)) addNotCarried(key, count)
  }
  // The live takes of a bundle: those whose shot and clip are in it. The rest
  // are the desktop's orphans (kept for undo, shown to nobody): not carried.
  const liveTakesOf = (bundle) => {
    const takes = bundle.shotTakes ?? []
    const shots = new Set((bundle.shots ?? []).map(s => s?.id))
    const clips = new Set((bundle.binFiles ?? []).map(c => c?.id))
    const live = takes.filter(t => t && shots.has(t.shot_id) && clips.has(t.bin_file_id))
    const orphans = takes.length - live.length
    if (orphans) { report.shotTakes.orphans += orphans; note(`  ${ORPHAN_TAKES(orphans)}`) }
    return live
  }
  const companyLocations = async () => {
    if (binsState.locations) return binsState.locations
    const r = await cloudLocations(workspaceId)
    if (r.error) { binsState.locationsError = r.error; binsState.locations = []; report.errors.push({ scope: 'bin_locations', message: `could not read the company's footage locations: ${r.error.message || r.error}` }) }
    else binsState.locations = r.rows
    report.footageLocations = binsState.locations.map(l => ({ id: l.id, name: l.name, unc_path: l.unc_path }))
    return binsState.locations
  }
  const switchOn = async () => {
    if (binsState.switch) return binsState.switch.on
    binsState.switch = await remoteViewingOn(workspaceId)
    report.remoteViewing = binsState.switch.on
    if (binsState.switch.error) report.errors.push({ scope: 'posters', message: `could not read the company's remote-viewing switch, so no picture was uploaded: ${binsState.switch.error.message || binsState.switch.error}` })
    return binsState.switch.on
  }
  // The answer for a root, resolved against the company's list: cached per
  // root, so one new location serves every clip and every project under it.
  const resolvedAnswers = new Map()
  const resolveRoot = async (root) => {
    if (resolvedAnswers.has(root.key)) return resolvedAnswers.get(root.key)
    const existing = await companyLocations()
    const r = resolveRootAnswer(root, binsState.answers[root.key], existing)
    resolvedAnswers.set(root.key, r)
    return r
  }
  // A location named now: made once (a race with a teammate naming the same
  // share reads back the row they made).
  const locationIdFor = async (resolved) => {
    if (resolved.kind === 'existing') return resolved.location.id
    if (resolved.location) return resolved.location.id
    const row = { id: crypto.randomUUID(), workspace_id: workspaceId, name: resolved.name, unc_path: resolved.unc_path }
    const r = await insertOrSkip('bin_locations', row)
    if (r.status === 'inserted') {
      bumpInserted(report.binLocations)
      resolved.location = row
      binsState.locations.push(row)
      report.footageLocations.push({ id: row.id, name: row.name, unc_path: row.unc_path })
      note(`  Footage location "${row.name}" (${row.unc_path}) named`)
      return row.id
    }
    // Already there (another run, a teammate): read it back by address.
    bumpSkipped(report.binLocations)
    const again = await cloudLocations(workspaceId)
    const hit = (again.rows || []).find(l => pathKey(l.unc_path) === pathKey(resolved.unc_path))
    if (!hit) throw new Error(`bin_locations: "${resolved.unc_path}" is already in the company's list but could not be read back`)
    resolved.location = hit
    binsState.locations = again.rows
    return hit.id
  }

  // VW1c (0098): the views' part. The cloud adapter writes the rows (its
  // column allowlist, its refusals in words: one vocabulary) and reads what
  // the cloud already holds of a project's views and groupings — its paged
  // reads, which are its probe too (a cloud without 0098 answers none, and
  // says so through tableViewsAvailable).
  const viewsAdapter = supabaseAdapter()
  // A grouping of a kind the cloud's pair CHECK lacks is sent all the same
  // and its refusal said (0098's item_groupings_pair_chk; no build writes one).
  const viewsPartOf = (bundle) => ({
    views: (bundle.tableViews ?? []).filter(v => v && typeof v === 'object'),
    carried: (bundle.itemGroupings ?? []).filter(g => g && typeof g === 'object'),
  })
  // `{ views, groupings }` (the ids the cloud holds for the project, as
  // Sets), `{ absent: true }` (no 0098 there) or `{ error }` (a read that
  // failed is said, never read as "none there").
  const cloudViewIds = async (projectId) => {
    try {
      const [views, groupings] = await Promise.all([viewsAdapter.listTableViews(projectId), viewsAdapter.listItemGroupings(projectId)])
      if (!viewsAdapter.tableViewsAvailable()) return { absent: true }
      return { views: new Set(views.map(r => r.id)), groupings: new Set(groupings.map(r => r.id)) }
    } catch (err) {
      return { error: err }
    }
  }
  const viewsNote = (views, groupings, where = '') => `  ${plural(views, 'saved view')} and ${plural(groupings, 'grouping')}${where}`
  // M2, counted alike by the dry run and the real one: what a project's
  // assets say of the desktop's task templates, and — when its budget goes
  // up (`moneyGoes`; else all of it stays, MONEY_GATE_LEFT) — what its lines
  // and rates say of the desktop's team members (a later run's), and its
  // invoices attached by a path on this computer (never carried).
  // M3: a person column names someone without an account (the people map),
  // or no one: counted per kind; the assets' templates are counted after
  // the templates land (linkAssetTemplates).
  const countPart2LeftAtHome = (bundle, moneyGoes) => {
    addNotCarried('taskPeople', (bundle.tasks ?? []).filter(t => isObj(t) && (unmatchedPerson(t.assignee_id) || unmatchedPerson(t.reviewer_id))).length)
    const p = bundle.project ?? {}
    addNotCarried('projectPeople', ['producer_id', 'director_id'].filter(k => unmatchedPerson(p[k])).length)
    if (!moneyGoes) return
    addNotCarried('lineTeamMembers', (bundle.budgetLines ?? []).filter(l => isObj(l) && unmatchedPerson(l.team_member_id)).length)
    addNotCarried('memberRates', (bundle.projectRateOverrides ?? []).filter(o => isObj(o) && isMemberRate(o) && unmatchedPerson(o.member_id)).length)
    addNotCarried('invoicePaths', (bundle.budgetActuals ?? []).filter(a => isObj(a) && isLegacyAttachment(a.attachment_path)).length)
  }
  // M2: the money a bundle holds (the five 0037 tables) and the files that
  // must stay behind the money gate (invoices, and the receipts an expense or
  // an actual names); and whether the person running the move can see this
  // project's budget in the cloud. Only a `true` counts (measured: for a
  // member with no seat on the project can_access_project_money answers NULL);
  // a project the run is about to insert is theirs to manage
  // (fn_projects_auto_staff seats the inserting person — measured), so the
  // dry run takes it as seen.
  const MONEY_KEYS = ['budgetVersions', 'budgetLines', 'budgetActuals', 'expenses', 'projectRateOverrides']
  const moneyOf = (bundle) => {
    const receipts = receiptFileIds(bundle)
    const files = (bundle.files ?? []).filter(f => isObj(f) && (f.is_financial === true || receipts.has(String(f.id))))
    return { rows: MONEY_KEYS.reduce((s, k) => s + (bundle[k] ?? []).filter(isObj).length, 0), receipts, files }
  }
  // `{ sees, unasked }`: a question the cloud did not answer is an error, said
  // as one — never MONEY_GATE_LEFT's "you are neither" (review round 1).
  const canSeeMoney = async (projectId) => {
    const { data, error } = await callRpc('can_access_project_money', { p_project: projectId })
    if (error) report.errors.push({ scope: 'budget', projectId, message: `could not ask whether you can see this project's budget in the cloud, so none of it was carried (run again): ${error.message || error}` })
    return { sees: data === true, unasked: !!error }
  }
  const moneyAsk = async (money, projectId, inserting) => (
    !(money.rows || money.files.length) || inserting ? { sees: true, unasked: false } : canSeeMoney(projectId)
  )
  const leaveMoney = (money) => {
    report.moneyLeft.projects++
    report.moneyLeft.rows += money.rows
    report.moneyLeft.receipts += money.files.length
    note(`  ${MONEY_GATE_LEFT(1, money.rows)}`)
  }

  // ── M1 (night 3): the project row and the five kinds ───────────────────
  //
  // Each kind is one function for the dry run and the real one alike
  // (`dry`: counted as the real run would take it, nothing written), so the
  // dry run's promise is the real run's code. A row of the five kinds keeps
  // its id; a second run skips what is there, and writes nothing for it.

  // What a project row leaves on this computer, said per project. Its status
  // and the values the cloud cannot hold are said only for a project that
  // arrives in this run (`arriving`; review round 2: on a second run, or for
  // a refused project, "it arrives as active" was untrue). `statusRefused`:
  // a status the row carried that the cloud's type refused (a cloud without
  // 0103), the row then sent again without it (M2).
  const countProjectLeftAtHome = (bundle, arriving, statusRefused = null) => {
    const home = projectLeftAtHome(bundle.project)
    if (home.folder) { report.projectsLeftAtHome.folders++; note(`  ${PROJECT_FOLDER_STAYS(1)}`) }
    if (!arriving) return
    const status = home.status || statusRefused
    if (status) {
      const st = report.projectsLeftAtHome.statuses
      st[status] = (st[status] || 0) + 1
      note(`  ${STATUS_NOT_IN_CLOUD(1, [status])}`)
    }
    if (home.values.length) {
      report.projectsLeftAtHome.withValues++
      const v = report.projectsLeftAtHome.values
      for (const w of home.values) v[w] = (v[w] || 0) + 1
      note(`  ${VALUES_NOT_IN_CLOUD(1, home.values)}`)
    }
  }
  // Whether the project is in the cloud already: `{ there, ours }` — `ours`,
  // in this workspace (M2 review round 1: a project's id another workspace
  // holds is not this run's to fill) — or `{ error }`.
  const cloudProjectThere = async (projectId) => {
    try {
      const { data, error } = await supabase.from('projects').select('id, workspace_id').eq('id', projectId).maybeSingle()
      return error ? { error } : { there: !!data, ours: !!data && data.workspace_id === workspaceId }
    } catch (err) {
      return { error: err }
    }
  }

  // This project's key dates in the cloud by id, its trash included: a key
  // date removed there keeps its id (0067), so a second run skips it rather
  // than bringing it back. `{ ids }`, or `{ error }` for the caller to say.
  // The trash is read through 0067's index (a trashed row is invisible to a
  // read of the table); a project not in the cloud yet has neither.
  const cloudMilestoneIds = async (projectId) => {
    const live = await listCloud('milestones', 'project_id', projectId, 'id')
    if (live.error) return { error: live.error }
    const ids = new Set(live.rows.map(r => r.id))
    const { data, error } = await callRpc('milestones_trash_index', { p_project_id: projectId })
    if (!error) {
      for (const r of Array.isArray(data) ? data : []) if (r?.id) ids.add(r.id)
      return { ids }
    }
    try {
      const there = await supabase.from('projects').select('id').eq('id', projectId).maybeSingle()
      if (!there.error && !there.data) return { ids }
    } catch { /* the trash's refusal is the answer */ }
    return { error }
  }

  // Key dates (0067), after the phases they may sit in. `rc`: the project's
  // record of what earlier runs carried (M2; recordContext below).
  const carryMilestones = async (bundle, projectId, stateOf, dry, rc) => {
    const all = (bundle.milestones ?? []).filter(isObj)
    const live = all.filter(m => !named(m.deleted_at))
    if (all.length > live.length) {
      report.milestones.trashed += all.length - live.length
      note(`  ${KEY_DATES_TRASHED(all.length - live.length)}`)
    }
    if (!live.length) return
    const known = await cloudMilestoneIds(projectId)
    if (known.error) report.errors.push({ scope: 'milestones', projectId, message: `could not read the key dates already in the cloud, so one refused as a duplicate reads as already there: ${known.error.message || known.error}` })
    let phaseLetGo = 0
    for (const m of live) {
      if (!hasId(m)) { report.errors.push({ scope: 'milestone', projectId, message: NO_ID }); bumpFailed(report.milestones); continue }
      const g = rc.gate('milestones', m.id)
      if (g === 'removed') { rc.removed('milestones', m); continue }
      if (known.ids?.has(m.id) || g === 'there') { bumpSkipped(report.milestones); rc.add('milestones', m.id); continue }
      const row = milestoneRowForCloud(m, projectId)
      const name = m.title || m.name || m.id
      // Its phase is a plain foreign key (no project in it): only a phase the
      // cloud shows under THIS project is kept; one that did not land in this
      // run fails the key date with it (a second run brings both); one
      // removed on this computer (the desktop's phase delete leaves its key
      // dates' link), or not this project's, is let go — counted and said,
      // not an error (review round 1: an error made a first run not Done for
      // a thing no run could change).
      let letGo = false
      if (named(row.phase_id)) {
        const st = await stateOf('phases', row.phase_id)
        if (st === 'unread') { report.errors.push({ scope: 'milestone', projectId, id: m.id, message: `${name}: whether its phase is in the cloud could not be checked (the read failed), so the key date was not carried (run again)` }); bumpFailed(report.milestones); continue }
        if (st === 'failed') { report.errors.push({ scope: 'milestone', projectId, id: m.id, message: `${name}: its phase is not in the cloud, so the key date was not carried (a second run brings both)` }); bumpFailed(report.milestones); continue }
        if (st === 'gone') { row.phase_id = null; letGo = true }
      }
      if (dry) { bumpInserted(report.milestones); if (letGo) phaseLetGo++; continue }
      try {
        const r = await insertOrSkip('milestones', row, known.ids ? (x) => known.ids.has(x.id) : null)
        r.status === 'inserted' ? bumpInserted(report.milestones) : bumpSkipped(report.milestones)
        if (keepsId(r, !!known.ids)) rc.add('milestones', m.id, r.status === 'inserted')
        if (letGo && r.status === 'inserted') phaseLetGo++
      } catch (err) {
        report.errors.push({ scope: 'milestone', projectId, id: m.id, message: `${name}: ${err.message}` })
        bumpFailed(report.milestones)
      }
    }
    report.milestones.phaseLetGo += phaseLetGo
    if (phaseLetGo) note(`  ${KEY_DATES_PHASE_LET_GO(phaseLetGo)}`)
  }

  // Comments (0000), after the rows they hang on. The dry run counts the
  // ones whose row goes up (Total, as for phases, assets and tasks: which are
  // there already the cloud cannot say by project — a comment has none).
  const carryComments = async (bundle, projectId, stateOf, dry, rc) => {
    const counts = { removed: 0, gone: 0, elsewhere: 0 }
    for (const c of (bundle.comments ?? []).filter(isObj)) {
      if (named(c.deleted_at)) { counts.removed++; continue }
      const table = COMMENT_TARGETS[c.entity_type]
      if (!table) { counts.elsewhere++; continue }
      const g = hasId(c) ? rc.gate('comments', c.id) : 'new'
      if (g === 'removed') { rc.removed('comments', c); continue }
      if (g === 'there') { dry ? report.comments.total++ : bumpSkipped(report.comments); continue }
      const st = table === 'projects' ? (String(c.entity_id) === String(projectId) ? 'landed' : 'gone') : await stateOf(table, c.entity_id)
      if (st === 'gone') { counts.gone++; continue }
      if (st === 'unread') { report.errors.push({ scope: 'comment', projectId, id: c.id, message: `whether its ${c.entity_type} is in the cloud could not be checked (the read failed), so the comment was not carried (run again)` }); bumpFailed(report.comments); continue }
      if (st === 'failed') { report.errors.push({ scope: 'comment', projectId, id: c.id, message: `its ${c.entity_type} is not in the cloud, so the comment was not carried (a second run brings both)` }); bumpFailed(report.comments); continue }
      if (!hasId(c)) { report.errors.push({ scope: 'comment', projectId, message: NO_ID }); bumpFailed(report.comments); continue }
      if (dry) { report.comments.total++; continue }
      try {
        // A comment removed in the cloud keeps its id there (0014), unseen
        // by a read: a duplicate counts as already there, never comes back.
        const r = await insertOrSkip('comments', commentRowForCloud(c))
        r.status === 'inserted' ? bumpInserted(report.comments) : bumpSkipped(report.comments)
        if (keepsId(r)) rc.add('comments', c.id)
      } catch (err) {
        report.errors.push({ scope: 'comment', projectId, id: c.id, message: err.message })
        bumpFailed(report.comments)
      }
    }
    report.comments.trashed += counts.removed
    report.comments.orphans += counts.gone
    report.comments.leftBehind += counts.elsewhere
    addNotCarried('commentsElsewhere', counts.elsewhere)
    if (counts.removed) note(`  ${COMMENTS_REMOVED(counts.removed)}`)
    if (counts.gone) note(`  ${COMMENTS_ON_GONE_ROWS(counts.gone)}`)
  }

  // The project's active shot list in the cloud: `{ id }` (null: none), or `{ error }`.
  const cloudActiveList = async (projectId) => {
    try {
      const { data, error } = await supabase.from('projects').select('active_shot_list_id').eq('id', projectId).maybeSingle()
      return error ? { error } : { id: data?.active_shot_list_id ?? null }
    } catch (err) {
      return { error: err }
    }
  }
  const nameKeyOf = (row) => `${String(row?.title ?? '').trim()}|${row?.version ?? 1}`

  // Shot lists, their items and edits (0084), after the scenes and shots.
  // A list arrives LIVE (0084 refuses a row inserted archived — 42501,
  // measured) and is archived after, through archive_shot_list(), as the
  // client archives one; the active list is set through
  // set_active_shot_list() once the lists are in. Items keep their list and
  // position; edits come each after the edit it continues (0084's guard).
  // `landed`: the scenes and shots in the cloud for this project. Answers
  // (M2) the lists in the cloud as this project's (`ours`: inserted, or read
  // there; a bid version's shot list is kept only to one of these) and those
  // that failed in this run (a version on one waits with it); review round
  // 1: `unread`, those skipped by their key while the read of the project's
  // lists failed — in the cloud, whose not known (a version on one waits).
  const carryShotLists = async (bundle, projectId, landed, dry, rc) => {
    const lists = (bundle.shotLists ?? []).filter(isObj)
    const items = (bundle.shotListItems ?? []).filter(isObj)
    const edits = (bundle.edits ?? []).filter(isObj)
    const outcome = { ours: new Set(), failed: new Set(), unread: new Set() }
    if (!lists.length && !items.length && !edits.length) return outcome
    const read = async (table, columns, rows) => {
      if (!rows.length) return { rows: [] }
      const r = await listCloud(table, 'project_id', projectId, columns)
      if (r.error) report.errors.push({ scope: table, projectId, message: `could not read what the cloud already holds, so a row refused as a duplicate reads as already there: ${r.error.message || r.error}` })
      return r
    }
    const haveLists = await read('shot_lists', 'id, title, version, archived_at', lists)
    const haveItems = await read('shot_list_items', 'id, shot_list_id, scene_id, shot_id', items)
    const haveEdits = await read('edits', 'id, shot_list_id, title, version, parent_edit_id, archived_at', edits)
    const cloudLists = new Map((haveLists.rows || []).map(l => [l.id, l]))
    const cloudEdits = new Map((haveEdits.rows || []).map(e => [e.id, e]))
    const listNames = new Set((haveLists.rows || []).map(nameKeyOf))
    const editNames = new Set((haveEdits.rows || []).map(e => `${e.shot_list_id}|${nameKeyOf(e)}`))
    const listsHere = idSet(lists)
    const scenesHere = idSet(bundle.scenes)
    const shotsHere = idSet(bundle.shots)
    const landedLists = new Set()
    const insertedLists = new Set()
    // M2: a list or an edit removed in the cloud since an earlier run is not
    // carried again, and what hangs on it is let go with it (not an error).
    const removedLists = new Set()
    const removedEdits = new Set()
    let liveThere = 0
    for (const l of lists) {
      if (!hasId(l)) { report.errors.push({ scope: 'shot_list', projectId, message: NO_ID }); bumpFailed(report.shotLists); continue }
      const there = cloudLists.get(l.id)
      if (there) { bumpSkipped(report.shotLists); landedLists.add(l.id); outcome.ours.add(l.id); rc.add('shot_lists', l.id); if (isArchived(l) && !isArchived(there)) liveThere++; continue }
      const g = rc.gate('shot_lists', l.id)
      if (g === 'removed') { rc.removed('shot_lists', l, listLabel(l)); removedLists.add(l.id); continue }
      // In the record and in the cloud: this project's (the record names only
      // rows known to be; review round 1, M3).
      if (g === 'there') { bumpSkipped(report.shotLists); landedLists.add(l.id); outcome.ours.add(l.id); continue }
      if (listNames.has(nameKeyOf(l))) { report.errors.push({ scope: 'shot_list', projectId, id: l.id, message: SHOT_LIST_NAME_TAKEN(listLabel(l)) }); bumpFailed(report.shotLists); outcome.failed.add(l.id); continue }
      if (dry) { bumpInserted(report.shotLists); landedLists.add(l.id); insertedLists.add(l.id); outcome.ours.add(l.id); continue }
      try {
        const r = await insertOrSkip('shot_lists', shotListRowForCloud(l, projectId), haveLists.error ? null : (x) => cloudLists.has(x.id), { shot_lists_project_title_version_key: SHOT_LIST_NAME_TAKEN(listLabel(l)) })
        if (r.status === 'inserted') { bumpInserted(report.shotLists); insertedLists.add(l.id); outcome.ours.add(l.id) } else bumpSkipped(report.shotLists)
        if (r.status !== 'inserted') outcome[haveLists.error ? 'unread' : 'ours'].add(l.id)
        landedLists.add(l.id)
        if (keepsId(r, !haveLists.error)) rc.add('shot_lists', l.id)
      } catch (err) {
        report.errors.push({ scope: 'shot_list', projectId, id: l.id, message: err.message })
        bumpFailed(report.shotLists)
        outcome.failed.add(l.id)
      }
    }
    const pairOf = (i) => (named(i?.scene_id) ? `${i.shot_list_id}|scene|${i.scene_id}` : `${i?.shot_list_id}|shot|${i?.shot_id}`)
    const itemIds = new Set((haveItems.rows || []).map(i => i.id))
    const itemPairs = new Set((haveItems.rows || []).map(pairOf))
    let itemsGone = 0
    for (const it of itemsInListOrder(items, lists)) {
      if (!hasId(it)) { report.errors.push({ scope: 'shot_list_item', projectId, message: NO_ID }); bumpFailed(report.shotListItems); continue }
      if (!landedLists.has(it.shot_list_id)) {
        if (listsHere.has(it.shot_list_id) && !removedLists.has(it.shot_list_id)) { report.errors.push({ scope: 'shot_list_item', projectId, id: it.id, message: 'its shot list is not in the cloud, so the item was not carried (a second run brings both)' }); bumpFailed(report.shotListItems) }
        else itemsGone++
        continue
      }
      if (itemIds.has(it.id) || itemPairs.has(pairOf(it))) { bumpSkipped(report.shotListItems); if (itemIds.has(it.id)) rc.add('shot_list_items', it.id); continue }
      const g = rc.gate('shot_list_items', it.id)
      if (g === 'removed') { rc.removed('shot_list_items', it); continue }
      if (g === 'there') { bumpSkipped(report.shotListItems); continue }
      const kind = named(it.scene_id) ? 'scene' : 'shot'
      const rowId = kind === 'scene' ? it.scene_id : it.shot_id
      if (!(kind === 'scene' ? landed.scenes : landed.shots).has(rowId)) {
        if ((kind === 'scene' ? scenesHere : shotsHere).has(rowId)) { report.errors.push({ scope: 'shot_list_item', projectId, id: it.id, message: `its ${kind} is not in the cloud, so the item was not carried (a second run brings both)` }); bumpFailed(report.shotListItems) }
        else itemsGone++
        continue
      }
      if (dry) { bumpInserted(report.shotListItems); continue }
      try {
        const r = await insertOrSkip('shot_list_items', shotListItemRowForCloud(it, projectId), haveItems.error ? null : (x) => itemIds.has(x.id), { shot_list_items_list_scene_key: 'skip', shot_list_items_list_shot_key: 'skip' })
        r.status === 'inserted' ? bumpInserted(report.shotListItems) : bumpSkipped(report.shotListItems)
        if (r.status === 'inserted') rc.add('shot_list_items', it.id)
      } catch (err) {
        report.errors.push({ scope: 'shot_list_item', projectId, id: it.id, message: err.message })
        bumpFailed(report.shotListItems)
      }
    }
    report.shotListItems.orphans += itemsGone
    if (itemsGone) note(`  ${ITEMS_ON_GONE_ROWS(itemsGone)}`)
    const landedEdits = new Set()
    const insertedEdits = new Set()
    // 0084's one chain per list (one edit with no parent per list, one child
    // per edit; the archived count, as the unconditional indexes count them):
    // who holds each place — the cloud's edits as read, then each edit of this
    // run as it lands (or, in the dry run, would). A desktop edit whose place
    // another edit holds — one made in the cloud since, or a second chain an
    // older version kept on this computer (rabbitShotLists.cjs leaves such a
    // bundle editable) — and every edit continuing it are counted and named,
    // never an error (review rounds 1 and 2): an edit cannot be moved, so no
    // run could carry it, and the dry run says what the real run will do.
    const rootOf = new Map() // list → the edit with no parent
    const childOf = new Map() // edit → the edit continuing it
    for (const e of haveEdits.rows || []) {
      if (named(e.parent_edit_id)) childOf.set(e.parent_edit_id, e.id)
      else rootOf.set(e.shot_list_id, e.id)
    }
    const holdPlace = (e) => (named(e.parent_edit_id) ? childOf.set(e.parent_edit_id, e.id) : rootOf.set(e.shot_list_id, e.id))
    const takenEdits = new Set()
    for (const e of editsParentsFirst(edits)) {
      if (!hasId(e)) { report.errors.push({ scope: 'edit', projectId, message: NO_ID }); bumpFailed(report.edits); continue }
      const there = cloudEdits.get(e.id)
      if (there) { bumpSkipped(report.edits); landedEdits.add(e.id); rc.add('edits', e.id); if (isArchived(e) && !isArchived(there)) liveThere++; continue }
      const g = rc.gate('edits', e.id)
      if (g === 'removed') { rc.removed('edits', e, listLabel(e)); removedEdits.add(e.id); continue }
      if (g === 'there') { bumpSkipped(report.edits); landedEdits.add(e.id); continue }
      // On a list, or continuing an edit, removed in the cloud since an
      // earlier run: let go with it, counted (M2).
      if (removedLists.has(e.shot_list_id) || removedEdits.has(e.parent_edit_id)) { report.edits.orphans++; removedEdits.add(e.id); continue }
      const fail = (message) => { report.errors.push({ scope: 'edit', projectId, id: e.id, message: `${listLabel(e)}: ${message}` }); bumpFailed(report.edits) }
      if (!landedLists.has(e.shot_list_id)) { fail('its shot list is not in the cloud, so the edit was not carried (a second run brings both)'); continue }
      const holder = !named(e.parent_edit_id) ? rootOf.get(e.shot_list_id)
        : takenEdits.has(e.parent_edit_id) ? e.parent_edit_id
          : landedEdits.has(e.parent_edit_id) ? childOf.get(e.parent_edit_id) : undefined
      if (holder !== undefined && holder !== e.id) { takenEdits.add(e.id); continue }
      if (named(e.parent_edit_id) && !landedEdits.has(e.parent_edit_id)) { fail('the edit it continues is not in the cloud, so it was not carried (a second run brings both)'); continue }
      if (editNames.has(`${e.shot_list_id}|${nameKeyOf(e)}`)) { fail(EDIT_NAME_TAKEN(listLabel(e))); continue }
      if (dry) { bumpInserted(report.edits); landedEdits.add(e.id); insertedEdits.add(e.id); holdPlace(e); continue }
      try {
        const r = await insertOrSkip('edits', editRowForCloud(e, projectId), haveEdits.error ? null : (x) => cloudEdits.has(x.id), {
          edits_list_title_version_key: EDIT_NAME_TAKEN(listLabel(e)), edits_one_root_per_list_key: 'taken', edits_one_child_key: 'taken',
        })
        if (r.status === 'taken') { takenEdits.add(e.id); continue }
        if (r.status === 'inserted') { bumpInserted(report.edits); insertedEdits.add(e.id) } else bumpSkipped(report.edits)
        landedEdits.add(e.id)
        if (keepsId(r, !haveEdits.error)) rc.add('edits', e.id)
        holdPlace(e)
      } catch (err) {
        report.errors.push({ scope: 'edit', projectId, id: e.id, message: err.message })
        bumpFailed(report.edits)
      }
    }
    report.edits.taken += takenEdits.size
    if (takenEdits.size) note(`  ${EDITS_CHAIN_TAKEN(takenEdits.size)}`)
    report.liveInCloud += liveThere
    if (liveThere) note(`  ${LIVE_IN_CLOUD(liveThere)}`)
    note(`  ${plural(lists.length, 'shot list')} with ${plural(items.length, 'item')} and ${plural(edits.length, 'edit')}`)
    // The active list: this computer's, once this run carried it, live, and
    // only where no list is active in the cloud yet (a teammate's choice is
    // left alone; a second run sets nothing).
    const activeId = bundle.project?.active_shot_list_id
    const active = named(activeId) ? lists.find(l => l.id === activeId) : null
    if (active && insertedLists.has(active.id) && !isArchived(active)) {
      if (dry) note(`  "${listLabel(active)}" will be the active shot list in the cloud, if none is active there`)
      else {
        const cur = await cloudActiveList(projectId)
        const refuse = (why) => report.errors.push({ scope: 'shot_list', projectId, id: active.id, message: `"${listLabel(active)}" was not made the active shot list in the cloud: ${why} (a workspace admin or the project's manager can, on the Scenes tab)` })
        if (cur.error) refuse(`its active list could not be read (${cur.error.message || cur.error})`)
        else if (cur.id == null) {
          const { error } = await callRpc('set_active_shot_list', { p_project: projectId, p_list: active.id })
          if (error) refuse(error.message || String(error))
          else note(`  "${listLabel(active)}" is the active shot list in the cloud`)
        }
      }
    }
    // Archived on this computer: archived in the cloud too, through 0084's
    // functions — the edits before their lists (an untouched list's maker
    // may archive it only once no live edit is on it, 0086), and only what
    // this run carried (a second run archives nothing; a list a teammate
    // restored in the cloud stays restored).
    const toArchive = [
      ...edits.filter(e => insertedEdits.has(e.id) && isArchived(e)).map(row => ({ row, fn: 'archive_edit', args: { p_edit: row.id, p_archived: true }, bucket: report.edits, scope: 'edit' })),
      ...lists.filter(l => insertedLists.has(l.id) && isArchived(l)).map(row => ({ row, fn: 'archive_shot_list', args: { p_list: row.id, p_archived: true }, bucket: report.shotLists, scope: 'shot_list' })),
    ]
    if (!toArchive.length) return outcome
    if (dry) {
      for (const a of toArchive) a.bucket.archived++
      note(`  ${ARCHIVED_AGAIN(toArchive.map(a => `"${listLabel(a.row)}"`))}`)
      return outcome
    }
    for (const a of toArchive) {
      const { error } = await callRpc(a.fn, a.args)
      if (error) report.errors.push({ scope: a.scope, projectId, id: a.row.id, message: `"${listLabel(a.row)}" is archived on this computer but live in the cloud: ${error.message || error}` })
      else a.bucket.archived++
    }
    return outcome
  }

  // Folders (0041), after the assets, scenes and shots they are of, parents
  // first; each a row by its path, matched where the cloud holds it (by id,
  // by its row, or at its path) and never made twice. Answers `{ cloudOf,
  // failed }`: the folder in the cloud of each desktop folder that is there
  // (desktop id → cloud id), which the files are filed in, and the desktop
  // folders that did not land in this run, whose files wait with them (review
  // round 2: a file filed at the top meanwhile stayed there, a second run
  // skipping it). `state(fk, id)`: the row a folder is of, as this run left
  // it (folderDecision says how each answer is taken).
  const FOLDER_READ = 'id, path, kind, asset_id, scene_id, shot_id, level_id, experience_id'
  const carryFolders = async (bundle, projectId, state, dry, rc) => {
    const folderOf = new Map()
    const failed = new Set()
    const folders = (bundle.folders ?? []).filter(isObj)
    if (!folders.length) return { cloudOf: folderOf, failed }
    const have = await listCloud('folders', 'project_id', projectId, FOLDER_READ)
    if (have.error) {
      report.errors.push({ scope: 'folders', projectId, message: `could not read the project's folders in the cloud, so none was carried, nor any file filed in one (run again): ${have.error.message || have.error}` })
      report.folders.total += folders.length
      report.folders.failed += folders.length
      for (const f of folders) failed.add(f.id)
      return { cloudOf: folderOf, failed }
    }
    let cloud = cloudFolderIndex(have.rows)
    const decided = new Map()
    const counts = { gone: 0, taken: 0 }
    for (const f of foldersParentsFirst(folders)) {
      if (!hasId(f)) { report.errors.push({ scope: 'folder', projectId, message: NO_ID }); bumpFailed(report.folders); continue }
      const parent = f.kind === 'root' ? null : decided.get(f.parent_id)
      // M2: removed in the cloud since an earlier run — not made again, and
      // the folders inside it are let go with it (folderDecision).
      if (!cloud.byId.has(f.id) && rc.gate('folders', f.id) === 'removed') { rc.removed('folders', f, f.path || f.label); decided.set(f.id, { action: 'removed' }); continue }
      let d = folderDecision(f, { parent, cloud, state })
      const where = f.path || 'the project folder'
      if (d.action === 'insert' && dry) d = { action: 'inserted', cloudId: f.id }
      else if (d.action === 'insert') {
        try {
          const { error } = await supabase.from('folders').insert(folderRowForCloud(f, projectId, d.parentCloudId))
          if (!error) d = { action: 'inserted', cloudId: f.id }
          else if (error.code === '23505') {
            // Made meanwhile (a teammate, the cloud's own planner): read
            // again and decide again — matched, or its place taken by a
            // namesake; anything else is an id another project holds.
            const again = await listCloud('folders', 'project_id', projectId, FOLDER_READ)
            if (!again.error) cloud = cloudFolderIndex(again.rows)
            const d2 = again.error ? null : folderDecision(f, { parent, cloud, state })
            if (d2?.action !== 'matched' && d2?.action !== 'taken') throw new Error(`folders: a folder with this id is in the cloud but is not this project's, so nothing was written for it (${error.message})`)
            d = d2
          } else throw new Error(`folders: ${error.message}`)
        } catch (err) {
          report.errors.push({ scope: 'folder', projectId, id: f.id, message: `${where}: ${err.message}` })
          d = { action: 'failed', said: true }
        }
      }
      if (d.action === 'inserted') { bumpInserted(report.folders); rc.add('folders', f.id) }
      else if (d.action === 'matched') { bumpSkipped(report.folders); if (d.cloudId === f.id) rc.add('folders', f.id) }
      else if (d.action === 'orphan') counts.gone++
      else if (d.action === 'taken') counts.taken++
      else if (d.action === 'failed') {
        if (!d.said) report.errors.push({ scope: 'folder', projectId, id: f.id, message: `${where}: ${d.why}, so the folder was not carried (a second run brings it)` })
        bumpFailed(report.folders)
        failed.add(f.id)
      }
      decided.set(f.id, d)
      if (d.cloudId) folderOf.set(f.id, d.cloudId)
    }
    report.folders.orphans += counts.gone
    report.folders.taken += counts.taken
    if (counts.gone) note(`  ${FOLDERS_OF_GONE_ROWS(counts.gone)}`)
    if (counts.taken) note(`  ${FOLDERS_TAKEN(counts.taken)}`)
    return { cloudOf: folderOf, failed }
  }
  // A file's own links, the table of each (0000's phase, asset and task;
  // 0043's scene, shot, level and experience — the last two since M2, the
  // levels landing first; before, a file with either was refused, 23503).
  const FILE_LINKS = { phase_id: 'phases', asset_id: 'assets', task_id: 'tasks', scene_id: 'scenes', shot_id: 'shots', level_id: 'levels', experience_id: 'experiences' }
  // The cloud folder a desktop file is filed in, by the desktop's own rule
  // (desktopFolderOfFile, fileTree.js's), or null (the project's top).
  const cloudFolderOfFile = (file, bundle, folderOf) => {
    const here = desktopFolderOfFile(file, bundle.folders)
    return here ? (folderOf.get(here.id) ?? null) : null
  }

  // ── M2 (night 4): the second run's record ─────────────────────────────
  //
  // What earlier runs carried into this workspace from a bundle (the record
  // the bundle keeps, carriedRecordOf), and what the cloud still shows of
  // it: an id the record holds is never inserted again — `there` (the cloud
  // has it, or could not be asked: skipped, nothing written) or `removed`
  // (it does not: a teammate removed it, or put it in the cloud's trash —
  // counted, named, never brought back). Each row this run carries joins the
  // record once it has landed: the ids go to the desktop's route every
  // RECORD_EVERY rows and at the project's end, so a crash leaves the record
  // true (it never names a row the cloud did not take; the last few it took
  // are recorded by the next run, which finds them there). The dry run reads
  // the same record and writes none.
  const RECORD_EVERY = 25
  const MONEY_TABLES = new Set(['budget_versions', 'budget_lines', 'budget_actuals', 'expenses', 'project_rate_overrides'])
  // A bundle's rows by the cloud table the record names them under.
  const recordedKinds = (bundle) => {
    const deps = (bundle.dependencies ?? []).filter(isObj)
    return [
      ['phases', bundle.phases], ['milestones', bundle.milestones], ['levels', bundle.levels], ['experiences', bundle.experiences],
      ['assets', bundle.assets], ['tasks', bundle.tasks],
      ['task_dependencies', deps.filter(d => dependencyKind(d) !== 'phase')], ['phase_dependencies', deps.filter(d => dependencyKind(d) === 'phase')],
      ['task_links', bundle.taskLinks], ['comments', bundle.comments], ['scenes', bundle.scenes], ['shots', bundle.shots],
      ['shot_lists', bundle.shotLists], ['shot_list_items', bundle.shotListItems], ['edits', bundle.edits], ['folders', bundle.folders],
      // Review round 1 (M3): the files kept with rows are recorded under
      // `files` too, so one a teammate removed is called removed, not skipped.
      ['files', [...(Array.isArray(bundle.files) ? bundle.files : []), ...(Array.isArray(bundle.managedFiles) ? bundle.managedFiles : []).filter(f => isObj(f) && !named(f.deleted_at))]],
      ['budget_versions', bundle.budgetVersions], ['budget_lines', bundle.budgetLines],
      ['budget_actuals', bundle.budgetActuals], ['expenses', bundle.expenses], ['project_rate_overrides', bundle.projectRateOverrides],
      ['bins', bundle.bins], ['bin_files', bundle.binFiles], ['shot_takes', bundle.shotTakes], ['task_items', bundle.taskItems],
      ['table_views', bundle.tableViews], ['item_groupings', bundle.itemGroupings],
    ].map(([table, rows]) => [table, (Array.isArray(rows) ? rows : []).filter(r => isObj(r) && hasId(r))])
  }
  // `money`: whether this project's budget is the person's to see (a money
  // table's rows are invisible to anyone else, so none of its rows is asked).
  // Review round 1 (M2): nor is a Legal file (0092's gate, which the runner
  // does not ask per project): to a person it shuts out, an earlier run's
  // would read as removed. A recorded one stays `there`, never written
  // again. (A money file never meets the record while the money gate is shut
  // to the person: the runner leaves it here before it asks.)
  const recordContext = async (projectId, bundle, { dry, money }) => {
    const had = carriedRecordOf(bundle, workspaceId)
    const unseen = new Set((bundle.files ?? []).filter(f => isObj(f) && isLegalFile(f)).map(f => String(f.id)))
    const removedNow = new Map()
    for (const [table, rows] of recordedKinds(bundle)) {
      const ids = rows.map(r => String(r.id)).filter(id => had.get(table)?.has(id) && !(table === 'files' && unseen.has(id)))
      if (!ids.length || (MONEY_TABLES.has(table) && !money)) continue
      const r = await listCloudIn(table, 'id', ids)
      if (r.error) { report.errors.push({ scope: table, projectId, message: `could not read which rows an earlier run carried are still in the cloud, so none of them was written again: ${r.error.message || r.error}` }); continue }
      const there = new Set(r.rows.map(x => String(x.id)))
      removedNow.set(table, new Set(ids.filter(id => !there.has(id))))
    }
    // M3: the roster's seats, recorded by user id (the table has no id), are
    // compared against this project's seats.
    const seats = had.get('project_members')
    if (seats?.size) {
      const r = await listCloud('project_members', 'project_id', projectId, 'user_id', 'user_id')
      if (r.error) report.errors.push({ scope: 'project_members', projectId, message: `could not read which seats an earlier run gave are still in the cloud, so none of them was given again: ${r.error.message || r.error}` })
      else { const there = new Set(r.rows.map(x => String(x.user_id))); removedNow.set('project_members', new Set([...seats].filter(id => !there.has(id)))) }
    }
    const pending = new Map()
    const inserted = new Map()
    let due = 0
    const write = async () => {
      if (!pending.size) return
      const batch = [...pending].map(([t, s]) => [t, [...s]])
      pending.clear()
      due = 0
      try {
        const res = await localFetch(`${RABBIT_BASE}/projects/${projectId}/cloud-migration-record`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: workspaceId, carried: Object.fromEntries(batch) }),
        })
        if (!res?.ok) throw new Error(`HTTP ${res?.status}`)
      } catch (err) {
        // Kept for the next write; said once per run.
        for (const [t, ids] of batch) { const s = pending.get(t) || new Set(); for (const id of ids) s.add(id); pending.set(t, s) }
        if (report.recordKept) { report.recordKept = false; note(`  ${RECORD_NOT_KEPT(err?.message || String(err))}`) }
      }
    }
    let writing = Promise.resolve()
    return {
      gate(table, id) {
        const k = String(id)
        if (!had.get(table)?.has(k)) return 'new'
        return removedNow.get(table)?.has(k) ? 'removed' : 'there'
      },
      // What this computer did once and never again (review round 1, H5):
      // `pointers` (`locked:<id>`, `open:<id>`) and `set_aside` (row ids);
      // and the receipts it found open in the cloud (`receipts_open`, review
      // round 2), whose removal there then stands.
      has: (key, id) => !!had.get(key)?.has(String(id)),
      removed(table, row, name) {
        report.removed.byTable[table] = (report.removed.byTable[table] || 0) + 1
        report.removed.rows.push({ projectId, table, id: row.id, name: String(name || row.name || row.title || row.label || row.display_name || row.url || row.id) })
      },
      // After the row landed (or was found there as this project's).
      add(table, id, wasInserted = false) {
        if (dry || id == null || id === '') return
        const k = String(id)
        const s = pending.get(table) || new Set(); s.add(k); pending.set(table, s)
        if (wasInserted) { const i = inserted.get(table) || new Set(); i.add(k); inserted.set(table, i) }
        if (++due >= RECORD_EVERY) writing = writing.then(write)
      },
      insertedOf: (table) => inserted.get(table) || new Set(),
      async done() { writing = writing.then(write); await writing },
    }
  }
  // A project an earlier run carried that the cloud no longer shows: none of
  // it is carried again (its rows hang on it).
  const removeProject = (bundle, projectId) => {
    report.removed.byTable.projects = (report.removed.byTable.projects || 0) + 1
    report.removed.rows.push({ projectId, table: 'projects', id: projectId, name: String(bundle.project?.title || projectId) })
    note(`  ${REMOVED_SINCE_LAST_RUN(removedWords({ projects: 1 }))} (nor anything of it)`)
  }
  const sayRemoved = (byTableBefore) => {
    const now = {}
    for (const [t, n] of Object.entries(report.removed.byTable)) { const d = n - (byTableBefore[t] || 0); if (d) now[t] = d }
    if (Object.keys(now).length) note(`  ${REMOVED_SINCE_LAST_RUN(removedWords(now))}`)
  }

  // Levels and experiences (0040), after the project and before what names
  // them (M2): their folders, an asset's links, a file's, a task's items,
  // the groupings. Answers this project's rows in the cloud (`ours`:
  // inserted, or read there) and those that failed in this run; review round
  // 1 (M3): `unread`, those skipped by their key while the read of the
  // project's rows failed — in the cloud, whose not known, so what names one
  // waits for a run that can tell (an asset's link let go here was lost for
  // good: the asset lands, and joins the record).
  const carryLevels = async (bundle, projectId, dry, rc) => {
    const out = { levels: { ours: new Set(), failed: new Set(), unread: new Set() }, experiences: { ours: new Set(), failed: new Set(), unread: new Set() } }
    for (const [table, bucket, scope] of [['levels', report.levels, 'level'], ['experiences', report.experiences, 'experience']]) {
      const rows = (bundle[table] ?? []).filter(isObj)
      if (!rows.length) continue
      const known = await cloudIds(table, projectId)
      if (known.error) report.errors.push({ scope: table, projectId, message: `could not read the project's ${table} in the cloud, so what names one already there waits for a run that can (run again): ${known.error.message || known.error}` })
      for (const row of rows) {
        if (!hasId(row)) { report.errors.push({ scope, projectId, message: NO_ID }); bumpFailed(bucket); continue }
        const g = rc.gate(table, row.id)
        if (g === 'removed') { rc.removed(table, row); continue }
        if (known.ids?.has(row.id)) { bumpSkipped(bucket); out[table].ours.add(row.id); rc.add(table, row.id); continue }
        // In the record and in the cloud: this project's (the record names
        // only rows known to be).
        if (g === 'there') { bumpSkipped(bucket); out[table].ours.add(row.id); continue }
        if (dry) { bumpInserted(bucket); out[table].ours.add(row.id); continue }
        try {
          const r = await insertOrSkip(table, levelRowForCloud(row, projectId), known.ids ? (x) => known.ids.has(x.id) : null)
          r.status === 'inserted' ? bumpInserted(bucket) : bumpSkipped(bucket)
          if (r.status === 'inserted') out[table].ours.add(row.id)
          else out[table].unread.add(row.id)
          if (keepsId(r, !!known.ids)) rc.add(table, row.id)
        } catch (err) {
          report.errors.push({ scope, projectId, id: row.id, message: `${row.name || row.id}: ${err.message}` })
          bumpFailed(bucket)
          if (!err.notOurs) out[table].failed.add(row.id)
        }
      }
    }
    return out
  }

  // Links on tasks (0000's task_links), after the tasks (M2). The table has
  // no project_id: this project's links in the cloud are read through its
  // tasks there (`cloudTasks`), and a link goes up only on a task the cloud
  // shows as this project's — one on a task removed on this computer, or in
  // the cloud's trash, is counted (not carried); one whose task did not land
  // in this run waits with it (a second run brings both).
  const carryTaskLinks = async (bundle, projectId, stateOf, dry, rc, cloudTasks) => {
    const links = (bundle.taskLinks ?? []).filter(isObj)
    if (!links.length) return
    const have = cloudTasks?.size ? await listCloudIn('task_links', 'task_id', cloudTasks) : { rows: [] }
    if (have.error) report.errors.push({ scope: 'task_links', projectId, message: `could not read the links already on this project's tasks in the cloud, so one refused as a duplicate reads as another project's: ${have.error.message || have.error}` })
    const there = new Set((have.rows || []).map(r => String(r.id)))
    let orphans = 0
    for (const l of links) {
      if (!hasId(l)) { report.errors.push({ scope: 'task_link', projectId, message: NO_ID }); bumpFailed(report.taskLinks); continue }
      const name = l.label || l.url || l.id
      const g = rc.gate('task_links', l.id)
      if (g === 'removed') { rc.removed('task_links', l, name); continue }
      if (there.has(String(l.id))) { bumpSkipped(report.taskLinks); rc.add('task_links', l.id); continue }
      if (g === 'there') { bumpSkipped(report.taskLinks); continue }
      const st = await stateOf('tasks', l.task_id)
      if (st === 'gone') { orphans++; continue }
      if (st === 'unread') { report.errors.push({ scope: 'task_link', projectId, id: l.id, message: `${name}: whether its task is in the cloud could not be checked (the read failed), so the link was not carried (run again)` }); bumpFailed(report.taskLinks); continue }
      if (st === 'failed') { report.errors.push({ scope: 'task_link', projectId, id: l.id, message: `${name}: its task is not in the cloud, so the link was not carried (a second run brings both)` }); bumpFailed(report.taskLinks); continue }
      if (dry) { bumpInserted(report.taskLinks); continue }
      try {
        const r = await insertOrSkip('task_links', taskLinkRowForCloud(l), have.error ? null : (x) => there.has(String(x.id)))
        r.status === 'inserted' ? bumpInserted(report.taskLinks) : bumpSkipped(report.taskLinks)
        if (keepsId(r, !have.error)) rc.add('task_links', l.id)
      } catch (err) {
        report.errors.push({ scope: 'task_link', projectId, id: l.id, message: `${name}: ${err.message}` })
        bumpFailed(report.taskLinks)
      }
    }
    report.taskLinks.orphans += orphans
    if (orphans) note(`  ${TASK_LINKS_ON_GONE_TASKS(orphans)}`)
  }

  // The budget (0037), behind the money gate, after the shot lists a bid
  // version is built against (M2): the bid versions, then the lines, the
  // actuals on them, the expenses and the role rates; then the project's
  // locked and open bid versions by UPDATE, each only to a version the cloud
  // holds as this project's (the lock's key is single-column and takes any
  // project's version — measured) and only where the cloud's is still empty
  // (a teammate's choice is left alone); then the rows the open version set
  // aside on this computer, carried live, are set aside again (0090's
  // set_aside_schedule_rows). Review round 1 (H5): a version an earlier run
  // carried counts as one carried now, and so does a row of the schedule (one
  // a build before M2 carried live among them); each pointer and each
  // set-aside row is done once, the record keeping it (`pointers`,
  // `set_aside`), so one that did not take is tried again by the next run and
  // one a teammate undid in the cloud stays undone. `lists`: carryShotLists'
  // answer.
  const POINTERS = [['budget_active_version_id', 'locked'], ['open_budget_version_id', 'open']]
  const carryBudgets = async (bundle, projectId, lists, dry, rc) => {
    const versions = (bundle.budgetVersions ?? []).filter(isObj)
    const lines = (bundle.budgetLines ?? []).filter(isObj)
    const actuals = (bundle.budgetActuals ?? []).filter(isObj)
    const expenses = (bundle.expenses ?? []).filter(isObj)
    // M3: a team member's rate is carried when its person has an account (the
    // people map); one whose person has none stays, counted (memberRates).
    const rates = (bundle.projectRateOverrides ?? []).filter(o => isObj(o) && (!isMemberRate(o) || people.userOf(o.member_id)))
    const known = {}
    for (const [table, rows] of [['budget_versions', versions], ['budget_lines', lines], ['budget_actuals', actuals], ['expenses', expenses], ['project_rate_overrides', rates]]) {
      if (!rows.length) continue
      const r = await cloudIds(table, projectId)
      if (r.error) report.errors.push({ scope: table, projectId, message: `could not read the project's budget in the cloud, so what hangs on a row already there waits for a run that can (run again): ${r.error.message || r.error}` })
      known[table] = r.error ? null : r.ids
    }
    // One row: `removed`, `there` (this project's, in the cloud: skipped),
    // `inserted`, `taken` (review round 1, H3: a unique key's place another
    // row holds — counted by the caller, never an error, never recorded),
    // `unread` (M6: skipped by its id while the read of the project's rows
    // failed — whose it is is not known, so nothing hangs on it in this run,
    // and the record does not name it), `elsewhere` (another project's id) or
    // `failed`, said; the dry run takes every new row to land.
    const carryRow = async (table, bucket, row, shaped, scope, name, keys = null) => {
      const g = rc.gate(table, row.id)
      if (g === 'removed') { rc.removed(table, row, name); return 'removed' }
      if (known[table]?.has(row.id)) { bumpSkipped(bucket); rc.add(table, row.id); return 'there' }
      if (g === 'there') { bumpSkipped(bucket); return 'there' }
      if (dry) { bumpInserted(bucket); return 'inserted' }
      try {
        const r = await insertOrSkip(table, shaped, known[table] ? (x) => known[table].has(x.id) : null, keys)
        if (r.status === 'taken') return 'taken'
        if (r.status === 'inserted') { bumpInserted(bucket); rc.add(table, row.id, true); return 'inserted' }
        // A skip by its id: with the project's rows read, this project's row
        // was found above (`known`) and another project's throws, so the read
        // failed — whose it is is not known.
        bumpSkipped(bucket)
        return 'unread'
      } catch (err) {
        report.errors.push({ scope, projectId, id: row.id, message: `${name}: ${err.message}` })
        bumpFailed(bucket)
        return err.notOurs ? 'elsewhere' : 'failed'
      }
    }
    const fail = (bucket, scope, id, message) => { report.errors.push({ scope, projectId, id, message }); bumpFailed(bucket) }
    let letGo = 0
    // The versions the cloud holds as this project's (carried now, or there):
    // the only ones a pointer may name.
    const versionsOurs = new Set()
    for (const v of versions) {
      if (!hasId(v)) { fail(report.budgetVersions, 'budget_version', undefined, NO_ID); continue }
      const row = budgetVersionRowForCloud(v, projectId)
      const name = `"${row.name}"`
      let dropped = false
      // Its shot list (0084's key holds it to this project's lists): kept to
      // a list in the cloud as this project's; one that failed in this run,
      // or whose owner could not be read (review round 1, M3), keeps the
      // version with it; one removed on this computer is let go. A version
      // already there is skipped, whatever its list.
      const there = known.budget_versions?.has(v.id) || rc.gate('budget_versions', v.id) !== 'new'
      if (!there && named(row.shot_list_id) && !lists.ours.has(row.shot_list_id)) {
        if (lists.failed.has(row.shot_list_id)) { fail(report.budgetVersions, 'budget_version', v.id, `${name}: its shot list is not in the cloud, so the bid version was not carried (a second run brings both)`); continue }
        if (lists.unread.has(row.shot_list_id)) { fail(report.budgetVersions, 'budget_version', v.id, `${name}: whether its shot list is this project's in the cloud could not be checked (the read failed), so the bid version was not carried (run again)`); continue }
        row.shot_list_id = null
        dropped = true
      }
      const out = await carryRow('budget_versions', report.budgetVersions, v, row, 'budget_version', name)
      if (out === 'inserted' || out === 'there') versionsOurs.add(String(v.id))
      if (out === 'inserted' && dropped) letGo++
    }
    const linesHere = idSet(lines)
    const linesLanded = new Set()
    const linesFailed = new Set()
    const linesUnread = new Set()
    let pctLines = 0
    for (const l of lines) {
      if (!hasId(l)) { fail(report.budgetLines, 'budget_line', undefined, NO_ID); continue }
      const shaped = budgetLineRowForCloud(l, projectId, people)
      const out = await carryRow('budget_lines', report.budgetLines, l, shaped, 'budget_line', l.label || l.department || l.id)
      // Review round 1 (M3): a line that arrives with its person is recorded as set.
      if (out === 'inserted' && shaped.team_member_id != null) rc.add('people_set', `line:${l.id}:team_member_id`)
      if (out === 'inserted' || out === 'there') linesLanded.add(l.id)
      if (out === 'failed') linesFailed.add(l.id)
      if (out === 'unread') linesUnread.add(l.id)
      // Review round 1 (H4): its own percentage left out, said.
      if (out === 'inserted' && LINE_PCTS.some(k => named(l[k]) && shaped[k] == null)) pctLines++
    }
    report.budgetLines.pctsLeftOut += pctLines
    if (pctLines) note(`  ${LINE_PCTS_LEFT_OUT(pctLines)}`)
    // An actual's line is a plain key (any project's line — measured): kept
    // only to a line of this project that is in the cloud; one whose line's
    // owner could not be read waits (review round 1, M6).
    let orphans = 0
    let actualsTaken = 0
    for (const a of actuals) {
      if (!hasId(a)) { fail(report.budgetActuals, 'budget_actual', undefined, NO_ID); continue }
      const name = a.invoice_number || `actual ${a.id}`
      const g = rc.gate('budget_actuals', a.id)
      if (g === 'removed') { rc.removed('budget_actuals', a, name); continue }
      if (g === 'new' && !known.budget_actuals?.has(a.id)) {
        if (!linesHere.has(a.line_id)) { orphans++; continue }
        if (linesUnread.has(a.line_id)) { fail(report.budgetActuals, 'budget_actual', a.id, `${name}: whether its budget line is this project's in the cloud could not be checked (the read failed), so the actual was not carried (run again)`); continue }
        if (linesFailed.has(a.line_id)) { fail(report.budgetActuals, 'budget_actual', a.id, `${name}: its budget line is not in the cloud, so the actual was not carried (a second run brings both)`); continue }
        if (!linesLanded.has(a.line_id)) { orphans++; continue }
      }
      const out = await carryRow('budget_actuals', report.budgetActuals, a, budgetActualRowForCloud(a, projectId), 'budget_actual', name, { budget_actuals_line_column_uniq: 'taken' })
      if (out === 'taken') actualsTaken++
    }
    report.budgetActuals.orphans += orphans
    if (orphans) note(`  ${ACTUALS_ON_GONE_LINES(orphans)}`)
    report.budgetActuals.taken += actualsTaken
    if (actualsTaken) note(`  ${ACTUALS_TAKEN(actualsTaken)}`)
    for (const e of expenses) {
      if (!hasId(e)) { fail(report.expenses, 'expense', undefined, NO_ID); continue }
      await carryRow('expenses', report.expenses, e, expenseRowForCloud(e, projectId), 'expense', e.title || e.id)
    }
    let ratesTaken = 0
    for (const o of rates) {
      if (!hasId(o)) { fail(report.rateOverrides, 'rate_override', undefined, NO_ID); continue }
      const out = await carryRow('project_rate_overrides', report.rateOverrides, o, rateOverrideRowForCloud(o, projectId, people), 'rate_override', o.role_slug || seatName(o.member_id) || o.id, { project_rate_overrides_role_uniq: 'taken', project_rate_overrides_member_uniq: 'taken' })
      if (out === 'taken') ratesTaken++
    }
    report.rateOverrides.taken += ratesTaken
    if (ratesTaken) note(`  ${RATES_TAKEN(ratesTaken)}`)
    report.rowLinksLetGo += letGo
    note(`  ${plural(versions.length, 'bid version')}, ${plural(lines.length, 'budget line')}, ${plural(actuals.length, 'actual')}, ${plural(expenses.length, 'expense')}, ${plural(rates.length, 'rate')}`)

    // The project's locked and open bid versions, each set once.
    const p = bundle.project ?? {}
    const want = {}
    for (const [col, word] of POINTERS) if (named(p[col]) && versionsOurs.has(String(p[col])) && !rc.has('pointers', `${word}:${p[col]}`)) want[col] = p[col]
    // The rows the open version set aside on this computer that this one has
    // not set aside again before.
    const openId = named(p.open_budget_version_id) && versionsOurs.has(String(p.open_budget_version_id)) ? String(p.open_budget_version_id) : null
    const asideOf = (key) => (openId ? (bundle[key] ?? []).filter(r => isObj(r) && hasId(r) && named(r.set_aside_at) && !named(r.deleted_at) && !rc.has('set_aside', r.id)) : [])
    const asideRows = { p_tasks: asideOf('tasks'), p_phases: asideOf('phases'), p_milestones: asideOf('milestones') }
    const anyAside = Object.values(asideRows).some(x => x.length)
    if (!Object.keys(want).length && !anyAside) return
    if (dry) {
      if (Object.keys(want).length) note(`  the ${Object.keys(want).map(c => (c === 'open_budget_version_id' ? 'open' : 'locked')).join(' and ')} bid version will be set in the cloud as on this computer, if none is there`)
      return
    }
    let cur = null
    try {
      const { data, error } = await supabase.from('projects').select('budget_active_version_id, open_budget_version_id').eq('id', projectId).maybeSingle()
      if (error) throw error
      cur = data || {}
    } catch (err) {
      report.errors.push({ scope: 'project', projectId, message: `the project's locked and open bid versions were not set in the cloud (run again): its own could not be read (${err?.message || err})` })
      return
    }
    // Review round 2: one the cloud already holds at this computer's value (a
    // teammate's, or set by a run whose record was not kept) is recorded as
    // set, so a teammate who clears it later is not overruled.
    for (const [col, word] of POINTERS) if (col in want && String(cur[col] ?? '') === String(want[col])) rc.add('pointers', `${word}:${want[col]}`)
    const patch = {}
    for (const [col, v] of Object.entries(want)) if (cur[col] == null) patch[col] = v
    if (Object.keys(patch).length) {
      const { error } = await (async () => { try { return await supabase.from('projects').update(patch).eq('id', projectId).select('id') } catch (err) { return { error: err } } })()
      if (error) { report.errors.push({ scope: 'project', projectId, message: `the project's locked or open bid version was not set in the cloud (run again): ${error.message || error}` }); return }
      for (const [col, word] of POINTERS) if (col in patch) rc.add('pointers', `${word}:${patch[col]}`)
      cur = { ...cur, ...patch }
    }
    // Set aside again only under the version that set them aside: the
    // cloud's open version is this computer's (set now, or there already).
    if (!anyAside || String(cur.open_budget_version_id ?? '') !== openId) return
    // Each this project's live row in the cloud — carried now or by an
    // earlier run; one in the cloud's trash, or another project's, is not
    // asked about.
    const aside = {}
    for (const [arg, table] of [['p_tasks', 'tasks'], ['p_phases', 'phases'], ['p_milestones', 'milestones']]) {
      aside[arg] = []
      if (!asideRows[arg].length) continue
      const r = await cloudIds(table, projectId)
      if (r.error) { report.errors.push({ scope: 'set_aside', projectId, message: `the open bid version's set-aside rows show live in the cloud (run again): the project's ${table} could not be read (${r.error.message || r.error})` }); return }
      aside[arg] = asideRows[arg].filter(x => r.ids.has(x.id)).map(x => x.id)
    }
    const n = aside.p_tasks.length + aside.p_phases.length + aside.p_milestones.length
    if (!n) return
    const set = await callRpc('set_aside_schedule_rows', { p_project: projectId, p_on: true, ...aside })
    if (set.error) { report.errors.push({ scope: 'set_aside', projectId, message: `the open bid version's set-aside rows show live in the cloud: they could not be set aside again (run again): ${set.error.message || set.error}` }); return }
    for (const id of [...aside.p_tasks, ...aside.p_phases, ...aside.p_milestones]) rc.add('set_aside', id)
    report.setAside += n
    note(`  ${SET_ASIDE_AGAIN(n)}`)
  }


  // ── M3 (night 5): the people, the company's stores, the workspace record ──
  //
  // Audrey's ruling of 2026-10-28: a desktop team member whose email matches a
  // company account is linked to it; the others stay on this computer, named,
  // and their rows arrive without a person until they join (no email is
  // sent). The map (peopleMapOf, migrationRows.js) is read once per run from
  // the desktop's two team stores, the company's directory and the signed-in
  // person's live role (measured: workspace_directory() gives emails to an
  // admin or a manager; a plain member sees only their own, and matches
  // nobody). Every person column goes through it: a seat, a line's person, a
  // rate's, an entry's, a task's assignee and reviewer, a project's producer
  // and director; an unmatched person is left empty and counted, never a raw
  // desktop id (which named nobody — measured). A workspace kind's record
  // (the rate cards, their entries, the templates) is kept by the desktop's
  // workspace route (electron/main.cjs), not in any project's bundle: it is
  // nobody's project, the stores it is about live beside it, and the archive
  // takes the two together.
  const DESKTOP_WORKSPACES = [...new Set([DESKTOP_SEED_WORKSPACE, workspaceId])]
  const readLocalList = async (url) => {
    try {
      const res = await localFetch(url)
      if (!res?.ok) return res?.status === 404 ? [] : { error: `HTTP ${res?.status}` }
      const body = await res.json()
      return Array.isArray(body) ? body : []
    } catch (err) {
      return { error: err?.message || String(err) }
    }
  }
  const unionById = (lists) => {
    const out = new Map()
    for (const l of lists) for (const r of l) if (isObj(r) && hasId(r) && !out.has(String(r.id))) out.set(String(r.id), r)
    return [...out.values()]
  }
  // The desktop's workspace stores: team members, rate cards (each with its
  // entries and department defaults) and task templates, under the seed
  // workspace id (written signed out) and this workspace's. A store that
  // cannot be read is said once and its kind waits for a run that can.
  const fetchWorkspaceStores = async () => {
    const out = { members: [], rateCards: [], templates: [], errors: {} }
    const words = { members: 'team members', cards: 'rate cards', templates: 'task templates' }
    for (const [key, route] of [['members', 'team-members'], ['cards', 'rate-cards'], ['templates', 'task-templates']]) {
      const lists = []
      for (const ws of DESKTOP_WORKSPACES) {
        const r = await readLocalList(`${RABBIT_BASE}/workspaces/${encodeURIComponent(ws)}/${route}`)
        if (r.error) { out.errors[key] = r.error; break }
        lists.push(r)
      }
      if (out.errors[key]) continue
      const rows = unionById(lists)
      if (key === 'members') out.members = rows
      else if (key === 'templates') out.templates = rows
      else {
        for (const card of rows) {
          const entries = await readLocalList(`${RABBIT_BASE}/rate-cards/${encodeURIComponent(card.id)}/entries`)
          const deptDefaults = await readLocalList(`${RABBIT_BASE}/rate-cards/${encodeURIComponent(card.id)}/dept-defaults`)
          if (entries.error || deptDefaults.error) { out.errors.cards = entries.error || deptDefaults.error; out.rateCards = []; break }
          out.rateCards.push({ card, entries: entries.filter(isObj), deptDefaults: deptDefaults.filter(isObj) })
        }
      }
    }
    for (const [key, why] of Object.entries(out.errors)) report.errors.push({ scope: 'desktop', message: `could not read this computer's ${words[key]}, so none was carried (run again): ${why}` })
    return out
  }
  // The people map: the directory and the signed-in person, read once. A
  // directory the cloud did not answer is an error, said as one (never "ask
  // an admin"): every person column then arrives empty, and the next run
  // sets them (setPeopleOnEarlierRows).
  const buildPeople = async (members) => {
    let callerUserId = null
    try {
      const got = await supabase.auth?.getSession?.()
      callerUserId = got?.data?.session?.user?.id ?? null
    } catch { callerUserId = null }
    const { data, error } = await callRpc('workspace_directory')
    const map = peopleMapOf({ members, directory: error ? [] : (Array.isArray(data) ? data : []), callerUserId })
    map.unread = error ? (error.message || String(error)) : null
    return map
  }
  const sayPeople = () => {
    if (!people.desktop) return
    if (people.unread) { report.errors.push({ scope: 'people', message: PEOPLE_UNREAD(people.unread) }); return }
    if (!people.canMatch) { note(`  ${PEOPLE_NEED_ADMIN}`); return }
    note(`  ${PEOPLE_MATCHED(people.matched, people.desktop)}`)
    if (people.unmatched.length) note(`  ${PEOPLE_NOT_MATCHED(people.unmatched)}`)
    if (people.shared) note(`  ${PEOPLE_SHARED(people.shared)}`)
  }
  // Review round 1 (M3): below admin or manager, or with the directory
  // unread, PEOPLE_NEED_ADMIN (or PEOPLE_UNREAD, an error) is the one sentence
  // for the team, and nobody is counted beside it as "without a WILSON
  // account" — the map never looked. A desktop with no team members has no
  // sentence, and its rows' people (ids it cannot name) are counted as before.
  const peopleSaid = () => !!people.desktop && !people.canMatch
  const unmatchedPerson = (id) => !peopleSaid() && named(id) && !people.userOf(id)
  const seatName = (desktopId) => people.nameOf(desktopId) || String(desktopId)

  // The workspace record (the rate cards, their entries, the templates), as
  // recordContext keeps a project's: read before the workspace kinds, written
  // as rows land, through the desktop's workspace route. `gate` takes the ids
  // the cloud shows for the kind (read by the caller), so a card or template
  // a teammate removed is never carried again.
  const workspaceRecordContext = async (dry) => {
    let had = new Map()
    try {
      const res = await localFetch(`${RABBIT_BASE}/workspaces/${encodeURIComponent(workspaceId)}/cloud-migration-record`)
      if (res?.ok) had = carriedRecordOf(await res.json(), workspaceId)
      else if (res?.status !== 404) report.errors.push({ scope: 'desktop', message: `could not read this computer's record of the company's rate cards and templates (HTTP ${res?.status}), so one a teammate removed in the cloud may be refused as not yours (run again)` })
    } catch (err) {
      report.errors.push({ scope: 'desktop', message: `could not read this computer's record of the company's rate cards and templates (${err?.message || err}), so one a teammate removed in the cloud may be refused as not yours (run again)` })
    }
    const pending = new Map()
    let due = 0
    const write = async () => {
      if (!pending.size) return
      const batch = [...pending].map(([t, s]) => [t, [...s]])
      pending.clear()
      due = 0
      try {
        const res = await localFetch(`${RABBIT_BASE}/workspaces/${encodeURIComponent(workspaceId)}/cloud-migration-record`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspace_id: workspaceId, carried: Object.fromEntries(batch) }),
        })
        if (!res?.ok) throw new Error(`HTTP ${res?.status}`)
      } catch (err) {
        for (const [t, ids] of batch) { const s = pending.get(t) || new Set(); for (const id of ids) s.add(id); pending.set(t, s) }
        if (report.recordKept) { report.recordKept = false; note(`  ${RECORD_NOT_KEPT(err?.message || String(err))}`) }
      }
    }
    let writing = Promise.resolve()
    return {
      gate(table, id, there) {
        const k = String(id)
        if (!had.get(table)?.has(k)) return 'new'
        return there.has(k) ? 'there' : 'removed'
      },
      removed(table, row, name) {
        report.removed.byTable[table] = (report.removed.byTable[table] || 0) + 1
        report.removed.rows.push({ projectId: null, table, id: row.id, name: String(name || row.name || row.id) })
      },
      add(table, id) {
        if (dry || id == null || id === '') return
        const s = pending.get(table) || new Set(); s.add(String(id)); pending.set(table, s)
        if (++due >= RECORD_EVERY) writing = writing.then(write)
      },
      async done() { writing = writing.then(write); await writing },
    }
  }

  // The rate cards (0000, 0015, 0020, 0032), once per run, before the
  // projects. Entries are written by a workspace admin or someone with the
  // rate card edit grant (42501 for a manager without it — measured), and a
  // card without its entries is noise, so the whole step runs only for them;
  // the desktop's own auto-made shells (no entries, no defaults) are not
  // carried. Each card by its own id with the cloud's workspace (none, or the
  // desktop's seed id, is refused before anything else — measured); a 23505
  // while the card is not among the readable ones is a trashed or another
  // company's card (the same answer — measured): refused, never recorded.
  // `is_default` only where the cloud has no default of that type; the
  // cloud's own General and Internal pair is left alone. An entry's person by
  // the map, one without an account left and counted; the record names
  // inserted entries only (a skip says nothing about whose an entry is).
  // Department defaults have no cloud home: counted, never carried.
  const carryRateCards = async (dry) => {
    const all = stores.rateCards
    if (!all.length) return
    addNotCarried('deptDefaults', all.reduce((s, c) => s + c.deptDefaults.length, 0))
    // The desktop's own auto-made shells (no entries, no defaults) are noise no
    // run carries, whoever runs it: counted first, never among the cards left
    // for want of the right (review round 1).
    const shells = all.filter(({ card, entries, deptDefaults }) => hasId(card) && !entries.length && !deptDefaults.length)
    const cards = all.filter(c => !shells.includes(c))
    report.rateCards.empty += shells.length
    if (shells.length) note(`  ${EMPTY_CARDS(shells.length)}`)
    if (!cards.length) return
    if (!people.callerEditsRateCards) {
      report.rateCards.left += cards.length
      report.needsRights.rateCards = true
      note(`  ${RATE_CARDS_NEED_RIGHT(cards.length)}`)
      return
    }
    const have = await listCloud('rate_cards', 'workspace_id', workspaceId, 'id, type, is_default')
    if (have.error) {
      report.errors.push({ scope: 'rate_cards', message: `could not read the company's rate cards in the cloud, so none was carried (run again): ${have.error.message || have.error}` })
      report.rateCards.total += cards.length
      report.rateCards.failed += cards.length
      return
    }
    const cloudCards = new Set(have.rows.map(c => String(c.id)))
    const defaults = have.rows.filter(c => c.is_default === true).map(c => c.type)
    const hasDefaultOfType = (type) => defaults.includes(type)
    let defaultsLeft = 0
    let entriesLeft = 0
    let entriesUnmatched = 0
    let refusedByGate = false
    for (const { card, entries } of cards) {
      if (!hasId(card)) { report.errors.push({ scope: 'rate_card', message: NO_ID }); bumpFailed(report.rateCards); continue }
      const name = String(card.name || card.id)
      const g = wrc.gate('rate_cards', card.id, cloudCards)
      if (g === 'removed') { wrc.removed('rate_cards', card, name); continue }
      if (cloudCards.has(String(card.id)) || g === 'there') {
        bumpSkipped(report.rateCards)
        if (cloudCards.has(String(card.id))) wrc.add('rate_cards', card.id)
      } else {
        const shaped = rateCardRowForCloud(card, workspaceId, { hasDefaultOfType })
        if (shaped.defaultLeft) defaultsLeft++
        if (dry) bumpInserted(report.rateCards)
        else {
          try {
            const r = await insertOrSkip('rate_cards', shaped.row, (x) => cloudCards.has(String(x.id)))
            if (r.status === 'inserted') { bumpInserted(report.rateCards); wrc.add('rate_cards', card.id) } else bumpSkipped(report.rateCards)
          } catch (err) {
            report.errors.push({ scope: 'rate_card', id: card.id, message: err.notOurs ? CARD_NOT_OURS(name) : `${name}: ${err.message}` })
            bumpFailed(report.rateCards)
            continue
          }
        }
        if (shaped.row.is_default) defaults.push(shaped.row.type)
        cloudCards.add(String(card.id))
      }
      // The card's entries, each by its own id.
      const haveEntries = entries.length ? await listCloud('rate_card_entries', 'rate_card_id', card.id, 'id') : { rows: [] }
      if (haveEntries.error) {
        report.errors.push({ scope: 'rate_card_entries', id: card.id, message: `${name}: could not read its entries in the cloud, so none was carried (run again): ${haveEntries.error.message || haveEntries.error}` })
        report.rateCardEntries.total += entries.length
        report.rateCardEntries.failed += entries.length
        continue
      }
      const cloudEntries = new Set(haveEntries.rows.map(e => String(e.id)))
      for (const e of entries) {
        if (!hasId(e)) { report.errors.push({ scope: 'rate_card_entry', message: NO_ID }); bumpFailed(report.rateCardEntries); continue }
        const shaped = rateCardEntryRowForCloud(e, card.id, people)
        if (shaped.userLeft) { if (!peopleSaid()) entriesUnmatched++; continue }
        const ge = wrc.gate('rate_card_entries', e.id, cloudEntries)
        if (ge === 'removed') { wrc.removed('rate_card_entries', e, e.role_label || e.id); continue }
        if (cloudEntries.has(String(e.id)) || ge === 'there') { bumpSkipped(report.rateCardEntries); continue }
        if (dry) { bumpInserted(report.rateCardEntries); continue }
        if (refusedByGate) { entriesLeft++; continue }
        try {
          const r = await insertOrSkip('rate_card_entries', shaped.row)
          if (r.status === 'inserted') { bumpInserted(report.rateCardEntries); wrc.add('rate_card_entries', e.id) } else bumpSkipped(report.rateCardEntries)
        } catch (err) {
          if (/row-level security/.test(err.message)) { refusedByGate = true; entriesLeft++; continue }
          report.errors.push({ scope: 'rate_card_entry', id: e.id, message: `${e.role_label || e.id}: ${err.message}` })
          bumpFailed(report.rateCardEntries)
        }
      }
    }
    report.rateCards.defaultsLeft += defaultsLeft
    report.rateCardEntries.unmatched += entriesUnmatched
    report.rateCardEntries.left += entriesLeft
    addNotCarried('entryPeople', entriesUnmatched)
    if (defaultsLeft) note(`  ${DEFAULTS_LEFT(defaultsLeft)}`)
    // Review round 1 (M3): entries the gate refused mid-run are a right this
    // person lacks, as the up-front refusal is: the run is not done.
    if (entriesLeft) { report.needsRights.rateCards = true; note(`  ${ENTRIES_NEED_GRANT(entriesLeft)}`) }
    note(`  ${plural(cards.length, 'rate card')} with ${plural(report.rateCardEntries.total, 'entry', 'entries')}`)
  }

  // The task templates (0044), once per run, after the projects: the cloud's
  // workspace sent explicitly (42501 without it, or with the desktop's seed
  // id — measured); a pinned template only after its project is in the cloud
  // as this workspace's (the composite key refuses any other, 23503 —
  // measured): one whose project failed this run waits, one whose project is
  // not on this computer is left, counted. Written by a workspace admin or
  // manager, a pinned one by its project's manager too (42501 otherwise —
  // measured): counted, never a failed run. `templatesInCloud` is what the
  // assets' links may name (linkAssetTemplates).
  const carryTemplates = async (dry) => {
    const templates = stores.templates
    if (!templates.length) return
    const have = await listCloud('task_templates', 'workspace_id', workspaceId, 'id, project_id')
    if (have.error) {
      report.errors.push({ scope: 'task_templates', message: `could not read the company's task templates in the cloud, so none was carried (run again): ${have.error.message || have.error}` })
      report.taskTemplates.total += templates.length
      report.taskTemplates.failed += templates.length
      return
    }
    const cloudTemplates = new Set(have.rows.map(t => String(t.id)))
    for (const id of cloudTemplates) templatesInCloud.add(id)
    let orphans = 0
    let left = 0
    let globalRefused = false
    for (const t of templates) {
      if (!hasId(t)) { report.errors.push({ scope: 'task_template', message: NO_ID }); bumpFailed(report.taskTemplates); continue }
      const name = String(t.name || t.id)
      const g = wrc.gate('task_templates', t.id, cloudTemplates)
      if (g === 'removed') { wrc.removed('task_templates', t, name); continue }
      if (cloudTemplates.has(String(t.id)) || g === 'there') {
        bumpSkipped(report.taskTemplates)
        if (cloudTemplates.has(String(t.id))) wrc.add('task_templates', t.id)
        continue
      }
      let projectId = null
      if (named(t.project_id)) {
        const st = projectsOurs.get(String(t.project_id))
        if (st === 'failed') { report.errors.push({ scope: 'task_template', id: t.id, message: `${name}: its project is not in the cloud, so the template was not carried (a second run brings both)` }); bumpFailed(report.taskTemplates); continue }
        if (st !== 'ours') { orphans++; continue }
        projectId = t.project_id
      }
      if (dry) { bumpInserted(report.taskTemplates); templatesInCloud.add(String(t.id)); continue }
      if (globalRefused && !projectId) { left++; continue }
      try {
        const r = await insertOrSkip('task_templates', taskTemplateRowForCloud(t, workspaceId, projectId), (x) => cloudTemplates.has(String(x.id)))
        if (r.status === 'inserted') { bumpInserted(report.taskTemplates); wrc.add('task_templates', t.id) } else bumpSkipped(report.taskTemplates)
        templatesInCloud.add(String(t.id))
      } catch (err) {
        if (/row-level security/.test(err.message)) { left++; if (!projectId) globalRefused = true; continue }
        report.errors.push({ scope: 'task_template', id: t.id, message: err.notOurs ? TEMPLATE_NOT_OURS(name) : `${name}: ${err.message}` })
        bumpFailed(report.taskTemplates)
      }
    }
    report.taskTemplates.orphans += orphans
    report.taskTemplates.left += left
    if (left) { report.needsRights.templates = true; note(`  ${TEMPLATES_LEFT(left)}`) }
    if (orphans) note(`  ${TEMPLATES_ORPHAN(orphans)}`)
    note(`  ${plural(templates.length, 'task template')}`)
  }

  // The assets' links to their templates, restored after the templates land:
  // only to a template this run carried or read under this workspace (the
  // key takes another workspace's — measured — so the set is the guard), only
  // where the cloud's link is still empty (a teammate's choice stands), by
  // UPDATE on this project's row. What names a template not in the cloud is
  // counted (`assetTemplates`).
  const assetTemplateLinks = []
  const collectAssetTemplates = (projectId, assets) => {
    const wanted = assets.filter(a => isObj(a) && hasId(a) && named(a.task_template_id)).map(a => ({ id: a.id, task_template_id: String(a.task_template_id) }))
    if (wanted.length) assetTemplateLinks.push({ projectId, assets: wanted })
  }
  const linkAssetTemplates = async (dry) => {
    let linked = 0
    let left = 0
    for (const { projectId, assets } of assetTemplateLinks) {
      const candidates = assets.filter(a => templatesInCloud.has(a.task_template_id))
      left += assets.length - candidates.length
      if (!candidates.length) continue
      const have = await listCloudIn('assets', 'id', candidates.map(a => a.id), 'id, task_template_id')
      if (have.error) { report.errors.push({ scope: 'assets', projectId, message: `could not read which assets still want their task template, so none was linked (run again): ${have.error.message || have.error}` }); continue }
      const found = new Map(have.rows.map(r => [String(r.id), r]))
      for (const a of candidates) {
        const row = found.get(String(a.id))
        // Not in the cloud yet: the dry run counts it as about to arrive and be
        // linked; the real run has nothing to link to (it did not land).
        if (!row) { if (dry) linked++; continue }
        if (row.task_template_id != null) continue
        if (dry) { linked++; continue }
        const { data, error } = await (async () => { try { return await supabase.from('assets').update({ task_template_id: a.task_template_id }).eq('id', a.id).eq('project_id', projectId).is('task_template_id', null).select('id') } catch (err) { return { error: err } } })()
        if (error) { report.errors.push({ scope: 'asset', projectId, id: a.id, message: `its task template could not be linked (run again): ${error.message || error}` }); continue }
        if (Array.isArray(data) && data.length === 1) linked++
      }
    }
    report.assetTemplatesLinked += linked
    addNotCarried('assetTemplates', left)
    if (linked) note(`  ${ASSET_TEMPLATES_LINKED(linked)}`)
  }

  // The roster (project_members, 0013), after the project row: each desktop
  // assignment whose person has an account, INSERTED and never upserted —
  // the table has no id, and a 23505 on its (project, user) pair is a seat
  // that is there (the mover's own, which the project's insert made —
  // measured — or one already given), skipped and recorded under the person's
  // id. The role as the desktop says (a desktop "manager" is a project
  // manager in the cloud: its budget, its roster; named in the report), the
  // desktop member's job title as the seat's, the dates left (no columns).
  // A seat the cloud refuses (42501: not a workspace admin or manager, nor
  // this project's manager) is counted once per project, never a failed
  // project; one whose account is no longer a member (23503) is counted as
  // unmatched.
  // `autoSeated` (the dry run): the people the project's insert will seat
  // itself — the mover, and a producer the map names (fn_projects_auto_staff,
  // measured) — met on their pair by the real run and skipped (review round 1).
  const carryRoster = async (bundle, projectId, dry, rc, autoSeated = []) => {
    const assignments = (bundle.teamAssignments ?? []).filter(isObj)
    if (!assignments.length) return
    // Below admin or manager nobody is matched: the one sentence
    // (PEOPLE_NEED_ADMIN, or PEOPLE_UNREAD as an error) covers the team.
    if (peopleSaid()) return
    const membersById = new Map(stores.members.map(m => [String(m.id), m]))
    const have = await listCloud('project_members', 'project_id', projectId, 'user_id, project_role', 'user_id')
    if (have.error) {
      report.errors.push({ scope: 'project_members', projectId, message: `could not read the project's roster in the cloud, so no seat was given (run again): ${have.error.message || have.error}` })
      // Review round 2: the seats this run would have given fail; the people
      // without an account are unmatched, as on any run.
      const matched = assignments.filter(a => people.userOf(a.member_id)).length
      report.projectMembers.total += matched
      report.projectMembers.failed += matched
      report.projectMembers.unmatched += assignments.length - matched
      addNotCarried('teamAssignments', assignments.length - matched)
      return
    }
    const seated = new Set([...have.rows.map(r => String(r.user_id)), ...autoSeated.filter(Boolean).map(String)])
    let unmatched = 0
    let dates = 0
    let roles = 0
    let left = 0
    let refused = false
    const removedSeats = new Set()
    for (const a of assignments) {
      const shaped = projectMemberRowForCloud(a, projectId, people, membersById.get(String(a.member_id)))
      if (!shaped) { unmatched++; continue }
      const { row, roleLeft, datesLeft } = shaped
      dates += datesLeft
      const g = rc.gate('project_members', row.user_id)
      // Review round 2: two desktop entries for one person are one seat, said
      // removed once; and a role outside the three is said left only where the
      // seat is given (never on a run that gave none).
      if (g === 'removed') { if (!removedSeats.has(row.user_id)) { removedSeats.add(row.user_id); rc.removed('project_members', { id: row.user_id }, seatName(a.member_id)) } continue }
      if (seated.has(row.user_id) || g === 'there') { bumpSkipped(report.projectMembers); if (seated.has(row.user_id)) rc.add('project_members', row.user_id); continue }
      if (dry) { bumpInserted(report.projectMembers); seated.add(row.user_id); if (roleLeft) roles++; if (row.project_role === 'manager') report.people.managersSeated.push(seatName(a.member_id)); continue }
      if (refused) { left++; continue }
      try {
        const r = await insertOrSkip('project_members', row, null, { project_members_pkey: 'skip' })
        r.status === 'inserted' ? bumpInserted(report.projectMembers) : bumpSkipped(report.projectMembers)
        // The pair holds this project's id, so a skip is this project's seat.
        rc.add('project_members', row.user_id, r.status === 'inserted')
        seated.add(row.user_id)
        if (r.status === 'inserted' && roleLeft) roles++
        if (r.status === 'inserted' && row.project_role === 'manager') report.people.managersSeated.push(seatName(a.member_id))
      } catch (err) {
        if (/row-level security/.test(err.message)) { refused = true; left++; continue }
        if (/project_members_member_fkey/.test(err.message)) { unmatched++; continue }
        report.errors.push({ scope: 'project_member', projectId, id: row.user_id, message: `${seatName(a.member_id)}: ${err.message}` })
        bumpFailed(report.projectMembers)
      }
    }
    report.projectMembers.unmatched += unmatched
    report.projectMembers.datesLeft += dates
    report.projectMembers.rolesLeft += roles
    report.projectMembers.left += left
    addNotCarried('teamAssignments', unmatched)
    addNotCarried('assignmentDates', dates)
    if (roles) note(`  ${ROLES_LEFT(roles)}`)
    if (left) { report.needsRights.roster = true; note(`  ${ROSTER_LEFT(left)}`) }
  }

  // The people on rows an earlier run carried without them (M2-L5: a crew
  // line went up without its person; a task or a project with a raw desktop
  // id): each set once, by UPDATE only where the cloud still holds nothing or
  // the raw id, and recorded (`people_set`: `<kind>:<row>:<column>`) so a
  // teammate who clears a person later is not overruled (the pointers'
  // rule). Rows this run inserted carry their people already and are not
  // asked about; those that arrived with one are recorded as set at the
  // insert (review round 1: the project's, a task's, a line's), so the rule
  // holds from the first run, and a column that arrived empty (its person
  // without an account yet) is set once they join. Setting a producer seats
  // them as the project's manager (fn_projects_auto_staff, measured): named
  // with the seated.
  const PEOPLE_COLUMNS = [['budget_lines', 'budgetLines', 'team_member_id', 'line', true], ['tasks', 'tasks', 'assignee_id', 'task', false], ['tasks', 'tasks', 'reviewer_id', 'task', false]]
  const TASK_PEOPLE = ['assignee_id', 'reviewer_id']
  const PROJECT_PEOPLE = ['producer_id', 'director_id']
  const setPeopleOnEarlierRows = async (bundle, projectId, rc, dry, moneyGoes) => {
    if (!people.canMatch || !people.matched) return
    // The rows set (a task's two columns are one row — review round 1).
    const touched = new Set()
    const update = async (table, col, value, rowId, cur) => {
      try {
        let q = supabase.from(table).update({ [col]: value }).eq('id', rowId)
        if (table !== 'projects') q = q.eq('project_id', projectId)
        q = cur == null ? q.is(col, null) : q.eq(col, cur)
        const { data, error } = await q.select('id')
        if (error) return { error }
        return { changed: Array.isArray(data) && data.length === 1 }
      } catch (err) { return { error: err } }
    }
    for (const [table, key, col, word, money] of PEOPLE_COLUMNS) {
      if (money && !moneyGoes) continue
      const wanted = new Map()
      const inserted = rc.insertedOf(table)
      for (const r of (bundle[key] ?? []).filter(isObj)) {
        if (!hasId(r) || !named(r[col]) || inserted.has(String(r.id)) || rc.has('people_set', `${word}:${r.id}:${col}`)) continue
        const user = people.userOf(r[col])
        if (user) wanted.set(String(r.id), { user, desktop: String(r[col]) })
      }
      if (!wanted.size) continue
      const have = await listCloudIn(table, 'id', [...wanted.keys()], `id, ${col}`)
      if (have.error) { report.errors.push({ scope: table, projectId, message: `could not read which ${word}s an earlier run carried without their person, so none was set (run again): ${have.error.message || have.error}` }); continue }
      for (const row of have.rows) {
        const w = wanted.get(String(row.id))
        const cur = row[col]
        if (!w) continue
        if (cur != null && String(cur) === w.user) { rc.add('people_set', `${word}:${row.id}:${col}`); continue }
        if (!(cur == null || String(cur) === w.desktop)) continue
        if (dry) { touched.add(`${word}:${row.id}`); continue }
        const out = await update(table, col, w.user, row.id, cur)
        if (out.error) { report.errors.push({ scope: table, projectId, id: row.id, message: `its person could not be set (run again): ${out.error.message || out.error}` }); continue }
        if (out.changed) { touched.add(`${word}:${row.id}`); rc.add('people_set', `${word}:${row.id}:${col}`) }
      }
    }
    const p = bundle.project ?? {}
    const want = {}
    for (const col of PROJECT_PEOPLE) {
      if (!named(p[col]) || rc.has('people_set', `project:${projectId}:${col}`)) continue
      const user = people.userOf(p[col])
      if (user) want[col] = { user, desktop: String(p[col]) }
    }
    if (Object.keys(want).length) {
      let cur = null
      try {
        const { data, error } = await supabase.from('projects').select('id, producer_id, director_id').eq('id', projectId).maybeSingle()
        if (error) throw error
        cur = data || {}
      } catch (err) {
        report.errors.push({ scope: 'project', projectId, message: `the project's producer and director were not set (run again): its own could not be read (${err?.message || err})` })
      }
      if (cur) {
        for (const [col, w] of Object.entries(want)) {
          const v = cur[col]
          if (v != null && String(v) === w.user) { rc.add('people_set', `project:${projectId}:${col}`); continue }
          if (!(v == null || String(v) === w.desktop)) continue
          if (dry) { touched.add('project'); if (col === 'producer_id') report.people.managersSeated.push(seatName(w.desktop)); continue }
          const out = await update('projects', col, w.user, projectId, v)
          if (out.error) { report.errors.push({ scope: 'project', projectId, message: `the project's ${col === 'producer_id' ? 'producer' : 'director'} could not be set (run again): ${out.error.message || out.error}` }); continue }
          if (out.changed) { touched.add('project'); rc.add('people_set', `project:${projectId}:${col}`); if (col === 'producer_id') report.people.managersSeated.push(seatName(w.desktop)) }
        }
      }
    }
    const set = touched.size
    report.people.set += set
    if (set) note(`  ${PEOPLE_SET(set)}`)
  }

  // ── M3: the files the desktop keeps with its rows (managedFiles → files) ──
  //
  // Each live managed row becomes a files row (managedFileRowForCloud: its own
  // name, its links checked as a file's are, its folder by its folder_path
  // through M1's folders) with its body where the company keeps its media:
  // the storage rule read once (getWorkspaceStorageCached, the upload path's
  // own read, failing closed), `network` → nothing uploaded and no row (her
  // ruling of 2026-10-28: the browser says where the files are), a private
  // project the same (its media lives on the computer that added it),
  // `petal` → the Supabase provider, `s3` → the s3 provider in one PUT up to
  // its bound. Before a byte moves: the row is asked for (as a file's is), the
  // links and the folder checked, the body's true size taken by one Range
  // request to the desktop's stream, in the dry run too — review round 1
  // (`?probe=1`: no 'downloaded' event per
  // file — the cloud's 'uploaded' event and the record are the record of the
  // move; 410 is a body not on the disk: counted, said, and the run is not
  // done). Under the resumable threshold the body is one Blob and the
  // provider's standard put; above it the provider's resumable path, fed by
  // Range requests six MiB at a time (rangeSource: tus reads the source it is
  // handed), reserved first by the provider. The key is never reused (a
  // completed resumable upload upserts, and a reused key would escape the
  // quota): the file's directory is listed first and an object already there
  // of the body's size is taken as the body (a run that stopped between the
  // upload and the row); else a new key with the moment in it. A thumbnail
  // as uploadFile makes one, for an image under the threshold (the body is in
  // memory already), best-effort; a video keeps the icon.
  let storageRuleCache = null
  const storageRule = async () => {
    if (storageRuleCache) return storageRuleCache
    try {
      const row = await getWorkspaceStorageCached()
      const workspaceProvider = activeWorkspaceProvider(row)
      storageRuleCache = { workspaceProvider, provider: workspaceProvider === WORKSPACE_PROVIDERS.NETWORK ? null : fileProviderFor(workspaceProvider) }
    } catch (err) {
      storageRuleCache = { error: err?.message || String(err) }
    }
    return storageRuleCache
  }
  const managedStreamUrl = (projectId, fileId) => `${RABBIT_BASE}/projects/${projectId}/managed-files/${fileId}/stream?probe=1`
  // The body's true size, by one Range request: `{ size }`, `{ gone }` (410) or `{ error }`.
  const probeManagedBody = async (projectId, fileId) => {
    let res
    try { res = await localFetch(managedStreamUrl(projectId, fileId), { headers: { Range: 'bytes=0-0' } }) } catch (err) { return { error: err?.message || String(err) } }
    if (res.status === 410) return { gone: true }
    const header = (name) => (typeof res.headers?.get === 'function' ? res.headers.get(name) : null) || ''
    const m = /\/(\d+)\s*$/.exec(header('content-range'))
    if (res.status === 206 || res.status === 416) {
      try { await res.body?.cancel?.() } catch { /* a byte at most */ }
      if (m) return { size: Number(m[1]) }
      return res.status === 416 ? { size: 0 } : { error: 'the size was not in the answer' }
    }
    if (res.ok) {
      try { await res.body?.cancel?.() } catch { /* not read */ }
      const len = Number(header('content-length'))
      return Number.isFinite(len) && len >= 0 && header('content-length') !== '' ? { size: len } : { error: 'the size was not in the answer' }
    }
    return { error: `HTTP ${res.status}` }
  }
  // The body, whole, under the threshold: a Blob with the row's type.
  const fetchManagedBlob = async (projectId, fileId, type) => {
    const res = await localFetch(managedStreamUrl(projectId, fileId))
    if (!res?.ok) throw new Error(`the file's body could not be read on this computer (HTTP ${res?.status})`)
    const blob = await res.blob()
    if (blob?.type || typeof Blob === 'undefined' || !(blob instanceof Blob)) return blob
    return new Blob([blob], { type })
  }
  // The body above the threshold, read as tus asks for it: each slice one
  // Range request, so no more than one chunk is in memory.
  const rangeSource = (projectId, fileId, size, type, name) => ({
    size, type, name,
    openSource: () => ({
      size,
      async slice(start, end) {
        const stop = Math.min(end, size)
        const res = await localFetch(managedStreamUrl(projectId, fileId), { headers: { Range: `bytes=${start}-${stop - 1}` } })
        if (!res?.ok) throw new Error(`the file's body could not be read on this computer (HTTP ${res?.status})`)
        return { value: await res.blob(), done: stop >= size }
      },
      close() {},
    }),
  })
  // An object already under the file's directory of the body's size (a run
  // that stopped between the upload and the row): its key, else null.
  const objectAlreadyThere = async (dir, size) => {
    try {
      const { data, error } = await supabase.storage.from(RABBIT_FILES_BUCKET).list(dir, { limit: 100 })
      if (error) return null
      const hit = (data || []).find(o => typeof o?.name === 'string' && o.name && !o.name.startsWith('.') && Number(o.metadata?.size) === size)
      return hit ? `${dir}/${hit.name}` : null
    } catch { return null }
  }
  const thumbnailFor = async (blob, key, provider) => {
    try {
      if (!canThumbnail(blob?.type)) return null
      const thumb = await generateThumbnail(blob)
      if (!thumb) return null
      const tkey = thumbnailKeyFor(key)
      await putThumbnailTo(provider, tkey, thumb, { client: supabase })
      return tkey
    } catch { return null }
  }
  const carryManagedFiles = async (bundle, projectId, { dry, rc, folders, linkState }) => {
    const rows = (bundle.managedFiles ?? []).filter(f => isObj(f) && !named(f.deleted_at))
    if (!rows.length) return
    const rule = await storageRule()
    if (rule.error) {
      report.errors.push({ scope: 'managed_files', projectId, message: `could not read where the company keeps its media, so no file kept with a row was carried (run again): ${rule.error}` })
      report.managedFiles.total += rows.length
      report.managedFiles.failed += rows.length
      return
    }
    if (rule.workspaceProvider === WORKSPACE_PROVIDERS.NETWORK) {
      report.managedFiles.server += rows.length
      addNotCarried('managedFilesServer', rows.length)
      note(`  ${SERVER_MEDIA_STAY(rows.length)}`)
      return
    }
    if (bundle.project?.is_private === true) {
      report.managedFiles.privateHome += rows.length
      addNotCarried('managedFilesPrivate', rows.length)
      note(`  ${PRIVATE_MEDIA_STAY(rows.length)}`)
      return
    }
    const known = await cloudIds('files', projectId)
    if (known.error) report.errors.push({ scope: 'files', projectId, message: `could not read the files already in the cloud, so a file kept with a row refused as a duplicate reads as already there: ${known.error.message || known.error}` })
    const counts = { placed: 0, letGo: 0, gone: 0, versions: 0, overCap: 0, overBound: 0, bytes: 0, uploaded: 0 }
    for (const mf of rows) {
      if (!hasId(mf) || !isUuid(mf.id)) { report.errors.push({ scope: 'managed_file', projectId, message: NO_ID }); bumpFailed(report.managedFiles); continue }
      const name = managedFileName(mf)
      const g = rc.gate('files', mf.id)
      if (g === 'removed') { rc.removed('files', mf, name); continue }
      if (known.ids?.has(mf.id) || g === 'there') { bumpSkipped(report.managedFiles); if (known.ids?.has(mf.id)) rc.add('files', mf.id); continue }
      // Its links (plain keys): kept only to this project's rows in the cloud.
      const links = {}
      let blocked = null
      let letGoHere = 0
      for (const key of MANAGED_LINKS) {
        if (!named(mf[key])) { links[key] = null; continue }
        const st = await linkState(key, mf[key])
        if (st === 'failed' || st === 'unread') { blocked = { what: key.replace(/_id$/, ''), unread: st === 'unread' }; break }
        if (st === 'gone') { links[key] = null; letGoHere++ } else links[key] = mf[key]
      }
      if (blocked) {
        report.errors.push({ scope: 'managed_file', projectId, id: mf.id, message: blocked.unread
          ? `${name}: whether its ${blocked.what} is in the cloud could not be checked (the read failed), so the file was not carried (run again)`
          : `${name}: its ${blocked.what} is not in the cloud, so the file was not carried (a second run brings both)` })
        bumpFailed(report.managedFiles)
        continue
      }
      const folderHere = desktopFolderOfManagedFile(mf, bundle.folders)
      if (folderHere && folders.failed.has(folderHere.id)) {
        report.errors.push({ scope: 'managed_file', projectId, id: mf.id, message: `${name}: its folder is not in the cloud, so the file was not carried (a second run brings both)` })
        bumpFailed(report.managedFiles)
        continue
      }
      const folderId = folderHere ? (folders.cloudOf.get(folderHere.id) ?? null) : null
      const versionLeft = !!managedVersionLabel(mf)
      const tooBig = (size) => (rule.provider === FILE_PROVIDERS.S3 && size > S3_MAX_SINGLE_PUT_BYTES ? 'overBound' : rule.provider === FILE_PROVIDERS.SUPABASE && size > PETAL_FILE_CAP_BYTES ? 'overCap' : null)
      if (dry) {
        // Review round 1 (M3): the body's true size by the same probe the real
        // run makes (one Range request, no event), so a body gone is said
        // before anything moves and the bytes promised are the bytes sent.
        const probe = await probeManagedBody(projectId, mf.id)
        if (probe.gone) { counts.gone++; continue }
        if (probe.error) { report.errors.push({ scope: 'managed_file', projectId, id: mf.id, message: `${name}: the file's body could not be read on this computer (${probe.error})` }); bumpFailed(report.managedFiles); continue }
        const size = probe.size
        const big = tooBig(size)
        if (big) { counts[big]++; continue }
        bumpInserted(report.managedFiles)
        counts.bytes += size
        counts.uploaded++
        if (folderId) counts.placed++
        counts.letGo += letGoHere
        if (versionLeft) counts.versions++
        continue
      }
      try {
        const asked = await cloudFileRow(mf.id)
        if (asked.error) { report.errors.push({ scope: 'managed_file', projectId, id: mf.id, message: `${name}: could not check whether the file is already in the cloud: ${asked.error.message || asked.error}` }); bumpFailed(report.managedFiles); continue }
        if (asked.row) {
          if (asked.row.project_id != null && asked.row.project_id !== projectId) { report.errors.push({ scope: 'managed_file', projectId, id: mf.id, message: `${name}: a file with this id is in the cloud but is not this project's, so nothing was written for it` }); bumpFailed(report.managedFiles); continue }
          bumpSkipped(report.managedFiles)
          rc.add('files', mf.id)
          continue
        }
        const probe = await probeManagedBody(projectId, mf.id)
        if (probe.gone) { counts.gone++; continue }
        if (probe.error) { report.errors.push({ scope: 'managed_file', projectId, id: mf.id, message: `${name}: the file's body could not be read on this computer (${probe.error})` }); bumpFailed(report.managedFiles); continue }
        const size = probe.size
        const big = tooBig(size)
        if (big) { counts[big]++; continue }
        const dir = `projects/${projectId}/files/${mf.id}`
        const safeName = (name || 'file').replace(/[^a-zA-Z0-9._-]+/g, '_')
        const contentType = mf.mime_type || 'application/octet-stream'
        let key = rule.provider === FILE_PROVIDERS.SUPABASE ? await objectAlreadyThere(dir, size) : null
        let thumbnailUrl = null
        let uploaded = 0
        if (!key) {
          key = `${dir}/${Date.now()}-${safeName}`
          const provider = getStorageProvider(rule.provider)
          if (rule.provider === FILE_PROVIDERS.SUPABASE && size > RESUMABLE_THRESHOLD_BYTES) {
            await provider.put(key, rangeSource(projectId, mf.id, size, contentType, name), { contentType })
          } else {
            const blob = await fetchManagedBlob(projectId, mf.id, contentType)
            await provider.put(key, blob, { contentType })
            thumbnailUrl = await thumbnailFor(blob, key, rule.provider)
          }
          uploaded = size
        }
        const shaped = managedFileRowForCloud(mf, projectId, { folderId, links, storageProvider: rule.provider, storagePath: key, thumbnailUrl })
        const r = await insertOrSkip('files', shaped.row)
        r.status === 'inserted' ? bumpInserted(report.managedFiles) : bumpSkipped(report.managedFiles)
        if (r.status === 'inserted') {
          rc.add('files', mf.id, true)
          counts.bytes += uploaded
          counts.uploaded += uploaded ? 1 : 0
          if (folderId) counts.placed++
          counts.letGo += letGoHere
          if (shaped.versionLeft) counts.versions++
        }
      } catch (err) {
        report.errors.push({ scope: 'managed_file', projectId, id: mf.id, message: `${name}: ${err.message}` })
        bumpFailed(report.managedFiles)
      }
    }
    report.managedFiles.uploaded += counts.uploaded
    report.managedFiles.bytes += counts.bytes
    report.managedFiles.placed += counts.placed
    report.managedFiles.linksLetGo += counts.letGo
    report.managedFiles.bodiesGone += counts.gone
    report.managedFiles.overCap += counts.overCap
    report.managedFiles.overBound += counts.overBound
    report.managedFiles.versions += counts.versions
    addNotCarried('managedVersions', counts.versions)
    if (dry && counts.uploaded) note(`  ${MANAGED_FILES_WILL_UPLOAD(counts.uploaded, counts.bytes)}`)
    if (!dry && counts.uploaded) note(`  ${MANAGED_FILES_UPLOADED(counts.uploaded, counts.bytes)}`)
    if (counts.letGo) note(`  ${FILE_LINKS_LET_GO(counts.letGo)}`)
    if (counts.gone) note(`  ${BODIES_GONE(counts.gone)}`)
    if (counts.overCap) note(`  ${MANAGED_OVER_CAP(counts.overCap)}`)
    if (counts.overBound) note(`  ${MANAGED_OVER_BOUND(counts.overBound)}`)
  }

  // A receipt an earlier run carried as an ordinary file (M2-L4), put behind
  // the money gate: its picture first (a legible JPEG of the receipt, at
  // <key>.jpg in rabbit-thumbnails — moved, or removed when it cannot be
  // moved, never left open), then the object (`files/` → `INVOICES/`; skipped
  // when the new key holds it and the old does not: a run that stopped before
  // the row changed), then the row's `is_financial`, `storage_path` and
  // `thumbnail_url` in one UPDATE (0088's key check and the money flag agree).
  // Measured as the admin and as a plain user who is the project's manager;
  // a plain member is refused on the object and on the row (42501), so the
  // gate is the cloud's. Throws with the reason, which the caller says.
  const existsAt = async (bucket, key) => {
    const slash = key.lastIndexOf('/')
    const { data, error } = await bucket.list(key.slice(0, slash), { search: key.slice(slash + 1), limit: 100 })
    if (error) throw new Error(error.message)
    return (data || []).some(o => o?.name === key.slice(slash + 1))
  }
  const moveReceipt = async (projectId, f, already, to) => {
    const from = already.storage_path
    const bucket = supabase.storage.from(RABBIT_FILES_BUCKET)
    const thumbs = supabase.storage.from(THUMBNAIL_BUCKET)
    let thumbTo = null
    if (named(already.thumbnail_url)) {
      thumbTo = thumbnailKeyFor(to)
      // Review round 1: a picture already at its place is left there.
      if (already.thumbnail_url === thumbTo) { /* nothing to move */ }
      else if (await existsAt(thumbs, already.thumbnail_url)) {
        const { error } = await thumbs.move(already.thumbnail_url, thumbTo)
        if (error) {
          const rm = await thumbs.remove([already.thumbnail_url])
          if (rm.error) throw new Error(`its picture could not be moved or removed, so the receipt stays as it is: ${error.message}`)
          thumbTo = null
        }
      } else if (!(await existsAt(thumbs, thumbTo))) thumbTo = null
    }
    // Review round 1: a row flagged ordinary whose object is already behind
    // the gate (a run that stopped after writing the path, before the flag)
    // needs only its row changed.
    if (from !== to) {
      if (!(await existsAt(bucket, to))) {
        const { error } = await bucket.move(from, to)
        if (error) throw new Error(`its body could not be moved behind the gate: ${error.message}`)
      } else if (await existsAt(bucket, from)) {
        throw new Error('its body is at both its old and its new place in the cloud; both were left')
      }
    } else if (!(await existsAt(bucket, to))) {
      // Review round 2: the flag may say money only once the body is there.
      throw new Error('its body is not in the cloud at the place its row names, so the row was left as it is')
    }
    const { data, error } = await supabase.from('files').update({ is_financial: true, storage_path: to, thumbnail_url: thumbTo }).eq('id', f.id).eq('project_id', projectId).eq('is_financial', false).select('id')
    if (error) throw new Error(`its row could not be put behind the gate: ${error.message}`)
    if (!Array.isArray(data) || data.length !== 1) throw new Error('its row was not changed (changed by someone else meanwhile)')
    return true
  }
  // The dry run's count of the receipts the real run will move: the bundle's
  // money files already in the cloud whose row says ordinary.
  const countOpenReceipts = async (projectId, money) => {
    const ids = money.files.filter(hasId).map(f => String(f.id))
    if (!ids.length) return
    const r = await listCloudIn('files', 'id', ids, 'id, project_id, is_financial')
    if (r.error) return
    const open = r.rows.filter(x => x.project_id === projectId && x.is_financial === false).length
    if (open) { report.receiptsMoved += open; note(`  ${RECEIPTS_WILL_MOVE(open)}`) }
  }

  // Fetch the local project list. On a fresh install there may be no local
  // server — handle a 404/network error as "nothing to migrate".
  let localProjects
  try {
    localProjects = await fetchLocalProjectsList()
  } catch (err) {
    report.errors.push({ scope: 'list', message: err.message })
    report.finishedAt = new Date().toISOString()
    return report
  }

  note(`Found ${localProjects.length} local project${localProjects.length === 1 ? '' : 's'}.`)
  // Asked once, and only when there is something to write.
  let legalLocked = null

  // M3 (night 5): the people, the company's stores and their record, then
  // the rate cards — before any project (the dry run and the real one alike).
  const stores = await fetchWorkspaceStores()
  const people = await buildPeople(stores.members)
  report.people = {
    canMatch: people.canMatch, desktop: people.desktop, matched: people.matched,
    unmatched: people.unmatched.map(u => ({ id: u.id, name: u.name, why: u.why })), shared: people.shared,
    managersSeated: [], set: 0, needAdmin: !!(people.desktop && !people.canMatch && !people.unread), unread: people.unread || null,
  }
  sayPeople()
  const wrc = await workspaceRecordContext(dryRun)
  // Whether each desktop project is in the cloud as this workspace's (`ours`)
  // or failed this run: a pinned template waits on its project.
  const projectsOurs = new Map()
  const templatesInCloud = new Set()
  await carryRateCards(dryRun)

  for (const { id: projectId, title } of localProjects) {
    note(`• ${title ?? projectId}`)
    let bundle
    try {
      bundle = await fetchLocalProject(projectId)
    } catch (err) {
      report.errors.push({ scope: 'load', projectId, message: err.message })
      bumpFailed(report.projects)
      continue
    }

    // Shape tolerance — localServerAdapter.loadProject returns
    //   { project, phases, assets, tasks, dependencies, taskLinks, files,
    //     assetVersions, comments, ingestionRuns }
    // Dry run: count only — and say the link counts out loud. A project with
    // edges used to migrate to an empty Gantt with no line in the report
    // (docs/OUTSTANDING.md, closed by Track A A2); the counts are the promise
    // the real run is then held to.
    if (dryRun) {
      // Review round 2: whether the project is there already, so its status
      // line is said only for a project that will arrive (as the real run
      // says it), and a second dry run counts it as there.
      const projectThere = await cloudProjectThere(projectId)
      if (projectThere.error) report.errors.push({ scope: 'project', projectId, message: `could not read whether the project is in the cloud already: ${projectThere.error.message || projectThere.error}` })
      // Review round 1 (M2): another workspace's project is none of this
      // run's, as the real run says.
      if (projectThere.there && !projectThere.ours) { report.errors.push({ scope: 'project', projectId, message: PROJECT_NOT_OURS }); bumpFailed(report.projects); continue }
      // M2: a project an earlier run carried that the cloud no longer shows
      // is not carried again, nor anything of it (the real run's rule).
      if (!projectThere.error && !projectThere.there && carriedRecordOf(bundle, workspaceId).get('projects')?.has(String(projectId))) {
        removeProject(bundle, projectId)
        continue
      }
      if (projectThere.there) bumpSkipped(report.projects)
      else bumpInserted(report.projects)
      projectsOurs.set(String(projectId), 'ours')
      // M2: the money, as the real run will take it — a project about to be
      // inserted is the person's to manage (fn_projects_auto_staff).
      const money = moneyOf(bundle)
      const asked = await moneyAsk(money, projectId, !projectThere.there)
      const moneyGoes = asked.sees
      const rc = await recordContext(projectId, bundle, { dry: true, money: moneyGoes })
      // M3: the roster, as the real run gives the seats; a producer the map
      // names on a project about to arrive is seated by the cloud as its manager.
      const removedBefore = { ...report.removed.byTable }
      const linksBefore = report.rowLinksLetGo
      await carryRoster(bundle, projectId, true, rc, projectThere.there ? [] : [people.callerUserId, people.userOf(bundle.project?.producer_id)])
      if (!projectThere.there && people.userOf(bundle.project?.producer_id)) report.people.managersSeated.push(seatName(bundle.project.producer_id))
      // The rows of a table this run will try (those an earlier run carried
      // and the cloud no longer shows are counted as removed, and left out).
      const toTry = (table, rows) => (rows ?? []).filter(r => {
        if (!isObj(r) || !hasId(r) || rc.gate(table, r.id) !== 'removed') return true
        rc.removed(table, r)
        return false
      })
      const deps = (bundle.dependencies ?? []).filter(isObj)
      const depsToTry = [...toTry('task_dependencies', deps.filter(d => dependencyKind(d) !== 'phase')), ...toTry('phase_dependencies', deps.filter(d => dependencyKind(d) === 'phase'))]
      report.phases.total += toTry('phases', bundle.phases).length
      report.assets.total += toTry('assets', bundle.assets).length
      report.tasks.total  += toTry('tasks', bundle.tasks).length
      // FX2 (0096): the items, as the real run will take them.
      report.taskItems.total += toTry('task_items', itemsToCarry(bundle)).length
      const links = countLinks(depsToTry)
      report.taskDependencies.total += links.task
      report.phaseLinks.total += links.phase
      note(`  ${plural((bundle.phases ?? []).length, 'phase')}, ${plural((bundle.tasks ?? []).length, 'task')}, ` +
           `${plural(links.task, 'task dependency', 'task dependencies')}, ${plural(links.phase, 'phase link')}`)
      // S4b (review round 2, R2-BEH-07): the dry run promises what the real
      // run will do with Legal files, asked of the same database.
      const legalCount = (bundle.files ?? []).filter(isLegalFile).length
      if (legalCount > 0) {
        if (legalLocked === null) legalLocked = await cloudLocksLegal()
        report.legalFiles = (report.legalFiles || 0) + legalCount
        note(legalLocked
          ? `  ${plural(legalCount, 'Legal file')} will go to the cloud's locked LEGAL folder`
          : `  ${plural(legalCount, 'Legal file')} will stay on this computer: ${LEGAL_UNAVAILABLE}`)
      }
      // BC3 (B9): what the bins' part will do — counted against what the
      // cloud already holds (a row there is skipped; the rest would be
      // inserted, and a row removed from the cloud since an earlier run is
      // among them: review round 1) — and the question the real run needs
      // answered: each distinct root of the clips, with what the answers
      // given so far make of it.
      const wouldWrite = async (bucket, table, rows0) => {
        const rows = toTry(table, rows0)
        if (!rows.length) return
        const have = await cloudIds(table, projectId)
        if (have.error) { report.errors.push({ scope: table, projectId, message: `could not read what the cloud already holds: ${have.error.message || have.error}` }); bucket.total += rows.length; return }
        const there = rows.filter(r => have.ids.has(r.id)).length
        bucket.total += rows.length; bucket.skipped += there; bucket.inserted += rows.length - there
      }
      await wouldWrite(report.scenes, 'scenes', bundle.scenes ?? [])
      await wouldWrite(report.shots, 'shots', bundle.shots ?? [])
      await wouldWrite(report.bins, 'bins', bundle.bins ?? [])
      countNotCarried(bundle)
      countPart2LeftAtHome(bundle, moneyGoes)
      // M1 (night 3): the project row, then the five kinds as the real run
      // takes them — every row of the bundle taken to land (the dry run
      // writes nothing to fail). M2: the levels and experiences, the links
      // on tasks and the budget the same way.
      countProjectLeftAtHome(bundle, !projectThere.there)
      {
        const here = { phases: idSet(bundle.phases), assets: idSet(bundle.assets), tasks: idSet(bundle.tasks), scenes: idSet(bundle.scenes), shots: idSet(bundle.shots), levels: idSet(bundle.levels), experiences: idSet(bundle.experiences) }
        // A row removed in the cloud since an earlier run is gone for what
        // hangs on it, as it is in the real run.
        for (const [table, rows] of recordedKinds(bundle)) if (here[table]) for (const r of rows) if (rc.gate(table, r.id) === 'removed') here[table].delete(r.id)
        const stateOf = async (table, id) => (here[table]?.has(id) ? 'landed' : 'gone')
        await carryMilestones(bundle, projectId, stateOf, true, rc)
        await carryLevels(bundle, projectId, true, rc)
        const cloudTasks = projectThere.there && (bundle.taskLinks ?? []).length ? (await cloudIds('tasks', projectId)).ids : null
        await carryTaskLinks(bundle, projectId, stateOf, true, rc, cloudTasks)
        await carryComments(bundle, projectId, stateOf, true, rc)
        const lists = await carryShotLists(bundle, projectId, { scenes: here.scenes, shots: here.shots }, true, rc)
        const folders = await carryFolders(bundle, projectId, (fk, id) => (
          here[{ asset_id: 'assets', scene_id: 'scenes', shot_id: 'shots', level_id: 'levels', experience_id: 'experiences' }[fk]]?.has(id) ? 'landed' : 'gone'
        ), true, rc)
        // The files as the real run will take them: one the cloud holds
        // already is skipped there, filed nowhere (review round 1); one in a
        // folder that did not land waits with it; the rest are filed, and a
        // link to a row this computer removed is let go (review round 2). A
        // file in the cloud's trash is hidden from this read: the real run
        // meets its key and skips it. M2: one removed in the cloud since an
        // earlier run is not carried again; money stays behind the gate (a
        // receipt kept as an ordinary file goes up as money), or here.
        // Money left here (the gate shut to this person) is none of this
        // run's files, in the count too, as in the real run (review round 1).
        let toCarry = toTry('files', (bundle.files ?? []).filter(f => moneyGoes || !money.files.includes(f))).filter(isObj)
        report.files.total += toCarry.length
        if (toCarry.length) {
          const have = await cloudIds('files', projectId)
          if (have.error) report.errors.push({ scope: 'files', projectId, message: `could not read the files already in the cloud: ${have.error.message || have.error}` })
          else {
            toCarry = toCarry.filter((f) => {
              if (have.ids.has(f.id)) return false
              // A receipt an earlier run found open, gone since: removed
              // there (the real run's rule, review round 2).
              if (!rc.has('receipts_open', f.id)) return true
              rc.removed('files', f)
              report.files.total--
              return false
            })
          }
        }
        toCarry = toCarry.filter(f => !folders.failed.has(desktopFolderOfFile(f, bundle.folders)?.id))
        const placeable = toCarry.filter(f => cloudFolderOfFile(f, bundle, folders.cloudOf))
        report.files.placed += placeable.length
        if (placeable.length) note(`  ${FILES_PLACED(placeable.length)}`)
        const gatedNow = toCarry.filter(f => f.is_financial !== true && money.receipts.has(String(f.id))).length
        report.files.receiptsGated += gatedNow
        if (gatedNow) note(`  ${RECEIPTS_GATED(gatedNow)}`)
        let letGo = 0
        for (const f of toCarry) for (const [key, table] of Object.entries(FILE_LINKS)) if (named(f[key]) && !here[table].has(f[key])) letGo++
        report.files.linksLetGo += letGo
        if (letGo) note(`  ${FILE_LINKS_LET_GO(letGo)}`)
        // M3: the files kept with rows, as the real run takes them; the
        // receipts an earlier run left open; the people on rows an earlier
        // run carried; the assets whose template links wait on the templates.
        await carryManagedFiles(bundle, projectId, { dry: true, rc, folders, linkState: async (key, id) => (here[FILE_LINKS[key]]?.has(id) ? 'landed' : 'gone') })
        if (moneyGoes) await countOpenReceipts(projectId, money)
        if (moneyGoes) await carryBudgets(bundle, projectId, lists, true, rc)
        else if (!asked.unasked) leaveMoney(money)
        if (projectThere.there) await setPeopleOnEarlierRows(bundle, projectId, rc, true, moneyGoes)
        collectAssetTemplates(projectId, (bundle.assets ?? []).filter(a => isObj(a) && hasId(a) && rc.gate('assets', a.id) !== 'removed'))
      }
      if ((bundle.bins ?? []).length || (bundle.binFiles ?? []).length) {
        const clips = bundle.binFiles ?? []
        const roots = binRootsOf(bundle)
        binsState.roots.push({ projectId, roots })
        note(`  ${plural((bundle.bins ?? []).length, 'bin')}, ${plural(clips.length, 'clip')} in ${plural(roots.length, 'footage root')}, ${plural((bundle.shotTakes ?? []).length, 'take')}`)
        const have = clips.length ? await listCloud('bin_files', 'project_id', projectId, 'id, poster_path') : { rows: [] }
        if (have.error) report.errors.push({ scope: 'bin_files', projectId, message: `could not read what the cloud already holds: ${have.error.message || have.error}` })
        const there = new Map((have.rows || []).map(r => [r.id, r]))
        const named = new Set()
        for (const root of roots) {
          const resolved = await resolveRoot(root)
          const what = resolved.kind === 'existing' ? `the company's "${resolved.location.name}"`
            : resolved.kind === 'new' ? `a new location "${resolved.name}" (${resolved.unc_path})`
              : resolved.kind === 'skip' ? 'left on this computer (not named)'
                : resolved.kind === 'invalid' ? `not an address the cloud takes: ${resolved.problem}`
                  : 'which footage location is this? (not named yet)'
          note(`    ${root.root}: ${plural(root.count, 'clip')} — ${what}`)
          if (resolved.kind === 'existing' || resolved.kind === 'new') { for (const id of root.clipIds) named.add(id); continue }
          report.binFiles.leftBehind += root.count
          for (const id of root.clipIds) {
            const clip = clips.find(f => f.id === id)
            report.clipsLeftBehind.push({ projectId, id, name: clip?.display_name || clip?.original_name || id, root: root.root })
          }
        }
        // A clip with no readable path has no root to ask about: left here, listed.
        const rooted = new Set(roots.flatMap(r => r.clipIds))
        for (const clip of clips) {
          if (rooted.has(clip.id)) continue
          report.binFiles.leftBehind++
          report.clipsLeftBehind.push({ projectId, id: clip.id, name: clip.display_name || clip.original_name || clip.id, root: null })
        }
        for (const clip of clips) {
          if (!named.has(clip.id)) continue
          if (rc.gate('bin_files', clip.id) === 'removed') { rc.removed('bin_files', clip, clip.display_name || clip.original_name); named.delete(clip.id); continue }
          report.binFiles.total++
          if (there.has(clip.id)) report.binFiles.skipped++; else report.binFiles.inserted++
        }
        // The takes, counted as the real run lands them (review round 2):
        // the live ones only; one in the cloud (by id or by its pair) is
        // skipped; one whose clip goes (or is there) is inserted; one whose
        // clip stays waits with it.
        const liveTakes = liveTakesOf(bundle)
        const haveTakes = liveTakes.length ? await listCloud('shot_takes', 'project_id', projectId, 'id, shot_id, bin_file_id') : { rows: [] }
        if (haveTakes.error) report.errors.push({ scope: 'shot_takes', projectId, message: `could not read what the cloud already holds: ${haveTakes.error.message || haveTakes.error}` })
        const thereTakes = new Set((haveTakes.rows || []).flatMap(t => [t.id, takePairKey(t)]))
        for (const t of liveTakes) {
          if (hasId(t) && rc.gate('shot_takes', t.id) === 'removed') { rc.removed('shot_takes', t, 'take'); continue }
          report.shotTakes.total++
          if (thereTakes.has(t.id) || thereTakes.has(takePairKey(t))) report.shotTakes.skipped++
          else if (named.has(t.bin_file_id) || there.has(t.bin_file_id)) report.shotTakes.inserted++
          else report.shotTakes.leftBehind++
        }
        // Pictures, for the clips that will go: said now, so the switch is
        // no surprise after the run; one already in the cloud is skipped.
        const withPicture = clips.filter(f => named.has(f.id) && POSTER_MEDIA.has(f.media_type))
        const havePicture = withPicture.filter(f => there.get(f.id)?.poster_path).length
        const toUpload = withPicture.length - havePicture
        report.posters.total += withPicture.length
        report.posters.skipped += havePicture
        if (toUpload > 0) {
          const on = await switchOn()
          if (on) { report.posters.uploaded += toUpload; note(`  ${plural(toUpload, 'picture')} will upload (the company allows viewing from outside the office network)`) }
          else { report.posters.switchOff += toUpload; note(`  ${plural(toUpload, 'picture')}: ${POSTERS_SWITCH_OFF}`) }
        }
      }
      // VW1c (0098): what the views' part will do, counted against what the
      // cloud already holds (a row there is skipped; the rest would be
      // inserted; M2: one removed there since an earlier run is not).
      const viewsPart0 = viewsPartOf(bundle)
      const viewsPart = { views: toTry('table_views', viewsPart0.views), carried: toTry('item_groupings', viewsPart0.carried) }
      if (viewsPart.views.length || viewsPart.carried.length) {
        const have = await cloudViewIds(projectId)
        if (have.absent || have.error) {
          report.errors.push({ scope: 'table_views', projectId, message: have.absent ? TABLE_VIEWS_NOT_IN_CLOUD(viewsPart.views.length, viewsPart.carried.length) : TABLE_VIEWS_UNREAD(have.error.message || have.error) })
          report.tableViews.total += viewsPart.views.length
          report.itemGroupings.total += viewsPart.carried.length
        } else {
          for (const [rows, bucket, there, scope] of [[viewsPart.views, report.tableViews, have.views, 'table_view'], [viewsPart.carried, report.itemGroupings, have.groupings, 'item_grouping']]) {
            for (const row of rows) {
              if (!hasId(row)) { report.errors.push({ scope, projectId, message: NO_ID }); bumpFailed(bucket); continue }
              if (there.has(row.id)) bumpSkipped(bucket); else bumpInserted(bucket)
            }
          }
        }
        note(viewsNote(viewsPart.views.length, viewsPart.carried.length))
      }
      sayRemoved(removedBefore)
      if (report.rowLinksLetGo > linksBefore) note(`  ${ROW_LINKS_LET_GO(report.rowLinksLetGo - linksBefore)}`)
      report.footageRoots = mergeRoots(binsState.roots).map(r => ({ ...r, resolved: (resolvedAnswers.get(r.key) || { kind: 'unanswered' }).kind }))
      continue
    }

    // Project row, through the cloud's columns, in the target workspace
    // (projectRowForCloud, migrationRows.js, says what stays and why).
    //
    // active_shot_list_id stays here (0084; S3a review round 1, scope#9): it
    // names a list not in the cloud yet, so the composite FK
    // projects_active_shot_list_fk refused the whole project (23503) — and
    // its phases, assets and tasks with it. M1 sets it through
    // set_active_shot_list() once the lists are in. Measured on wilson-dev
    // (M1, rolled back): the desktop's `documents` refused the whole row
    // (42703; through PostgREST, PGRST204), so did a locked or open bid
    // version the cloud does not hold (23503) and a folder on this computer
    // (P0001) — every desktop project, until this allowlist.
    // M2: a project an earlier run carried that the cloud no longer shows (a
    // teammate removed it, or put it in the cloud's trash) is not carried
    // again, nor anything of it.
    if (carriedRecordOf(bundle, workspaceId).get('projects')?.has(String(projectId))) {
      const there = await cloudProjectThere(projectId)
      if (there.error) {
        report.errors.push({ scope: 'project', projectId, message: `could not read whether the project is still in the cloud, so none of it was written (run again): ${there.error.message || there.error}` })
        bumpFailed(report.projects)
        continue
      }
      if (!there.there) { removeProject(bundle, projectId); continue }
    }
    let arriving = false
    let statusRefused = null
    let sent = null
    try {
      const row = projectRowForCloud(bundle.project ?? {}, workspaceId, people)
      sent = row
      let r
      try {
        r = await insertOrSkip('projects', row)
      } catch (err) {
        // A cloud without 0103 refuses the desktop's Draft, Wrapped and
        // Inactive (22P02 — measured), and with one the whole project: it is
        // sent again without its status, so it arrives as active, said.
        if (!('status' in row) || !/invalid input value for enum project_status/.test(err.message)) throw err
        const { status, ...rest } = row
        r = await insertOrSkip('projects', rest)
        statusRefused = String(status)
      }
      if (r.status === 'inserted') { bumpInserted(report.projects); arriving = true }
      else {
        // Review round 1 (M2): skipped by its key, the project is this run's
        // to fill only if the cloud shows it in THIS workspace. An id held
        // elsewhere (the same desktop moved into a second company) or out of
        // this person's sight is said, and none of it written or recorded (the
        // record named it, and the next run called it removed).
        const mine = await cloudProjectThere(projectId)
        if (mine.error) throw new Error(`could not check whether the project already in the cloud is in this workspace, so none of it was written (run again): ${mine.error.message || mine.error}`)
        if (!mine.ours) throw new Error(PROJECT_NOT_OURS)
        bumpSkipped(report.projects)
      }
    } catch (err) {
      report.errors.push({ scope: 'project', projectId, message: err.message })
      bumpFailed(report.projects)
      countProjectLeftAtHome(bundle, false)
      projectsOurs.set(String(projectId), 'failed')
      continue // don't try children if the project itself failed
    }
    countProjectLeftAtHome(bundle, arriving, statusRefused)
    projectsOurs.set(String(projectId), 'ours')
    // M3: a producer the map names on a project that arrives is seated by the
    // cloud as its manager (fn_projects_auto_staff — measured): named.
    if (arriving && people.userOf(bundle.project?.producer_id)) report.people.managersSeated.push(seatName(bundle.project.producer_id))

    // M2: the money (behind its gate, asked once the project is in: a project
    // this run inserted is the person's to manage — fn_projects_auto_staff),
    // and the record of what earlier runs carried into this workspace.
    const money = moneyOf(bundle)
    const asked = await moneyAsk(money, projectId, false)
    const moneyGoes = asked.sees
    const rc = await recordContext(projectId, bundle, { dry: false, money: moneyGoes })
    rc.add('projects', projectId)
    // Review round 1 (M3): the people the project arrived with are recorded
    // as set now (`people_set`), so a teammate who clears one later is not
    // overruled by the next run; a column that arrived empty (its person
    // without an account yet) is not, and is set once they join.
    if (arriving) for (const col of PROJECT_PEOPLE) if (sent?.[col] != null) rc.add('people_set', `project:${projectId}:${col}`)
    const removedBefore = { ...report.removed.byTable }
    const linksBefore = report.rowLinksLetGo
    // M3: the roster, right after the project row (the seats need nothing else).
    await carryRoster(bundle, projectId, false, rc)
    countPart2LeftAtHome(bundle, moneyGoes)

    // M1: which of this project's rows did not land in this run (a comment,
    // a key date or a folder on one fails with it, and a second run brings
    // both), and this project's rows as the cloud shows them, read once per
    // table when a kind needs them: a row whose id another project holds is
    // skipped by its key below, and must never take this project's comment,
    // key date or folder.
    const failedRows = { phases: new Set(), assets: new Set(), tasks: new Set(), levels: new Set(), experiences: new Set() }
    const here = { phases: idSet(bundle.phases), assets: idSet(bundle.assets), tasks: idSet(bundle.tasks), scenes: idSet(bundle.scenes), shots: idSet(bundle.shots), levels: idSet(bundle.levels), experiences: idSet(bundle.experiences) }
    const cloudRowsOf = new Map()
    const verified = async (table) => {
      if (cloudRowsOf.has(table)) return cloudRowsOf.get(table)
      const r = await cloudIds(table, projectId)
      if (r.error) report.errors.push({ scope: table, projectId, message: `could not read the project's ${table} in the cloud, so nothing that hangs on them was carried (run again): ${r.error.message || r.error}` })
      cloudRowsOf.set(table, r.error ? null : r.ids)
      return cloudRowsOf.get(table)
    }
    // A row of `table` as this run left it: 'landed' (the cloud shows it
    // under this project), 'failed' (its insert failed in this run),
    // 'unread' (the read of the cloud's rows failed: not known; review round
    // 2 says so apart), 'gone' (removed on this computer — or in the cloud,
    // but not as this project's row: in its trash, or another project's id).
    const stateOf = async (table, id) => {
      if (!here[table]?.has(id)) return 'gone'
      const ids = await verified(table)
      if (!ids) return 'unread'
      if (ids.has(id)) return 'landed'
      return failedRows[table]?.has(id) ? 'failed' : 'gone'
    }

    // Phases / assets / tasks — parent-join-based RLS. assets and tasks
    // auto-populate workspace_id from their project via our 0004 triggers.
    // M1-L5 (settled by M2): this project's rows of the three as the cloud
    // shows them, read before they go up, so a duplicate id is "already
    // there" only for this project's own row (another project's is said);
    // and each phase link — a phase's parent, an asset's or a task's phase,
    // plain keys with no project in them that take any project's phase
    // (measured) — is kept only to a phase of this project in the cloud: one
    // that failed in this run keeps the row with it (a second run brings
    // both), one removed on this computer, in the cloud's trash or another
    // project's is let go, counted (ROW_LINKS_LET_GO). An asset's levels and
    // experiences the same way (M2: they land before it).
    const knownSched = {}
    for (const table of ['phases', 'assets', 'tasks']) {
      if (!(bundle[table] ?? []).length) continue
      const r = await cloudIds(table, projectId)
      if (r.error) report.errors.push({ scope: table, projectId, message: `could not read the project's ${table} in the cloud, so one refused as a duplicate reads as already there: ${r.error.message || r.error}` })
      knownSched[table] = r.error ? null : r.ids
    }
    const oursSched = (table) => (knownSched[table] ? (row) => knownSched[table].has(row.id) : null)
    const phasesOurs = new Set(knownSched.phases || [])
    let schedLetGo = 0
    // One row of the three: `shape(row)` answers its cloud row and the links
    // it let go, or throws why it waits (said, and its children with it).
    const carrySched = async (table, scope, bucket, src, shape, onLanded, onInserted) => {
      const g = hasId(src) ? rc.gate(table, src.id) : 'new'
      if (g === 'removed') { rc.removed(table, src); return }
      if (g === 'there') { bumpSkipped(bucket); onLanded?.(src.id); return }
      try {
        const { row, letGo } = shape(src)
        const r = await insertOrSkip(table, row, oursSched(table))
        r.status === 'inserted' ? bumpInserted(bucket) : bumpSkipped(bucket)
        if (r.status === 'inserted') { schedLetGo += letGo; onInserted?.(row) }
        if (r.status === 'inserted' || knownSched[table]) onLanded?.(src.id)
        if (keepsId(r, !!knownSched[table])) rc.add(table, src.id, r.status === 'inserted')
      } catch (err) {
        report.errors.push({ scope, projectId, id: src?.id, message: err.message })
        bumpFailed(bucket)
        // Another project's id is no run's to change: what names this row
        // lets the link go; any other refusal keeps it waiting with the row.
        if (!err.notOurs) failedRows[table].add(src?.id)
      }
    }
    // A phase link as the cloud may take it, or the reason the row waits.
    const phaseLink = (id, what) => {
      if (!named(id)) return { id: id === '' ? null : id, letGo: 0 }
      if (phasesOurs.has(id)) return { id, letGo: 0 }
      if (failedRows.phases.has(id)) throw new Error(`${what}: its phase is not in the cloud, so it was not carried (a second run brings both)`)
      return { id: null, letGo: 1 }
    }
    for (const ph of phasesParentsFirst(bundle.phases ?? [])) {
      await carrySched('phases', 'phase', report.phases, ph, (src) => {
        const row = { ...withoutSetAside(src) }
        if (!('parent_phase_id' in row)) return { row, letGo: 0 }
        const link = phaseLink(row.parent_phase_id, src.name || src.id)
        row.parent_phase_id = link.id
        return { row, letGo: link.letGo }
      }, (id) => phasesOurs.add(id))
    }
    // M1: the key dates, after the phases they may sit in.
    await carryMilestones(bundle, projectId, stateOf, false, rc)
    // M2: the levels and experiences, before the assets and everything else
    // that names them.
    const levelsOut = await carryLevels(bundle, projectId, false, rc)
    failedRows.levels = levelsOut.levels.failed
    failedRows.experiences = levelsOut.experiences.failed
    // M3: the assets the cloud holds as this project's after this pass, whose
    // desktop row names a task template: linked after the templates land.
    const assetsLanded = new Set()
    for (const a of bundle.assets ?? []) {
      await carrySched('assets', 'asset', report.assets, a, (src) => {
        const keep = { level_ids: [], experience_ids: [] }
        let letGo = 0
        for (const [k, table, what] of [['level_ids', 'levels', 'level'], ['experience_ids', 'experiences', 'experience']]) {
          for (const id of Array.isArray(src[k]) ? src[k] : []) {
            if (levelsOut[table].ours.has(id)) { if (!keep[k].includes(id)) keep[k].push(id) }
            else if (levelsOut[table].failed.has(id)) throw new Error(`${src.name || src.id}: its ${what} is not in the cloud, so it was not carried (a second run brings both)`)
            // Review round 1 (M3): let go here, the link was lost for good.
            else if (levelsOut[table].unread.has(id)) throw new Error(`${src.name || src.id}: whether its ${what} is this project's in the cloud could not be checked (the read failed), so it was not carried (run again)`)
            else letGo++
          }
        }
        const row = assetRowForCloud(src, keep)
        if ('phase_id' in row) { const link = phaseLink(row.phase_id, src.name || src.id); row.phase_id = link.id; letGo += link.letGo }
        return { row, letGo }
      }, (id) => assetsLanded.add(id))
    }
    collectAssetTemplates(projectId, (bundle.assets ?? []).filter(a => isObj(a) && assetsLanded.has(a.id)))
    for (const t of bundle.tasks ?? []) {
      await carrySched('tasks', 'task', report.tasks, t, (src) => {
        const row = taskRowForCloud(src, people)
        if (!('phase_id' in row)) return { row, letGo: 0 }
        const link = phaseLink(row.phase_id, src.title || src.id)
        row.phase_id = link.id
        return { row, letGo: link.letGo }
      }, null, (row) => {
        // Review round 1 (M3): a task that arrives with its people is recorded
        // as set, so a teammate who clears one later is not overruled.
        if (hasId(t)) for (const col of TASK_PEOPLE) if (row[col] != null) rc.add('people_set', `task:${t.id}:${col}`)
      })
    }
    report.rowLinksLetGo += schedLetGo

    // Dependency edges — both tables, after every endpoint row is in.
    // dependencyKind / DEPENDENCY_TABLE route each row to its table exactly
    // as the adapter does on a live link. `kind` and `project_id` are not
    // columns (the desktop URL and the Gantt's arrow routing need them; the
    // database does not) and `predecessor` is the embed a cloud load adds, so
    // all three are stripped BEFORE toColumns, which then has nothing to warn
    // about on a well-formed row. An edge whose endpoint failed above is
    // refused by the foreign key and lands in `errors` with its id — the
    // report says so instead of the Gantt going quietly empty.
    for (const dep of bundle.dependencies ?? []) {
      const kind   = dependencyKind(dep)
      const table  = DEPENDENCY_TABLE[kind]
      const bucket = kind === 'phase' ? report.phaseLinks : report.taskDependencies
      const g = hasId(dep) ? rc.gate(table, dep.id) : 'new'
      if (g === 'removed') { rc.removed(table, dep, kind === 'phase' ? 'phase dependency' : 'task dependency'); continue }
      if (g === 'there') { bumpSkipped(bucket); continue }
      try {
        const columns = { ...dep }
        delete columns.kind
        delete columns.project_id
        delete columns.predecessor
        const r = await insertOrSkip(table, toColumns(table, columns))
        r.status === 'inserted' ? bumpInserted(bucket) : bumpSkipped(bucket)
        if (keepsId(r)) rc.add(table, dep.id)
      } catch (err) {
        report.errors.push({ scope: kind === 'phase' ? 'phase_link' : 'task_dependency', projectId, id: dep.id, message: err.message })
        bumpFailed(bucket)
      }
    }

    // M2: the links on tasks, after the tasks (read through them).
    if ((bundle.taskLinks ?? []).length) await carryTaskLinks(bundle, projectId, stateOf, false, rc, await verified('tasks'))
    // M1: the comments, after every row they can hang on (the project, its
    // phases, assets and tasks).
    await carryComments(bundle, projectId, stateOf, false, rc)

    // ── BC3 (B9): the bins — "bins move with the project" ────────────────
    // Scenes and shots first: a take links a shot to a clip, and a clip may
    // be logged to a scene and a shot, so their rows must be in the cloud
    // before the bins' (the runner carried neither before BC3). Since M1 the
    // shot lists, their items and edits, the folders and the files (each in
    // its folder) come next, before the bins. Then the bins, parents first; then each clip under the
    // footage location its root was named as; then the takes whose shot and
    // clip both landed; then the pictures, while the switch is on. Every
    // row keeps its id (the desktop's UUIDs are 0091's), so a second run
    // skips what is there.
    const landed = { scenes: new Set(), shots: new Set(), bins: new Set(), clips: new Set() }
    // M1 (review round 1, security): the scenes and shots KNOWN to be this
    // project's — inserted now, or skipped while the read of what the cloud
    // holds answered (a duplicate key is then this project's own row). A
    // folder's or a file's scene or shot link is a plain foreign key, so it
    // is kept only to one of these; `landed` also takes a skip made while
    // that read failed, which may be another project's row.
    const landedOurs = { scenes: new Set(), shots: new Set() }
    countNotCarried(bundle)
    // What the cloud already holds for THIS project, per table, so that a
    // duplicate key is "already there" only for this project's own row
    // (review round 2). A read that fails is said; its table then skips a
    // duplicate as before.
    const known = {}
    for (const [key, table] of [['scenes', 'scenes'], ['shots', 'shots'], ['bins', 'bins']]) {
      if (!(bundle[key] ?? []).length) continue
      const r = await cloudIds(table, projectId)
      if (r.error) { known[table] = null; report.errors.push({ scope: table, projectId, message: `could not read what the cloud already holds, so a row refused as a duplicate reads as already there: ${r.error.message || r.error}` }) }
      else known[table] = r.ids
    }
    const oursIn = (table) => (known[table] ? (row) => known[table].has(row.id) : null)
    // M2: removed in the cloud since an earlier run — not carried again, and
    // what hangs on it there let go with it (`removedHere`).
    const removedHere = { scenes: new Set(), shots: new Set(), bins: new Set(), clips: new Set() }
    for (const sc of bundle.scenes ?? []) {
      const g = hasId(sc) ? rc.gate('scenes', sc.id) : 'new'
      if (g === 'removed') { rc.removed('scenes', sc); removedHere.scenes.add(sc.id); continue }
      if (g === 'there') { bumpSkipped(report.scenes); landed.scenes.add(sc.id); landedOurs.scenes.add(sc.id); continue }
      try {
        const r = await insertOrSkip('scenes', toColumns('scenes', withoutSetAside(cloudRowOf(sc, projectId))), oursIn('scenes'))
        r.status === 'inserted' ? bumpInserted(report.scenes) : bumpSkipped(report.scenes)
        landed.scenes.add(sc.id)
        if (r.status === 'inserted' || known.scenes) landedOurs.scenes.add(sc.id)
        if (keepsId(r, !!known.scenes)) rc.add('scenes', sc.id)
      } catch (err) {
        report.errors.push({ scope: 'scene', projectId, id: sc.id, message: err.message })
        bumpFailed(report.scenes)
      }
    }
    for (const sh of bundle.shots ?? []) {
      const g = hasId(sh) ? rc.gate('shots', sh.id) : 'new'
      if (g === 'removed') { rc.removed('shots', sh); removedHere.shots.add(sh.id); continue }
      if (g === 'there') { bumpSkipped(report.shots); landed.shots.add(sh.id); landedOurs.shots.add(sh.id); continue }
      try {
        const row = withoutSetAside(cloudRowOf(sh, projectId))
        // A scene removed in the cloud since an earlier run: let go, counted.
        if (row.scene_id && removedHere.scenes.has(row.scene_id)) { row.scene_id = null; report.rowLinksLetGo++ }
        // 0040's scene link is a plain FK (no project in it): a scene that
        // did not land here — failed, or another project's — is let go, and
        // said (review round 2, security: a migrated shot must not hang off
        // a scene of another project).
        // M1 review round 2 (security): a scene skipped while the read of the
        // cloud's scenes failed may be another project's, whose delete would
        // take this shot with it (0040's ON DELETE CASCADE); the shot waits —
        // a second run, the read answering, brings it with its scene.
        if (row.scene_id && landed.scenes.has(row.scene_id) && !landedOurs.scenes.has(row.scene_id)) {
          report.errors.push({ scope: 'shot', projectId, id: sh.id, message: `${sh.name || sh.id}: whether its scene is this project's could not be checked (the read of the cloud's scenes failed), so the shot was not carried (a second run brings it)` })
          bumpFailed(report.shots)
          continue
        }
        if (row.scene_id && !landed.scenes.has(row.scene_id)) { report.errors.push({ scope: 'shot', projectId, id: sh.id, message: `${sh.name || sh.id}: its scene is not in the cloud, so the shot's scene link was left empty` }); row.scene_id = null }
        const r = await insertOrSkip('shots', toColumns('shots', row), oursIn('shots'))
        r.status === 'inserted' ? bumpInserted(report.shots) : bumpSkipped(report.shots)
        landed.shots.add(sh.id)
        if (r.status === 'inserted' || known.shots) landedOurs.shots.add(sh.id)
        if (keepsId(r, !!known.shots)) rc.add('shots', sh.id)
      } catch (err) {
        report.errors.push({ scope: 'shot', projectId, id: sh.id, message: err.message })
        bumpFailed(report.shots)
      }
    }
    // ── M1 (night 3): shot lists with their items and edits, then the
    // folders, after the scenes and shots they name (and the assets) ──────
    const lists = await carryShotLists(bundle, projectId, landed, false, rc)
    // A scene, shot, level or experience as this run left it, for what hangs
    // on it (M2: one removed in the cloud since an earlier run is gone; the
    // levels and experiences land before the folders and files).
    const sceneShotState = (kind, id) => (landedOurs[kind].has(id) ? 'landed' : here[kind].has(id) && !removedHere[kind].has(id) ? 'failed' : 'gone')
    const levelState = (table, id) => (levelsOut[table].ours.has(id) ? 'landed' : levelsOut[table].failed.has(id) ? 'failed' : levelsOut[table].unread.has(id) ? 'unread' : 'gone')
    const folderAssets = (bundle.folders ?? []).some(f => isObj(f) && named(f.asset_id)) ? await verified('assets') : new Set()
    const folders = await carryFolders(bundle, projectId, (fk, id) => {
      if (fk === 'level_id') return levelState('levels', id)
      if (fk === 'experience_id') return levelState('experiences', id)
      if (fk === 'scene_id') return sceneShotState('scenes', id)
      if (fk === 'shot_id') return sceneShotState('shots', id)
      if (fk === 'asset_id') return !here.assets.has(id) ? 'gone' : !folderAssets ? 'unread' : folderAssets.has(id) ? 'landed' : failedRows.assets.has(id) ? 'failed' : 'gone'
      return 'gone'
    }, false, rc)
    // A file's own links (0000's phase, asset and task; 0043's scene, shot,
    // level and experience) are plain foreign keys, with no project in them.
    // Each is kept only to a row the cloud holds as this project's; a row of
    // this project that did not land in this run fails the file with it,
    // before a byte moves (a second run brings both); a row removed on this
    // computer (the desktop's deletes leave a file's link) or not this
    // project's is let go, counted and said (review round 1, security, and a
    // run that could never be Done: before, such a file was refused on every
    // run).
    const fileLinkState = async (key, id) => {
      if (key === 'scene_id') return sceneShotState('scenes', id)
      if (key === 'shot_id') return sceneShotState('shots', id)
      if (key === 'level_id') return levelState('levels', id)
      if (key === 'experience_id') return levelState('experiences', id)
      return stateOf(FILE_LINKS[key], id)
    }

    // Files — upload the binary, then the metadata row (which gets the
    // cloud storage_path). Since M1 after the folders: each row is filed in
    // the folder the desktop shows it in (cloudFolderOfFile), and after the
    // scenes and shots, which a file's own links may name.
    let placed = 0
    let linksLetGo = 0
    let receiptsGated = 0
    let receiptsOpen = 0
    let receiptsMoved = 0
    for (const f of bundle.files ?? []) {
      // M2: money (an invoice, or a receipt an expense or an actual names,
      // whatever its own flag) goes up behind the money gate, or — when the
      // person cannot see this project's budget — stays here with it, asked
      // nothing (review round 1: its record would read it as removed). One
      // removed in the cloud since an earlier run is never uploaded again.
      const isMoney = isObj(f) && (f.is_financial === true || money.receipts.has(String(f.id)))
      if (isMoney && !moneyGoes) continue
      const g = hasId(f) ? rc.gate('files', f.id) : 'new'
      if (g === 'removed') { rc.removed('files', f); continue }
      if (g === 'there') { bumpSkipped(report.files); continue }
      try {
        // S4b: a Legal file (on the desktop, its tag) goes under LEGAL with
        // its tag, never core — or, where the cloud does not lock LEGAL, not
        // at all. Decided BEFORE its body is read.
        const legal = isLegalFile(f)
        if (legal) {
          if (legalLocked === null) legalLocked = await cloudLocksLegal()
          if (!legalLocked) {
            report.errors.push({ scope: 'file', projectId, id: f.id, message: `Legal file not migrated: ${LEGAL_UNAVAILABLE}` })
            bumpSkipped(report.files)
            continue
          }
        }
        const objectPath = cloudObjectPathFor(projectId, f, isMoney)
        const asked = await cloudFileRow(f.id)
        if (asked.error) {
          report.errors.push({ scope: 'file', projectId, id: f.id, message: `could not check whether the file is already in the cloud: ${asked.error.message || asked.error}` })
          bumpFailed(report.files)
          continue
        }
        const already = asked.row
        // Review round 2: a receipt an earlier run found open that the cloud
        // no longer shows was removed there (as RECEIPTS_LEFT_OPEN says an
        // admin may, or put in the trash): counted, named, never uploaded.
        if (!already && rc.has('receipts_open', f.id)) { rc.removed('files', f); continue }
        if (already) {
          // Review round 1 (M2): another project's file is not this one, and
          // never joins the record (a later run, not seeing it, would call it
          // removed); a receipt an earlier build carried as an ordinary file
          // is said on every run while it stays open (review round 2: kept in
          // the record apart, `receipts_open`, not as a carried file).
          if (already.project_id != null && already.project_id !== projectId) {
            report.errors.push({ scope: 'file', projectId, id: f.id, message: `${f.name || f.id}: a file with this id is in the cloud but is not this project's, so nothing was written for it` })
            bumpFailed(report.files)
            continue
          }
          // M3 (M2-L4): a receipt an earlier run carried as an ordinary file is
          // put behind the gate now — its picture, its body, its row — or left
          // open with the reason, said (never uploaded again).
          if (isMoney && already.is_financial === false) {
            bumpSkipped(report.files)
            try {
              await moveReceipt(projectId, f, already, objectPath)
              receiptsMoved++
              rc.add('files', f.id)
            } catch (err) {
              receiptsOpen++
              rc.add('receipts_open', f.id)
              report.errors.push({ scope: 'file', projectId, id: f.id, message: `${f.name || f.id}: still open to every member of the project in the cloud — ${err.message}` })
            }
            continue
          }
          if (already.storage_path && already.storage_path !== objectPath) {
            report.errors.push({
              scope: 'file', projectId, id: f.id,
              message: `already in the cloud at an older path (${already.storage_path}), not uploaded again — check that copy, and add the file again if it is wrong`,
            })
          }
          bumpSkipped(report.files)
          rc.add('files', f.id)
          continue
        }
        const links = {}
        let blocked = null
        for (const key of Object.keys(FILE_LINKS)) {
          // A cleared picker's '' is no link (the UUID column refuses it).
          if (f[key] === '') { links[key] = null; continue }
          if (!named(f[key])) continue
          const st = await fileLinkState(key, f[key])
          if (st === 'failed' || st === 'unread') { blocked = { what: key.replace(/_id$/, ''), unread: st === 'unread' }; break }
          if (st === 'gone') links[key] = null
        }
        if (blocked) {
          report.errors.push({
            scope: 'file', projectId, id: f.id,
            message: blocked.unread
              ? `${f.name || f.id}: whether its ${blocked.what} is in the cloud could not be checked (the read failed), so the file was not carried (run again)`
              : `${f.name || f.id}: its ${blocked.what} is not in the cloud, so the file was not carried (a second run brings both)`,
          })
          bumpFailed(report.files)
          continue
        }
        // Its folder (review round 2): one that did not land in this run
        // keeps the file with it, as a row the file is about does.
        if (folders.failed.has(desktopFolderOfFile(f, bundle.folders)?.id)) {
          report.errors.push({ scope: 'file', projectId, id: f.id, message: `${f.name || f.id}: its folder is not in the cloud, so the file was not carried (a second run brings both)` })
          bumpFailed(report.files)
          continue
        }
        const { blob, status } = await fetchLocalFileBlob(projectId, f.id)
        if (!blob) {
          report.errors.push({ scope: 'file', projectId, id: f.id, message: `the file's body could not be read on this computer (HTTP ${status})` })
          bumpFailed(report.files)
          continue
        }

        const objectDir = objectPath.slice(0, objectPath.lastIndexOf('/'))
        const safeName = objectPath.slice(objectPath.lastIndexOf('/') + 1)

        // Detect already-uploaded objects via list (cheap for the dir).
        const { data: existing } = await supabase.storage
          .from('rabbit-files')
          .list(objectDir, { limit: 10 })
        const alreadyUploaded = existing?.some(e => e.name === safeName)

        if (!alreadyUploaded) {
          const { error: upErr } = await supabase.storage
            .from('rabbit-files')
            .upload(objectPath, blob, {
              cacheControl: '3600',
              upsert: false,
              contentType: f.mime_type || blob.type || 'application/octet-stream',
            })
          if (upErr && !/already exists/i.test(upErr.message)) {
            throw new Error(`storage upload: ${upErr.message}`)
          }
          report.files.bytes += blob.size ?? 0
        }

        const row = {
          ...f,
          ...links,
          storage_provider: 'supabase',
          storage_path:     objectPath,
          // M1: the folder in the cloud, never the desktop's own id.
          folder_id:        cloudFolderOfFile(f, bundle, folders.cloudOf),
        }
        // M2: a receipt is money in the row as in its key (0038's row gate
        // and 0042's blob gate are set together, or either is a way in).
        if (isMoney) row.is_financial = true
        if (legal) {
          row.tags = ['legal', ...(Array.isArray(f.tags) ? f.tags.filter(t => t !== 'legal') : [])]
          row.is_core_definer = false // files_legal_not_core_chk
        } else if (Array.isArray(f.tags) && f.tags.includes('legal')) {
          row.tags = f.tags.filter(t => t !== 'legal') // not Legal: a label only
        }
        // Not there a moment ago: a duplicate now is a row this person cannot
        // see (another company's, a trashed one), never this run's to record.
        const r = await insertOrSkip('files', row)
        r.status === 'inserted' ? bumpInserted(report.files) : bumpSkipped(report.files)
        if (r.status === 'inserted' && row.folder_id) placed++
        if (r.status === 'inserted') linksLetGo += Object.entries(links).filter(([k]) => f[k] !== '').length
        if (r.status === 'inserted' && isMoney && f.is_financial !== true) receiptsGated++
        if (r.status === 'inserted') rc.add('files', f.id)
      } catch (err) {
        report.errors.push({ scope: 'file', projectId, id: f.id, message: err.message })
        bumpFailed(report.files)
      }
    }
    report.files.placed += placed
    if (placed) note(`  ${FILES_PLACED(placed)}`)
    report.files.linksLetGo += linksLetGo
    if (linksLetGo) note(`  ${FILE_LINKS_LET_GO(linksLetGo)}`)
    report.files.receiptsGated += receiptsGated
    if (receiptsGated) note(`  ${RECEIPTS_GATED(receiptsGated)}`)
    report.files.receiptsOpen += receiptsOpen
    if (receiptsOpen) note(`  ${RECEIPTS_LEFT_OPEN(receiptsOpen)}`)
    report.receiptsMoved += receiptsMoved
    if (receiptsMoved) note(`  ${RECEIPTS_MOVED(receiptsMoved)}`)
    // M3: the files the desktop keeps with its rows, after the ordinary files
    // (the same folders and links).
    await carryManagedFiles(bundle, projectId, { dry: false, rc, folders, linkState: fileLinkState })

    // M2: the budget, after the shot lists a bid version is built against and
    // the files its receipts are; behind the money gate, or left here, said
    // (a question the cloud did not answer is an error, said as one).
    if (moneyGoes) await carryBudgets(bundle, projectId, lists, false, rc)
    else if (!asked.unasked) leaveMoney(money)
    // M3: the people on the rows an earlier run carried without them (a
    // project that arrived now carries them already).
    if (!arriving) await setPeopleOnEarlierRows(bundle, projectId, rc, false, moneyGoes)

    for (const b of binsParentsFirst(bundle.bins ?? [])) {
      const g = hasId(b) ? rc.gate('bins', b.id) : 'new'
      if (g === 'removed') { rc.removed('bins', b); removedHere.bins.add(b.id); continue }
      if (g === 'there') { bumpSkipped(report.bins); landed.bins.add(b.id); continue }
      try {
        const r = await insertOrSkip('bins', toColumns('bins', { ...cloudRowOf(b, projectId), workspace_id: workspaceId }), oursIn('bins'))
        r.status === 'inserted' ? bumpInserted(report.bins) : bumpSkipped(report.bins)
        landed.bins.add(b.id)
        if (keepsId(r, !!known.bins)) rc.add('bins', b.id)
      } catch (err) {
        report.errors.push({ scope: 'bin', projectId, id: b.id, message: err.message })
        bumpFailed(report.bins)
      }
    }
    const clips = bundle.binFiles ?? []
    const roots = binRootsOf(bundle)
    if (clips.length) binsState.roots.push({ projectId, roots })
    const rootByClip = new Map()
    for (const root of roots) for (const id of root.clipIds) rootByClip.set(id, root)
    // What the cloud already holds for this project (a second run): the
    // rows to skip, and which of them still want a picture.
    let cloudClips = new Map()
    // The read failed: the rows still go (a row already there is skipped by
    // its key), but no picture does — which rows already have one is
    // unknown, and a second upload would orphan the first in the bucket.
    let cloudClipsUnknown = false
    if (clips.length) {
      const have = await listCloud('bin_files', 'project_id', projectId, 'id, poster_path, location_id')
      if (have.error) { cloudClipsUnknown = true; report.errors.push({ scope: 'bin_files', projectId, message: `could not read the project's clips already in the cloud, so no picture was uploaded for it: ${have.error.message || have.error}` }) }
      else cloudClips = new Map(have.rows.map(r => [r.id, r]))
    }
    const wantPicture = []
    const leftClips = new Set()
    // A clip already in the cloud keeps the location it has there: the
    // answer given now does not move it. Said once per root (review round 2:
    // the answer used to make an empty location for clips all already there).
    const keptLocation = new Map()
    for (const clip of clips) {
      const root = rootByClip.get(clip.id)
      const name = clip.display_name || clip.original_name || clip.id
      // M2: removed in the cloud since an earlier run (B10's remove): not
      // carried again, no location made for it, no picture.
      if (hasId(clip) && !cloudClips.has(clip.id) && rc.gate('bin_files', clip.id) === 'removed') {
        rc.removed('bin_files', clip, name)
        removedHere.clips.add(clip.id)
        continue
      }
      if (!root) {
        // No readable path: left here, listed (never dropped), with its reason.
        report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: no path recorded, so it was left on this computer` })
        report.binFiles.leftBehind++
        report.clipsLeftBehind.push({ projectId, id: clip.id, name, root: null })
        leftClips.add(clip.id)
        continue
      }
      let resolved
      try { resolved = await resolveRoot(root) } catch (err) { report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: err.message }); bumpFailed(report.binFiles); continue }
      if (resolved.kind !== 'existing' && resolved.kind !== 'new') {
        // Not named: left here, listed, never dropped. The desktop's bundle
        // is untouched, and a second run after naming the root brings it.
        report.binFiles.leftBehind++
        report.clipsLeftBehind.push({ projectId, id: clip.id, name, root: root.root })
        leftClips.add(clip.id)
        continue
      }
      try {
        // Already in the cloud (a second run): skipped BEFORE any location
        // is made for it, and its picture completed if it still has none.
        const already = cloudClips.get(clip.id)
        if (already) {
          const namedId = resolved.kind === 'existing' ? resolved.location.id : resolved.location?.id
          if (already.location_id && already.location_id !== namedId) keptLocation.set(root.key, (keptLocation.get(root.key) || 0) + 1)
          bumpSkipped(report.binFiles)
          landed.clips.add(clip.id)
          rc.add('bin_files', clip.id)
          if (POSTER_MEDIA.has(clip.media_type) && !already.poster_path && !cloudClipsUnknown) wantPicture.push(clip)
          else if (POSTER_MEDIA.has(clip.media_type)) { report.posters.total++; report.posters.skipped++ }
          continue
        }
        if (rc.gate('bin_files', clip.id) === 'there') { bumpSkipped(report.binFiles); landed.clips.add(clip.id); continue }
        if (!landed.bins.has(clip.bin_id)) throw new Error(`its bin (${clip.bin_id}) is not in the cloud`)
        // The row is built BEFORE a location is made for it (review round
        // 1): a clip the cloud cannot take leaves no empty location behind.
        const made = cloudBinFileRow(clip, { root: root.root, locationId: null, prefix: resolved.prefix, workspaceId, projectId })
        if (made.error) throw new Error(made.error)
        const row = made.row
        row.location_id = await locationIdFor(resolved)
        // A scene or shot link to a row that did not land is let go, and said.
        // M2: one removed in the cloud since an earlier run is let go, counted.
        for (const [col, kind] of [['scene_id', 'scenes'], ['shot_id', 'shots']]) if (row[col] && removedHere[kind].has(row[col])) { row[col] = null; report.rowLinksLetGo++ }
        if (row.scene_id && !landed.scenes.has(row.scene_id)) { report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: its scene is not in the cloud, so the clip's scene link was left empty` }); row.scene_id = null }
        if (row.shot_id && !landed.shots.has(row.shot_id)) { report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: its shot is not in the cloud, so the clip's shot link was left empty` }); row.shot_id = null }
        const r = await insertOrSkip('bin_files', toColumns('bin_files', row), cloudClipsUnknown ? null : (x) => cloudClips.has(x.id))
        r.status === 'inserted' ? bumpInserted(report.binFiles) : bumpSkipped(report.binFiles)
        landed.clips.add(clip.id)
        if (keepsId(r, !cloudClipsUnknown)) rc.add('bin_files', clip.id)
        if (POSTER_MEDIA.has(clip.media_type) && !cloudClipsUnknown) wantPicture.push(clip)
        else if (POSTER_MEDIA.has(clip.media_type)) { report.posters.total++; report.posters.skipped++ }
      } catch (err) {
        report.errors.push({ scope: 'bin_file', projectId, id: clip.id, message: `${name}: ${err.message}` })
        bumpFailed(report.binFiles)
      }
    }
    for (const [key, n] of keptLocation) {
      const root = roots.find(r => r.key === key)
      note(`  ${root?.root || key}: ${plural(n, 'clip')} already in the cloud ${n === 1 ? 'keeps' : 'keep'} the footage location ${n === 1 ? 'it has' : 'they have'} there (the answer given now moves no clip)`)
    }
    // The takes: the live ones (a take of a shot or clip removed on this
    // computer is the desktop's own, for undo: not carried, not an error)
    // whose shot and clip landed, their role and position settled against
    // the takes the cloud already holds for the shot (takesToLand): one
    // already there is skipped without a write; a take of a clip left on
    // this computer waits with it (left behind, not failed); a take whose
    // shot or clip FAILED is said.
    // M2: a take removed in the cloud since an earlier run is not carried
    // again (nor does it hold its shot's primary place).
    const takes = liveTakesOf(bundle).filter((t) => {
      if (!hasId(t) || rc.gate('shot_takes', t.id) !== 'removed') return true
      rc.removed('shot_takes', t, 'take')
      return false
    })
    let cloudTakes = []
    let cloudTakesUnknown = false
    if (takes.length) {
      const have = await listCloud('shot_takes', 'project_id', projectId, 'id, shot_id, bin_file_id, role, position')
      if (have.error) { cloudTakesUnknown = true; report.errors.push({ scope: 'shot_takes', projectId, message: `could not read the project's takes already in the cloud, so a duplicate reads as already there: ${have.error.message || have.error}` }) }
      else cloudTakes = have.rows
    }
    const thereTakes = new Set(cloudTakes.flatMap(t => [t.id, takePairKey(t)]))
    const landing = takesToLand(takes, landed.shots, landed.clips, cloudTakes)
    const landingIds = new Set(landing.map(t => t.id))
    for (const t of takes) {
      if (landingIds.has(t.id)) continue
      report.shotTakes.total++
      if (thereTakes.has(t.id) || thereTakes.has(takePairKey(t))) { report.shotTakes.skipped++; if (thereTakes.has(t.id)) rc.add('shot_takes', t.id); continue }
      if (hasId(t) && rc.gate('shot_takes', t.id) === 'there') { report.shotTakes.skipped++; continue }
      if (leftClips.has(t.bin_file_id)) { report.shotTakes.leftBehind++; continue }
      const why = !landed.shots.has(t.shot_id) ? 'its shot is not in the cloud' : 'its clip is not in the cloud'
      report.errors.push({ scope: 'shot_take', projectId, id: t.id, message: `take not migrated: ${why}` })
      report.shotTakes.failed++
    }
    for (const t of landing) {
      report.shotTakes.total++
      const was = takes.find(x => x.id === t.id)
      if (was?.role === 'primary' && t.role !== 'primary') {
        const clip = clips.find(c => c.id === t.bin_file_id)
        note(`  ${clip?.display_name || clip?.original_name || t.bin_file_id}: lands as an alternative take — its shot already has a primary take in the cloud`)
      }
      try {
        const r = await insertOrSkip('shot_takes', toColumns('shot_takes', { ...cloudRowOf(t, projectId), workspace_id: workspaceId }), cloudTakesUnknown ? null : (x) => thereTakes.has(x.id) || thereTakes.has(takePairKey(x)))
        r.status === 'inserted' ? report.shotTakes.inserted++ : report.shotTakes.skipped++
        if (keepsId(r, !cloudTakesUnknown)) rc.add('shot_takes', t.id)
      } catch (err) {
        report.errors.push({ scope: 'shot_take', projectId, id: t.id, message: err.message })
        report.shotTakes.failed++
      }
    }
    // FX2 (0096): a task's items, after every row they can name is in — the
    // tasks and assets (above), the scenes and shots (BC3, above). VW1m
    // (2026-10-16): every one, its assets included, lands here (the task
    // went up without its links, taskRowForCloud) and 0097 §4 writes the
    // cloud's copy from them; every item keeps its id and position. An item
    // the cloud has already (a move run again) answers 23505 and reads as
    // skipped; one whose asset did not go up fails alone, in the report.
    // Since M2 a task's levels and experiences too: they landed first, and
    // task_items' keys hold each item to this project's row (23503 —
    // measured); one removed in the cloud since an earlier run stays removed.
    for (const it of itemsToCarry(bundle)) {
      const g = hasId(it) ? rc.gate('task_items', it.id) : 'new'
      if (g === 'removed') { rc.removed('task_items', it, `${it.entity_type} item`); continue }
      report.taskItems.total++
      if (g === 'there') { report.taskItems.skipped++; continue }
      try {
        const r = await insertOrSkip('task_items', toColumns('task_items', {
          ...(it.id != null ? { id: it.id } : {}), task_id: it.task_id, project_id: projectId,
          entity_type: it.entity_type, entity_id: it.entity_id,
          position: Number.isInteger(it.position) && it.position >= 0 ? it.position : 0,
          ...(it.created_at ? { created_at: it.created_at } : {}),
        }))
        r.status === 'inserted' ? report.taskItems.inserted++ : report.taskItems.skipped++
        if (keepsId(r)) rc.add('task_items', it.id)
      } catch (err) {
        report.errors.push({ scope: 'task_item', projectId, id: it.id, message: err.message })
        report.taskItems.failed++
      }
    }
    // VW1c (0098): the project's saved views and groupings, with their ids,
    // after every row a grouping can name is in (the assets above, BC3's
    // scenes and shots). By INSERT through the cloud adapter (addTableView /
    // addItemGrouping): never an upsert, its column allowlist strips the
    // workspace, the revision and the stamps, which the cloud makes its own
    // (each view takes a new revision there, made by whoever runs the move).
    // What the cloud holds of the project is read first, so a second run
    // skips by id; a grouping whose set the cloud holds under another id (a
    // teammate made it) is skipped too — the cloud answers that row. A
    // grouping of levels or experiences stays (the runner carries neither),
    // counted, as are the views that filter by one. A cloud without 0098, or
    // a read that fails, writes none of the project's and says so once; they
    // count as failed, so the panel does not call the run done, and a later
    // run brings them.
    // M2: a view or grouping removed in the cloud since an earlier run is not
    // carried again.
    const keepViews = (table, rows) => rows.filter((r) => {
      if (!hasId(r) || rc.gate(table, r.id) !== 'removed') return true
      rc.removed(table, r, r.name || r.kind)
      return false
    })
    const viewsPart0 = viewsPartOf(bundle)
    const viewsPart = { views: keepViews('table_views', viewsPart0.views), carried: keepViews('item_groupings', viewsPart0.carried) }
    if (viewsPart.views.length || viewsPart.carried.length) {
      const have = await cloudViewIds(projectId)
      let viewsThere = 0
      let groupingsThere = 0
      if (have.absent || have.error) {
        report.errors.push({ scope: 'table_views', projectId, message: have.absent ? TABLE_VIEWS_NOT_IN_CLOUD(viewsPart.views.length, viewsPart.carried.length) : TABLE_VIEWS_UNREAD(have.error.message || have.error) })
        report.tableViews.total += viewsPart.views.length
        report.tableViews.failed += viewsPart.views.length
        report.itemGroupings.total += viewsPart.carried.length
        report.itemGroupings.failed += viewsPart.carried.length
      } else {
        for (const v of viewsPart.views) {
          if (!hasId(v)) { report.errors.push({ scope: 'table_view', projectId, message: NO_ID }); bumpFailed(report.tableViews); continue }
          if (have.views.has(v.id)) { bumpSkipped(report.tableViews); viewsThere++; rc.add('table_views', v.id); continue }
          if (rc.gate('table_views', v.id) === 'there') { bumpSkipped(report.tableViews); continue }
          try {
            await viewsAdapter.addTableView({ id: v.id, project_id: projectId, table_key: v.table_key, name: v.name, position: v.position, config: v.config })
            bumpInserted(report.tableViews)
            viewsThere++
            rc.add('table_views', v.id)
          } catch (err) {
            report.errors.push({ scope: 'table_view', projectId, id: v.id, message: viewWriteMessage('table_views', err) })
            bumpFailed(report.tableViews)
          }
        }
        for (const g of viewsPart.carried) {
          if (!hasId(g)) { report.errors.push({ scope: 'item_grouping', projectId, message: NO_ID }); bumpFailed(report.itemGroupings); continue }
          if (have.groupings.has(g.id)) { bumpSkipped(report.itemGroupings); groupingsThere++; rc.add('item_groupings', g.id); continue }
          if (rc.gate('item_groupings', g.id) === 'there') { bumpSkipped(report.itemGroupings); continue }
          try {
            const stored = await viewsAdapter.addItemGrouping({ id: g.id, project_id: projectId, table_key: g.table_key, kind: g.kind, entity_ids: g.entity_ids })
            if (stored && stored.id !== g.id) bumpSkipped(report.itemGroupings)
            else { bumpInserted(report.itemGroupings); rc.add('item_groupings', g.id) }
            groupingsThere++
          } catch (err) {
            report.errors.push({ scope: 'item_grouping', projectId, id: g.id, message: viewWriteMessage('item_groupings', err) })
            bumpFailed(report.itemGroupings)
          }
        }
      }
      note(viewsNote(viewsThere, groupingsThere, ' in the cloud'))
    }
    // Pictures: only while the company's switch is on (B4) — asked once;
    // off, the desktop keeps them and the report says so. The desktop makes
    // each picture on demand from the file it reaches; a clip it cannot
    // reach has none to send, which is said per clip.
    if (wantPicture.length) {
      report.posters.total += wantPicture.length
      const on = await switchOn()
      if (!on) {
        report.posters.switchOff += wantPicture.length
        note(`  ${plural(wantPicture.length, 'picture')}: ${POSTERS_SWITCH_OFF}`)
      } else {
        let done = 0
        for (const clip of wantPicture) {
          const name = clip.display_name || clip.original_name || clip.id
          try {
            const { bytes, why } = await fetchLocalPoster(projectId, clip.id)
            if (!bytes) throw new Error(`no picture on this computer (${why})`)
            await uploadPoster(projectId, clip.id, bytes)
            report.posters.uploaded++
          } catch (err) {
            report.errors.push({ scope: 'poster', projectId, id: clip.id, message: `${name}: ${err.message}` })
            report.posters.failed++
          }
          done++
          if (done % 10 === 0 || done === wantPicture.length) note(`  Pictures: ${done} of ${wantPicture.length}`)
        }
      }
    }
    if (clips.length) {
      const left = report.clipsLeftBehind.filter(c => c.projectId === projectId).length
      const takesThere = landing.length + takes.filter(t => !landingIds.has(t.id) && (thereTakes.has(t.id) || thereTakes.has(takePairKey(t)))).length
      note(`  ${plural(report.bins.inserted + report.bins.skipped, 'bin')}, ${plural(landed.clips.size, 'clip')} and ${plural(takesThere, 'take')} in the cloud` +
        (left ? `; ${BINS_LEFT_BEHIND(left)}` : ''))
    }
    // M2: the rest of what this project's run carried joins the record, and
    // what an earlier run carried that the cloud no longer shows is said.
    await rc.done()
    sayRemoved(removedBefore)
    if (report.rowLinksLetGo > linksBefore) note(`  ${ROW_LINKS_LET_GO(report.rowLinksLetGo - linksBefore)}`)
  }

  // M3: the company's task templates (a pinned one after its project), the
  // assets' links to them, the workspace record's last rows, and the people
  // seated as managers, named once.
  await carryTemplates(dryRun)
  await linkAssetTemplates(dryRun)
  await wrc.done()
  report.people.managersSeated = [...new Set(report.people.managersSeated.filter(Boolean))]
  if (report.people.managersSeated.length) note(`  ${MANAGERS_SEATED(report.people.managersSeated)}`)

  report.footageRoots = mergeRoots(binsState.roots).map(r => ({ ...r, resolved: (resolvedAnswers.get(r.key) || { kind: 'unanswered' }).kind }))
  report.notCarried = [...notCarried.values()]
  report.finishedAt = new Date().toISOString()
  return report
}
