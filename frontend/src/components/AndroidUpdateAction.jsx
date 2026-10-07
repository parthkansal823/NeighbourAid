import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../utils/i18n'
import { androidUpdateCopy, cancelDirectUpdate, directUpdateStatus, installDirectUpdate, startDirectUpdate } from '../utils/androidUpdate'
import { haptic } from '../utils/haptics'

export default function AndroidUpdateAction({ update, autoFocus = false }) {
  const { lang } = useI18n()
  const copy = androidUpdateCopy(lang)
  const [download, setDownload] = useState({ state: 'idle', percent: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pollTick, setPollTick] = useState(0)
  const alive = useRef(true)
  const autoInstall = useRef(false)
  const installBusy = useRef(false)
  const showError = useCallback(err => {
    if (alive.current) setError(err.code === 'SIGNATURE_MISMATCH' ? 'signature' : err.code === 'INVALID_APK' ? 'invalid' : err.code === 'UPDATER_MISSING' ? 'missing' : 'failed')
  }, [])
  const install = useCallback(async () => {
    if (installBusy.current) return
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
      const state = await startDirectUpdate(update)
      if (alive.current) { setDownload(state); setPollTick(n => n + 1) }
      haptic(12)
      if (alive.current && state.state === 'ready' && document.visibilityState !== 'hidden') { autoInstall.current = false; await install() }
    } catch (err) { autoInstall.current = false; showError(err) }
    finally { if (alive.current) setBusy(false) }
  }
  const cancel = async () => {
    setBusy(true); autoInstall.current = false
    try { await cancelDirectUpdate(); if (alive.current) setDownload({ state: 'idle', percent: 0 }); haptic(8) }
    catch (err) { showError(err) }
    finally { if (alive.current) setBusy(false) }
  }
  const pending = ['downloading', 'paused'].includes(download.state)
  const ready = ['ready', 'permission', 'installer'].includes(download.state)
  return <div className="min-w-0 max-w-md text-sm">
    {pending && <><p role="status" className="mb-1 text-xs text-gray-300">{copy[download.state]} {Math.max(0, Math.min(100, Number(download.percent) || 0))}%</p><progress className="mb-2 w-full accent-orange-500" value={download.percent || 0} max="100" aria-label={copy.downloading} /></>}
    {ready && <p role="status" className="mb-2 text-xs leading-relaxed text-gray-300">{copy[download.state]}</p>}
    {error && <p role="alert" className="mb-2 text-xs leading-relaxed text-orange-300">{copy[error]}</p>}
    <button type="button" autoFocus={autoFocus} disabled={busy} onClick={pending ? cancel : ready ? install : start} className="tap app-update-action-button rounded-lg bg-orange-500 px-3 font-medium text-black disabled:opacity-50">
      {busy ? copy.opening : pending ? copy.cancel : ready ? copy.install : download.state === 'failed' ? copy.retry : copy.update}
    </button>
    {!pending && !ready && <p className="mt-1 text-xs text-gray-400">{copy.confirmation}</p>}
  </div>
}
