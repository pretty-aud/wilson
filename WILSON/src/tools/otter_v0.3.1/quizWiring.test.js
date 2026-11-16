// =============================================================================
// quizWiring.test.js — Session 30.
//
// 🚨 THIS SUITE EXISTS BECAUSE A GREEN SUITE IS WHAT HID THE BUG.
//
// Quiz history had a column (0022), two adapter ops, a route mapping and a
// PASSING unit test in otterRoutes.test.js — for twenty sessions — and nothing
// ever called the writer, on either backend. The route test asserted that the
// parser mapped a URL to an op. It was correct. It could not say that any code
// ever requested that URL.
//
// That is the fourth instance of the shape in four sessions (the folder tree
// in S27, task templates in S28, O.T.T.E.R.'s own unreferenced
// setOtterAdapterMode, and this) and the first where a green test covered the
// dead path. So these assertions are deliberately about CALLERS, not mappings:
// every one of them fails if the wiring is removed while the plumbing stays.
// =============================================================================

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const here = (rel) => fileURLToPath(new URL(rel, import.meta.url))
const read = (rel) => readFileSync(here(rel), 'utf8')

const OTTER = read('./Otter.jsx')
const ADAPTER = read('./adapters/supabaseOtterAdapter.js')
const MAIN_CJS = read('../../../electron/main.cjs')
const SRC = here('../../')

/** Body of a `const <name> = useCallback(` declaration, by balanced parens. */
function callbackBody(source, name) {
  const start = source.indexOf(`const ${name} = useCallback(`)
  if (start === -1) return null
  let i = source.indexOf('(', start + `const ${name} = useCallback`.length)
  let depth = 1
  const from = ++i
  while (i < source.length && depth > 0) {
    const c = source[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    i++
  }
  return source.slice(from, i - 1)
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue
      walk(full, out)
    } else if (/\.(js|jsx)$/.test(entry) && !/\.test\.jsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('a finished quiz is actually recorded', () => {
  const record = callbackBody(OTTER, 'recordQuizAttempt')
  const next = callbackBody(OTTER, 'nextQuestion')

  it('finds both callbacks — the instrument works', () => {
    expect(record, 'recordQuizAttempt must exist in Otter.jsx').not.toBeNull()
    expect(next, 'nextQuestion must exist in Otter.jsx').not.toBeNull()
  })

  it('recordQuizAttempt POSTs to the personal quiz-history route', () => {
    expect(record).toContain("'/api/otter/quiz-history'")
    expect(record).toContain("method: 'POST'")
  })

  it('and checks res.ok — otterFetch resolves for every status', () => {
    const post = record.indexOf("method: 'POST'")
    const check = record.indexOf('res.ok')
    expect(check, 'an unchecked await reports a refused save as a successful one')
      .toBeGreaterThan(post)
  })

  it('records the courses the quiz actually drew on, not the active one', () => {
    // A quiz is built from quizSelections and can span several courses.
    // Reaching for activeSoftware here is the wiring that files a
    // Blender+Unity score under whichever course happened to be open.
    expect(record).toContain('quizSelections')
    expect(record).not.toMatch(/activeSoftware(Slug)?\b/)
  })

  it('nextQuestion calls it at the moment the quiz completes', () => {
    // The whole defect in one assertion: setQuizComplete(true) with nothing
    // beside it is exactly what shipped for twenty sessions.
    expect(next).toContain('setQuizComplete(true)')
    expect(next).toContain('recordQuizAttempt(')
  })

  it('nextQuestion depends on quizScore — otherwise the last answer is lost', () => {
    // useCallback captures quizScore. With the old deps
    // ([currentQuestion, quizQuestions]) the closure is stale and a correct
    // final answer is dropped from the recorded mark — silently, and only on
    // the last question, which is the hardest kind of wrong number to notice.
    const depsAt = OTTER.indexOf('}, [currentQuestion, quizQuestions, quizScore, recordQuizAttempt])')
    expect(depsAt, 'nextQuestion must list quizScore and recordQuizAttempt in its deps')
      .toBeGreaterThan(-1)
  })
})

describe('the storage path matches the caller on both backends', () => {
  it('the adapter exposes quiz.list and quiz.add', () => {
    expect(ADAPTER).toContain("async 'quiz.list'")
    expect(ADAPTER).toContain("async 'quiz.add'")
  })

  it('the per-course ops are gone with the column they read', () => {
    // otter_progress.quiz_attempts was dropped by 0045. Leaving these behind
    // would be an op that throws at runtime against a column that no longer
    // exists — worse than the dead path they replace.
    expect(ADAPTER).not.toContain("async 'quiz.get'")
    expect(ADAPTER).not.toContain("async 'quiz.put'")

    // ⚠️ Deliberately NOT a blanket scan for the identifier. The adapter names
    // the retired column in a comment explaining why it went, and a blunt
    // negative would force that explanation to be deleted to keep the suite
    // green — S29 hit exactly this with `canWrite = true`, where five
    // legitimate default parameters failed a naive assertion. So the check is
    // on the two shapes that are CODE: a PostgREST column selection and an
    // object key in a write payload.
    expect(ADAPTER, 'no query may still select the dropped column')
      .not.toMatch(/select\([^)]*quiz_attempts/)
    expect(ADAPTER, 'no insert/upsert may still write the dropped column')
      .not.toMatch(/quiz_attempts\s*:/)
  })

  it('Express serves the same route', () => {
    expect(MAIN_CJS).toMatch(/expressApp\.get\(\s*'\/api\/otter\/quiz-history'/)
    expect(MAIN_CJS).toMatch(/expressApp\.post\(\s*'\/api\/otter\/quiz-history'/)
  })

  it('nothing anywhere still calls the retired per-course route', () => {
    const offenders = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      // The new route is `/api/otter/quiz-history`; the retired one always had
      // a slug interpolated before it.
      if (/\/subjects?\/[^'"`]*quiz-history|\$\{[^}]*\}\/quiz-history/.test(text)) {
        offenders.push(relative(SRC, file).replace(/\\/g, '/'))
      }
    }
    expect(offenders, 'a per-course quiz-history URL no longer resolves and would '
      + 'fall through to the real network').toEqual([])
  })

  it('the export ships one top-level quiz history, not an empty one per course', () => {
    // Every export WILSON ever produced carried an empty per-course
    // quizHistory while presenting itself as complete.
    expect(ADAPTER).toContain('quiz_history:')
    expect(MAIN_CJS).toContain('quiz_history:')
  })
})
