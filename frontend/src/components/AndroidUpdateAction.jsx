import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../utils/i18n'
import { androidUpdateCopy, cancelDirectUpdate, directUpdateStatus, installDirectUpdate, startDirectUpdate } from '../utils/androidUpdate'
import { haptic } from '../utils/haptics'
import { allowScreenNavigation } from '../utils/androidBack'

export default function AndroidUpdateAction({ update, autoFocus = false }) {
  const { lang } = useI18n()
  const copy = androidUpdateCopy(lang)
  const [download, setDownload] = useState({ state: 'idle', percent: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [wifiOnly, setWifiOnly] = useState(false)
  const [pollTick, setPollTick] = useState(0)
  const alive = useRef(true)
  const autoInstall = useRef(false)
  const installBusy = useRef(false)
  const showError = useCallback(err => {
    if (alive.current) setError(['CHECKSUM_MISMATCH', 'SIZE_MISMATCH'].includes(err.code) ? 'integrity' : err.code === 'SIGNATURE_MISMATCH' ? 'signature' : err.code === 'INVALID_APK' ? 'invalid' : err.code === 'UPDATER_MISSING' ? 'missing' : 'failed')
  }, [])
  const install = useCallback(async () => {
    if (installBusy.current) return
    if (!allowScreenNavigation()) return
    installBusy.current = true
    if (alive.current) { setBusy(true); setError('') }
    try {
      const result = await installDirectUpdate()
      if (alive.current) setDownload(previous => ({ ...previous, state: result.state }))
      haptic([12, 28, 20])
    } catch (err) { showError(err) }
    finally { installBusy.current = false; if (alive.current) setBusy(false) }
  }, [showError])
  // Resume the OS-owned download after a screen/app restart. Installation is
  // automatic only after this screen's explicit Update tap, while foreground.
  useEffect(() => {
    alive.current = true
    let live = true
    let timer
    let querying = false
    const poll = async () => {
      clearTimeout(timer)
      if (querying || document.visibilityState === 'hidden') return
      querying = true
      try {
        const state = await directUpdateStatus()
        if (!live || state.versionCode !== update.versionCode) return
        setDownload(previous => ['permission', 'installer'].includes(previous.state) && state.state === 'ready' ? previous : state)
        if (state.state === 'ready' && autoInstall.current === update.versionCode && document.visibilityState !== 'hidden') {
          autoInstall.current = 0
          await install()
        }
        if (live && ['downloading', 'paused'].includes(state.state)) timer = setTimeout(poll, 1500)
      } catch { /* No pending download, or an old APK without this plugin. */ }
      finally { querying = false }
    }
    void poll()
    document.addEventListener('visibilitychange', poll)
    return () => { live = false; alive.current = false; clearTimeout(timer); document.removeEventListener('visibilitychange', poll) }
  }, [update.versionCode, pollTick, install])

  const start = async () => {
    setBusy(true); setError(''); autoInstall.current = update.versionCode
    try {
      const state = await startDirectUpdate(wifiOnly ? { ...update, wifiOnly: true } : update)
      if (alive.current) { setDownload(state); setPollTick(n => n + 1) }
      haptic(12)
      if (alive.current && state.state === 'ready' && document.visibilityState !== 'hidden') { autoInstall.current = false; await install() }
    } catch (err) { autoInstall.current = false; showError(err) }
    finally { if (alive.current) setBusy(false) }
  }
  const cancel = async () => {
    setBusy(true); autoInstall.current = false
    try {
      await cancelDirectUpdate()
      if (alive.current) { setDownload({ state: 'idle', percent: 0 }); setError('') }
      haptic(8)
    }
    catch (err) { showError(err) }
    finally { if (alive.current) setBusy(false) }
  }
  const pending = ['downloading', 'paused'].includes(download.state)
  const ready = ['ready', 'permission', 'installer'].includes(download.state)
  const percent = Math.max(0, Math.min(100, Number(download.percent) || 0))
  const checksumAvailable = typeof download.checksumAvailable === 'boolean' ? download.checksumAvailable : Boolean(update.sha256)
  return <div className="w-full min-w-0 text-sm" aria-busy={busy}>
    {pending && <><p role="status" className="mb-2 text-sm leading-relaxed text-app-muted">{copy[download.state]} {percent}%</p><progress className="mb-3 w-full accent-accent" value={percent} max="100" aria-label={copy.downloading} /></>}
    {ready && <p role="status" className="mb-3 text-sm leading-relaxed text-app-muted">{copy[download.state]}</p>}
    {error && <p role="alert" className="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-sm leading-relaxed text-app-ink">{copy[error]}</p>}
    {!pending && !ready && <label className="tap mb-3 flex items-center gap-2 text-sm text-app-muted"><input type="checkbox" checked={wifiOnly} disabled={busy} onChange={event => setWifiOnly(event.target.checked)} />{lang === 'hi' ? 'केवल Wi-Fi से डाउनलोड करें' : 'Download using Wi-Fi only'}</label>}
    <button type="button" data-update-primary={autoFocus || undefined} autoFocus={autoFocus} disabled={busy} onClick={pending ? cancel : ready ? install : start} className={`tap app-update-action-button ${pending ? 'app-secondary-button' : 'app-primary-button'} w-full`}>
      {busy ? copy.opening : pending ? copy.cancel : ready ? copy.install : download.state === 'failed' ? copy.retry : copy.update}
    </button>
    {ready && <button type="button" disabled={busy} onClick={cancel} className="tap app-secondary-button mt-2 w-full">{lang === 'hi' ? 'डाउनलोड की गई APK हटाएँ' : 'Discard downloaded APK'}</button>}
    {!pending && !ready && <p className="mt-3 text-xs leading-relaxed text-app-muted">{copy.confirmation}</p>}
    <p className="mt-2 text-xs leading-relaxed text-app-muted">{lang === 'hi'
      ? checksumAvailable ? 'इंस्टॉल से पहले SHA-256, पैकेज, संस्करण और signing key जाँचे जाएँगे।' : 'पैकेज, संस्करण और signing key जाँचे जाएँगे। इस डाउनलोड में checksum नहीं है।'
      : checksumAvailable ? 'SHA-256, package, version and signing key are checked before installation.' : 'Package, version and signing key are checked. This download does not include a checksum.'}</p>
  </div>
}
