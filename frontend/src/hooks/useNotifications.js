import { useCallback, useEffect, useState } from 'react'

/**
 * Browser Notification API + Service Worker bridge.
 *
 * Two-tier strategy:
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

  useEffect(() => {
    // No `setPermission('unsupported')` here — the useState initializer above
    // already resolves that case, so this was a redundant synchronous setState
    // that forced an extra render on every mount.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(() => setSwReady(true))
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

  return { permission, request, notify, swReady }
}
