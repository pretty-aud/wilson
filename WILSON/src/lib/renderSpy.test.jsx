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
//      and nothing else.
// =============================================================================
import { renderSpy } from './renderSpy'
import { describe, it, expect, afterEach } from 'vitest'
import { createContext, memo, useContext, useState } from 'react'
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
})
