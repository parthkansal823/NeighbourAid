import { useCallback, useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import AndroidUpdateAction from '../components/AndroidUpdateAction'
import { Bell, CheckCircle2, RefreshCw, ShieldCheck } from '../components/icons'
import { UPDATE_RESULT_EVENT } from '../utils/androidUpdate'
import { latestAppUpdate } from '../utils/appUpdate'
import { isNativeApp } from '../utils/runtime'
import { enableUpdateNotifications, notifyAppUpdate, openAppUpdate } from '../utils/updateNotification'
import { androidUpdateCopy } from '../utils/androidUpdate'
import { useI18n } from '../utils/i18n'

const SCREEN_COPY = {
  en: {
    title: 'App updates',
    intro: 'Check your version and keep NeighbourAid up to date.',
    current: 'You have the latest signed release.',
    notifications: 'Update notifications',
    notificationsBody: 'Get a notification when a signed update is ready. You choose when to install it.',
    version: 'New version',
    build: 'Build',
    ready: 'Available',
  },
  hi: {
    title: 'ऐप अपडेट',
    intro: 'अपना संस्करण देखें और NeighbourAid को अपडेट रखें।',
    current: 'आपके पास सबसे नया signed release है।',
    notifications: 'अपडेट सूचनाएँ',
    notificationsBody: 'नया signed update तैयार होने पर सूचना पाएँ। इंस्टॉल कब करना है, आप चुनेंगे।',
    version: 'नया संस्करण',
    build: 'बिल्ड',
    ready: 'उपलब्ध',
  },
}

/**
 * A dedicated, calm update screen. Emergency content no longer shifts down
 * under a long download banner; the update remains discoverable from More
 * and a compact in-app prompt.
 */
export default function AppUpdates() {
  const { lang, t } = useI18n()
  const copy = androidUpdateCopy(lang)
  const screenCopy = SCREEN_COPY[lang] || SCREEN_COPY.en
  const native = isNativeApp()
  const [state, setState] = useState('idle')
  const [update, setUpdate] = useState(null)
  const [message, setMessage] = useState('')
  const [opening, setOpening] = useState(false)
  const [notifying, setNotifying] = useState(false)

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
    if (notifying) return
    setNotifying(true)
    try {
      const granted = await enableUpdateNotifications()
      setMessage(t(granted ? 'app_update_notifications_on' : 'app_update_notifications_off'))
      if (granted && update) await notifyAppUpdate(update, t('app_update_title'), update.versionName)
    } catch {
      setMessage(t('app_update_notifications_off'))
    } finally {
      setNotifying(false)
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

  if (!native) return <div className="page-panel mx-auto max-w-xl px-4 py-6 sm:py-8">
    <h1 className="text-2xl font-semibold tracking-tight text-app-ink">{screenCopy.title}</h1>
    <p className="mt-3 text-base leading-relaxed text-app-muted">{lang === 'hi'
      ? 'वेबसाइट का नया संस्करण अपने आप मिलता है। Android ऐप का संस्करण और अपडेट देखने के लिए ऐप में यह स्क्रीन खोलें।'
      : 'The website receives updates automatically. Open this screen in the Android app to check its installed version and available updates.'}</p>
  </div>

  const noUpdate = state === 'none'
  const unavailable = state === 'unavailable'
  return (
    <div className="page-panel app-updates-page mx-auto w-full max-w-xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight text-app-ink">{screenCopy.title}</h1>
        <p className="mt-2 max-w-prose text-sm leading-relaxed text-app-muted">{screenCopy.intro}</p>
      </header>

      <section className="overflow-hidden rounded-2xl border border-line bg-surface-1" aria-label={screenCopy.title}>
        <div className="border-b border-line p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-app-muted"><ShieldCheck className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-app-muted">{copy.installed}</p>
              <p className="mt-1 break-words text-lg font-semibold text-app-ink">{__APP_BUILD__.versionName}</p>
              <p className="mt-1 text-xs text-app-muted">{screenCopy.build} {__APP_BUILD__.versionCode}</p>
            </div>
            {update && <span className="shrink-0 rounded-full bg-surface-2 px-2 py-1 text-xs font-medium text-app-ink">{screenCopy.ready}</span>}
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5" aria-busy={state === 'checking'}>
          {state === 'checking' && <p role="status" className="flex items-center gap-2 text-sm text-app-muted"><RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden />{copy.checking}</p>}
          {update && (
            <>
              <div>
                <p className="break-words text-base font-semibold text-app-ink">{screenCopy.version}: {update.versionName}</p>
                <p className="mt-2 text-sm leading-relaxed text-app-muted">{t('app_update_body').replace('{version}', update.versionName)}</p>
              </div>
              {Capacitor.getPlatform() === 'android' ? (
                <AndroidUpdateAction key={update.versionCode} update={update} />
              ) : (
                <button type="button" disabled={opening} onClick={downloadInBrowser} className="tap app-primary-button w-full">
                  {opening ? copy.opening : t('app_update_download')}
                </button>
              )}
              {__APP_BUILD__.channel !== 'release' && <p className="rounded-xl border border-line bg-surface-2 px-3 py-3 text-xs leading-relaxed text-app-muted">{t('app_update_debug')}</p>}
            </>
          )}
          {noUpdate && <div role="status" className="flex items-start gap-3 text-app-ink"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-app-muted" aria-hidden /><div><p className="text-sm font-medium">{screenCopy.current}</p><p className="mt-1 text-xs leading-relaxed text-app-muted">{copy.none}</p></div></div>}
          {unavailable && <p role="status" className="rounded-xl bg-surface-2 px-3 py-3 text-sm leading-relaxed text-app-ink">{copy.unavailable}</p>}
          {message && <p role="status" className="rounded-xl bg-surface-2 px-3 py-3 text-sm leading-relaxed text-app-ink">{message}</p>}
          <button type="button" onClick={check} disabled={state === 'checking'} className={`tap ${update ? 'app-secondary-button' : 'app-primary-button'} w-full`}><RefreshCw className={`h-4 w-4 shrink-0${state === 'checking' ? ' animate-spin' : ''}`} aria-hidden />{copy.check}</button>
        </div>
      </section>

      <section className="mt-6" aria-labelledby="update-notifications-title">
        <div className="flex items-center gap-2"><Bell className="h-4 w-4 shrink-0 text-app-muted" aria-hidden /><h2 id="update-notifications-title" className="text-sm font-semibold text-app-ink">{screenCopy.notifications}</h2></div>
        <p className="mt-2 text-sm leading-relaxed text-app-muted">{screenCopy.notificationsBody}</p>
        <button type="button" onClick={enableNotifications} disabled={notifying} className="tap app-secondary-button mt-3 w-full">{notifying ? t('vol_enabling') : t('app_update_enable_notifications')}</button>
      </section>
    </div>
  )
}
