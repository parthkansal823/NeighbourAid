import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVolunteerSocket } from './useWebSocket'

vi.mock('../utils/runtime', () => ({ websocketOrigin: () => 'wss://app.example.test' }))
let sockets
beforeEach(() => {
  vi.useFakeTimers()
  sockets = []
  class Socket {
    static OPEN = 1
    readyState = 0
    send = vi.fn()
    close = vi.fn()
    constructor(url) { this.url = url; sockets.push(this) }
    open() { this.readyState = 1; this.onopen?.() }
  }
  vi.stubGlobal('WebSocket', Socket)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('volunteer socket session isolation', () => {
  it('ignores an old socket closing after the next account has connected', () => {
    const onStatus = vi.fn()
    const { rerender } = renderHook((props) => useVolunteerSocket(props), {
      initialProps: { token: 'old-token', coordinates: [76, 30], onStatus },
    })
    act(() => sockets[0].open())
    rerender({ token: 'new-token', coordinates: [76, 30], onStatus })
    act(() => sockets[1].open())
    onStatus.mockClear()
    act(() => sockets[0].onclose({ code: 1000 }))
    expect(onStatus).not.toHaveBeenCalled()
    rerender({ token: 'new-token', coordinates: [77, 31], onStatus })
    expect(sockets[1].send).toHaveBeenLastCalledWith(JSON.stringify({ coordinates: [77, 31] }))
  })

  it('never forwards a previous account frame to the current account callback', () => {
    const onAlert = vi.fn()
    const { rerender } = renderHook((props) => useVolunteerSocket(props), {
      initialProps: { token: 'old-token', coordinates: [76, 30], onAlert },
    })
    act(() => sockets[0].open())
    rerender({ token: 'new-token', coordinates: [76, 30], onAlert })
    act(() => sockets[1].open())
    act(() => sockets[0].onmessage({ data: JSON.stringify({ id: 'old-account-alert' }) }))
    expect(onAlert).not.toHaveBeenCalled()
    act(() => sockets[1].onmessage({ data: JSON.stringify({ id: 'current-account-alert' }) }))
    expect(onAlert).toHaveBeenCalledWith({ id: 'current-account-alert' })
  })

  it('ignores a stale open callback after logout', () => {
    const onStatus = vi.fn()
    const { rerender } = renderHook((props) => useVolunteerSocket(props), {
      initialProps: { token: 'old-token', coordinates: [76, 30], onStatus },
    })
    rerender({ token: null, coordinates: [76, 30], onStatus })
    onStatus.mockClear()
    act(() => sockets[0].open())
    expect(onStatus).not.toHaveBeenCalled()
    expect(sockets[0].send).not.toHaveBeenCalled()
  })

  it('still reconnects the active session after an unexpected close', () => {
    const { unmount } = renderHook(() => useVolunteerSocket({ token: 'token', coordinates: [76, 30] }))
    act(() => sockets[0].open())
    act(() => sockets[0].onclose({ code: 1006 }))
    act(() => vi.advanceTimersByTime(3000))
    expect(sockets).toHaveLength(2)
    unmount()
    act(() => vi.advanceTimersByTime(6000))
    expect(sockets).toHaveLength(2)
  })

  it.each([1000, 4001, 4003])('does not reconnect after a deliberate/auth close (%s)', (code) => {
    renderHook(() => useVolunteerSocket({ token: 'token', coordinates: [76, 30] }))
    act(() => sockets[0].onclose({ code }))
    act(() => vi.advanceTimersByTime(6000))
    expect(sockets).toHaveLength(1)
  })
})
