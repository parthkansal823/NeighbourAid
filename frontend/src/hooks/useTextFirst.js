import { useSyncExternalStore } from 'react'

const KEY = 'neighbouraid:text-first'
const EVENT = 'neighbouraid:preferences-changed'

function snapshot() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved !== null) return saved === '1'
  } catch { /* Storage may be unavailable on a shared/private device. */ }
  return navigator.connection?.saveData === true
}

function subscribe(listener) {
  const onStorage = event => { if (!event.key || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  navigator.connection?.addEventListener?.('change', listener)
  return () => {
    window.removeEventListener(EVENT, listener)
    window.removeEventListener('storage', onStorage)
    navigator.connection?.removeEventListener?.('change', listener)
  }
}

export function setTextFirst(enabled) {
  try { localStorage.setItem(KEY, enabled ? '1' : '0') } catch { /* Best-effort device preference. */ }
  window.dispatchEvent(new Event(EVENT))
}

export default function useTextFirst() {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
