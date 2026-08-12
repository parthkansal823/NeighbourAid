import { useCallback, useEffect, useRef, useState } from 'react'
import { useLatest } from './useLatest'

/**
 * Web Speech API wrapper. Lets a reporter dictate the crisis description
 * with a mic button — useful in India where low-literacy users are a real
 * audience. Zero cost, zero server dependency, zero API key.
 *
 * Passes through en-IN by default so Indian-English accents are handled best.
 */
export function useVoice({ lang = 'en-IN', onResult } = {}) {
  const Recognition =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition)
  const supported = !!Recognition

  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recRef = useRef(null)
  const onResultRef = useLatest(onResult)

  const start = useCallback(() => {
    if (!supported) {
      setError('Voice input is not supported in this browser')
      return
    }
    setError('')
    const rec = new Recognition()
    rec.lang = lang
    rec.interimResults = true
    rec.continuous = false
    rec.onresult = (e) => {
      let finalText = ''
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) finalText += t
        else interim += t
      }
      onResultRef.current?.(finalText || interim, e.results[0]?.isFinal ?? false)
    }
    rec.onerror = (e) => {
      setError(e.error || 'voice error')
      setListening(false)
    }
    rec.onend = () => setListening(false)
    recRef.current = rec
    try {
      rec.start()
      setListening(true)
    } catch {
      setError('Failed to start microphone')
    }
    // onResultRef is a useRef container — its identity is stable for the
    // life of the hook, so listing it satisfies the linter without
    // re-creating the callback on every keystroke.
  }, [supported, lang, Recognition, onResultRef])

  const stop = useCallback(() => {
    recRef.current?.stop()
  }, [])

  useEffect(() => () => recRef.current?.abort?.(), [])

  return { supported, listening, error, start, stop }
}
