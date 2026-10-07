import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import LaunchScreen from './LaunchScreen'
import { LAUNCH_EXIT_MS, LAUNCH_VISIBLE_MS } from '../hooks/useLaunchScreen'

describe('LaunchScreen', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows a finite branded launch transition', () => {
    render(<LaunchScreen />)
    expect(screen.getByRole('status', { name: 'Opening NeighbourAid' })).toHaveAttribute('data-state', 'opening')

    act(() => { vi.advanceTimersByTime(LAUNCH_VISIBLE_MS) })
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'exiting')
    act(() => { vi.advanceTimersByTime(LAUNCH_EXIT_MS) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('lets a keyboard user skip the transition with Escape', () => {
    render(<LaunchScreen />)
    fireEvent.keyDown(window, { key: 'Escape' })
    act(() => { vi.advanceTimersByTime(LAUNCH_EXIT_MS) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not hold reduced-motion users on the launch animation', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    render(<LaunchScreen />)
    act(() => { vi.runAllTimers() })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
