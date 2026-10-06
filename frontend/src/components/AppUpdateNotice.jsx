import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import AndroidUpdateAction from './AndroidUpdateAction'
import { UPDATE_CHECK_EVENT, UPDATE_RESULT_EVENT } from '../utils/androidUpdate'
import { isNativeApp } from '../utils/runtime'
import { latestAppUpdate } from '../utils/appUpdate'
import { useI18n } from '../utils/i18n'
import { enableUpdateNotifications, listenForUpdateTap, notifyAppUpdate, openAppUpdate } from '../utils/updateNotification'

const CHECK_INTERVAL = 4 * 60 * 60 * 1000
const DISMISSED_KEY = 'neighbouraid-dismissed-release'

export default function AppUpdateNotice() {
  const { t } = useI18n()
  const [update, setUpdate] = useState(null)
  const [message, setMessage] = useState('')
  const [downloading, setDownloading] = useState(false)
  useEffect(() => {
    if (!isNativeApp() || import.meta.env.MODE === 'demo') return undefined
    let active = true
    let busy = false
    let lastChecked = -CHECK_INTERVAL
    let listener
    let manualRequested = false
    void listenForUpdateTap().then((handle) => {
      if (active) listener = handle
      else void handle?.remove()
    }).catch(() => {})
    const result = state => window.dispatchEvent(new CustomEvent(UPDATE_RESULT_EVENT, { detail: state }))
    const check = async (manual = false) => {
      if (manual) manualRequested = true
      if (!navigator.onLine) {
        if (manualRequested) { manualRequested = false; result('unavailable') }
        return
      }
      if (busy || document.visibilityState === 'hidden' || (!manualRequested && Date.now() - lastChecked < CHECK_INTERVAL)) return
      busy = true
      lastChecked = Date.now()
      try {
        const release = await latestAppUpdate(__APP_BUILD__.versionCode, fetch, { reportUnavailable: true })
        const manualCheck = manualRequested
        manualRequested = false
        let dismissed = false
        try { dismissed = !manualCheck && localStorage.getItem(DISMISSED_KEY) === String(release?.versionCode) } catch { /* Private storage can be unavailable. */ }
        if (active && manualCheck) result(release ? 'found' : 'none')
        if (active) setUpdate(dismissed ? null : release)
        if (active && release && !dismissed) {
          await notifyAppUpdate(release, t('app_update_title'), release.versionName).catch(() => {})
        }
      } catch {
        // An unavailable update service must not hide or block emergency actions.
        lastChecked = -CHECK_INTERVAL
        if (active && manualRequested) { manualRequested = false; result('unavailable') }
      } finally {
        busy = false
      }
    }
    const onVisible = () => { void check() }
    const onManual = () => { void check(true) }
    void check()
    const timer = setInterval(onVisible, CHECK_INTERVAL)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    window.addEventListener(UPDATE_CHECK_EVENT, onManual)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
      window.removeEventListener(UPDATE_CHECK_EVENT, onManual)
      void listener?.remove()
    }
  }, [t])

  if (!update) return null
  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, String(update.versionCode)) } catch { /* Dismiss still works for this session. */ }
    setUpdate(null)
  }
  const download = async (event) => {
    event.preventDefault()
    if (downloading) return
    setDownloading(true)
    setMessage('')
    try {
      if (!await openAppUpdate(update.downloadUrl)) setMessage(t('app_update_open_error'))
    } catch { setMessage(t('app_update_open_error')) }
    finally { setDownloading(false) }
  }
  const enable = async () => {
    try {
      const granted = await enableUpdateNotifications()
      setMessage(t(granted ? 'app_update_notifications_on' : 'app_update_notifications_off'))
      if (granted) await notifyAppUpdate(update, t('app_update_title'), update.versionName)
    } catch { setMessage(t('app_update_notifications_off')) }
  }
  return (
    <aside aria-label={t('app_update_title')} className="app-update-notice border-b border-orange-500/30 bg-black px-4 py-3 text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
        <div role="status" className="max-w-2xl">
          <p className="text-sm font-medium">{t('app_update_title')}</p>
          <p className="mt-0.5 text-xs text-gray-300">{update.versionName}</p>
          <details className="mt-1 text-xs leading-relaxed text-gray-300">
            <summary className="flex min-h-11 cursor-pointer items-center text-orange-300">{t('app_update_details')}</summary>
            <p>{t('app_update_body').replace('{version}', update.versionName)}</p>
            {__APP_BUILD__.channel !== 'release' && <p className="mt-1 text-orange-300">{t('app_update_debug')}</p>}
            <button type="button" onClick={enable} className="tap text-orange-300">{t('app_update_enable_notifications')}</button>
          </details>
          {message && <p role="alert" className="mt-1 text-xs text-orange-300">{message}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {Capacitor.getPlatform() === 'android' ? <AndroidUpdateAction key={update.versionCode} update={update} /> : <a href={update.downloadUrl} onClick={download} aria-disabled={downloading} target="_blank" rel="noopener noreferrer" className="tap flex items-center rounded-lg bg-orange-500 px-3 text-sm font-medium text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400">{t('app_update_download')}</a>}
          <button type="button" onClick={dismiss} className="tap rounded-lg px-3 text-sm text-gray-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400">{t('app_update_later')}</button>
        </div>
      </div>
    </aside>
  )
}
