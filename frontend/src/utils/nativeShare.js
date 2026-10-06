import { Share } from '@capacitor/share'
import { isNativeApp } from './runtime'

export function publicAlertUrl(id) {
  // A native WebView's origin is localhost, not a link friends can open.
  const raw = isNativeApp()
    ? (import.meta.env.VITE_MOBILE_EDGE_ORIGIN || 'https://neighbouraid.kansalp-parth.workers.dev')
    : window.location.origin
  const base = new URL(raw)
  return new URL(`/alert/${encodeURIComponent(id || '')}`, base.origin).href
}

export async function nativeShareAlert(id) {
  if (!isNativeApp() || !(await Share.canShare()).value) return false
  // Share only the public link, not private contacts, exact coordinates or
  // the description in the recipient app's message preview.
  await Share.share({ title: 'NeighbourAid alert', url: publicAlertUrl(id), dialogTitle: 'Share alert link' })
  return true
}
