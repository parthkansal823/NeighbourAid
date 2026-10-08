import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'
import { useLatest } from './useLatest'
import {
  ANDROID_KEYBOARD_DISMISS_EVENT,
  allowScreenNavigation,
  dismissTopAndroidOverlay,
} from '../utils/androidBack'

/** Mount once under BrowserRouter. Hardware back never exits NeighbourAid. */
export default function useAndroidBackButton() {
  const location = useLocation()
  const navigate = useNavigate()
  const current = useLatest({ location, navigate })

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android' ||
        !Capacitor.isPluginAvailable('App')) return undefined

    let active = true
    let listener
    const remove = (handle) => {
      try { Promise.resolve(handle?.remove()).catch(() => {}) } catch { /* Native cleanup is best-effort. */ }
    }
    const back = (event = {}) => {
      if (!active) return
      if (dismissTopAndroidOverlay()) return
      const keyboard = new CustomEvent(ANDROID_KEYBOARD_DISMISS_EVENT, { cancelable: true })
      window.dispatchEvent(keyboard)
      if (keyboard.defaultPrevented || !allowScreenNavigation()) return

      const { location: route, navigate: go } = current.current
      // BrowserRouter owns `idx`. history.length and native canGoBack alone can
      // include an external page, so neither is a safe permission to go back.
      const index = window.history.state?.idx
      if (route.pathname === '/' && !route.search && !route.hash) return
      if (event.canGoBack !== false && Number.isSafeInteger(index) && index > 0) go(-1)
      else go('/', { replace: true })
    }

    const subscribe = async () => {
      try {
        const handle = await App.addListener('backButton', back)
        if (active) listener = handle
        else remove(handle)
      } catch { /* Missing/outdated APK plugins must not break the website. */ }
    }
    void subscribe()
    return () => {
      active = false
      remove(listener)
    }
  }, [current])
}
