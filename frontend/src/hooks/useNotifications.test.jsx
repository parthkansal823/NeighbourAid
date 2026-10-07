import { afterEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useNotifications } from './useNotifications'

const originalPermission = Object.getOwnPropertyDescriptor(Notification, 'permission')

afterEach(() => {
  if (originalPermission) Object.defineProperty(Notification, 'permission', originalPermission)
})

describe('useNotifications', () => {
  it('refreshes notification permission when the person returns from device settings', () => {
    Object.defineProperty(Notification, 'permission', { configurable: true, value: 'default' })
    const { result } = renderHook(() => useNotifications())
    expect(result.current.permission).toBe('default')

    Object.defineProperty(Notification, 'permission', { configurable: true, value: 'granted' })
    act(() => window.dispatchEvent(new Event('focus')))
    expect(result.current.permission).toBe('granted')
  })
})
