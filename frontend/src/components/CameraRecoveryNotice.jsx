import { useEffect } from 'react'
import { App as NativeApp } from '@capacitor/app'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { hasNativeCamera } from '../utils/nativeCamera'
import { cameraRestorationCandidate, recoverCameraResult } from '../utils/cameraRecovery'
import useCameraRecovery from '../hooks/useCameraRecovery'

/** Android may recreate the WebView after its external camera Activity closes.
 * Listen at app scope, but never navigate, attach a photo or send a report. */
export default function CameraRecoveryNotice() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const record = useCameraRecovery(user?.id || null)
  useEffect(() => {
    if (!hasNativeCamera()) return undefined
    let disposed = false
    let handle
    const remove = listener => { void Promise.resolve(listener.remove()).catch(() => {}) }
    // Freeze the pre-existing session before subscribing. A delayed old result
    // must not get assigned to a new camera session created after app startup.
    Promise.resolve().then(() => cameraRestorationCandidate()).then(candidateId => {
      if (disposed) return null
      return NativeApp.addListener('appRestoredResult', event => {
        if (!disposed) void recoverCameraResult(event, candidateId).catch(() => {})
      })
    }).then(listener => {
      if (!listener) return
      if (disposed) remove(listener)
      else handle = listener
    }).catch(() => {})
    return () => { disposed = true; if (handle) remove(handle) }
  }, [])
  if (!record || pathname === '/post-alert') return null
  return <aside aria-label="Unsent camera draft" className="border-b border-line bg-surface-2 px-4 py-3 text-sm text-app-ink">
    <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2">
      <p>A camera draft is saved on this device. It has not been sent.</p>
      <Link className="app-secondary-button" to="/post-alert">Review saved draft</Link>
    </div>
  </aside>
}
