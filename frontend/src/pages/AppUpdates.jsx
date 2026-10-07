import { useCallback, useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import AndroidUpdateAction from '../components/AndroidUpdateAction'
import { CheckCircle2, RefreshCw, ShieldCheck } from '../components/icons'
import { UPDATE_RESULT_EVENT } from '../utils/androidUpdate'
import { latestAppUpdate } from '../utils/appUpdate'
import { isNativeApp } from '../utils/runtime'
import { enableUpdateNotifications, notifyAppUpdate, openAppUpdate } from '../utils/updateNotification'
import { androidUpdateCopy } from '../utils/androidUpdate'
import { useI18n } from '../utils/i18n'

/**
 * A dedicated, calm update screen. Emergency content no longer shifts down
 * under a long download banner; the update remains discoverable from More
 * and a compact in-app prompt.
 */
export default function AppUpdates() {
  const { lang, t } = useI18n()
  const copy = androidUpdateCopy(lang)
  const native = isNativeApp()
  const [state, setState] = useState('idle')
  const [update, setUpdate] = useState(null)
  const [message, setMessage] = useState('')
  const [opening, setOpening] = useState(false)

  const check = useCallback(async () => {
    if (!native || import.meta.env.MODE === 'demo') return
    if (!navigator.onLine) {
      setState('unavailable')
      window.dispatchEvent(new CustomEvent(UPDATE_RESULT_EVENT, { detail: 'unavailable' }))
      return
    }
    setState('checking')
    setMessage('')
    try {
      const release = await latestAppUpdate(__APP_BUILD__.versionCode, fetch, { reportUnavailable: true })
      setUpdate(release)
      const next = release ? 'found' : 'none'
      setState(next)
      window.dispatchEvent(new CustomEvent(UPDATE_RESULT_EVENT, { detail: next }))
    } catch {
      setState('unavailable')
      window.dispatchEvent(new CustomEvent(UPDATE_RESULT_EVENT, { detail: 'unavailable' }))
    }
  }, [native])

  useEffect(() => {
    void check()
  }, [check])

  const enableNotifications = async () => {
    try {
      const granted = await enableUpdateNotifications()
      setMessage(t(granted ? 'app_update_notifications_on' : 'app_update_notifications_off'))
      if (granted && update) await notifyAppUpdate(update, t('app_update_title'), update.versionName)
    } catch {
      setMessage(t('app_update_notifications_off'))
    }
  }

  const downloadInBrowser = async () => {
    if (!update || opening) return
    setOpening(true)
    setMessage('')
    try {
      if (!await openAppUpdate(update.downloadUrl)) setMessage(t('app_update_open_error'))
    } catch {
      setMessage(t('app_update_open_error'))
    } finally {
      setOpening(false)
    }
  }

  if (!native) return null

  const noUpdate = state === 'none'
  const unavailable = state === 'unavailable'
  return (
    <div className="page-panel app-updates-page mx-auto max-w-xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <div className="app-screen-kicker"><RefreshCw className="h-4 w-4" aria-hidden /> App care</div>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">App updates</h1>
        <p className="mt-1 text-sm leading-relaxed text-gray-400">Keep NeighbourAid reliable when you need it. Updates never interrupt an emergency action.</p>
      </header>

      <section className="surface-card overflow-hidden">
        <div className="app-update-hero p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="app-update-mark"><ShieldCheck className="h-6 w-6" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-gray-400">{copy.installed}</p>
              <p className="mt-1 text-lg font-semibold text-white">{__APP_BUILD__.versionName}</p>
              <p className="mt-1 text-xs text-gray-500">Build {__APP_BUILD__.versionCode}</p>
            </div>
            {update && <span className="app-update-ready">Ready</span>}
          </div>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          {state === 'checking' && <p role="status" className="flex items-center gap-2 text-sm text-gray-400"><RefreshCw className="h-4 w-4 animate-spin" aria-hidden />{copy.checking}</p>}
          {update && (
            <>
              <div>
                <p className="text-sm font-semibold text-white">Version {update.versionName} is ready</p>
                <p className="mt-1 text-sm leading-relaxed text-gray-400">{t('app_update_body').replace('{version}', update.versionName)}</p>
              </div>
              {Capacitor.getPlatform() === 'android' ? (
                <AndroidUpdateAction key={update.versionCode} update={update} />
              ) : (
                <button type="button" disabled={opening} onClick={downloadInBrowser} className="tap app-primary-action w-full rounded-xl px-4 text-sm font-semibold disabled:opacity-50">
                  {opening ? copy.opening : t('app_update_download')}
                </button>
              )}
              {__APP_BUILD__.channel !== 'release' && <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">{t('app_update_debug')}</p>}
            </>
          )}
          {noUpdate && <div className="app-update-empty"><CheckCircle2 className="h-5 w-5" aria-hidden /><div><p className="font-medium">{copy.none}</p><p className="mt-1 text-xs leading-relaxed">You already have the latest signed release.</p></div></div>}
          {unavailable && <p role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm leading-relaxed text-amber-300">{copy.unavailable}</p>}
          {message && <p role="status" className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs leading-relaxed text-gray-300">{message}</p>}
          <button type="button" onClick={check} disabled={state === 'checking'} className="tap inline-flex items-center gap-2 text-sm font-medium text-orange-300 disabled:opacity-50"><RefreshCw className={`h-4 w-4${state === 'checking' ? ' animate-spin' : ''}`} aria-hidden />{copy.check}</button>
        </div>
      </section>

      <section className="mt-4 surface-card p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">Stay informed</h2>
        <p className="mt-1 text-sm leading-relaxed text-gray-400">Ask Android to notify you when a signed release is ready. You will always approve installation yourself.</p>
        <button type="button" onClick={enableNotifications} className="tap mt-3 rounded-xl border border-line px-3 text-sm font-medium text-gray-200 hover:border-orange-500/50 hover:text-white">{t('app_update_enable_notifications')}</button>
      </section>
    </div>
  )
}
