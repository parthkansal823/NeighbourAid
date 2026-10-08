import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import useAndroidBackButton from '../hooks/useAndroidBackButton'
import { allowScreenNavigation } from '../utils/androidBack'

/** Must stay under the router. Native links and hardware/header back share
 * one draft guard; the regular website retains its browser navigation. */
export default function NativePlatformEffects() {
  useAndroidBackButton()
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return undefined
    const protectLink = event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target?.closest?.('a[href]')
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return
      const target = new URL(anchor.href, window.location.href)
      if (target.origin !== window.location.origin || !['http:', 'https:'].includes(target.protocol)) return
      if (target.pathname === window.location.pathname && target.search === window.location.search) return
      if (!allowScreenNavigation()) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    document.addEventListener('click', protectLink, true)
    return () => document.removeEventListener('click', protectLink, true)
  }, [])
  return null
}
