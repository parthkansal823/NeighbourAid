import { useEffect, useRef } from 'react'
import { useLatest } from './useLatest'
import { websocketOrigin } from '../utils/runtime'

/**
 * Volunteer WebSocket client.
 *
 * Connects once per token, then streams coordinate updates over the same
 * socket as the volunteer moves. Backend accepts `{coordinates:[lng,lat]}`
 * frames and re-registers the volunteer's position without needing a full
 * reconnect — this saves a TLS handshake every GPS tick.
 *
 * Auto-reconnects with a small backoff on unexpected close.
 */
export function useVolunteerSocket({ token, coordinates, onAlert, onStatus }) {
  const wsRef = useRef(null)
  const retryRef = useRef(null)
  // These are read from socket callbacks, never during render, so tracking
  // the last committed value is exactly right.
  const onAlertRef = useLatest(onAlert)
  const onStatusRef = useLatest(onStatus)
  const coordsRef = useLatest(coordinates)

  // Connect once per token. Coords live in a ref so we can pick them up at
  // onopen time without re-running this effect on every move.
  useEffect(() => {
    // The standalone demo has a memory-only API and no websocket server.
    // Treat it as connected so the full volunteer view stays demonstrable
    // without repeatedly attempting a real network connection.
    if (import.meta.env.MODE === 'demo') {
      onStatusRef.current?.('open')
      return undefined
    }
    if (!token) return undefined

    let closedByCleanup = false

    const connect = () => {
      if (!coordsRef.current) {
        // No GPS fix yet — retry shortly without opening a socket we'd
        // have to close right after.
        retryRef.current = setTimeout(connect, 1000)
        return
      }
      onStatusRef.current?.('connecting')
      const ws = new WebSocket(`${websocketOrigin()}/ws/volunteer?token=${token}`)
      wsRef.current = ws

      ws.onopen = () => {
        if (closedByCleanup || wsRef.current !== ws) return
        const [lng, lat] = coordsRef.current
        ws.send(JSON.stringify({ coordinates: [lng, lat] }))
        onStatusRef.current?.('open')
      }

      ws.onmessage = (e) => {
        // Closing a socket is asynchronous. A delayed frame from a previous
        // login must not reach the next account's current callback.
        if (closedByCleanup || wsRef.current !== ws) return
        try {
          onAlertRef.current?.(JSON.parse(e.data))
        } catch {
          /* ignore malformed frames */
        }
      }

      ws.onerror = () => {
        // Let onclose handle retry
      }

      ws.onclose = (e) => {
        if (closedByCleanup || wsRef.current !== ws) return
        onStatusRef.current?.('closed')
        wsRef.current = null
        if (e.code === 1000 || e.code === 4001 || e.code === 4003) return
        retryRef.current = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      closedByCleanup = true
      clearTimeout(retryRef.current)
      wsRef.current?.close(1000)
      wsRef.current = null
    }
    // The three *Ref values are stable useRef containers; including them
    // keeps exhaustive-deps satisfied without reconnecting the socket.
  }, [token, coordsRef, onAlertRef, onStatusRef])

  // Push coord updates over the existing socket as the volunteer moves.
  // If the socket isn't open yet, we drop the update — the next onopen
  // will pick up coordsRef.current anyway.
  const lng = coordinates?.[0]
  const lat = coordinates?.[1]
  useEffect(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    if (lng === undefined || lat === undefined) return
    try {
      ws.send(JSON.stringify({ coordinates: [lng, lat] }))
    } catch {
      /* socket went away between check and send — ignore */
    }
  }, [lng, lat])
}
