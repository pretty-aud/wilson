// =============================================================================
// scripts/sweepOutlineNone.mjs — the `outline-none` sweep (UI overhaul F1,
// review F24, plan §5).
//
// 405 elements stripped the native focus ring with `focus:outline-none`
// (and two with a bare `outline-none`); roughly 80 of them put nothing back
// and the rest put back one of four different rings. src/index.css now
// carries ONE focus rule on `:focus-visible`, which a surviving
// `focus:outline-none` utility beats on specificity — so every one of them
// is removed here, mechanically, class-name only, no reformatting.
//
// Left alone, deliberately:
//   - src/components/PetCompanion.jsx                     (C5: pets untouched)
//   - src/tools/deck-outline-generator_v0.514/LayoutVisualizer.jsx
//     and VideoThumbnail.jsx                              (C4: untouchable)
//   - src/admin/**                                        (Q14: the operator console is out of scope)
//   - src/ui/**                                           (the kit never had one)
//
// Usage (from WILSON/):  node scripts/sweepOutlineNone.mjs [--dry]
// Prints a per-file count and a total, and exits 1 if anything is left in a
// file it was supposed to clean, so it can be re-run as a check.
// =============================================================================

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, sep } from 'node:path'

const DRY = process.argv.includes('--dry')
const ROOT = 'src'
const SKIP = [
  /PetCompanion\.jsx$/,
  /LayoutVisualizer\.jsx$/,
  /VideoThumbnail\.jsx$/,
  new RegExp(`${sep === '\\' ? '\\\\' : '/'}src${sep === '\\' ? '\\\\' : '/'}admin${sep === '\\' ? '\\\\' : '/'}`),
  new RegExp(`${sep === '\\' ? '\\\\' : '/'}src${sep === '\\' ? '\\\\' : '/'}ui${sep === '\\' ? '\\\\' : '/'}`),
  /node_modules/,
]

// Order matters: a token with a neighbour first (so no double spaces are
// left behind), then a token standing alone in a class string.
const PATTERNS = [
  [/ focus:outline-none\b/g, ''],
  [/\bfocus:outline-none /g, ''],
  [/\bfocus:outline-none\b/g, ''],
  // A bare `outline-none` (not `focus:outline-none`, not `-outline-none`) strips
  // the ring in EVERY state, focus-visible included.
  [/ (?<![:\w-])outline-none\b/g, ''],
  [/(?<![:\w-])\boutline-none (?=[^\s])/g, ''],
  [/(?<![:\w-])\boutline-none\b/g, ''],
]

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(jsx|js)$/.test(name) && !/\.test\.(jsx|js)$/.test(name)) out.push(p)
  }
  return out
}

let total = 0
let leftovers = 0
const perFile = []
for (const file of walk(ROOT)) {
  const abs = join(process.cwd(), file)
  if (SKIP.some((re) => re.test(abs) || re.test(file))) continue
  const before = readFileSync(file, 'utf8')
  let after = before
  for (const [re, to] of PATTERNS) after = after.replace(re, to)
  // Count every spelling (`focus:outline-none` and the bare one); the first
  // cut of this script counted only the bare form, wrote only the two files
  // that had one, and reported success — a sweep that sweeps nothing.
  const count = (s) => (s.match(/(?<![\w-])(?:[a-z-]+:)?outline-none\b/g) || []).length
  const removed = count(before) - count(after)
  const left = count(after)
  if (removed) {
    perFile.push([file, removed])
    total += removed
    if (!DRY) writeFileSync(file, after)
  }
  leftovers += left
}

perFile.sort((a, b) => b[1] - a[1])
for (const [file, n] of perFile) console.log(`${String(n).padStart(4)}  ${file}`)
console.log(`${DRY ? '[dry] would remove' : 'removed'} ${total} outline-none utilities across ${perFile.length} files`)
if (leftovers) {
  console.error(`${leftovers} outline-none left in files this sweep should clean`)
  process.exit(1)
}
