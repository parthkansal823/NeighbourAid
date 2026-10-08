import { StrictMode, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useDialog } from './useDialog'
import { dismissTopAndroidOverlay } from '../utils/androidBack'

function Dialog({ name, onClose, children }) {
  const ref = useDialog(onClose)
  return <section ref={ref} role="dialog" aria-modal="true" aria-label={name} tabIndex={-1}><button onClick={onClose}>Close {name}</button>{children}</section>
}
function Nested() {
  const [parent, setParent] = useState(true), [child, setChild] = useState(true)
  return <><button>Original trigger</button>{parent && <Dialog name="parent" onClose={() => setParent(false)}><button onClick={() => setParent(false)}>Remove lower dialog</button></Dialog>}{child && <Dialog name="child" onClose={() => setChild(false)} />}</>
}
afterEach(() => { document.body.style.overflow = '' })

describe('useDialog dismissal stack', () => {
  it('closes only the top nested dialog for hardware back and keeps the parent locked', () => {
    document.body.style.overflow = 'auto'
    render(<Nested />)
    act(() => { expect(dismissTopAndroidOverlay()).toBe(true) })
    expect(screen.queryByRole('dialog', { name: 'child' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'parent' })).toBeVisible()
    expect(document.body.style.overflow).toBe('hidden')
    act(() => { dismissTopAndroidOverlay() })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('auto')
    expect(dismissTopAndroidOverlay()).toBe(false)
  })

  it('routes Escape and focus trapping to the top dialog only', () => {
    render(<Nested />)
    expect(screen.getByRole('button', { name: 'Close child' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'Close child' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'child' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'parent' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Close parent' })).toHaveFocus()
  })

  it('preserves the scroll lock if a lower dialog unmounts first', () => {
    document.body.style.overflow = 'scroll'
    render(<Nested />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove lower dialog' }))
    expect(screen.queryByRole('dialog', { name: 'parent' })).not.toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.click(screen.getByRole('button', { name: 'Close child' }))
    expect(document.body.style.overflow).toBe('scroll')
  })

  it('uses the latest close handler and restores focus after unmount', () => {
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const first = vi.fn(), latest = vi.fn()
    const view = render(<Dialog name="test" onClose={first} />)
    view.rerender(<Dialog name="test" onClose={latest} />)
    act(() => { dismissTopAndroidOverlay() })
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledOnce()
    view.unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('does not leave stale dismissal or scroll locks after StrictMode cleanup', () => {
    document.body.style.overflow = 'auto'
    const close = vi.fn()
    const view = render(<StrictMode><Dialog name="strict" onClose={close} /></StrictMode>)
    act(() => { dismissTopAndroidOverlay() })
    expect(close).toHaveBeenCalledOnce()
    view.unmount()
    expect(document.body.style.overflow).toBe('auto')
    expect(dismissTopAndroidOverlay()).toBe(false)
  })
})
