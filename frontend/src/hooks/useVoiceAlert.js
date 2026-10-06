import { speechLocaleFor } from '../utils/i18n'
import { useCallback, useEffect, useState } from 'react'

/**
 * Hands-free voice alert via the Web Speech API's SpeechSynthesis.
 *
 * Use case: a volunteer who's mid-task (driving, walking, on the phone)
 * can hear "CRITICAL fire alert, 1.2 km away" without unlocking the
 * device. Free, zero-API-key, browser-native.
 *
 * The hook respects a `voiceAlerts` localStorage pref so users on
 * limited data / shared computers can silence it. Defaults ON because
 * the use case (crisis response) skews toward "I want to know".
 */

const STORAGE_KEY = 'voiceAlerts'

// Re-evaluated on every call so test environments that install
// speechSynthesis after module import are still detected.
function isSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function useVoiceAlert() {
  const supported = isSupported()
  const [enabled, setEnabled] = useState(() => {
    if (!supported) return false
    const saved = localStorage.getItem(STORAGE_KEY)
    // Default ON — users explicitly opt out
    return saved == null ? true : saved === '1'
  })

  useEffect(() => {
    if (!supported) return
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  }, [enabled, supported])

  /**
   * Speak `text` immediately, cancelling any in-flight utterance so two
   * back-to-back CRITICAL alerts don't queue up and play 30 seconds late.
   * Locale follows the active UI language so Hindi text gets a Hindi voice.
   */
  const speak = useCallback(
    (text, { lang = 'en-IN' } = {}) => {
      if (!isSupported() || !enabled || !text) return
      try {
        // Cancel anything currently playing/queued — prefer the freshest alert
        window.speechSynthesis.cancel()
        const utt = new SpeechSynthesisUtterance(text)
        utt.lang = lang
        utt.rate = 1.05
        utt.pitch = 1.05
        utt.volume = 1.0
        window.speechSynthesis.speak(utt)
      } catch {
        /* speech synthesis blocked or unavailable — drop silently */
      }
    },
    [enabled]
  )

  return { supported, enabled, setEnabled, speak }
}

/**
 * Map UI lang code to a SpeechSynthesis locale string. Browsers vary in
 * which voices are pre-installed, so picking a recognised BCP-47 tag
 * gives the best chance of a non-fallback voice firing.
 */
// Kept as a named export because callers and tests already use this name;
// the mapping itself now lives in utils/i18n so the mic and the spoken
// alerts cannot drift apart again.
export function ttsLocaleFor(lang) {
  return speechLocaleFor(lang)
}
