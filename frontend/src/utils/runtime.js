import { Capacitor } from '@capacitor/core'

/**
 * A Capacitor app is not served from the public Worker origin. It runs from
 * the phone's local WebView origin, so relative /api and /ws URLs would be
 * sent to the phone itself. For native builds we use the public Worker URL;
 * it remains the only client-visible origin and keeps the changing tunnel
 * address plus EDGE_SECRET on the server side.
 */
function withoutTrailingSlash(value) {
  return value ? value.replace(/\/+$/, '') : ''
}

export function isNativeApp() {
  return Capacitor.isNativePlatform()
}

export function apiOrigin() {
  if (import.meta.env.VITE_API_URL) {
    return withoutTrailingSlash(import.meta.env.VITE_API_URL)
  }
  if (isNativeApp() && import.meta.env.VITE_MOBILE_EDGE_ORIGIN) {
    return withoutTrailingSlash(import.meta.env.VITE_MOBILE_EDGE_ORIGIN)
  }
  return ''
}

export function apiUrl(path) {
  return `${apiOrigin()}${path}`
}

export function websocketOrigin() {
  if (import.meta.env.VITE_WS_URL) {
    return withoutTrailingSlash(import.meta.env.VITE_WS_URL)
  }

  const origin = apiOrigin()
  if (origin) {
    const url = new URL(origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.origin
  }

  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}`
}
