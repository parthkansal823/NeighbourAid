import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { allowScreenNavigation } from '../utils/androidBack'

/** Web shell updates never reload an unsent/in-flight report automatically. */
const reloadPage = () => window.location.reload()
export default function WebUpdateNotice({ reload = reloadPage }) {
  const [waiting, setWaiting] = useState(null)
  const [error, setError] = useState(false)
  const [activeUpdate, setActiveUpdate] = useState(false)
  const approved = useRef(false)
  useEffect(() => {
    if (Capacitor.isNativePlatform() || !import.meta.env.PROD || !navigator.serviceWorker) return undefined
    const serviceWorker = navigator.serviceWorker
    let alive = true
    let registration
    const installers = new Map()
    const observe = () => {
      if (registration.waiting && serviceWorker.controller && alive) setWaiting(registration.waiting)
      const installing = registration.installing
      if (!installing || installers.has(installing)) return
      const changed = () => { if (installing.state === 'installed' && alive) observe() }
      installers.set(installing, changed)
      installing.addEventListener('statechange', changed)
    }
    const refresh = () => {
      if (document.visibilityState !== 'hidden' && navigator.onLine) void registration?.update().catch(() => {})
    }
    const activated = () => {
      if (!approved.current) return
      setActiveUpdate(true)
      approved.current = false
      // A report may have started while the waiting worker activated.
      if (allowScreenNavigation()) reload()
    }
    void serviceWorker.register('/service-worker.js').then(reg => {
      if (!alive) return
      registration = reg
      observe()
      reg.addEventListener('updatefound', observe)
    }).catch(() => {})
    const timer = setInterval(refresh, 4 * 60 * 60 * 1000)
    serviceWorker.addEventListener('controllerchange', activated)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      alive = false
      clearInterval(timer)
      registration?.removeEventListener('updatefound', observe)
      installers.forEach((listener, worker) => worker.removeEventListener('statechange', listener))
      serviceWorker.removeEventListener('controllerchange', activated)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [reload])
  if (!waiting) return null
  return <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2 text-sm text-app-ink">
    <p>A new website version is ready. Reload when your report is safely sent or saved.{error && ' Reload could not start. Try again.'}</p>
    <button type="button" className="tap rounded-lg border border-line px-3 font-medium" onClick={() => {
      if (!allowScreenNavigation()) return
      try {
        if (activeUpdate || waiting.state === 'activated') reload()
        else { approved.current = true; waiting.postMessage({ type: 'SKIP_WAITING' }) }
        setError(false)
      } catch { approved.current = false; setError(true) }
    }}>Reload to update</button>
  </div>
}
