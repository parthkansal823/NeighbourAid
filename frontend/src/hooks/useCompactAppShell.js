import { useEffect, useState } from 'react'
import { isNativeApp } from '../utils/runtime'

// Keep a phone browser in the same intentional shell as the installed app.
// A narrow viewport is not a desktop site with less room; it is a touch-first
// context with the same navigation, safe spacing, and focused home surface.
const COMPACT_QUERY = '(max-width: 1023px)'

function matchesCompactViewport() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(COMPACT_QUERY).matches)
}

export default function useCompactAppShell() {
  const native = isNativeApp()
  const [compact, setCompact] = useState(() => native || matchesCompactViewport())

  useEffect(() => {
    if (native) {
      setCompact(true)
      return undefined
    }
    const media = window.matchMedia?.(COMPACT_QUERY)
    if (!media) return undefined
    const onChange = () => setCompact(media.matches)
    onChange()
    media.addEventListener?.('change', onChange)
    return () => media.removeEventListener?.('change', onChange)
  }, [native])

  return native || compact
}
