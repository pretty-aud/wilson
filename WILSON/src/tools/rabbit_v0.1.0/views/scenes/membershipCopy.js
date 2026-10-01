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
 *  listLabel  the list on screen
 * → the sentences, in order
 */
export function removeQuestion({ kind, rows, shotCount = 0, listLabel }) {
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
