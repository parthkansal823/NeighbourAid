import { useCallback, useEffect, useState } from 'react'

// A launch screen should affirm that the app opened, but never delay someone
// who may be trying to report or respond to an emergency. The hard limit is
// deliberately short, even when a caller passes a longer preferred duration.
export const LAUNCH_VISIBLE_MS = 820
export const LAUNCH_EXIT_MS = 180
export const LAUNCH_MAX_MS = 2200

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Controls the short, one-time in-app launch transition.
 *
 * `dismiss` gives keyboard users an immediate route through it, and the hard
 * timeout ensures an animation or browser scheduling problem cannot leave a
 * blocker over the emergency controls.
 */
export default function useLaunchScreen({ visibleFor = LAUNCH_VISIBLE_MS } = {}) {
  const [phase, setPhase] = useState('entering')
  const [entered, setEntered] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion)
  const dismiss = useCallback(() => {
    setPhase(current => current === 'done' ? current : 'exiting')
  }, [])

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const syncMotion = () => setReducedMotion(Boolean(media?.matches))
    syncMotion()
    media?.addEventListener?.('change', syncMotion)

    // Waiting one frame lets the initial, small mark paint before it settles
    // into place. The CSS transition is automatically removed for reduced
    // motion users.
    const enterFrame = window.requestAnimationFrame?.(() => setEntered(true))
      ?? window.setTimeout(() => setEntered(true), 0)
    const duration = media?.matches ? 0 : Math.min(Math.max(0, visibleFor), LAUNCH_MAX_MS)
    const dismissTimer = window.setTimeout(dismiss, duration)
    const failSafeTimer = window.setTimeout(() => setPhase('done'), LAUNCH_MAX_MS + LAUNCH_EXIT_MS)

    return () => {
      if (typeof enterFrame === 'number' && window.cancelAnimationFrame) window.cancelAnimationFrame(enterFrame)
      else window.clearTimeout(enterFrame)
      window.clearTimeout(dismissTimer)
      window.clearTimeout(failSafeTimer)
      media?.removeEventListener?.('change', syncMotion)
    }
  }, [dismiss, visibleFor])

  useEffect(() => {
    if (phase !== 'exiting') return undefined
    const timer = window.setTimeout(() => setPhase('done'), reducedMotion ? 0 : LAUNCH_EXIT_MS)
    return () => window.clearTimeout(timer)
  }, [phase, reducedMotion])

  return {
    dismiss,
    entered,
    exiting: phase === 'exiting',
    reducedMotion,
    visible: phase !== 'done',
  }
}
