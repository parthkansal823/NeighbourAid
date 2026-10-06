import { afterEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { probeServer } from './useServerStatus'

/**
 * The probe decides whether a visitor sees the app or a "server is off"
 * notice, so the cases that matter are the ones where it could get that
 * wrong in the reassuring direction — reporting online when nothing is
 * there.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('probeServer', () => {
  it('reports online when /health answers 200', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, headers: {} })
    expect(await probeServer()).toEqual({ state: 'online' })
  })

  it('reports offline when nothing is listening', async () => {
    // The laptop is off: the request never gets an answer and axios throws.
    vi.spyOn(axios, 'get').mockRejectedValue(new Error('Network Error'))
    expect(await probeServer()).toMatchObject({ state: 'offline' })
  })

  it('reports offline when the edge says it cannot reach the tunnel', async () => {
    vi.spyOn(axios, 'get').mockResolvedValue({
      status: 503,
      headers: { 'x-edge-status': 'origin-offline' },
    })
    expect(await probeServer()).toEqual({ state: 'offline', edgeReported: true })
  })

  it('treats a 5xx that is not the edge as offline but not edge-reported', async () => {
    // The laptop is on and answering, but unhealthy. Both are offline to a
    // visitor; only the first is the ordinary "not running right now".
    vi.spyOn(axios, 'get').mockResolvedValue({ status: 500, headers: {} })
    expect(await probeServer()).toEqual({ state: 'offline', edgeReported: false })
  })

  it('does not let a cached 200 report a server that has since stopped', async () => {
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, headers: {} })
    await probeServer()
    expect(get.mock.calls[0][1]).toMatchObject({
      headers: { 'Cache-Control': 'no-cache' },
    })
  })

  it('uses a short timeout, not the 20s one the shared client carries', async () => {
    // The whole point is to find out quickly. Inheriting the api client's
    // 20s timeout would mean 20s of spinner before the banner appeared.
    const get = vi.spyOn(axios, 'get').mockResolvedValue({ status: 200, headers: {} })
    await probeServer()
    expect(get.mock.calls[0][1].timeout).toBeLessThanOrEqual(5000)
  })

  it('never throws, whatever comes back', async () => {
    // It runs on an interval behind the UI; an unhandled rejection here
    // would surface as a console error on a page that looks fine.
    vi.spyOn(axios, 'get').mockRejectedValue({ weird: 'not an Error' })
    await expect(probeServer()).resolves.toMatchObject({ state: 'offline' })
  })
})
