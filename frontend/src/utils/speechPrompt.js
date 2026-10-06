import { Capacitor } from '@capacitor/core'
import { NeighbourAidSpeech } from '@neighbouraid/speech-input'

let pending = null
export function stopSpeechPrompt() {
  pending?.()
  pending = null
  if (Capacitor.isNativePlatform()) {
    if (Capacitor.isPluginAvailable('NeighbourAidSpeech')) void NeighbourAidSpeech.stopPrompt().catch(() => {})
  } else window.speechSynthesis?.cancel()
}

/** Static prompts only. Never silently read a language using a different voice. */
export function speakPrompt(text, language) {
  stopSpeechPrompt()
  return new Promise(resolve => {
    let timer, done = false
    const finish = spoken => {
      if (done) return
      done = true; clearTimeout(timer)
      if (pending === cancel) pending = null
      resolve(spoken)
    }
    const cancel = () => finish(false)
    pending = cancel
    timer = setTimeout(() => { stopSpeechPrompt(); finish(false) }, 15000)
    if (Capacitor.isNativePlatform()) {
      if (!Capacitor.isPluginAvailable('NeighbourAidSpeech')) { finish(false); return }
      void NeighbourAidSpeech.speakPrompt({ text, language }).then(r => finish(r.spoken === true)).catch(() => finish(false))
      return
    }
    const synth = window.speechSynthesis
    if (!synth || !window.SpeechSynthesisUtterance) { finish(false); return }
    const voices = synth.getVoices()
    const voice = voices.find(v => v.lang.toLowerCase() === language.toLowerCase()) || voices.find(v => v.lang.split('-')[0] === language.split('-')[0])
    // Voice lists may load lazily. Do not gamble on an unknown default voice;
    // the visible question works, and the next attempt can use the loaded list.
    if (!voice) { finish(false); return }
    try {
      const utterance = new window.SpeechSynthesisUtterance(text)
      utterance.lang = language; if (voice) utterance.voice = voice
      utterance.onend = () => finish(true)
      utterance.onerror = () => finish(false)
      synth.speak(utterance)
    } catch { finish(false) }
  })
}
