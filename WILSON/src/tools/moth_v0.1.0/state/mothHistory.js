// mothHistory.js — MO1 (MOTH_DESIGN §1.10): Moth's undo and redo, in memory, at most ten each way. Each step
// knows how to undo itself, and undoing one gives the step that redoes it. It survives R.A.B.B.I.T. project
// switches, and the page clears it on an account, workspace or adapter change. One step at a time: a held key
// or a second click while one is running asks nothing.
export const HISTORY_CAP = 10

// Asked of the error a step threw: does asking again have any point? What may pass keeps the step: the network,
// a server that went off, a file a program has open, a move still settling. Undo is the only way back that
// restores a file's links and place, so a passing failure must not cost it. A refusal that will say the same
// again goes, as does a step part of which has happened, or nobody can say. A database's own code (a statement
// timeout) rolled back, so nothing happened, and only Moth's refusals are written in lower case.
const MAY_PASS = new Set(['unreachable', 'cannot_check', 'in_use', 'folder_away', 'pending', 'plan_changed', 'failed'])
const refused = (code) => /^[a-z]/.test(String(code ?? '')) && !MAY_PASS.has(code)
const stale = (err) => Boolean(refused(err?.code) || err?.notMoved || err?.later || err?.stale)

export function createMothHistory({ cap = HISTORY_CAP } = {}) {
  let undoes = []
  let redoes = []
  let running = false
  const listeners = new Set()
  const told = () => { for (const fn of listeners) fn() }
  const capped = (list) => list.slice(-cap)

  async function step(from, setFrom, setTo) {
    const entry = from[from.length - 1]
    if (!entry || running) return null
    running = true
    setFrom(from.slice(0, -1))
    told()
    try {
      const opposite = await entry.run()
      if (opposite) setTo(opposite)
      return entry
    } catch (err) {
      if (!stale(err)) setFrom([...from.slice(0, -1), entry])
      throw err
    } finally {
      running = false
      told()
    }
  }

  const undo = () => step(undoes, (v) => { undoes = v }, (e) => { redoes = capped([...redoes, e]) })

  return {
    // A new step ends what could have been redone.
    push(entry) {
      undoes = capped([...undoes, entry])
      redoes = []
      told()
    },
    undo,
    redo: () => step(redoes, (v) => { redoes = v }, (e) => { undoes = capped([...undoes, e]) }),
    // A toast's Undo: its own step, only while that is still the next one. Anything done since comes first.
    top: () => undoes[undoes.length - 1] ?? null,
    undoStep: (entry) => (undoes[undoes.length - 1] === entry ? undo() : Promise.resolve(null)),
    clear() {
      undoes = []
      redoes = []
      told()
    },
    canUndo: () => undoes.length > 0,
    canRedo: () => redoes.length > 0,
    undoLabel: () => undoes[undoes.length - 1]?.label ?? null,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
}
