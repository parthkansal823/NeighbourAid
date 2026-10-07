import { useEffect, useLayoutEffect } from 'react'
import BrandLogo from './BrandLogo'
import useLaunchScreen from '../hooks/useLaunchScreen'

/**
 * The native Android splash covers WebView start-up. This component takes
 * over once React mounts, so launch feels continuous on Android and web
 * without letting a long loader conceal the emergency UI.
 */
export default function LaunchScreen() {
  const { dismiss, entered, exiting, reducedMotion, visible } = useLaunchScreen()

  useLayoutEffect(() => {
    const bootSplash = document.getElementById('boot-splash')
    // Hand off before paint: fading both screens together duplicated the
    // logo and app name during startup, especially on slower WebViews.
    bootSplash?.remove()
  }, [])

  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dismiss])

  if (!visible) return null

  const contentState = entered && !exiting
    ? 'opacity-100 translate-y-0 scale-100'
    : 'opacity-0 translate-y-2 scale-95'

  return (
    <div
      aria-label="Opening NeighbourAid"
      aria-live="polite"
      className={`fixed inset-0 z-[2000] grid place-items-center overflow-hidden bg-surface px-6 text-[var(--app-ink)] transition-opacity duration-180 ease-out motion-reduce:transition-none ${exiting ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      data-reduced-motion={reducedMotion || undefined}
      data-state={exiting ? 'exiting' : 'opening'}
      role="status"
    >
      <button
        type="button"
        onClick={dismiss}
        className="sr-only rounded-lg bg-surface-1 px-4 py-3 text-sm font-semibold text-[var(--app-ink)] focus:not-sr-only focus:absolute focus:left-4 focus:top-4"
      >
        Skip launch animation
      </button>
      <div className={`relative flex max-w-xs flex-col items-center text-center transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none ${contentState}`}>
        <BrandLogo size={72} />
        <p className="mt-5 text-xl font-semibold tracking-tight">NeighbourAid</p>
        <p className="mt-1 text-sm text-[var(--app-muted)]">Your community, ready to help.</p>
      </div>
    </div>
  )
}
