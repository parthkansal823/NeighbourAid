import { useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'
const getSnapshot = () => typeof window !== 'undefined' && Boolean(window.matchMedia?.(QUERY).matches)
const getServerSnapshot = () => true

function subscribe(onChange) {
  const media = typeof window !== 'undefined' ? window.matchMedia?.(QUERY) : null
  if (!media) return () => {}
  if (media.addEventListener) {
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }
  media.addListener?.(onChange)
  return () => media.removeListener?.(onChange)
}

/** Shared live preference, with conservative static rendering during SSR. */
export default function useReducedMotion() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
