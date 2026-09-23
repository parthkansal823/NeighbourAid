/* NeighbourAid service worker
 *
 * Minimal offline strategy:
 *   - Pre-cache the shell on install.
 *   - Cache-first for static assets (/assets/...).
 *   - Network-first for API + WS (never cache live crisis data stale).
 *
 * Also handles `notificationclick` so a volunteer tapping a background
 * alert notification is routed straight to /volunteer (or the specific
 * alert if a URL was provided in the notification payload). Surviving
 * reloads is why we push through the SW instead of `new Notification()`.
 */

const CACHE = 'neighbouraid-v2'
const CORE = ['/', '/index.html', '/favicon.svg', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(CORE).catch(() => undefined))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Never cache API or WebSocket calls — they must be fresh.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return

  // Same-origin static assets: cache-first.
  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const clone = res.clone()
            caches.open(CACHE).then((c) => c.put(req, clone))
            return res
          })
      )
    )
    return
  }

  // Shell / navigations: network-first, falling back to cached index.html.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    )
  }
})

// Web push. Fires with the tab closed, which is the entire reason this
// exists — `useNotifications` can only reach someone already looking at the
// app, and a crisis app is not something people sit with.
//
// The payload is encrypted end to end (RFC 8291) and decrypted by the
// browser before it gets here; see backend/app/services/push.py.
self.addEventListener('push', (event) => {
  // A push with no data is legal and some services send one to keep a
  // subscription warm. Showing an empty notification would be worse than
  // showing nothing, but a subscription that never displays anything can be
  // revoked by the browser — so this shows a generic line rather than
  // silently returning.
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    /* not JSON — fall through to the generic notification */
  }

  const urgency = (data.urgency || 'MEDIUM').toUpperCase()
  const critical = urgency === 'CRITICAL'

  event.waitUntil(
    self.registration.showNotification(data.title || 'NeighbourAid alert', {
      body: [data.body, data.where].filter(Boolean).join(' · ') || 'Tap to open',
      // Both exist at the web root beside the manifest. The manifest has
      // referenced icon-192 since it was written; the file itself was only
      // added with this feature, which is also why "Add to home screen"
      // never appeared on Android — Chrome wants a >=192px PNG first.
      icon: '/icon-192.png',
      badge: '/badge-72.png',
      // Tagging by alert id means a re-push of the SAME alert replaces its
      // notification instead of stacking a second one. During a flood the
      // difference is one line in the shade versus twenty.
      tag: data.id ? `alert-${data.id}` : 'neighbouraid',
      // ...but a replacement should still buzz when it is critical, or the
      // tag would silently swallow the update that mattered.
      renotify: critical,
      // Only CRITICAL stays on screen until it is dealt with. Applying this
      // to everything is how a notification tray becomes something people
      // clear without reading.
      requireInteraction: critical,
      vibrate: critical ? [200, 100, 200, 100, 200] : [100],
      data: { alertId: data.id, urgency, category: data.category },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  // Prefer the alert's share URL when one was supplied in the payload, so
  // volunteers land directly on the alert. Otherwise open the volunteer feed.
  const target = data.url || (data.alertId ? `/alert/${data.alertId}` : '/volunteer')
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of allClients) {
        try {
          const clientUrl = new URL(client.url)
          if (clientUrl.origin === self.location.origin) {
            await client.focus()
            client.postMessage({ type: 'notification-click', target, data })
            return
          }
        } catch {
          /* ignore bad URLs */
        }
      }
      await self.clients.openWindow(target)
    })()
  )
})
