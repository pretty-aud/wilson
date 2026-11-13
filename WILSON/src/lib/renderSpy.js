// =============================================================================
// renderSpy.js — which components drew in each commit, read from React's own
// commit hook (F4, 2026-11-13). Test code: only test files import it, so no
// build holds it.
//
// Why the commit hook and not a counter wrapped around a component: a wrapper
// sits OUTSIDE a React.memo placed on the component, so it counts the parent's
// render and not the component's, and it cannot be put around a component
// declared inside another one's render at all. The hook is the one React's
// DevTools read: after each commit it hands over the finished tree, and each
// fiber says what happened to it.
//
//   - A component whose render React KEPT carries the PerformedWork flag
//     (bit 1). One React skipped does not, and neither does one whose function
//     ran and ended on the state it had, with the same props and contexts (a
//     batch that set a value and set it back): React throws that render away
//     and keeps the old output, a bailout. So what is counted is the renders
//     React kept, not every call of a component's function. The flags are
//     reset whenever React takes a fiber up for a render, so on a fiber this
//     commit touched they are this commit's.
//   - A subtree React skipped whole keeps the very child fibers it had
//     (`child === alternate.child`), with flags from an older commit: it is
//     not walked. This is DevTools' own rule for "did this render".
//   - A fiber with no alternate did not exist before this commit: a mount.
//
// BY NAME OR BY REFERENCE. `renders(name)` and its kin match the name a
// component's function has AT RUN TIME, and the build may change it: esbuild
// names the inner function of `const X = forwardRef(function X(...))` X2 (ten
// components in src are written so, the kit's Button, Input and Select among
// them). A name that is never recorded counts 0, so a zero-pin on a renamed
// component, or on a typo, passes without measuring anything. Two answers:
// count by the component itself, `rendersOf(Select)` (the exported memo or
// forwardRef, or the function), which no build renames; and before a zero-pin
// by name, say that the name was seen at all: `assertSeen('Markdown')` throws
// for a name not recorded since the last reset.
//
// IMPORT THIS MODULE FIRST in a test file, before anything that loads
// react-dom (Testing Library does): React looks for the hook once, when its
// renderer module is evaluated. A spy installed too late sees nothing, and
// `assertWired()` says so instead of reporting "nothing rendered".
//
// renderSpy.test.jsx holds the controls: a memoized child is not counted, a
// component declared inside a render is counted as a mount every time, a
// render that ended on the state it had is not counted, a renamed forwardRef
// counts 0 by its name and is counted by reference, a typo throws.
// =============================================================================

const PERFORMED_WORK = 1
// FunctionComponent, ClassComponent, ForwardRef, SimpleMemoComponent. A
// MemoComponent (14, a memo with its own compare) is not counted itself: the
// component inside it is its child fiber, and that one says whether it ran.
const COMPONENT_TAGS = new Set([0, 1, 11, 15])
const MEMO_COMPONENT = 14

function nameOf(fiber) {
  const type = fiber.type
  if (typeof type === 'function') return type.displayName || type.name || '(anonymous)'
  if (type && typeof type === 'object') {
    const inner = type.render || type.type
    if (typeof inner === 'function') return type.displayName || inner.displayName || inner.name || '(anonymous)'
  }
  return '(anonymous)'
}

/**
 * The component references a counted fiber answers to: its function or class;
 * the forwardRef object it was written as, and that object's inner function;
 * the memo object around it. A memo over a plain function is one fiber whose
 * `type` is the function and `elementType` the memo; a memo with its own
 * compare (or over a forwardRef) is a MemoComponent fiber with the component
 * as its one child, so the memo is read off the parent, as many as are nested.
 */
function typesOf(fiber) {
  const out = []
  const add = (t) => { if (t && !out.includes(t)) out.push(t) }
  add(fiber.type)
  add(fiber.elementType)
  if (fiber.type && typeof fiber.type === 'object') add(fiber.type.render)
  for (let up = fiber.return; up && up.tag === MEMO_COMPONENT; up = up.return) { add(up.type); add(up.elementType) }
  return out
}

/** A name for a component reference, for an error: its displayName or its function's name. */
function labelOf(component) {
  if (typeof component === 'function') return component.displayName || component.name || '(anonymous)'
  if (component && typeof component === 'object') return component.displayName || labelOf(component.render || component.type)
  return String(component)
}

function contextsOf(fiber) {
  const out = []
  for (let dep = fiber.dependencies?.firstContext || null; dep; dep = dep.next) out.push(dep.context)
  return out
}

