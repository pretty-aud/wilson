/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { Toast, ToastProvider, useToast, TOAST_TONES } from './Toast'

afterEach(() => { cleanup(); vi.useRealTimers() })

function Pusher({ opts }) {
  const toast = useToast()
  return <button onClick={() => toast.push(opts)}>push</button>
}

describe('Toast', () => {
  it('renders each tone with title, body and a dismiss control', () => {
    for (const tone of TOAST_TONES) {
      const onDismiss = vi.fn()
      const { unmount } = render(<Toast tone={tone} title={`T ${tone}`} body="b" onDismiss={onDismiss} />)
      const t = screen.getByText(`T ${tone}`).closest('.ui-toast')
      expect(t.dataset.tone).toBe(tone)
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
      expect(onDismiss).toHaveBeenCalledTimes(1)
      unmount()
    }
  })

  it('the provider stacks at one anchor, auto-dismisses, and hover pauses the timer', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Pusher opts={{ tone: 'success', title: 'Saved', duration: 1000 }} />
      </ToastProvider>,
    )
    fireEvent.click(screen.getByText('push'))
    fireEvent.click(screen.getByText('push'))
    const stack = document.querySelector('.ui-toast-stack')
    expect(stack.querySelectorAll('.ui-toast').length).toBe(2)
    // Hover the first: it survives the timeout; the second goes.
    const [first] = stack.querySelectorAll('.ui-toast')
    fireEvent.mouseEnter(first)
    act(() => { vi.advanceTimersByTime(1200) })
    expect(stack.querySelectorAll('.ui-toast').length).toBe(1)
    fireEvent.mouseLeave(stack.querySelector('.ui-toast'))
    act(() => { vi.advanceTimersByTime(1200) })
    expect(stack.querySelectorAll('.ui-toast').length).toBe(0)
  })

  it('useToast outside a provider is a stack trace, not a silent no-op', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Pusher opts={{}} />)).toThrow(/ToastProvider/)
    err.mockRestore()
  })
})
