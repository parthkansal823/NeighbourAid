import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { AppLauncher } from '@capacitor/app-launcher'
import { isNativeApp } from './runtime'
import { trustedUpdateDownload } from './appUpdate'

const CHANNEL = 'app-updates'
const NOTIFIED = 'neighbouraid-notified-release'

export async function openAppUpdate(raw) {
  const url = trustedUpdateDownload(raw)
  if (!url || !isNativeApp()) return false
  const result = await AppLauncher.openUrl({ url })
  return result.completed
}

export async function enableUpdateNotifications() {
  if (!isNativeApp() || import.meta.env.MODE === 'demo') return false
  return (await LocalNotifications.requestPermissions()).display === 'granted'
}

export async function notifyAppUpdate(update, title, body) {
  if (!isNativeApp() || import.meta.env.MODE === 'demo' || !trustedUpdateDownload(update?.downloadUrl)) return false
  // No unsolicited OS permission prompt. The update bar offers an opt-in.
  if ((await LocalNotifications.checkPermissions()).display !== 'granted') return false
  try { if (localStorage.getItem(NOTIFIED) === String(update.versionCode)) return false } catch { /* best effort */ }
  if (Capacitor.getPlatform() === 'android') {
    await LocalNotifications.createChannel({ id: CHANNEL, name: title, importance: 3 })
  }
  await LocalNotifications.schedule({ notifications: [{
    id: 1900000001, title, body, channelId: CHANNEL,
    extra: { downloadUrl: update.downloadUrl },
  }] })
  try { localStorage.setItem(NOTIFIED, String(update.versionCode)) } catch { /* best effort */ }
  return true
}

export async function listenForUpdateTap() {
  if (!isNativeApp() || import.meta.env.MODE === 'demo') return null
  return LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
    if (event.notification?.id !== 1900000001) return
    // Notification extras are untrusted too; never launch an arbitrary URL.
    void openAppUpdate(event.notification.extra?.downloadUrl).catch(() => {})
  })
}
