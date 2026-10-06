import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useVoice } from './useVoice'

const mocks = vi.hoisted(() => ({ native: false, plugin: true, available: vi.fn(), recognize: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native, getPlatform: () => mocks.native ? 'android' : 'web', isPluginAvailable: () => mocks.plugin } }))
vi.mock('@neighbouraid/speech-input', () => ({ NeighbourAidSpeech: { isAvailable: mocks.available, recognize: mocks.recognize } }))
let instances
function result(text, final) { return Object.assign([{ transcript: text }], { isFinal: final }) }
beforeEach(() => {
  mocks.native = false; mocks.plugin = true; vi.clearAllMocks(); instances = []
  mocks.available.mockResolvedValue({ available: true })
  class Recognition {
    constructor() { instances.push(this) }
    start = vi.fn()
    stop = vi.fn()
    abort = vi.fn()
  }
  vi.stubGlobal('SpeechRecognition', Recognition)
  vi.stubGlobal('webkitSpeechRecognition', undefined)
  vi.stubGlobal('isSecureContext', true)
})
afterEach(() => vi.unstubAllGlobals())

describe('web dictation', () => {
  it('shows interim text but emits only each final result once, even when index 0 is interim', () => {
    const callback = vi.fn(), { result: hook } = renderHook(() => useVoice({ lang: 'hi-IN', onResult: callback }))
    act(() => { hook.current.start(); hook.current.start() })
    expect(instances).toHaveLength(1)
    expect(instances[0].lang).toBe('hi-IN')
    act(() => instances[0].onstart())
    expect(hook.current.listening).toBe(true)
    act(() => instances[0].onresult({ resultIndex: 1, results: [result('अभी सुन रहा', false), result('आग लगी है', true)] }))
    expect(hook.current.interim).toBe('अभी सुन रहा')
    expect(callback).toHaveBeenLastCalledWith('आग लगी है', true)
    act(() => instances[0].onresult({ resultIndex: 1, results: [result('अभी सुन रहा', false), result('आग लगी है', true), result('दो लोग फंसे हैं', true)] }))
    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenLastCalledWith('दो लोग फंसे हैं', true)
  })
  it('collects multiple final pieces with spaces, not joined words', () => {
    const callback = vi.fn(), { result: hook } = renderHook(() => useVoice({ onResult: callback }))
    act(() => hook.current.start())
    act(() => instances[0].onresult({ resultIndex: 0, results: [result('Fire nearby', true), result('need help', true)] }))
    expect(callback).toHaveBeenCalledWith('Fire nearby need help', true)
  })
  it('contains constructor failures and allows a retry after a denied microphone', () => {
    vi.stubGlobal('SpeechRecognition', function Broken() { throw new DOMException('Denied', 'NotAllowedError') })
    const { result: hook } = renderHook(() => useVoice())
    act(() => hook.current.start())
    expect(hook.current.error).toBe('not-allowed')
    expect(hook.current.listening).toBe(false)
  })
  it('retains the final result after Stop and does not restart automatically', () => {
    const callback = vi.fn(), { result: hook } = renderHook(() => useVoice({ onResult: callback }))
    act(() => hook.current.start())
    act(() => hook.current.stop())
    expect(instances[0].stop).toHaveBeenCalledOnce()
    act(() => instances[0].onresult({ resultIndex: 0, results: [result('Need an ambulance', true)] }))
    act(() => instances[0].onend())
    expect(callback).toHaveBeenCalledWith('Need an ambulance', true)
    expect(hook.current.listening).toBe(false)
    expect(hook.current.error).toBe('')
    expect(instances).toHaveLength(1)
  })
  it('reports a silent end and network failure without remaining stuck recording', () => {
    const { result: hook } = renderHook(() => useVoice())
    act(() => hook.current.start())
    act(() => instances[0].onend())
    expect(hook.current.error).toBe('no-speech')
    act(() => hook.current.start())
    act(() => instances[1].onerror({ error: 'network' }))
    expect(hook.current.error).toBe('network')
    expect(hook.current.listening).toBe(false)
  })
  it('ignores late results after language change, a new session or unmount', () => {
    const callback = vi.fn(), { result: hook, rerender, unmount } = renderHook(({ lang }) => useVoice({ lang, onResult: callback }), { initialProps: { lang: 'en-IN' } })
    act(() => hook.current.start())
    const old = instances[0]
    rerender({ lang: 'hi-IN' })
    expect(old.abort).toHaveBeenCalledOnce()
    act(() => hook.current.start())
    act(() => old.onresult({ results: [result('old words', true)] }))
    expect(callback).not.toHaveBeenCalled()
    unmount()
    act(() => instances[1].onresult({ results: [result('late words', true)] }))
    expect(callback).not.toHaveBeenCalled()
  })
  it('explains unsupported and insecure environments', () => {
    vi.stubGlobal('isSecureContext', false)
    const { result: hook } = renderHook(() => useVoice())
    expect(hook.current.supported).toBe(false)
    act(() => hook.current.start())
    expect(hook.current.error).toBe('insecure')
    expect(instances).toHaveLength(0)
  })
})

describe('Android dictation', () => {
  beforeEach(() => { mocks.native = true; vi.stubGlobal('SpeechRecognition', undefined) })
  it('uses native speech when Web Speech is absent, with the selected language', async () => {
    mocks.recognize.mockResolvedValue({ text: 'बिजली का तार गिरा है' })
    const callback = vi.fn(), { result: hook } = renderHook(() => useVoice({ lang: 'hi-IN', onResult: callback }))
    await waitFor(() => expect(mocks.available).toHaveBeenCalled())
    await act(async () => hook.current.start())
    expect(mocks.recognize).toHaveBeenCalledWith({ language: 'hi-IN' })
    expect(callback).toHaveBeenCalledWith('बिजली का तार गिरा है', true)
    expect(hook.current.listening).toBe(false)
  })
  it('does not turn native cancellation into a report or an error', async () => {
    mocks.recognize.mockResolvedValue({ cancelled: true })
    const callback = vi.fn(), { result: hook } = renderHook(() => useVoice({ onResult: callback }))
    await act(async () => hook.current.start())
    expect(callback).not.toHaveBeenCalled()
    expect(hook.current.error).toBe('')
  })
  it('requires the new APK instead of pretending WebView speech is supported', () => {
    mocks.plugin = false
    const { result: hook } = renderHook(() => useVoice())
    expect(hook.current.supported).toBe(false)
    expect(hook.current.unavailableReason).toBe('native-upgrade')
  })
  it('explains an absent phone speech service and ignores late native results', async () => {
    mocks.available.mockResolvedValue({ available: false })
    const unavailable = renderHook(() => useVoice())
    await waitFor(() => expect(unavailable.result.current.supported).toBe(false))
    unavailable.unmount()
    mocks.available.mockResolvedValue({ available: true })
    let resolve
    mocks.recognize.mockImplementation(() => new Promise(done => { resolve = done }))
    const callback = vi.fn(), { result: hook, unmount } = renderHook(() => useVoice({ onResult: callback }))
    act(() => hook.current.start())
    unmount()
    await act(async () => resolve({ text: 'Do not save this' }))
    expect(callback).not.toHaveBeenCalled()
  })
})
