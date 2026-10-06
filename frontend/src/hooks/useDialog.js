import { useEffect, useRef } from 'react'
import { useLatest } from './useLatest'

/** Keep emergency dialogs reachable with a keyboard and restore the trigger. */
export function useDialog(onClose) {
  const ref = useRef(null)
  const close = useLatest(onClose)
  useEffect(() => {
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const nodes = () => [...(ref.current?.querySelectorAll('button:not(:disabled), a[href], input, select, textarea, [tabindex="0"]') || [])]
    ;(nodes()[0] || ref.current)?.focus()
    const key = event => {
      if (event.key === 'Escape') close.current()
      if (event.key !== 'Tab') return
      const items = nodes(), first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); ref.current?.focus() }
      else if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      document.body.style.overflow = overflow
      if (previous?.isConnected) previous.focus()
    }
  }, [close])
  return ref
}
