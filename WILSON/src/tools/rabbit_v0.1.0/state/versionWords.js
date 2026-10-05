// =============================================================================
// versionWords.js — the words of bid versions (post-overhaul S5b). Pure, so
// every sentence a question, a toast or a tooltip says is tested on its own
// (versionWords.test.js) and reads the same from the Budget and the Timeline.
// S3b's membershipCopy.js is the model: each question says what it does, by
// name, and names where the rows go.
//
// Three states, three words (the first brief's model): OPEN (the version
// whose data is in the live Timeline and Budget), SELECTED (the bid the
// variance measures against), LOCKED ("Budget active — in production"). Her
// verb is "Edit this version"; "open" is the state's word.
//
// S5c adds the versions block's questions and toasts (below the removal
// words): views/budget/VersionQuestions.jsx reads them.
// =============================================================================

const q = (s) => `“${s}”`
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "A", "A and B", "A, B and C" — no serial comma (membershipCopy's rule). */
export function joinNames(names) {
  const list = (names || []).filter(Boolean)
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

const KIND_WORD = { tasks: ['task', 'tasks'], phases: ['phase', 'phases'], milestones: ['key date', 'key dates'] }

/** "3 tasks, 1 phase and 2 key dates" for a { tasks, phases, milestones } set of rows (or ids). '' for none. */
export function rowsWords(set) {
  const parts = []
  for (const k of ['tasks', 'phases', 'milestones']) {
    const n = ((set && set[k]) || []).length
    if (n) parts.push(count(n, KIND_WORD[k][0], KIND_WORD[k][1]))
  }
  return joinNames(parts)
}

const WORK_WORDS = (w) => {
  const parts = []
  if (w?.loggedDays) parts.push(`${Math.round(w.loggedDays * 100) / 100} ${w.loggedDays === 1 ? 'day' : 'days'} logged`)
  if (w?.comments) parts.push(count(w.comments, 'comment'))
  if (w?.files) parts.push(count(w.files, 'file'))
  return joinNames(parts)
}
/** "Lighting pass 2 (1.5 days logged and 2 comments)" — a row and the work on it. */
export function workLine(row) {
  const w = WORK_WORDS(row?.work)
  return w ? `${q(row.name)} (${w})` : q(row?.name)
}

/**
 * The question before the person's delete, while a version is open
 * (constraint 9; S3b's Remove / Delete question is the model). `plan` is the
 * provider's removalPlanFor answer; `noun` the row's word ('task', 'phase',
 * 'key date'). → { title, sentences, confirm, danger } — or null when every
 * row is an ordinary delete (the caller's own question stands, unchanged).
 */
export function removalQuestion(plan, noun = 'task') {
  const removed = (plan?.rows || []).filter(r => r.verb === 'remove')
  const deleted = (plan?.rows || []).filter(r => r.verb === 'delete')
  if (!removed.length) return null
  const where = plan?.openVersion ? q(plan.openVersion.name) : 'the open version'
  const nouns = `${noun}s`
  const one = removed.length === 1
  const homes = joinNames([...new Map(removed.flatMap(r => r.holders).map(h => [h.id, q(h.name)])).values()])
  const sentences = []
  if (one) {
    sentences.push(`Takes ${q(removed[0].name)} out of ${where}. Nothing is deleted: it stays in ${homes}, with everything on it, and comes back when you edit ${removed[0].holders.length === 1 ? 'that version' : 'one of them'}.`)
  } else {
    sentences.push(`Takes ${count(removed.length, noun)} out of ${where}. Nothing is deleted: each stays in the other bid versions that hold it (${homes}), with everything on it, and comes back when you edit one of them.`)
  }
  const worked = removed.filter(r => r.work)
  if (worked.length) {
    sentences.push(`${worked.length === 1 ? 'It has' : 'These have'} work on ${worked.length === 1 ? 'it' : 'them'}, kept with ${worked.length === 1 ? 'it' : 'them'} while ${worked.length === 1 ? 'it is' : 'they are'} out of sight: ${joinNames(worked.map(workLine))}.`)
  }
  if (deleted.length) {
    // S5c: "Undo", not "Undo (Ctrl+Z)" — the Tasks tab, one of this
    // question's hosts, binds no Ctrl+Z; the undo toast after every removal
    // is the way back on every page, as the versions block's words say.
    sentences.push(`${deleted.length === 1 ? q(deleted[0].name) : count(deleted.length, noun)} ${deleted.length === 1 ? 'is' : 'are'} in no other bid version, so ${deleted.length === 1 ? 'it is' : 'they are'} deleted. Undo brings ${deleted.length === 1 ? 'it' : 'them'} back.`)
  }
  return {
    title: deleted.length
      ? `Remove ${count(removed.length, noun)} and delete ${count(deleted.length, noun)}?`
      : (one ? `Remove ${q(removed[0].name)} from ${where}?` : `Remove ${count(removed.length, noun, nouns)} from ${where}?`),
    sentences,
    confirm: deleted.length ? 'Remove and delete' : 'Remove from this version',
    danger: deleted.length > 0,
  }
}

/** True when the person's delete must ask first: a row going aside has work on it (constraint 4's rule, on the Remove path). */
export function removalNeedsAsking(plan) {
  return (plan?.rows || []).some(r => r.verb === 'remove' && r.work)
}

/**
 * The toast after the person's delete (constraint 9), when at least one row
 * went aside instead of to the trash: it says which, and where the row still
 * is. `plan` is the provider's removalPlanFor answer.
 */
export function removalToastWords(plan) {
  const where = plan?.openVersion ? q(plan.openVersion.name) : 'the open version'
  const removed = (plan?.rows || []).filter(r => r.verb === 'remove')
  const deleted = (plan?.rows || []).filter(r => r.verb === 'delete')
  let head
  if (removed.length === 1) {
    const holders = removed[0].holders.map(h => q(h.name))
    head = `Removed ${q(removed[0].name)} from ${where} — ${joinNames(holders)} still ${holders.length === 1 ? 'holds' : 'hold'} it`
  } else {
    head = `Removed ${removed.length} rows from ${where} — the other bid versions that hold them keep them`
  }
  if (!deleted.length) return head
  return `${head}; deleted ${deleted.length === 1 ? q(deleted[0].name) : `${deleted.length} more`}`
}

// ── The versions block's questions and toasts (post-overhaul S5c, step 4) ───
// Edit this version, Set budget active, a version's delete and Save as new
// version, as the Budget's Summary asks them (the Timeline's control, S5d,
// mounts the same questions). Each names its rows by count AND by name, rows
// with work first (Working memory: nobody has to remember which tasks a
// version held). Her ruling (a)'s own words: rows that are not part of a
// version LEAVE the Timeline and COME BACK; "set aside" is the code's word.
// Every "Undo" here is a promise the undo toast keeps: the Budget's Summary
// binds no Ctrl+Z (the Expenses tab's keys are its own history), so these
// never say "Ctrl+Z".

const MAX_NAMES = 4
const nameOf = (r) => (r && (r.title || r.name)) || 'Untitled'
const cap = (s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s)
const rowsOf = (set) => [...((set && set.tasks) || []), ...((set && set.phases) || []), ...((set && set.milestones) || [])]

/** "“A”, “B”, “C”, “D” and 3 more" — the first few names of some rows. */
export function someNames(rows, max = MAX_NAMES) {
  const names = (rows || []).map(r => q(nameOf(r)))
  if (names.length <= max) return joinNames(names)
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`
}

/** A { tasks, phases, milestones } set's rows, those with work on them first. */
function workFirst(set, work) {
  const worked = new Set((work || []).map(w => String(w.id)))
  const rows = rowsOf(set)
  return [...rows.filter(r => worked.has(String(r.id))), ...rows.filter(r => !worked.has(String(r.id)))]
}

/** "“A” has work on it (1.5 days logged)." / "2 of them have work on them: …" — null for none. */
function workSentence(work) {
  const list = work || []
  if (!list.length) return null
  if (list.length === 1) return `${q(list[0].name)} has work on it (${WORK_WORDS(list[0].work)}).`
  return `${list.length} of them have work on them: ${joinNames(list.map(workLine))}.`
}

/**
 * Before Edit this version or Set budget active, when the open version has
 * unsaved changes (F2), or no version is open and the Timeline matches none
 * (constraint 8). `unsaved` is previewOpenBudgetVersion's; `target` the
 * version asked for; `mode` 'open' | 'lock'.
 * → { title, sentences, discard, save } — the two answers' words.
 */
export function unsavedQuestionWords({ mode = 'open', unsaved, target }) {
  const none = unsaved?.inNoVersion || {}
  const n = rowsOf(none).length
  const what = q(target?.name)
  const keyDates = ((none.milestones || []).length ? ' Deleted key dates are in Recently deleted as well.' : '')
  const deletes = (verb) => `${verb} the ${rowsWords(none)} no bid version holds: ${someNames(workFirst(none, unsaved?.work))}. Undo brings ${n === 1 ? 'it' : 'them'} back.${keyDates}`
  const sentences = []
  if (unsaved?.kind === 'open') {
    const open = q(unsaved.version?.name)
    const same = unsaved.version?.id === target?.id
    sentences.push(mode === 'lock'
      ? `${open} has unsaved changes, and setting ${same ? 'it' : what} active locks ${same ? 'it' : 'that version'} as it was last saved.`
      : `${open} has unsaved changes, and editing ${what} replaces what the Timeline and Budget show.`)
    sentences.push(n ? `Discard changes leaves ${open} as it was last saved and ${deletes('deletes')}` : `Discard changes leaves ${open} as it was last saved.`)
  } else {
    sentences.push(mode === 'lock'
      ? `What the Timeline and Budget show now is not saved in any bid version, and setting ${what} active replaces it with ${what} as it was saved.`
      : `What the Timeline and Budget show now is not saved in any bid version, and editing ${what} replaces it.`)
    sentences.push(n ? deletes('Discard deletes') : 'Discard lets the changes go; no row is deleted.')
  }
  const w = workSentence(unsaved?.work)
  if (w) sentences.push(w)
  const isOpen = unsaved?.kind === 'open'
  return {
    title: isOpen ? `Save the changes to ${q(unsaved.version?.name)} first?` : 'Save what the Timeline shows first?',
    sentences,
    discard: isOpen ? 'Discard changes' : 'Discard',
    save: isOpen ? `Save to ${q(unsaved.version?.name)}` : 'Save as new version…',
  }
}

/** "11 tasks that are not part of it leave the Timeline: …; 2 of its own come back: …" — '' when nothing moves. */
function movesSentence(leaving, returning, work) {
  const away = rowsOf(leaving).length
  const back = rowsOf(returning).length
  const parts = []
  if (away) parts.push(`${rowsWords(leaving)} that ${away === 1 ? 'is' : 'are'} not part of it ${away === 1 ? 'leaves' : 'leave'} the Timeline: ${someNames(workFirst(leaving, work))}`)
  if (back) parts.push(`${rowsWords(returning)} of its own ${back === 1 ? 'comes' : 'come'} back: ${someNames(rowsOf(returning))}`)
  return parts.length ? `${cap(parts.join('; '))}.` : ''
}

/**
 * Edit this version / Set budget active, the question itself (step 4).
 * `preview` is previewOpenBudgetVersion's, with the person's answers so far
 * (Discard, the kept rows) folded in; `work` the rows with work on them that
 * would leave were none kept (constraint 4: the checkbox stays while it is
 * ticked); `read` readVersion(preview.version); `discard` whether Discard
 * was answered.
 * → { title, sentences, verb, keepLabel } — keepLabel null when no row
 *   leaving has work on it (then there is no checkbox).
 */
export function openQuestionWords({ mode = 'open', preview, work = [], read, discard = false }) {
  const v = preview?.version
  const name = q(v?.name)
  const sentences = []
  const moves = movesSentence(preview?.leaving, preview?.returning, work)
  const lost = rowsOf(preview?.leaving).length
    ? 'Nothing on a row that leaves is lost: it comes back, with its comments, files and logged time, when you edit a version that holds it.'
    : null
  const one = work.length === 1
  let keepLabel = null
  if (mode === 'lock') {
    sentences.push(`${name} becomes the budget in production: it is locked as it was saved, and the variance measures against it.`)
    if (!read?.hasTimeline) {
      sentences.push('It was saved before versions kept their schedule (no timeline captured), so the Timeline stays as it is.')
    } else if (preview?.open?.id === v?.id && !discard) {
      sentences.push('It is the open version, so the Timeline already shows it.')
    } else {
      sentences.push(`The Timeline and Budget become its schedule first.${moves ? ` ${moves}` : ''}`)
      if (lost) sentences.push(lost)
      if (work.length) keepLabel = `Keep ${one ? 'it' : 'them'} on the Timeline during production`
    }
    sentences.push('During production you keep editing the Timeline as usual, and Save as new version records those changes without touching the lock.')
  } else {
    sentences.push('Its phases, tasks, key dates, roles and rates replace what the Timeline and Budget show, and it becomes the open version: Save writes your changes back into it.')
    if (moves) sentences.push(moves)
    if (lost) sentences.push(lost)
    if (work.length) keepLabel = `Keep ${one ? 'it' : 'them'} on the Timeline in ${name} (${one ? 'it becomes an unsaved change' : 'they become unsaved changes'})`
  }
  const w = keepLabel ? workSentence(work) : null
  if (w) sentences.splice(sentences.length - (mode === 'lock' ? 1 : 0), 0, w)
  return {
    title: mode === 'lock' ? `Set ${name} active?` : `Edit ${name}?`,
    sentences,
    verb: mode === 'lock' ? 'Set budget active' : 'Edit this version',
    keepLabel,
  }
}

/**
 * Delete a version (constraint 10): the rows only it holds that are off the
 * Timeline now go with it, named first, rows with work first. `preview` is
 * previewDeleteBudgetVersion's.
 */
export function deleteQuestionWords({ preview, isOpen = false, isSelected = false }) {
  const only = preview?.only || {}
  const n = rowsOf(only).length
  const sentences = []
  if (n) {
    sentences.push(`It is the only version that holds ${rowsWords(only)} that ${n === 1 ? 'is' : 'are'} off the Timeline now: ${someNames(workFirst(only, preview?.work))}. ${n === 1 ? 'It is' : 'They are'} deleted with it.`)
    const w = workSentence(preview?.work)
    if (w) sentences.push(w)
  }
  if (isOpen) sentences.push('It is the open version: the Timeline keeps what it shows, and no version is open after this.')
  if (isSelected) sentences.push('It is the selected bid: no bid is selected after this, so the variance has nothing to measure against until you choose one.')
  sentences.push(`Undo brings back the version${n ? ` and ${n === 1 ? 'that row' : 'those rows'}` : ''}.`)
  return { title: `Delete ${q(preview?.version?.name)}?`, sentences, verb: 'Delete version' }
}

/** Save as new version…'s one line: what it does, open and selected — or, under a lock, only recorded (F9). */
export function saveAsNewWords({ locked = null } = {}) {
  return locked
    ? `Records what the Timeline and Budget show now as a new bid version, so production changes are kept. It is not opened or selected: the budget stays locked to ${q(locked.name)}.`
    : 'Saves what the Timeline and Budget show now as a new bid version. It becomes the open version and the selected bid.'
}

// The undo toast after each step the questions take (the Budget's one way back).
/** "Editing “Bid v1”: 11 tasks left the Timeline, 2 came back". */
export function openedToastWords({ version, leaving, returning }) {
  const moved = [
    rowsOf(leaving).length ? `${rowsWords(leaving)} left the Timeline` : null,
    rowsOf(returning).length ? `${rowsWords(returning)} came back` : null,
  ].filter(Boolean)
  return `Editing ${q(version?.name)}${moved.length ? `: ${moved.join(', ')}` : ''}`
}
/** "“Mid ROM” is the budget in production, locked as it was saved". */
export function lockedToastWords(version) {
  return `${q(version?.name)} is the budget in production, locked as it was saved`
}
/** "Back to bidding: “Mid ROM” is no longer locked". */
export function resetToastWords(version) {
  return `Back to bidding: ${version ? `${q(version.name)} is no longer locked` : 'the budget is no longer locked'}`
}
/** "Deleted “Bid v2” and the 11 tasks only it held". */
export function deletedToastWords({ version, only }) {
  const n = rowsOf(only).length
  return `Deleted ${q(version?.name)}${n ? ` and the ${rowsWords(only)} only it held` : ''}`
}
/** "Recorded “Revision after week 2”; the lock is unchanged" — short: the toast holds one line. */
export function recordedToastWords({ name }) {
  return `Recorded ${q(name)}; the lock is unchanged`
}
