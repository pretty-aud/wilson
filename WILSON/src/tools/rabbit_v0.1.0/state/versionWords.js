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
    sentences.push(`${deleted.length === 1 ? q(deleted[0].name) : count(deleted.length, noun)} ${deleted.length === 1 ? 'is' : 'are'} in no other bid version, so ${deleted.length === 1 ? 'it is' : 'they are'} deleted. Undo (Ctrl+Z) brings ${deleted.length === 1 ? 'it' : 'them'} back.`)
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
