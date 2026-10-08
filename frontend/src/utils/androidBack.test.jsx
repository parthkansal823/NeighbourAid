import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  allowScreenNavigation, dismissTopAndroidOverlay, lockDialogScroll,
  registerDialogDismissal, registerScreenNavigationGuard,
} from './androidBack'

const cleanups = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  document.body.style.overflow = ''
})

describe('shared Android dismissal and navigation registry', () => {
  it('evaluates guards newest-first and cleans up idempotently', () => {
    const old = vi.fn(() => true), recent = vi.fn(() => false)
    const removeOld = registerScreenNavigationGuard(old), removeRecent = registerScreenNavigationGuard(recent)
    cleanups.push(removeOld, removeRecent)
    expect(allowScreenNavigation()).toBe(false)
    expect(old).not.toHaveBeenCalled()
    removeRecent()
    removeRecent()
    expect(allowScreenNavigation()).toBe(true)
    expect(old).toHaveBeenCalledOnce()
    removeOld()
    expect(allowScreenNavigation()).toBe(true)
  })

  it('conservatively prevents navigation when a guard throws', () => {
    cleanups.push(registerScreenNavigationGuard(() => { throw new Error('Unavailable form state') }))
    expect(allowScreenNavigation()).toBe(false)
  })

  it('ignores hidden overlays and respects the top visible layer rather than DOM order', () => {
    const closeTop = vi.fn(), closeLower = vi.fn(), closeHidden = vi.fn()
    render(<><div style={{ zIndex: 80 }}><section role="dialog" aria-modal="true"><button aria-label="Close" onClick={closeTop}>Top</button></section></div><section role="dialog" aria-modal="true" style={{ zIndex: 40 }}><button aria-label="Close" onClick={closeLower}>Lower</button></section><div style={{ display: 'none' }}><section role="dialog" aria-modal="true" style={{ zIndex: 100 }}><button aria-label="Close" onClick={closeHidden}>Hidden</button></section></div></>)
    expect(dismissTopAndroidOverlay()).toBe(true)
    expect(closeTop).toHaveBeenCalledOnce()
    expect(closeLower).not.toHaveBeenCalled()
    expect(closeHidden).not.toHaveBeenCalled()
  })

  it('uses an explicit update close action without requiring an English aria-label', () => {
    const close = vi.fn()
    render(<section role="dialog" aria-modal="true"><button className="app-update-prompt-close" aria-label="अपडेट स्क्रीन बंद करें" onClick={close}>Close</button></section>)
    expect(dismissTopAndroidOverlay()).toBe(true)
    expect(close).toHaveBeenCalledOnce()
  })

  it('consumes an unknown or broken modal rather than navigating beneath it', () => {
    render(<section role="dialog" aria-modal="true" aria-label="Busy" />)
    const dialog = screen.getByRole('dialog')
    const registration = registerDialogDismissal(() => dialog, () => { throw new Error('Busy') })
    cleanups.push(registration.remove)
    expect(dismissTopAndroidOverlay()).toBe(true)
    registration.remove()
    expect(dismissTopAndroidOverlay()).toBe(true)
  })

  it('closes a header menu using only its own expanded trigger', () => {
    const close = vi.fn()
    render(<><button aria-expanded="true" aria-controls="native-menu" onClick={close}>More</button><nav id="native-menu">Menu</nav><button aria-expanded="true" aria-controls="not-a-menu">Disclosure</button><div id="not-a-menu">Content</div></>)
    expect(dismissTopAndroidOverlay()).toBe(true)
    expect(close).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Disclosure' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('restores the original body overflow after out-of-order, repeated unlocks', () => {
    document.body.style.overflow = 'auto'
    const lower = lockDialogScroll(), upper = lockDialogScroll()
    cleanups.push(lower, upper)
    lower()
    lower()
    expect(document.body.style.overflow).toBe('hidden')
    upper()
    expect(document.body.style.overflow).toBe('auto')
  })
})
