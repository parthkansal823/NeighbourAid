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

const CACHE = 'neighbouraid-shell-v4'
const ASSET_CACHE = 'neighbouraid-assets-v4'
const ASSET_LIMIT = 80
const MAX_ASSET_BYTES = 5 * 1024 * 1024
const noStore = headers => /(?:^|,)\s*no-store\s*(?:,|$)/i.test(headers?.get('Cache-Control') || '')
const CORE = ['/', '/index.html', '/brand-logo.png', '/favicon-32.png', '/favicon-64.png', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/badge-72.png', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(CORE.map(async path => {
        try { const response = await fetch(path, { cache: 'reload' }); if (response.ok && response.type !== 'opaque' && !noStore(response.headers)) await c.put(path, response) } catch { /* One missing icon must not prevent offline shell install. */ }
      })))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => /^neighbouraid-(brand|shell|assets)-/.test(k) && k !== CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
})

// A new website version activates only after the user approves a safe reload.
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting())
})

async function cacheAsset(req, response) {
  if (!response.ok || response.type === 'opaque' || noStore(response.headers)) return
  if ((await response.clone().blob()).size > MAX_ASSET_BYTES) return
  const cache = await caches.open(ASSET_CACHE)
  await cache.put(req, response.clone())
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - ASSET_LIMIT)).map(key => cache.delete(key)))
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  if (url.origin !== self.location.origin || req.headers?.has('Authorization') || req.cache === 'no-store' || noStore(req.headers)) return

  // Never cache API or WebSocket calls — they must be fresh.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) return

  // These were pre-cached at install and must actually remain available
  // offline. HTML stays network-first; icons never contain live crisis data.
  if (CORE.includes(url.pathname) && !['/', '/index.html'].includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(req)).catch(() => undefined).then(hit => hit || fetch(req)))
    return
  }

  // Same-origin static assets: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(cache => cache.match(req)).catch(() => undefined).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            event.waitUntil(cacheAsset(req, res).catch(() => undefined))
            return res
          })
      )
    )
    return
  }

  // Shell / navigations: network-first, falling back to cached index.html.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(async response => {
        if (response.ok && response.headers.get('Content-Type')?.includes('text/html') && !noStore(response.headers)) {
          event.waitUntil(caches.open(CACHE).then(cache => cache.put('/index.html', response.clone())).catch(() => undefined))
        }
        if (response.status >= 500) return (await caches.open(CACHE).then(cache => cache.match('/index.html')).catch(() => null)) || response
        return response
      }).catch(async () => (await caches.open(CACHE).then(cache => cache.match('/index.html')).catch(() => null)) || new Response('NeighbourAid is offline and this screen is not saved yet. Reconnect and retry.', { status: 503, headers: { 'Content-Type': 'text/plain' } }))
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
  let target = '/volunteer'
  try {
    const candidate = new URL(data.url || (data.alertId ? `/alert/${encodeURIComponent(data.alertId)}` : '/volunteer'), self.location.origin)
    if (candidate.origin === self.location.origin && ['http:', 'https:'].includes(candidate.protocol)) target = `${candidate.pathname}${candidate.search}${candidate.hash}`
  } catch { /* External/untrusted notification targets cannot navigate away. */ }
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
const RECEIPT_STORE = 'delivery-receipts'
const SYNC_TAG = 'neighbouraid-alert-queue'
const QUEUE_LOCK = 'neighbouraid-alert-queue-flush'
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

function acknowledgeRow(db, row, receipt) {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(QUEUE_STORE)) return resolve()
    if (!db.objectStoreNames.contains(RECEIPT_STORE)) return reject(new Error('Open the app to upgrade receipt storage'))
    const tx = db.transaction([QUEUE_STORE, RECEIPT_STORE], 'readwrite')
    const receipts = tx.objectStore(RECEIPT_STORE)
    receipts.put({ id: row.payload.client_submission_id, anonymous: true, accountId: null,
      alertId: receipt.id, created_at: row.created_at, received_at: Date.now(), status: 'server_received' })
    const all = receipts.getAll()
    all.onsuccess = () => all.result.sort((a, b) => b.received_at - a.received_at).forEach((item, index) => {
      if (index >= 100 || item.received_at < Date.now() - 30 * 24 * 60 * 60 * 1000) receipts.delete(item.id)
    })
    tx.objectStore(QUEUE_STORE).delete(row.id)
    tx.oncomplete = () => resolve()
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Queue deletion failed'))
  })
}

function recordFailure(db, id, review) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    const store = tx.objectStore(QUEUE_STORE)
    const request = store.get(id)
    request.onsuccess = () => {
      const row = request.result
      if (row) store.put({ ...row, attempts: (row.attempts || 0) + 1, ...(review ? { deliveryState: 'needs_review' } : {}) })
    }
    tx.oncomplete = resolve
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not save retry state'))
  })
}

async function flushAnonymousQueue() {
  // Hidden tabs also flush. Let any open page own delivery; use the same
  // Web Lock as the page in case one opens while background sync is running.
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  if (clients.length) return

  const db = await openQueue()
  if (!db) return
  try {
    const rows = await queueRows(db)
    let failed = false
    for (const row of rows) {
      if (row.anonymous !== true || row.deliveryState === 'needs_review') continue
      let review = false
      try {
        // Legacy rows need the page's durable identity migration first.
        if (!row.payload.client_submission_id || !row.anonymousClientId) throw new Error('Open the app to prepare this saved report')
        const res = await fetch(ANON_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Anonymous-Client-ID': row.anonymousClientId },
          body: JSON.stringify(row.payload),
        })
        // 408/429 and auth/server failures can recover. Retain every rejected
        // report until confirmed delivery; keep trying other rows in this batch.
        if (!res.ok) {
          review = [400, 403, 404, 413, 415, 422].includes(res.status)
          if (res.status === 409) {
            let detail
            try { detail = await res.json() } catch { /* Unknown conflicts require review. */ }
            review = (detail?.detail?.code || detail?.code) !== 'SUBMISSION_PENDING'
          }
          throw new Error('alert delivery failed: ' + res.status)
        }
        const receipt = await res.json()
        if (typeof receipt?.id !== 'string' || !receipt.id) throw new Error('Server receipt is missing')
        await acknowledgeRow(db, row, receipt)
      } catch {
        failed = true
        await recordFailure(db, row.id, review).catch(() => {})
      }
    }
    if (failed) throw new Error('Some queued alerts still need delivery')
  } finally {
    db.close()
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return
  const locks = self.navigator?.locks
  event.waitUntil(locks?.request
    ? locks.request(QUEUE_LOCK, flushAnonymousQueue)
    : flushAnonymousQueue())
})
