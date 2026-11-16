// =============================================================================
// rabbitLive.js — the part of R.A.B.B.I.T.'s state that changes on its own
// clock, out of the provider's one value (F4, 2026-11-13; the review's rabbit
// C1 and shared-client C4).
//
// RabbitProvider hands ONE value to about seventy files. Eight pieces of state
// in it move without anything in the project moving: a presence heartbeat, a
// channel's status, an ingestion's progress, the undo toast, the adapter's
// status. Each was a new value for every reader. Measured on the Assets tab of
// the fixture project (state/volatileState.rerender.test.jsx): one heartbeat
// ran all seven readers mounted there and 574 components with them.
//
// So each of the eight that anything SHOWS has a context of its own here, and
// the provider's value no longer changes when one of them does:
//
//   const users = useRabbitLive('presentUsers', ctx)     // ctx = useRabbit()
//
// A reader that shows one of them reads it THIS way, and is drawn again when
// it changes, in the same commit as before. Every other reader is left alone.
//
// 🚨 THE VALUE STILL CARRIES ALL EIGHT, AS GETTERS (liveGetters, below), AND
// A GETTER DOES NOT TELL ANYONE. `ctx.undoToast` answers with the toast as of
// the provider's last render, for code that looks when it runs (a handler, a
// test's probe after an action). A component that reads `ctx.presentUsers`
// WHILE IT DRAWS compiles, looks right, and is never drawn again for it. The
// readers are listed in rabbitLive.test.jsx, which reads every source file
// under src: one of the eight read off an object (`x.undoToast`) anywhere but
// the provider fails there.
//
// WHY A FILE OF ITS OWN, and why it imports nothing but React. 54 test files
// stand in for the provider's module with a single function, `useRabbit: ()
// => fake`, and their fakes carry these fields. A hook exported from
// RabbitProvider.jsx does not exist in those tests. And a hooks file that
// imported `useRabbit` back would make an import cycle that a test which
// awaits the real module while mocking it walks into
// (deck-outline-generator_v0.514/enterKey.render.test.jsx). So the caller
// passes what its own `useRabbit()` gave it, and with no provider above (those
// tests; the app always has one) the hook answers from that: the very
// expression the reader held before F4.
// =============================================================================
import { createContext, createElement, useContext } from 'react'

const ABSENT = Symbol('no RabbitProvider above')

/** The eight, in the order the provider declares them. `activeIngestion` is shown by nothing: it has no context. */
export const LIVE_NAMES = Object.freeze([
  'adapterStatus', 'undoToast', 'activeIngestion', 'ingestionRun',
  'realtimeStatus', 'presentUsers', 'workspaceRealtimeStatus', 'workspacePresentUsers',
])
/** The seven that something shows: each has a context. */
export const SHOWN_NAMES = Object.freeze(LIVE_NAMES.filter((name) => name !== 'activeIngestion'))

const CONTEXTS = Object.freeze(Object.fromEntries(SHOWN_NAMES.map((name) => [name, createContext(ABSENT)])))

/**
 * One of the seven, as the provider holds it now; the component is drawn again when it changes.
 * @param {string} name  one of SHOWN_NAMES
 * @param {object | null | undefined} ctx  what the caller's own useRabbit() returned (read only when no provider is above)
 */
export function useRabbitLive(name, ctx) {
  const context = CONTEXTS[name]
  if (!context) throw new Error(`useRabbitLive: ${name} is not one of ${SHOWN_NAMES.join(', ')}`)
  const live = useContext(context)
  return live === ABSENT ? ctx?.[name] : live
}

// ── The adapter's `online`, alone ────────────────────────────────────────────
// The adapter's status is an OBJECT ({ online, lastSyncAt, error }) that every
// refresh of the projects list and every refreshed sign-in replaces, and seven
// of its readers want one word of it: is the adapter online. The six data
// hooks load again when that flips (the Budget's lines and rates, the
// expenses, the rate card, the templates, the team), and the connection dot
// asks again. Reading the object drew each of their hosts at every
// replacement: measured in the running app with the Assets tab open, 1,644
// components for a status that said the same thing (the shell and the tab are
// hosts of the team hook). They read the word, which is a boolean and so the
// same value until it flips.
const OnlineContext = createContext(ABSENT)

/**
 * Whether the adapter is online; the component is drawn again when that flips, and not for a new status object that
 * says the same.
 * @param {object | null | undefined} ctx  what the caller's own useRabbit() returned (read only when no provider is above)
 */
export function useRabbitOnline(ctx) {
  const online = useContext(OnlineContext)
  return online === ABSENT ? ctx?.adapterStatus?.online : online
}

/** The provider's children under the seven contexts and the one word. A function, not a component: it adds no render of its own. */
export function withRabbitLive(live, children) {
  let tree = createElement(OnlineContext.Provider, { value: live.adapterStatus?.online }, children)
  for (const name of SHOWN_NAMES) tree = createElement(CONTEXTS[name].Provider, { value: live[name] }, tree)
  return tree
}

/**
 * The eight as getters on the provider's value, each answering from `ref.current` (which the provider writes as it
 * renders). The value's identity no longer follows them; what a getter answers is never older than the provider's
 * last render.
 */
export function liveGetters(value, ref) {
  for (const name of LIVE_NAMES) {
    Object.defineProperty(value, name, { enumerable: true, get: () => ref.current[name] })
  }
  return value
}

// ── D.O.G.'s six fields ──────────────────────────────────────────────────────
// D.O.G. read six fields off the whole value (the projects list and the four
// things it does with a project), so every write to the open project ran
// D.O.G., on screen or off. The provider hands those six as one memoized
// object here, which changes with the list, the mode and the open project's
// id and with nothing else.
const ProjectsContext = createContext(ABSENT)

/** The provider's children under the projects context. */
export function withRabbitProjects(projects, children) {
  return createElement(ProjectsContext.Provider, { value: projects }, children)
}

/**
 * { adapterMode, projectsIndex, refreshProjectsIndex, createProject, updateProject, getAdapter }.
 * @param {() => object | null} readWhole  the caller's own `useRabbit`, CALLED only when no provider is above (a
 *   test's stand-in for the provider answers through it). It reads a context and nothing else, so calling it on
 *   one path and not the other keeps the caller's hooks in order.
 */
export function useRabbitProjects(readWhole) {
  const projects = useContext(ProjectsContext)
  return projects === ABSENT ? (readWhole ? readWhole() : null) : projects
}