function walk(fiber, mountedAbove, out) {
  for (let node = fiber; node; node = node.sibling) {
    const before = node.alternate
    const mounted = mountedAbove || before === null
    if (COMPONENT_TAGS.has(node.tag) && (mounted || (node.flags & PERFORMED_WORK) === PERFORMED_WORK)) {
      out.push({ name: nameOf(node), mounted, contexts: contextsOf(node), types: typesOf(node) })
    }
    if (mounted) walk(node.child, true, out)
    else if (node.child !== before.child) walk(node.child, false, out)
  }
}

function install() {
  const existing = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__
  if (existing?.renderSpy) return existing.renderSpy
  if (existing) throw new Error('renderSpy: another commit hook is already installed in this test file')

  /** One entry per commit: the components that ran in it, in tree order. */
  const commits = []
  const renderers = new Map()

  const spy = {
    commits,
    /** A place in the record; `since(mark)` is what happened after it. */
    mark: () => commits.length,
    since: (mark = 0) => commits.slice(mark),
    reset: () => { commits.length = 0 },
    /** Throws unless React registered with the hook: see IMPORT THIS MODULE FIRST. */
    assertWired() {
      if (renderers.size === 0) throw new Error('renderSpy: react-dom loaded before the spy was installed; import src/lib/renderSpy.js first in the test file')
    },
    /** Every component that ran since `mark`, flat, in order. */
    ran(mark = 0) {
      spy.assertWired()
      return commits.slice(mark).flat()
    },
    /** name -> how many times a component of that name ran since `mark`. */
    counts(mark = 0) {
      const tally = new Map()
      for (const entry of spy.ran(mark)) tally.set(entry.name, (tally.get(entry.name) || 0) + 1)
      return tally
    },
    /** How many times a component of that name ran since `mark` (mounts included). */
    renders: (name, mark = 0) => spy.ran(mark).filter((entry) => entry.name === name).length,
    /** How many times a component of that name was MOUNTED since `mark`. */
    mounts: (name, mark = 0) => spy.ran(mark).filter((entry) => entry.name === name && entry.mounted).length,
    /** The names, of `names`, that ran since `mark`, each once, in the order given. */
    which: (names, mark = 0) => {
      const tally = spy.counts(mark)
      return names.filter((name) => tally.has(name))
    },
    /**
     * How many times THAT component ran since `mark` (mounts included), matched
     * by reference: the exported memo or forwardRef, or the function itself.
     * No build renames a reference, so this is the count for a forwardRef, whose
     * inner function esbuild may name X2.
     */
    rendersOf: (component, mark = 0) => spy.ran(mark).filter((entry) => entry.types.includes(component)).length,
    /** How many times THAT component was MOUNTED since `mark`, matched by reference as rendersOf is. */
    mountsOf: (component, mark = 0) => spy.ran(mark).filter((entry) => entry.types.includes(component) && entry.mounted).length,
    /**
     * Throws, naming each one, unless a component of every name given (or that
     * very component, when a reference is given) has been recorded since the
     * last reset. Call it before a pin that a name ran 0 times: a name never
     * recorded counts 0 whether or not the component exists under it.
     */
    assertSeen(...names) {
      const seen = spy.ran(0)
      const missing = names.filter((name) => (typeof name === 'string'
        ? !seen.some((entry) => entry.name === name)
        : !seen.some((entry) => entry.types.includes(name))))
      if (missing.length > 0) {
        throw new Error(`renderSpy: never recorded since the last reset: ${missing.map((name) => (typeof name === 'string' ? `"${name}"` : `${labelOf(name)} (by reference)`)).join(', ')}. A typo, a component that did not draw, or a name the build changed (the inner function of forwardRef(function X) is recorded as X2): count that one with rendersOf(X)`)
      }
    },
    /** The context object a component of that name read the last time it ran (its first useContext). */
    contextReadBy(name) {
      const entry = [...spy.ran()].reverse().find((e) => e.name === name && e.contexts.length > 0)
      if (!entry) throw new Error(`renderSpy: no component named ${name} has read a context`)
      return entry.contexts[0]
    },
    /** The components that ran since `mark` AND read that context in the render: its consumers that drew. */
    readers: (context, mark = 0) => spy.ran(mark).filter((entry) => entry.contexts.includes(context)),
  }

  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderSpy: spy,
    supportsFiber: true,
    renderers,
    inject(renderer) { const id = renderers.size + 1; renderers.set(id, renderer); return id },
    onCommitFiberRoot(_id, root) {
      const entries = []
      walk(root.current, false, entries)
      commits.push(entries)
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    setStrictMode() {},
    checkDCE() {},
  }
  return spy
}

/** The one spy of this test file, installed when this module is first evaluated. */
export const renderSpy = install()
