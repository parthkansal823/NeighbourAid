import { useEffect } from 'react'
import BrandLogo from './BrandLogo'
import useLaunchScreen from '../hooks/useLaunchScreen'

/**
 * The native Android splash covers WebView start-up. This component takes
 * over once React mounts, so launch feels continuous on Android and web
 * without letting a long loader conceal the emergency UI.
 */
export default function LaunchScreen() {
  const { dismiss, entered, exiting, reducedMotion, visible } = useLaunchScreen()

  useEffect(() => {
    const bootSplash = document.getElementById('boot-splash')
    if (!bootSplash) return undefined
    bootSplash.setAttribute('aria-hidden', 'true')
    bootSplash.classList.add('boot-splash--leaving')
    const removeTimer = window.setTimeout(() => bootSplash.remove(), 180)
    return () => window.clearTimeout(removeTimer)
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
      <div aria-hidden="true" className="absolute h-72 w-72 rounded-full bg-[var(--color-accent-soft)] blur-3xl" />
      <div className={`relative flex max-w-xs flex-col items-center text-center transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none ${contentState}`}>
        <div className="grid h-28 w-28 place-items-center rounded-[2rem] border border-line bg-surface-1 p-3 shadow-[var(--app-shadow-float)]">
          <BrandLogo size={88} />
        </div>
        <p className="mt-6 text-xl font-bold tracking-tight">NeighbourAid</p>
        <p className="mt-1 text-sm text-[var(--app-muted)]">Your community, ready to help.</p>
        <span className="mt-5 h-1 w-10 rounded-full bg-[var(--color-accent)]" />
      </div>
    </div>
  )
}
