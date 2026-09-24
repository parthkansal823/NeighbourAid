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

/* ---- Background Sync: deliver queued alerts with no tab open ----------
 *
 * Mirrors the IndexedDB layout in src/utils/offlineQueue.js. The worker
 * cannot import from the bundle, so the names below are duplicated and
 * the two must be changed together.
 *
 * Only rows flagged `anonymous` are sent. Everything else needs a bearer
 * token out of localStorage, which a worker has no access to, so those
 * rows are left for a tab to flush exactly as before.
 */
const QUEUE_DB = 'neighbouraid-offline'
const QUEUE_STORE = 'pending-alerts'
const SYNC_TAG = 'neighbouraid-alert-queue'
const ANON_ENDPOINT = '/api/alerts/anonymous'

function openQueue() {
  return new Promise((resolve, reject) => {
    // The page owns this schema, and the worker must not create it.
    // `open()` with no version CREATES the database at version 1 when it
    // is absent -- with no object store. The page then opens at version 1
    // too, finds that version already current, never gets
    // `onupgradeneeded`, and so never creates `pending-alerts`. The queue
    // would be permanently and silently broken.
    //
    // Reachable whenever a sync registered in an earlier session fires
    // after the user has cleared site data, before any page has loaded.
    // So: if the upgrade handler runs at all, this worker just created an
    // empty database that should not exist -- throw it away and report
    // nothing to flush.
    let created = false
    const req = indexedDB.open(QUEUE_DB)
    req.onupgradeneeded = () => {
      created = true
    }
    req.onsuccess = () => {
      if (created) {
        req.result.close()
        indexedDB.deleteDatabase(QUEUE_DB)
        return resolve(null)
      }
      resolve(req.result)
    }
    req.onerror = () => reject(req.error)
  })
}

function queueRows(db) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(QUEUE_STORE)) return resolve([])
    const req = db.transaction(QUEUE_STORE, 'readonly')
      .objectStore(QUEUE_STORE)
      .getAll()
    req.onsuccess = () => resolve(req.result || [])
    req.onerror = () => reject(req.error)
  })
}

function dropRow(db, id) {
  return new Promise((resolve) => {
    if (!db.objectStoreNames.contains(QUEUE_STORE)) return resolve()
    const req = db.transaction(QUEUE_STORE, 'readwrite')
      .objectStore(QUEUE_STORE)
      .delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => resolve()
  })
}

async function flushAnonymousQueue() {
  // A visible tab has its own `online` listener and will flush this same
  // store. Standing down is how the two avoid posting the same alert
  // twice; the worker is here for the case where no tab is left.
  const clients = await self.clients.matchAll({ type: 'window' })
  if (clients.some((c) => c.visibilityState === 'visible')) return

  const db = await openQueue()
  if (!db) return
  const rows = await queueRows(db)

  for (const row of rows) {
    if (row.anonymous !== true) continue
    const res = await fetch(ANON_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(row.payload),
    })
    // 4xx means this payload will never be accepted -- a rate limit or a
    // rejected body -- so the row goes rather than being retried forever.
    // A 5xx or a thrown fetch keeps it, and throwing lets the browser
    // retry the whole sync later with its own backoff.
    if (res.ok || (res.status >= 400 && res.status < 500)) {
      await dropRow(db, row.id)
    } else {
      throw new Error('alert delivery failed: ' + res.status)
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return
  event.waitUntil(flushAnonymousQueue())
})
