import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { NeighbourAidSpeech } from '@neighbouraid/speech-input'
import { useLatest } from './useLatest'

/**
 * Dictation uses the Android system dialog in an APK and Web Speech on web.
 * Reviewable text only: no auto-submit and no app-owned audio recording.
 *
 * NOT on-device, despite running in the browser. Chrome streams the audio to
 * Google's speech service for recognition; Safari uses Apple's. Only the
 * transcript comes back. So this is a third-party data path, and callers
 * must disclose it — PostAlert renders `post_voice_privacy` next to the mic,
 * with a stronger `post_voice_privacy_anon` on the anonymous flow, where a
 * voiceprint would undo the anonymity the page promises.
 *
 * `lang` is a BCP-47 locale and should come from speechLocaleFor(lang) in
 * utils/i18n, not be hard-coded: recognition in the wrong language does not
 * fail, it returns confident nonsense.
 */
export function useVoice({ lang = 'en-IN', onResult } = {}) {
  const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  const plugin = native && Capacitor.isPluginAvailable('NeighbourAidSpeech')
  const Recognition =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  const [available, setAvailable] = useState(null)
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')
  const [interim, setInterim] = useState('')
  const sessionRef = useRef(null)
  const onResultRef = useLatest(onResult)
  const secure = typeof window !== 'undefined' && window.isSecureContext !== false
  const supported = native ? plugin && available !== false : typeof Recognition === 'function' && secure
  const unavailableReason = native ? plugin ? 'speech-service-unavailable' : 'native-upgrade' : secure ? 'unsupported' : 'insecure'

  useEffect(() => {
    let live = true
    if (plugin) NeighbourAidSpeech.isAvailable().then(result => {
      if (live) setAvailable(result.available === true)
    }).catch(() => { if (live) setAvailable(false) })
    return () => { live = false }
  }, [plugin])

  // Late callbacks cannot edit a closed form or a newly selected language.
  useEffect(() => {
    setStatus('idle'); setInterim(''); setError('')
    return () => {
      const session = sessionRef.current
      if (session) { session.active = false; clearTimeout(session.timer); session.rec?.abort?.() }
      sessionRef.current = null
    }
  }, [lang])

  const start = useCallback(() => {
    if (sessionRef.current?.active) return
    if (!supported) { setError(unavailableReason); return }
    setError(''); setInterim(''); setStatus('starting')
    const session = { active: true, stopped: false, final: false, errored: false, rec: null }
    sessionRef.current = session
    const live = () => session.active && sessionRef.current === session
    const finish = () => { clearTimeout(session.timer); if (live()) { session.active = false; setStatus('idle') } }
    if (native) {
      setStatus('listening')
      void NeighbourAidSpeech.recognize({ language: lang }).then(result => {
        if (!live() || result.cancelled) return
        const text = typeof result.text === 'string' ? result.text.trim() : ''
        if (text && text.length <= 2000) onResultRef.current?.(text, true)
        else setError('no-speech')
      }).catch(err => { if (live()) setError(err.code || 'failed') }).finally(finish)
      return
    }
    try {
      const rec = new Recognition()
      session.rec = rec
      rec.lang = lang
      rec.interimResults = true
      rec.continuous = false
      rec.maxAlternatives = 1
      const emitted = new Set()
      rec.onstart = () => { if (live()) { clearTimeout(session.timer); setStatus('listening') } }
      rec.onresult = event => {
        if (!live()) return
        const final = [], preview = []
        for (let index = 0; index < event.results.length; index++) {
          const result = event.results[index]
          const text = result[0]?.transcript?.trim()
          if (!text) continue
          if (result.isFinal) {
            if (!emitted.has(index)) { emitted.add(index); final.push(text) }
          } else preview.push(text)
        }
        setInterim(preview.join(' '))
        if (final.length) { session.final = true; onResultRef.current?.(final.join(' '), true) }
      }
      rec.onerror = event => {
        if (!live()) return
        session.errored = true
        if (!(session.stopped && event.error === 'aborted')) setError(event.error || 'failed')
        finish()
        rec.abort?.()
      }
      rec.onend = () => {
        if (!live()) return
        if (!session.final && !session.stopped && !session.errored) setError('no-speech')
        finish()
      }
      session.timer = setTimeout(() => {
        if (!live()) return
        setError('failed'); finish(); rec.abort?.()
      }, 12000)
      rec.start()
    } catch (err) {
      setError(err.name === 'NotAllowedError' || err.name === 'SecurityError' ? 'not-allowed' : 'failed')
      finish()
    }
  }, [supported, unavailableReason, native, lang, Recognition, onResultRef])

  const stop = useCallback(() => {
    const session = sessionRef.current
    if (!session?.active) return
    session.stopped = true
    if (!session.rec) { session.active = false; setStatus('idle'); return }
    setStatus('stopping')
    try {
      clearTimeout(session.timer)
      session.timer = setTimeout(() => {
        if (!session.active) return
        session.active = false; setStatus('idle')
        if (!session.final) setError('failed')
        session.rec.abort?.()
      }, 5000)
      session.rec.stop()
    }
    catch { session.active = false; setStatus('idle') }
  }, [])

  const cancel = useCallback(() => {
    const session = sessionRef.current
    if (session) { session.active = false; clearTimeout(session.timer); session.rec?.abort?.() }
    sessionRef.current = null
    setStatus('idle'); setInterim('')
  }, [])

  return { supported, native, status, listening: status !== 'idle', interim, error, unavailableReason, start, stop, cancel }
}
