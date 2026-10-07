import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { UPDATE_CHECK_EVENT, UPDATE_RESULT_EVENT } from '../utils/androidUpdate'
import { isNativeApp } from '../utils/runtime'
import { latestAppUpdate } from '../utils/appUpdate'
import { useI18n } from '../utils/i18n'
import { listenForUpdateTap, notifyAppUpdate } from '../utils/updateNotification'
import AndroidUpdateAction from './AndroidUpdateAction'
import { ArrowRight, Download, RefreshCw, ShieldCheck, X } from './icons'

const CHECK_INTERVAL = 4 * 60 * 60 * 1000
const DISMISSED_KEY = 'neighbouraid-dismissed-release'

export default function AppUpdateNotice() {
  const { t } = useI18n()
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
    if (!update) return undefined
    const previousFocus = document.activeElement
    const focusDialog = () => {
      const primaryAction = dialogRef.current?.querySelector('[data-update-primary]')
      ;(primaryAction || dialogRef.current)?.focus()
    }
    const timer = window.setTimeout(focusDialog, 0)
    const onKeyDown = event => {
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
      previousFocus?.focus?.()
    }
  }, [dismiss, update])

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
  return (
    <div className="app-update-prompt-layer" role="presentation">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="app-update-prompt-title" aria-describedby="app-update-prompt-description" tabIndex="-1" className="app-update-prompt">
        <div className="app-update-prompt-topline">
          <span className="app-update-prompt-kicker"><span className="app-update-prompt-pulse" aria-hidden /><span>NeighbourAid</span></span>
          <button type="button" onClick={dismiss} className="tap app-update-prompt-close" aria-label={t('app_update_later')} title={t('app_update_later')}><X className="h-5 w-5" aria-hidden /></button>
        </div>

        <div className="app-update-prompt-main">
          <div className="app-update-prompt-icon" aria-hidden><RefreshCw className="h-8 w-8" /></div>
          <p className="app-update-prompt-eyebrow"><ShieldCheck className="h-4 w-4" aria-hidden /> Verified app release</p>
          <h1 id="app-update-prompt-title" className="app-update-prompt-title">{t('app_update_title')}</h1>
          <p id="app-update-prompt-description" className="app-update-prompt-copy">{t('app_update_body').replace('{version}', update.versionName)}</p>

          <div className="app-update-prompt-version" aria-label={`New version ${update.versionName}`}>
            <span className="app-update-prompt-version-label">New version</span>
            <strong>{update.versionName}</strong>
            <span>•</span>
            <span>Signed release</span>
          </div>

          <div className="app-update-prompt-action">
            <AndroidUpdateAction update={update} autoFocus />
          </div>
          <p className="app-update-prompt-assurance">The download stays in NeighbourAid. Android will always ask you before installation.</p>
        </div>

        <div className="app-update-prompt-footer">
          <Link to="/app-updates" onClick={() => setUpdate(null)} className="tap app-update-prompt-details">
            <span><Download className="h-4 w-4" aria-hidden /> View update details</span>
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
          <button type="button" onClick={dismiss} className="tap app-update-prompt-later">{t('app_update_later')}</button>
        </div>
      </section>
    </div>
  )
}
