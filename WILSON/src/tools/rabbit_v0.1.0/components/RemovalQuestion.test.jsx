/** @vitest-environment jsdom */
// =============================================================================
// RemovalQuestion.test.jsx — post-overhaul S5b, step 0, constraint 9 (and 4's
// rule on the Remove path): with a bid version open, the person's delete of a
// row another version holds sets it ASIDE; a path that never asked asks only
// when that row has work on it. Each case with a control; the call sites are
// pinned on their source (the popup, the Tasks row and card, the bulk bar,
// the Timeline editor), each pin with a control.
// =============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { readFileSync } from 'node:fs'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useRemovalAsk } from './RemovalQuestion'

afterEach(cleanup)

const openVersion = { id: 'v2', name: 'Mid ROM · v2' }
const plan = (work) => ({ openVersion, rows: [{ kind: 'tasks', id: 't1', name: 'Lighting pass 2', verb: 'remove', holders: [{ id: 'v3', name: 'High ROM · v3' }], work }] })

function Harness({ ctx, run }) {
  const removal = useRemovalAsk(ctx)
  return (
    <>
      <button type="button" onClick={() => removal.ask({ tasks: ['t1'] }, run)}>delete it</button>
      {removal.dialog}
    </>
  )
}

describe('useRemovalAsk', () => {
  it('a removed task with work asks first; Cancel deletes nothing', () => {
    const run = vi.fn()
    render(<Harness ctx={{ removalPlanFor: () => plan({ loggedDays: 1.5, comments: 2, files: 0 }) }} run={run} />)
    fireEvent.click(screen.getByText('delete it'))
    expect(run).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').textContent).toMatch(/Remove “Lighting pass 2” from “Mid ROM · v2”\?/)
    expect(screen.getByRole('dialog').textContent).toMatch(/1\.5 days logged and 2 comments/)
    // Cancel first and focused.
    expect(document.activeElement?.textContent).toBe('Cancel')
    fireEvent.click(screen.getByText('Cancel'))
    expect(run).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('its confirm runs the delete', () => {
    const run = vi.fn()
    render(<Harness ctx={{ removalPlanFor: () => plan({ loggedDays: 1, comments: 0, files: 0 }) }} run={run} />)
    fireEvent.click(screen.getByText('delete it'))
    fireEvent.click(screen.getByText('Remove from this version'))
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('CONTROL: no work on it, or no versions at all (a member, the Dashboard), runs at once — the undo toast says which', () => {
    const run = vi.fn()
    render(<Harness ctx={{ removalPlanFor: () => plan(null) }} run={run} />)
    fireEvent.click(screen.getByText('delete it'))
    expect(run).toHaveBeenCalledTimes(1)
    cleanup()
    const run2 = vi.fn()
    render(<Harness ctx={{}} run={run2} />)
    fireEvent.click(screen.getByText('delete it'))
    expect(run2).toHaveBeenCalledTimes(1)
  })
})

describe('every person\'s delete goes through the Remove / Delete answer', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf-8')
  it('the task popup, the Tasks row and card ask through useRemovalAsk', () => {
    const popup = read('./TaskDetailPopup.jsx')
    expect(popup).toMatch(/onClick=\{\(\) => removal\.ask\(\{ tasks: \[task\.id\] \}, \(\) => \{ if \(ctx\?\.deleteTask\?\.\(task\.id\) !== false\) onClose\(\) \}\)\}/)
    expect(popup).toMatch(/\{removal\.dialog\}/)
    const tasks = read('../views/ProjectTasksView.jsx')
    expect(tasks.match(/removal\.ask\(\{ tasks: \[task\.id\] \}, \(\) => ctx\?\.deleteTask\?\.\(task\.id\)\)/g)).toHaveLength(2)
    expect(tasks.match(/\{removal\.dialog\}/g)).toHaveLength(2)
    // CONTROL: no bare delete is left on those paths.
    expect(tasks).not.toMatch(/onClick=\{\(\) => ctx\?\.deleteTask\?\.\(task\.id\)\}/)
  })
  it('the bulk bar and the Timeline editor word their question with removalQuestion', () => {
    expect(read('../views/ProjectTasksView.jsx')).toMatch(/const removalQ = removalQuestion\(ctx\?\.removalPlanFor\?\.\(\{ tasks: \[\.\.\.selected\] \}\), 'task'\)/)
    expect(read('../views/TimelineView.jsx')).toMatch(/const removalQ = kind \? removalQuestion\(ctx\?\.removalPlanFor\?\.\(\{ \[kind\]: \[ask\.id\] \}\), noun\) : null/)
  })
})
