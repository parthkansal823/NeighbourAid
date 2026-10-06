import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import NativeOverlay from './NativeOverlay'

const state = vi.hoisted(() => ({ native: true }))
vi.mock('../utils/runtime', () => ({ isNativeApp: () => state.native }))
beforeEach(() => { state.native = true })

describe('native overlays', () => {
  it('escapes a clipping card and removes its portal on close', () => {
    const { container, unmount } = render(<div className="overflow-hidden"><NativeOverlay><div role="dialog">Camera</div></NativeOverlay></div>)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(screen.getByRole('dialog').closest('.native-overlay')?.parentElement).toBe(document.body)
    unmount()
    expect(document.body.querySelector('.native-overlay')).toBeNull()
  })

  it('also escapes web cards without applying native styling', () => {
    state.native = false
    const { container } = render(<NativeOverlay><div role="dialog">Share</div></NativeOverlay>)
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(screen.getByRole('dialog').closest('.app-overlay')?.parentElement).toBe(document.body)
    expect(document.body.querySelector('.native-overlay')).toBeNull()
  })
})
