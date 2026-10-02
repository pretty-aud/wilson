// ============================================================
// RABBIT — the words of Remove from this list and Delete
// (post-overhaul S3b, step 6)
// ============================================================
//
// A scene or shot is ONE row that many shot lists may hold (S3a). With a
// list on screen, two verbs sit near each other and do very different
// things: Remove from this list takes rows out of THAT list — nothing is
// deleted, and every other list keeps them — while Delete takes them out of
// the project, and so out of every list that holds them. Each question says
// which it is and names the lists involved; Delete, while a list is on
// screen, also points at the other verb (D1 + D3). Pure, so the sentences
// are tested on their own (membershipCopy.test.js) and read the same from a
// row, a card, a bulk bar and a popup.
// ============================================================

const q = (s) => `“${s}”`
const count = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Why New scene, New shot and Add shot are greyed while an archived list is
    on screen (review round 1, R1-02): it is read-only, and a new row would
    otherwise land in the active list, out of sight. */
export const ARCHIVED_ADD_REASON = 'This shot list is archived. Restore it, or open another list, to add scenes and shots.'

/**
 * What taking rows out of the ACTIVE list does to the other tabs (Remove
 * from this list, Clear this list). Audrey's rule of 2026-10-02: removing a
 * list never removes the Timeline or the Budget — nothing there is deleted;
 * a task on those rows reads as not assigned until they are back in the
 * active list (its link is kept).
 *   one  a single row ("it") or several ("them")
 */
export function activeListLeaves(one) {
  const it = one ? 'it' : 'them'
  return `This is the active list, so the other tabs stop showing ${it}. Nothing on the Timeline or the Budget is deleted: a task on ${it} reads there as not assigned until ${one ? 'it is' : 'they are'} in the active list again.`
}

/** Set active: what the change of list does to the Timeline and the Budget (the same rule). */
export const SET_ACTIVE_KEEPS = 'Nothing on the Timeline or the Budget is deleted: a task on a scene or shot this list does not hold reads there as not assigned until that scene or shot is in the active list.'

/** Archive, Withdraw: only a list that is not the active one can be set aside (S3a), so the Timeline and the Budget do not change. */
export const NOT_ACTIVE_KEEPS = 'It is not the active list, so nothing on the Timeline or the Budget changes.'

/** "A", "A and B", "A, B and C" — the app's lists have no serial comma. */
export function joinNames(names) {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** What the question is about: one row by name, several by count. */
function subject({ kind, names, shotCount }) {
  const shots = kind === 'scene' && shotCount > 0
  if (names.length === 1) {
    return `${kind === 'shot' ? 'shot ' : ''}${q(names[0])}${shots ? ` and its ${count(shotCount, 'shot')}` : ''}`
  }
  return `${count(names.length, kind)}${shots ? ` and their ${count(shotCount, 'shot')}` : ''}`
}

/**
 * Remove from this list.
 *  kind       'scene' | 'shot'
 *  rows       [{ name, homes }] — homes: the labels of the OTHER live lists
 *             that hold the row (an archived list is no home: S3a counts a
 *             row only it holds as "Not in any list")
 *  shotCount  scenes only: this list's shots of those scenes, which leave
 *             with them (S3a: a scene takes its shots' items with it)
 *  homelessShots  scenes only: how many of those shots NO other live list
 *             holds — they will be in no list (review round 1, R1-08: the
 *             scene's homes said nothing of its shots')
 *  listLabel  the list on screen
 *  active     the list on screen is the project's active list: every other
 *             tab stops showing the rows (R1-08), and the Timeline and the
 *             Budget keep their tasks, read as not assigned (the rule of
 *             2026-10-02)
 * → the sentences, in order
 */
export function removeQuestion({ kind, rows, shotCount = 0, homelessShots = 0, listLabel, active = false }) {
  const one = rows.length === 1
  const out = [
    `Takes ${subject({ kind, names: rows.map(r => r.name), shotCount })} out of ${q(listLabel)}.`,
    `Nothing is deleted: ${one ? 'it stays' : 'they stay'} in the project.`,
  ]
  const homes = joinNames([...new Set(rows.flatMap(r => r.homes))].map(q))
  const homeless = rows.filter(r => r.homes.length === 0).length
  if (homeless === 0) {
    out.push(one ? `It is still in ${homes}.` : `Each is still in another shot list: ${homes}.`)
  } else if (homeless === rows.length) {
    const it = one ? 'it' : 'them'
    out.push(`No other shot list holds ${it}, so Shot lists… will show ${it} under “Not in any list”.`)
  } else {
    const rest = rows.length - homeless
    out.push(`${homeless} of them ${homeless === 1 ? 'is' : 'are'} in no other shot list, so Shot lists… will show ${homeless === 1 ? 'it' : 'those'} under “Not in any list”.`)
    out.push(`${rest === 1 ? 'The other one is' : 'The rest are'} still in ${homes}.`)
  }
  if (kind === 'scene' && homelessShots > 0) {
    const all = homelessShots === shotCount
    const who = one
      ? (all ? (shotCount === 1 ? 'Its shot is' : `Its ${shotCount} shots are`) : `${homelessShots} of its shots ${homelessShots === 1 ? 'is' : 'are'}`)
      : (all ? (shotCount === 1 ? 'Their shot is' : `Their ${shotCount} shots are`) : `${homelessShots} of their shots ${homelessShots === 1 ? 'is' : 'are'}`)
    out.push(`${who} in no other shot list, so Shot lists… will show ${homelessShots === 1 ? 'it' : 'them'} under “Not in any list”.`)
  }
  if (active) out.push(activeListLeaves(one))
  return out
}

/**
 * Delete: from the project, and so from every list that holds the rows.
 *  kind        'scene' | 'shot'
 *  names       the rows' names
 *  shotCount   scenes only: EVERY shot of those scenes in the project,
 *              deleted with them (whatever list is on screen)
 *  lists       [{ label, archived }] — every shot list that holds them; an
 *              archived one loses them too, and says so
 *  onScreen    the live list on screen, when the person could take the rows
 *              out of it instead (it holds them and they may write lists)
 *  removeWhere where that other verb is: 'row' (a row's or card's
 *              shot-list menu) or 'bar' (the selection bar)
 * → the sentences, in order
 */
export function deleteQuestion({ kind, names, shotCount = 0, lists, onScreen = null, removeWhere = 'row' }) {
  const one = names.length === 1
  const out = [`This will permanently delete ${subject({ kind, names, shotCount })} from the project.`]
  const It = one ? 'It' : 'They'
  const them = one ? 'it' : 'them'
  const named = joinNames(lists.map(l => `${q(l.label)}${l.archived ? ' (archived)' : ''}`))
  if (lists.length === 1) out.push(`${It} will be gone from ${named} too.`)
  else if (lists.length === 2) out.push(`${It} will be gone from both shot lists that hold ${them}: ${named}.`)
  else if (lists.length > 2) out.push(`${It} will be gone from all ${lists.length} shot lists that hold ${them}: ${named}.`)
  if (onScreen) {
    out.push(removeWhere === 'bar'
      ? `To take ${them} out of ${q(onScreen)} only, use “Remove from list” in the selection bar.`
      : `To take ${them} out of ${q(onScreen)} only, use “Remove from this list” in ${one ? 'its' : 'their'} shot-list menu.`)
  }
  return out
}
