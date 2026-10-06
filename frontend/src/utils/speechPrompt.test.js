import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { speakPrompt, stopSpeechPrompt } from './speechPrompt'
const native = vi.hoisted(() => ({ enabled: false, speak: vi.fn(), stop: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.enabled, isPluginAvailable: () => true } }))
vi.mock('@neighbouraid/speech-input', () => ({ NeighbourAidSpeech: { speakPrompt: native.speak, stopPrompt: native.stop } }))
let synth, utterances
beforeEach(() => {
  native.enabled = false; vi.clearAllMocks(); native.stop.mockResolvedValue({})
  utterances = []
  synth = { getVoices: vi.fn().mockReturnValue([{ lang: 'hi-IN' }]), cancel: vi.fn(), speak: vi.fn(u => utterances.push(u)) }
  vi.stubGlobal('speechSynthesis', synth)
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(text) { this.text = text } })
})
afterEach(() => { stopSpeechPrompt(); vi.unstubAllGlobals(); vi.useRealTimers() })
it('uses the requested voice and settles only after playback completion', async () => {
  const pending = speakPrompt('क्या हुआ?', 'hi-IN')
  expect(utterances[0].lang).toBe('hi-IN')
  utterances[0].onend()
  expect(await pending).toBe(true)
})
it('does not read unsupported locales with another language voice', async () => {
  expect(await speakPrompt('தமிழ்', 'ta-IN')).toBe(false)
  expect(synth.speak).not.toHaveBeenCalled()
})
it('cancel and timeout settle pending prompts, so the UI cannot hang', async () => {
  vi.useFakeTimers()
  const first = speakPrompt('सवाल', 'hi-IN')
  stopSpeechPrompt(); expect(await first).toBe(false)
  const second = speakPrompt('सवाल', 'hi-IN')
  await vi.advanceTimersByTimeAsync(15000)
  expect(await second).toBe(false)
})
it('uses the Android prompt method instead of a WebView speech API', async () => {
  native.enabled = true; native.speak.mockResolvedValue({ spoken: true })
  expect(await speakPrompt('सवाल', 'hi-IN')).toBe(true)
  expect(native.speak).toHaveBeenCalledWith({ text: 'सवाल', language: 'hi-IN' })
  expect(synth.speak).not.toHaveBeenCalled()
})
