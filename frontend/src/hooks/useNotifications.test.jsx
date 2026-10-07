import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useNotifications } from './useNotifications'

const mocks = vi.hoisted(() => ({ delete: vi.fn() }))
vi.mock('../utils/api', () => ({ default: { delete: mocks.delete } }))

const originalPermission = Object.getOwnPropertyDescriptor(Notification, 'permission')

afterEach(() => {
  if (originalPermission) Object.defineProperty(Notification, 'permission', originalPermission)
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

async function subscribedDevice() {
  const sub = { toJSON: () => ({ endpoint: 'https://push.example.test/device' }), unsubscribe: vi.fn() }
  const getSubscription = vi.fn().mockResolvedValue(sub)
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve({ pushManager: { getSubscription } }) } })
  const { result } = renderHook(() => useNotifications())
  await waitFor(() => expect(result.current.pushEnabled).toBe(true))
  return { result, sub, getSubscription }
}

describe('useNotifications', () => {
  it('refreshes notification permission when the person returns from device settings', () => {
    Object.defineProperty(Notification, 'permission', { configurable: true, value: 'default' })
    const { result } = renderHook(() => useNotifications())
    expect(result.current.permission).toBe('default')

    Object.defineProperty(Notification, 'permission', { configurable: true, value: 'granted' })
    act(() => window.dispatchEvent(new Event('focus')))
    expect(result.current.permission).toBe('granted')
  })

  it('keeps the enabled state and reports failure when the server cannot unregister', async () => {
    const { result, sub } = await subscribedDevice()
    mocks.delete.mockRejectedValue(new Error('offline'))
    let outcome
    await act(async () => { outcome = await result.current.unsubscribe() })
    expect(outcome).toBe('failed')
    expect(result.current.pushEnabled).toBe(true)
    expect(sub.unsubscribe).not.toHaveBeenCalled()
  })

  it('does not report off if the browser retains the subscription after unsubscribe resolves', async () => {
    const { result, sub } = await subscribedDevice()
    mocks.delete.mockResolvedValue({})
    sub.unsubscribe.mockResolvedValue(false)
    let outcome
    await act(async () => { outcome = await result.current.unsubscribe() })
    expect(outcome).toBe('failed')
    expect(result.current.pushEnabled).toBe(true)
  })

  it('reports off after both the server and browser confirm removal', async () => {
    const { result, sub, getSubscription } = await subscribedDevice()
    mocks.delete.mockResolvedValue({})
    sub.unsubscribe.mockImplementation(async () => {
      getSubscription.mockResolvedValue(null)
      return true
    })
    let outcome
    await act(async () => { outcome = await result.current.unsubscribe() })
    expect(outcome).toBe('unsubscribed')
    expect(result.current.pushEnabled).toBe(false)
    expect(mocks.delete).toHaveBeenCalledWith('/api/push/subscribe', { data: sub.toJSON() })
  })
})
