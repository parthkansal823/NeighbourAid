import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { UPDATE_CHECK_EVENT, UPDATE_RESULT_EVENT } from '../utils/androidUpdate'
import { isNativeApp } from '../utils/runtime'
import { latestAppUpdate } from '../utils/appUpdate'
import { hasReleaseUpdateChannel } from '../utils/updateChannel'
import { useI18n } from '../utils/i18n'
import { listenForUpdateTap, notifyAppUpdate } from '../utils/updateNotification'
import AndroidUpdateAction from './AndroidUpdateAction'
import { RefreshCw, X } from './icons'
import { lockDialogScroll, registerDialogDismissal } from '../utils/androidBack'

const CHECK_INTERVAL = 4 * 60 * 60 * 1000
const DISMISSED_KEY = 'neighbouraid-dismissed-release'

export default function AppUpdateNotice() {
  const { lang, t } = useI18n()
  const { pathname } = useLocation()
  const [update, setUpdate] = useState(null)
  const dialogRef = useRef(null)
  const dismiss = useCallback(() => {
    if (!update) return
    try { localStorage.setItem(DISMISSED_KEY, String(update.versionCode)) } catch { /* Dismiss still works for this session. */ }
    setUpdate(null)
  }, [update])

  // Treat the release prompt like a proper app screen: it takes focus while
  // it is open, can be dismissed with Escape, and never strands keyboard
  // focus behind the overlay.
  useEffect(() => {
    if (!update || pathname === '/post-alert') return undefined
    const previousFocus = document.activeElement
    const unlock = lockDialogScroll()
    const dismissal = registerDialogDismissal(() => dialogRef.current, dismiss)
    const focusDialog = () => {
      const primaryAction = dialogRef.current?.querySelector('[data-update-primary]')
      ;(primaryAction || dialogRef.current)?.focus()
    }
    const timer = window.setTimeout(focusDialog, 0)
    const onKeyDown = event => {
      if (!dismissal.isTop()) return
      if (event.key === 'Escape') {
        event.preventDefault()
        dismiss()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKeyDown)
      const top = dismissal.isTop()
      dismissal.remove()
      unlock()
      if (top && previousFocus?.isConnected) previousFocus.focus()
    }
  }, [dismiss, update, pathname])

  useEffect(() => {
    if (!isNativeApp() || import.meta.env.MODE === 'demo' || !hasReleaseUpdateChannel()) return undefined
    let active = true
    let busy = false
    let lastChecked = -CHECK_INTERVAL
    let listener
    let manualRequested = false
    void listenForUpdateTap().then((handle) => {
      if (active) listener = handle
      else void handle?.remove()
    }).catch(() => {})
    const result = (state, release = null) => window.dispatchEvent(new CustomEvent(UPDATE_RESULT_EVENT, { detail: { state, update: release } }))
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
        if (active && manualCheck) result(release ? 'found' : 'none', release)
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
  // A release must not interrupt an emergency draft. It remains available
  // on the update screen and will prompt after leaving the report form.
  if (pathname === '/post-alert') return null
  return (
    <div className="app-update-prompt-layer" role="presentation">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="app-update-prompt-title" aria-describedby="app-update-prompt-description" tabIndex="-1" className="app-update-prompt">
        <div className="app-update-prompt-topline">
          <span className="text-sm font-semibold text-app-ink">NeighbourAid</span>
          <button type="button" onClick={dismiss} className="tap app-update-prompt-close" aria-label={lang === 'hi' ? 'अपडेट स्क्रीन बंद करें' : 'Close update prompt'} title={t('app_update_later')}><X className="h-5 w-5" aria-hidden /></button>
        </div>

        <div className="app-update-prompt-main">
          <div className="app-update-prompt-icon" aria-hidden><RefreshCw className="h-5 w-5" /></div>
          <h1 id="app-update-prompt-title" className="app-update-prompt-title">{t('app_update_title')}</h1>
          <p id="app-update-prompt-description" className="app-update-prompt-copy">{t('app_update_body').replace('{version}', update.versionName)}</p>

          <div className="app-update-prompt-version">
            <span className="app-update-prompt-version-label">{lang === 'hi' ? 'नया संस्करण' : 'New version'}</span>
            <strong>{update.versionName}</strong>
          </div>

          <div className="app-update-prompt-action">
            <AndroidUpdateAction update={update} autoFocus />
          </div>
        </div>

        <div className="app-update-prompt-footer">
          <Link to="/app-updates" onClick={() => setUpdate(null)} className="tap app-update-prompt-details" aria-label={lang === 'hi' ? 'अपडेट की जानकारी देखें' : 'View update details'}>
            {t('app_update_details')}
          </Link>
          <button type="button" onClick={dismiss} className="tap app-update-prompt-later">{t('app_update_later')}</button>
        </div>
      </section>
    </div>
  )
}
