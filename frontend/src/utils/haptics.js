import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

function browserHaptic(pattern) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
    return navigator.vibrate(pattern)
  } catch {
    return false
  }
}

function nativeFeedback(pattern) {
  if (Array.isArray(pattern)) {
    if (pattern.some((duration) => !Number.isFinite(duration) || duration < 0)) return null
    // Preserve the meaning of the existing callers, not just their timing:
    // SOS/update acknowledgement, versus an incoming critical alert.
    const sequence = pattern.join(',')
    if (sequence === '12,32,28' || sequence === '12,28,20') {
      return { method: 'notification', options: { type: NotificationType.Success } }
    }
    if (sequence === '35,60,70') {
      return { method: 'notification', options: { type: NotificationType.Warning } }
    }
  } else if (pattern === 70) {
    // QuickSOS uses this single pulse only after its request fails.
    return { method: 'notification', options: { type: NotificationType.Error } }
  }

  // Pauses are at odd indexes: they must not increase impact intensity.
  const pulse = Array.isArray(pattern)
    ? pattern.reduce((longest, duration, index) => index % 2 === 0 ? Math.max(longest, duration) : longest, 0)
    : pattern
  if (!Number.isFinite(pulse) || pulse <= 0) return null
  const style = pulse <= 20 ? ImpactStyle.Light : pulse <= 45 ? ImpactStyle.Medium : ImpactStyle.Heavy
  return { method: 'impact', options: { style } }
}

/**
 * Best-effort feedback: never await it before a safety-critical action.
 * Web callers keep navigator.vibrate's synchronous result. Native callers
 * get an immediate acceptance boolean, not a guarantee that hardware moved.
 * Missing/failed native bridges fall back to the original browser pattern.
 */
export function haptic(pattern = 12) {
  try {
    if (typeof window === 'undefined' || !Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Haptics')) {
      return browserHaptic(pattern)
    }
    const feedback = nativeFeedback(pattern)
    // Zero/empty patterns cancel browser vibration; never turn them into taps.
    if (!feedback || typeof Haptics[feedback.method] !== 'function') return browserHaptic(pattern)
    const pending = Haptics[feedback.method](feedback.options)
    Promise.resolve(pending).catch(() => { browserHaptic(pattern) })
    return true
  } catch {
    return browserHaptic(pattern)
  }
}
