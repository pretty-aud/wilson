// mothHistory.js — MO1 (MOTH_DESIGN §1.10): Moth's undo and redo, in memory, at most ten each way. Each step
// knows how to undo itself, and undoing one gives the step that redoes it. It survives R.A.B.B.I.T. project
// switches, and the page clears it on an account, workspace or adapter change.
export const HISTORY_CAP = 10

export function createMothHistory({ cap = HISTORY_CAP } = {}) {
  let undoes = []
  let redoes = []
  const listeners = new Set()
  const told = () => { for (const fn of listeners) fn() }
  const capped = (list) => list.slice(-cap)

  async function step(from, setFrom, setTo) {
    const entry = from[from.length - 1]
    if (!entry) return null
    // Off the stack first: a step that is refused has gone stale, and asking again would say the same.
    setFrom(from.slice(0, -1))
    told()
    const opposite = await entry.run()
    if (opposite) setTo(opposite)
    told()
    return entry
  }

  return {
    // A new step ends what could have been redone.
    push(entry) {
      undoes = capped([...undoes, entry])
      redoes = []
      told()
    },
    undo: () => step(undoes, (v) => { undoes = v }, (e) => { redoes = capped([...redoes, e]) }),
    redo: () => step(redoes, (v) => { redoes = v }, (e) => { undoes = capped([...undoes, e]) }),
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
