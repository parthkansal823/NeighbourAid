import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}))

import { Capacitor } from '@capacitor/core'
import { apiOrigin, apiUrl, websocketOrigin } from './runtime'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false)
})

describe('native runtime routing', () => {
  it('keeps browser edge-proxy requests relative', () => {
    expect(apiOrigin()).toBe('')
    expect(apiUrl('/health')).toBe('/health')
  })

  it('routes a native build through the published Worker', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
    vi.stubEnv('VITE_MOBILE_EDGE_ORIGIN', 'https://neighbouraid.example.workers.dev/')

    expect(apiOrigin()).toBe('https://neighbouraid.example.workers.dev')
    expect(apiUrl('/api/stats/')).toBe('https://neighbouraid.example.workers.dev/api/stats/')
    expect(websocketOrigin()).toBe('wss://neighbouraid.example.workers.dev')
  })

  it('preserves an explicitly configured direct API and WebSocket origin', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test/')
    vi.stubEnv('VITE_WS_URL', 'wss://socket.example.test/')

    expect(apiOrigin()).toBe('https://api.example.test')
    expect(websocketOrigin()).toBe('wss://socket.example.test')
  })
})
