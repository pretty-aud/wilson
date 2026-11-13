/** @vitest-environment jsdom */
// =============================================================================
// renderSpy.test.jsx — the render spy's own controls (F4, 2026-11-13).
//
// Every render pin of F4 reads the spy, so the spy is pinned first, on trees
// small enough to count by hand:
//
//   1. a component that re-renders with its parent IS counted, and a memoized
//      sibling with equal props is NOT (the pair is the control: one tree, one
//      update, two answers);
//   2. what sits under the memoized sibling is not counted either. Its fiber
//      still carries the flag from the commit that mounted it, so a walk that
//      trusted every flag would count it on every later commit: `naiveCount`
//      below is that walk, and it is shown to be wrong on this very tree;
//   3. a component declared INSIDE a render is a new component each time, so
//      React mounts it again: counted as a mount on every parent render, where
//      the same component at module level mounts once;
//   4. the readers of a context are the components that read it in the render
//      and nothing else;
//   5. a render React threw away because it ended on the state it had (a
//      bailout) is not counted, though the component's function ran: what is
//      counted is the renders React kept;
//   6. by reference: a forwardRef written `forwardRef(function X(...))`, whose
//      function the build names X2, counts 0 by its name and is counted by
//      `rendersOf(X)` (the pair is the control); a memo is counted by the memo
//      or by its function, with or without a compare of its own;
//   7. `assertSeen`: a name recorded since the last reset passes, a typo
//      throws and names itself, where `renders(typo)` says 0 and passes.
// =============================================================================
import { renderSpy } from './renderSpy'
import { describe, it, expect, afterEach } from 'vitest'
import { createContext, forwardRef, memo, useContext, useState } from 'react'
import { render, cleanup, act, fireEvent } from '@testing-library/react'

afterEach(() => { cleanup(); renderSpy.reset() })

function Leaf() { return <i /> }
function Plain() { return <b><Leaf /></b> }
function Under() { return <u /> }
function Kept() { return <em><Under /></em> }
const KeptMemo = memo(Kept)

function Parent() {
  const [n, setN] = useState(0)
  return (
    <div>
      <button onClick={() => setN((x) => x + 1)}>{n}</button>
      <Plain />
      <KeptMemo />
    </div>
  )
}

/** The wrong walk: every fiber in the tree that carries the flag, old or new. */
function naiveCount(container, name) {
  const key = Object.keys(container).find((k) => k.startsWith('__reactContainer$'))
  let count = 0
  const visit = (fiber) => {
    for (let node = fiber; node; node = node.sibling) {
      if (typeof node.type === 'function' && node.type.name === name && (node.flags & 1) === 1) count++
      visit(node.child)
    }
  }
  visit(container[key].stateNode.current)
  return count
}

describe('the render spy', () => {
  it('is wired: React registered with the hook when its renderer loaded', () => {
    expect(() => renderSpy.assertWired()).not.toThrow()
  })

  it('counts the mount: every component once, each a mount', () => {
    render(<Parent />)
    for (const name of ['Parent', 'Plain', 'Leaf', 'Kept', 'Under']) {
      expect(renderSpy.renders(name), name).toBe(1)
      expect(renderSpy.mounts(name), name).toBe(1)
    }
  })

  it('an update: the plain child is counted, the memoized one and what is under it are not', async () => {
    const view = render(<Parent />)
    const mark = renderSpy.mark()
    await act(async () => { fireEvent.click(view.getByRole('button')) })
    expect(renderSpy.since(mark)).toHaveLength(1)
    expect(renderSpy.renders('Parent', mark)).toBe(1)
    expect(renderSpy.renders('Plain', mark)).toBe(1)
    expect(renderSpy.renders('Leaf', mark)).toBe(1)
    expect(renderSpy.mounts('Plain', mark)).toBe(0)
    expect(renderSpy.renders('Kept', mark)).toBe(0)
    expect(renderSpy.renders('Under', mark)).toBe(0)
    expect(renderSpy.which(['Parent', 'Plain', 'Kept', 'Under', 'Leaf'], mark)).toEqual(['Parent', 'Plain', 'Leaf'])
  })

  it('CONTROL: a walk that trusts every flag counts what React skipped (so the spy must not be that walk)', async () => {
    const view = render(<Parent />)
    await act(async () => { fireEvent.click(view.getByRole('button')) })
    // `Under` did not run in the update, and its fiber still says it did.
    expect(naiveCount(view.container, 'Under')).toBe(1)
    expect(renderSpy.renders('Under', renderSpy.mark() - 1)).toBe(0)
  })

  it('a component declared inside a render is mounted again by every render; at module level, once', async () => {
    function Outside() { return <s /> }
    function Host() {
      const [n, setN] = useState(0)
      const Inside = () => <q />
      return <div><button onClick={() => setN((x) => x + 1)}>{n}</button><Inside /><Outside /></div>
    }
    const view = render(<Host />)
    const mark = renderSpy.mark()
    for (let i = 0; i < 3; i++) await act(async () => { fireEvent.click(view.getByRole('button')) })
    expect(renderSpy.mounts('Inside', mark)).toBe(3)
    expect(renderSpy.mounts('Outside', mark)).toBe(0)
    expect(renderSpy.renders('Outside', mark)).toBe(3)
  })

  it('the readers of a context: those that read it in the render, by the context itself', async () => {
    const Words = createContext('a')
    const Other = createContext(0)
    function Reads() { return <span>{useContext(Words)}</span> }
    function ReadsOther() { return <span>{useContext(Other)}</span> }
    function Deaf() { return <span>deaf</span> }
    const DeafMemo = memo(Deaf)
    function Provider({ children }) {
      const [word, setWord] = useState('a')
      return <Words.Provider value={word}><button onClick={() => setWord('b')}>go</button>{children}</Words.Provider>
    }
    const view = render(<Provider><Reads /><ReadsOther /><DeafMemo /></Provider>)
    const words = renderSpy.contextReadBy('Reads')
    expect(words).toBe(Words)
    const mark = renderSpy.mark()
    await act(async () => { fireEvent.click(view.getByRole('button')) })
    // The provider's children are the same elements, so only the context's readers run.
    expect(renderSpy.readers(Words, mark).map((e) => e.name)).toEqual(['Reads'])
    expect(renderSpy.renders('ReadsOther', mark)).toBe(0)
    expect(renderSpy.renders('Deaf', mark)).toBe(0)
  })

  it('a render that ended on the state it had is not counted, though the function ran: the count is of the renders React kept', async () => {
    let calls = 0
    function Flip() {
      calls++
      const [n, setN] = useState(0)
      return <button onClick={() => { setN(1); setN(0) }}>{n}</button>
    }
    const view = render(<Flip />)
    const mark = renderSpy.mark()
    const before = calls
    await act(async () => { fireEvent.click(view.getByRole('button')) })
    expect(calls - before).toBe(1)                       // React ran it, to learn the state
    expect(renderSpy.since(mark)).toHaveLength(1)        // and committed
    expect(renderSpy.renders('Flip', mark)).toBe(0)      // the render it threw away is not counted
  })
})

