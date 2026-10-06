import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { ttsLocaleFor, useVoiceAlert } from './useVoiceAlert'

let speakSpy
let cancelSpy

beforeEach(() => {
  // jsdom doesn't ship speechSynthesis — install a tiny shim that records calls
  speakSpy = vi.fn()
  cancelSpy = vi.fn()
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: { speak: speakSpy, cancel: cancelSpy },
  })
  // SpeechSynthesisUtterance also missing in jsdom
  window.SpeechSynthesisUtterance = function Utt(text) {
    this.text = text
    this.lang = 'en-IN'
    this.rate = 1
    this.pitch = 1
    this.volume = 1
  }
  localStorage.clear()
})

afterEach(() => {
  delete window.speechSynthesis
  delete window.SpeechSynthesisUtterance
})

describe('ttsLocaleFor', () => {
  it('maps lang codes to BCP-47 locales', () => {
    expect(ttsLocaleFor('en')).toBe('en-IN')
    expect(ttsLocaleFor('hi')).toBe('hi-IN')
    expect(ttsLocaleFor('pa')).toBe('pa-IN')
    expect(ttsLocaleFor(undefined)).toBe('en-IN')
  })
})

describe('useVoiceAlert', () => {
  it('reports supported when speechSynthesis is present', () => {
    const { result } = renderHook(() => useVoiceAlert())
    expect(result.current.supported).toBe(true)
  })

  it('defaults to enabled=true on first run', () => {
    const { result } = renderHook(() => useVoiceAlert())
    expect(result.current.enabled).toBe(true)
  })

  it('persists the toggle to localStorage', () => {
    const { result } = renderHook(() => useVoiceAlert())
    act(() => result.current.setEnabled(false))
    expect(localStorage.getItem('voiceAlerts')).toBe('0')
  })

  it('speak() cancels any in-flight utterance and calls speechSynthesis.speak', () => {
    const { result } = renderHook(() => useVoiceAlert())
    act(() => result.current.speak('Critical fire alert', { lang: 'hi-IN' }))
    expect(cancelSpy).toHaveBeenCalledOnce()
    expect(speakSpy).toHaveBeenCalledOnce()
    const utt = speakSpy.mock.calls[0][0]
    expect(utt.text).toBe('Critical fire alert')
    expect(utt.lang).toBe('hi-IN')
  })

  it('speak() is a no-op when disabled', () => {
    const { result } = renderHook(() => useVoiceAlert())
    act(() => result.current.setEnabled(false))
    act(() => result.current.speak('hello'))
    expect(speakSpy).not.toHaveBeenCalled()
  })
})
