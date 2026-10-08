import { useEffect, useState } from 'react'
import { hasNativeCamera } from '../utils/nativeCamera'
import { CAMERA_RECOVERY_EVENT, readCameraRecovery } from '../utils/cameraRecovery'

/** Hide the previous account's record synchronously, before IndexedDB resolves. */
export default function useCameraRecovery(accountId) {
  const [snapshot, setSnapshot] = useState(null)
  useEffect(() => {
    if (!hasNativeCamera()) return undefined
    let live = true
    let revision = 0
    let expiryTimer
    const refresh = () => {
      clearTimeout(expiryTimer)
      const current = ++revision
      readCameraRecovery(accountId).then(record => {
        if (live && current === revision) {
          setSnapshot({ accountId, record })
          if (Number.isFinite(record?.expiresAt)) expiryTimer = setTimeout(refresh, Math.max(0, record.expiresAt - Date.now()))
        }
      }).catch(() => {
        if (live && current === revision) setSnapshot({ accountId, record: null })
      })
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    refresh()
    window.addEventListener(CAMERA_RECOVERY_EVENT, refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      live = false
      clearTimeout(expiryTimer)
      window.removeEventListener(CAMERA_RECOVERY_EVENT, refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [accountId])
  return snapshot?.accountId === accountId ? snapshot.record : null
}