// ── By reference, and the names a pin relies on ──────────────────────────────
// Written as ten components in src are: the build (esbuild) names the inner
// function of `const Fancy = forwardRef(function Fancy(...))` Fancy2, so the
// spy, which records the function's name at run time, records Fancy2.
const Fancy = forwardRef(function Fancy({ word }, ref) { return <input ref={ref} value={word} readOnly /> })
function Shown({ word }) { return <b>{word}</b> }
const ShownMemo = memo(Shown)
// A memo with a compare of its own is a fiber of its own, the component its one child.
const Picky = memo(function Choosy({ word }) { return <i>{word}</i> }, (was, now) => was.word === now.word)

function Board() {
  const [n, setN] = useState(0)
  const [word, setWord] = useState('a')
  return (
    <div>
      <button onClick={() => setN((x) => x + 1)}>tick {n}</button>
      <button onClick={() => setWord((w) => `${w}a`)}>word</button>
      <Fancy word={word} />
      <ShownMemo word={word} />
      <Picky word={word} />
    </div>
  )
}
const press = (view, name) => act(async () => { fireEvent.click(view.getByRole('button', { name })) })

describe('the render spy by reference (rendersOf, mountsOf) and assertSeen', () => {
  it('CONTROL: a forwardRef whose function the build renamed counts 0 by its name; by reference it is counted', async () => {
    expect(Fancy.render.name).not.toBe('Fancy')          // renamed by the build (Fancy2): the name a by-name pin would miss
    const view = render(<Board />)
    expect(renderSpy.renders('Fancy')).toBe(0)           // by name: nothing measured, and a zero-pin on it would pass
    expect(renderSpy.rendersOf(Fancy)).toBe(1)
    expect(renderSpy.mountsOf(Fancy)).toBe(1)
    expect(renderSpy.renders(Fancy.render.name)).toBe(1) // the name it IS recorded under
    const mark = renderSpy.mark()
    await press(view, /tick/)
    await press(view, /tick/)
    expect(renderSpy.rendersOf(Fancy, mark)).toBe(2)     // no memo: drawn with its parent
    expect(renderSpy.mountsOf(Fancy, mark)).toBe(0)
    expect(() => renderSpy.assertSeen('Fancy')).toThrow(/"Fancy"/)
    expect(() => renderSpy.assertSeen(Fancy)).not.toThrow()
  })

  it('a memo, by the memo or by its function, with or without a compare of its own: drawn when its props change, not otherwise', async () => {
    const view = render(<Board />)
    expect([renderSpy.mountsOf(ShownMemo), renderSpy.mountsOf(Shown), renderSpy.mountsOf(Picky)]).toEqual([1, 1, 1])
    let mark = renderSpy.mark()
    await press(view, /tick/)
    expect(renderSpy.rendersOf(Board, mark)).toBe(1)
    expect([renderSpy.rendersOf(ShownMemo, mark), renderSpy.rendersOf(Shown, mark), renderSpy.rendersOf(Picky, mark)]).toEqual([0, 0, 0])
    mark = renderSpy.mark()
    await press(view, 'word')
    expect([renderSpy.rendersOf(ShownMemo, mark), renderSpy.rendersOf(Shown, mark), renderSpy.rendersOf(Picky, mark)]).toEqual([1, 1, 1])
    expect([renderSpy.renders('Shown', mark), renderSpy.renders('Choosy', mark)]).toEqual([1, 1])   // by name, where the names are true
    expect(renderSpy.mountsOf(Picky, mark)).toBe(0)
  })

  it('CONTROL: assertSeen passes for a name recorded since the last reset; a typo throws and names itself, where renders() says 0', () => {
    render(<Parent />)
    expect(() => renderSpy.assertSeen('Parent', 'Plain', 'Kept', 'Under')).not.toThrow()
    expect(renderSpy.renders('Parnet')).toBe(0)          // the zero-pin a typo passes
    expect(() => renderSpy.assertSeen('Parent', 'Parnet')).toThrow(/"Parnet"/)
    expect(() => renderSpy.assertSeen('Parent', 'Parnet')).not.toThrow(/"Parent"/)
    renderSpy.reset()
    expect(() => renderSpy.assertSeen('Parent')).toThrow(/"Parent"/)   // since the last reset, not ever
  })
})
