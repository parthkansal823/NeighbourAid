import { useEffect, useState } from 'react'
import { isNativeApp } from '../utils/runtime'
import { latestAppUpdate } from '../utils/appUpdate'
import { useI18n } from '../utils/i18n'

const CHECK_INTERVAL = 4 * 60 * 60 * 1000
const DISMISSED_KEY = 'neighbouraid-dismissed-release'

export default function AppUpdateNotice() {
  const { t } = useI18n()
  const [update, setUpdate] = useState(null)
  useEffect(() => {
    if (!isNativeApp() || import.meta.env.MODE === 'demo') return undefined
    let active = true
    let busy = false
    let lastChecked = -CHECK_INTERVAL
    const check = async () => {
      if (busy || !navigator.onLine || document.visibilityState === 'hidden' || Date.now() - lastChecked < CHECK_INTERVAL) return
      busy = true
      lastChecked = Date.now()
      try {
        const release = await latestAppUpdate(__APP_BUILD__.versionCode)
        let dismissed = false
        try { dismissed = localStorage.getItem(DISMISSED_KEY) === String(release?.versionCode) } catch { /* Private storage can be unavailable. */ }
        if (active) setUpdate(dismissed ? null : release)
      } catch {
        // An unavailable update service must not hide or block emergency actions.
        lastChecked = -CHECK_INTERVAL
      } finally {
        busy = false
      }
    }
    const onVisible = () => { void check() }
    void check()
    const timer = setInterval(onVisible, CHECK_INTERVAL)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [])

  if (!update) return null
  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, String(update.versionCode)) } catch { /* Dismiss still works for this session. */ }
    setUpdate(null)
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
          </details>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a href={update.downloadUrl} target="_blank" rel="noopener noreferrer" className="tap flex items-center rounded-lg bg-orange-500 px-3 text-sm font-medium text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400">{t('app_update_download')}</a>
          <button type="button" onClick={dismiss} className="tap rounded-lg px-3 text-sm text-gray-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400">{t('app_update_later')}</button>
        </div>
      </div>
    </aside>
  )
}
