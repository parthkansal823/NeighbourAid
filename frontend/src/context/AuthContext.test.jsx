import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuth } from './AuthContext'

vi.mock('../utils/api', () => ({ default: { post: vi.fn() } }))

const MAX_DELAY = 2 ** 31 - 1
const DAY = 24 * 60 * 60 * 1000

function session(expiresIn) {
  const exp = (Date.now() + expiresIn) / 1000
  const token = `e30.${btoa(JSON.stringify({ sub: 'volunteer-1', role: 'volunteer', exp }))}.signature`
  localStorage.setItem('token', token)
  localStorage.setItem('name', 'Volunteer')
  return renderHook(() => useAuth(), { wrapper: AuthProvider })
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-07T00:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('session expiry', () => {
  it('rearms long-lived sessions and only logs out at their actual expiry', () => {
    const lifetime = 60 * DAY
    const { result } = session(lifetime)

    act(() => vi.advanceTimersByTime(MAX_DELAY))
    expect(result.current.user?.id).toBe('volunteer-1')
    expect(localStorage.getItem('token')).not.toBeNull()

    act(() => vi.advanceTimersByTime(MAX_DELAY))
    expect(result.current.user?.id).toBe('volunteer-1')
    act(() => vi.advanceTimersByTime(lifetime - 2 * MAX_DELAY - 1))
    expect(result.current.user?.id).toBe('volunteer-1')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.user).toBeNull()
    expect(result.current.token).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('still logs short sessions out at expiry', () => {
    const { result } = session(1000)
    act(() => vi.advanceTimersByTime(999))
    expect(result.current.user?.id).toBe('volunteer-1')
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.user).toBeNull()
  })

  it('cancels the rearmed timer when the provider unmounts', () => {
    const { unmount } = session(60 * DAY)
    act(() => vi.advanceTimersByTime(MAX_DELAY))
    unmount()
    act(() => vi.advanceTimersByTime(60 * DAY))
    expect(localStorage.getItem('token')).not.toBeNull()
  })
})
