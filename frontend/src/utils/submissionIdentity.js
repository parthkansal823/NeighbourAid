const ANONYMOUS_CLIENT_KEY = 'neighbouraid:anonymous-client'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
let anonymousClient

/** Secure opaque identities, never an account token or a location fingerprint. */
export function newSubmissionId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure submission identity is unavailable')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function getAnonymousClientId() {
  try {
    const saved = localStorage.getItem(ANONYMOUS_CLIENT_KEY)
    if (UUID.test(saved || '')) return saved
  } catch { /* A queued row also retains its own anonymous identity. */ }
  anonymousClient ||= newSubmissionId()
  try { localStorage.setItem(ANONYMOUS_CLIENT_KEY, anonymousClient) } catch { /* Storage can be disabled. */ }
  return anonymousClient
}
