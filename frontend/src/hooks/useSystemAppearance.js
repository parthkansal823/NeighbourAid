import { useEffect } from 'react'
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/**
 * Treat the device preference as the single source of truth for appearance.
 *
 * CSS owns the actual palette so it can paint correctly before React mounts.
 * This hook mirrors that choice onto the document and Android system bars
 * after mount, then stays in sync when someone changes the system setting.
 */
export default function useSystemAppearance() {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined

    const media = window.matchMedia(DARK_QUERY)
    const sync = () => {
      const theme = media.matches ? 'dark' : 'light'
      document.documentElement.dataset.theme = theme
      document.documentElement.style.colorScheme = theme

      if (Capacitor.isNativePlatform()) {
        try {
          void SystemBars?.setStyle?.({
            style: media.matches ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
          })?.catch(() => {
            // A web preview or an older APK can omit SystemBars. Appearance
            // is still fully correct inside the WebView, so this is optional.
          })
        } catch {
          // Some old native bridge versions throw before returning a Promise.
        }
      }
    }

    sync()
    media.addEventListener?.('change', sync)
    return () => media.removeEventListener?.('change', sync)
  }, [])
}
