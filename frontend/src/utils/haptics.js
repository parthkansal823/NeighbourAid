/**
 * Lightweight native-feeling confirmation for Android without making a
 * safety-critical action depend on another plugin. It is intentionally a
 * best-effort progressive enhancement: browsers without vibration simply
 * continue normally.
 */
export function haptic(pattern = 12) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
  try {
    return navigator.vibrate(pattern)
  } catch {
    return false
  }
}
