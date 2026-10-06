import { useCallback, useEffect, useState } from 'react'

import api from '../utils/api'

/**
 * Browser Notification API + Service Worker bridge.
 *
 * Three tiers now, and the third is the one that matters:
 *   `notify()` below can only reach someone with the app open. `subscribe()`
 *   registers the device with a push service, so the backend can reach a
 *   volunteer whose tab is closed and whose phone is in their pocket. That
 *   is most volunteers, most of the time — see backend/app/services/push.py.
 *
 * Two-tier strategy for the in-app half:
 *   1. When the tab is visible, notifications are redundant (toasts do the
 *      work better) — we suppress native popups to avoid doubling up.
 *   2. When the tab is hidden, we prefer the Service Worker's
 *      `registration.showNotification` because it persists across tab
 *      reloads, supports action buttons (Open / Dismiss), and survives
 *      the JS context being discarded. If no SW is registered we fall
 *      back to `new Notification()` — still works, just no actions.
 *
 * Click handling: the SW listens for `notificationclick` events (see
 * /service-worker.js) and posts a message back to any focused tab to
 * route to the alert. From here we also attach an onclick that refocuses
 * the tab and runs the provided callback.
 */
export function useNotifications() {
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  )
  const [swReady, setSwReady] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const pushSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window

  useEffect(() => {
    // No `setPermission('unsupported')` here — the useState initializer above
    // already resolves that case, so this was a redundant synchronous setState
    // that forced an extra render on every mount.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(async (reg) => {
          setSwReady(true)
          // Reflect what the browser already holds. Without this the toggle
          // reads "off" on every reload for someone who subscribed weeks ago,
          // and tapping it re-subscribes an endpoint that already exists.
          if ('PushManager' in window) {
            const sub = await reg.pushManager.getSubscription()
            setPushEnabled(!!sub)
          }
        })
        .catch(() => setSwReady(false))
    }
  }, [])

  const request = useCallback(async () => {
    if (typeof Notification === 'undefined') return 'unsupported'
    if (Notification.permission !== 'default') {
      setPermission(Notification.permission)
      return Notification.permission
    }
    try {
      const result = await Notification.requestPermission()
      setPermission(result)
      return result
    } catch {
      setPermission('denied')
      return 'denied'
    }
  }, [])

  const notify = useCallback(
    async ({ title, body, tag, data, onClick, requireInteraction = false }) => {
      if (typeof Notification === 'undefined') return
      if (Notification.permission !== 'granted') return
      if (document.visibilityState === 'visible') return

      const options = {
        body,
        tag,
        icon: '/favicon.svg',
        badge: '/favicon.svg',
        silent: false,
        renotify: true,
        requireInteraction,
        data: data || {},
        // Actions only render through the SW path. Keep them minimal —
        // "Open" + implicit dismiss is all a volunteer needs mid-alert.
        actions: [{ action: 'open', title: 'Open alert' }],
      }

      try {
        if (swReady && 'serviceWorker' in navigator) {
          const reg = await navigator.serviceWorker.ready
          await reg.showNotification(title, options)
          return
        }
        const n = new Notification(title, options)
        if (onClick) {
          n.onclick = () => {
            window.focus()
            onClick()
            n.close()
          }
        }
      } catch {
        /* browser blocked or not supported — drop silently */
      }
    },
    [swReady]
  )

  // --- Web push -------------------------------------------------------

  // `applicationServerKey` must be a Uint8Array of the raw P-256 point, not
  // the base64 string the server sends. Browsers reject the string with a
  // DOMException whose message says nothing about encoding, so this is the
  // step that silently costs an afternoon.
  const decodeKey = (base64) => {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
      .replace(/-/g, '+')
      .replace(/_/g, '/')
    const raw = atob(padded)
    return Uint8Array.from(raw, (c) => c.charCodeAt(0))
  }

  /**
   * Register this device for push. Returns 'subscribed', or a reason.
   *
   * Idempotent: an existing subscription is re-sent to the server rather
   * than replaced. Browsers keep a subscription across reloads, so calling
   * this on every mount would otherwise churn a new endpoint each time and
   * leave the old rows to be pruned the hard way — by failing to deliver.
   */
  const subscribe = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      return 'unsupported'
    }
    if (Notification.permission !== 'granted') {
      const result = await request()
      if (result !== 'granted') return result
    }

    try {
      // Asked before subscribing so a deployment with push switched off
      // never prompts — the 503 is how the client learns it is off.
      const { data } = await api.get('/api/push/key')
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      const sub =
        existing ||
        (await reg.pushManager.subscribe({
          // Required by every current browser: a push that cannot be shown
          // to the user is not allowed to be delivered silently.
          userVisibleOnly: true,
          applicationServerKey: decodeKey(data.public_key),
        }))
      await api.post('/api/push/subscribe', sub.toJSON())
      setPushEnabled(true)
      return 'subscribed'
    } catch (err) {
      if (err?.response?.status === 503) return 'not-configured'
      return 'failed'
    }
  }, [request])

  /** Unregister this device, both sides. */
  const unsubscribe = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!sub) {
        setPushEnabled(false)
        return
      }
      // Server first: if the local unsubscribe succeeds and the request
      // then fails, the server keeps pushing to an endpoint the browser has
      // already thrown away, and the only cure is waiting for a 410.
      await api.delete('/api/push/subscribe', { data: sub.toJSON() })
      await sub.unsubscribe()
    } catch {
      /* best effort — a dead subscription is pruned on its next 404/410 */
    } finally {
      setPushEnabled(false)
    }
  }, [])

  return {
    permission,
    request,
    notify,
    swReady,
    pushEnabled,
    pushSupported,
    subscribe,
    unsubscribe,
  }
}
