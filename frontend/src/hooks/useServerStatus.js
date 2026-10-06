import { useEffect, useState } from 'react'
import axios from 'axios'
import { apiUrl } from '../utils/runtime'

/**
 * Is the backend actually up?
 *
 * This deployment runs the API on a laptop that is only switched on for a
 * demo, while the frontend sits on Cloudflare permanently. So "the page
 * loaded" says nothing about whether anything behind it is running, and the
 * app had no way to tell the difference.
 *
 * What it did instead: `navigator.onLine` is true whenever the BROWSER has
 * internet, which it does — the server being off is invisible to it. Every
 * page would fire its request, wait out the 20s axios timeout, and show its
 * own error. Several pages doing that at once reads as a broken app rather
 * than a server that is simply not on right now.
 *
 * Deliberately NOT the shared `api` client:
 *   - that carries a 20s timeout, which is the delay this exists to avoid;
 *   - its 401 interceptor logs the user out, and a probe firing while the
 *     server is down must never do that.
 *
 * The edge Worker answers 503 with `X-Edge-Status: origin-offline` when it
 * cannot reach the tunnel, which separates "the laptop is off" from "the
 * laptop is on and unhealthy". Both show as offline, but only the first is
 * the normal state worth a calm message.
 */

const PROBE_TIMEOUT_MS = 4000

// Poll faster while down than while up: the moment that matters is the one
// where someone starts the server and wants the page to come alive without
// being told to refresh. While it is up, there is nothing to watch for.
const POLL_WHEN_UP_MS = 60000
const POLL_WHEN_DOWN_MS = 5000

export const SERVER_STATUS_EVENT = 'server-status:changed'

export async function probeServer() {
  try {
    const res = await axios.get(apiUrl('/health'), {
      timeout: PROBE_TIMEOUT_MS,
      // A cached 200 from a previous session would report a server that is
      // no longer running.
      headers: { 'Cache-Control': 'no-cache' },
      // Any status is a real answer about reachability; only a thrown
      // request means nothing is listening.
      validateStatus: () => true,
    })
    if (res.status === 200) return { state: 'online' }
    return {
      state: 'offline',
      edgeReported: res.headers?.['x-edge-status'] === 'origin-offline',
    }
  } catch {
    return { state: 'offline', edgeReported: false }
  }
}

export function useServerStatus() {
  // Starts as 'checking' rather than 'offline' so a slow first probe does
  // not flash a scary banner at someone whose server is perfectly fine.
  const [status, setStatus] = useState({ state: 'checking', edgeReported: false })

  useEffect(() => {
    let cancelled = false
    let timer

    const tick = async () => {
      const next = await probeServer()
      if (cancelled) return
      setStatus((prev) => {
        if (prev.state !== next.state) {
          window.dispatchEvent(
            new CustomEvent(SERVER_STATUS_EVENT, { detail: next })
          )
        }
        return next
      })
      timer = setTimeout(
        tick,
        next.state === 'online' ? POLL_WHEN_UP_MS : POLL_WHEN_DOWN_MS
      )
    }

    tick()

    // Coming back from a closed laptop or a tab left open overnight: check
    // immediately rather than waiting out whatever remained of the interval.
    const onWake = () => {
      if (document.visibilityState === 'visible') {
        clearTimeout(timer)
        tick()
      }
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('online', onWake)

    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('online', onWake)
    }
  }, [])

  return status
}
