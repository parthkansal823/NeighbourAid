import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { translateText, clearTranslationCache } from './translate'

beforeEach(() => {
  clearTranslationCache()
  vi.restoreAllMocks()
})

afterEach(() => {
  clearTranslationCache()
})

function mockGtxOnce(translated) {
  // gtx response shape: [[[ "translated", "original", null, null, ... ]]]
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => [[[translated, 'original', null, null, 1, null, null, []]]],
  }))
}

describe('translateText', () => {
  it('returns original input when text is empty', async () => {
    const out = await translateText('   ', 'hi')
    expect(out).toBe('   ')
  })

  it('returns original when target is missing', async () => {
    const out = await translateText('hello', '')
    expect(out).toBe('hello')
  })

  it('returns translation from gtx and caches subsequent calls', async () => {
    mockGtxOnce('नमस्ते')
    const first = await translateText('hello', 'hi')
    expect(first).toBe('नमस्ते')
    expect(global.fetch).toHaveBeenCalledTimes(1)

    // Second call must hit the cache, not the network
    const second = await translateText('hello', 'hi')
    expect(second).toBe('नमस्ते')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to the original text when gtx fails', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 503 }))
    const out = await translateText('hello there', 'hi')
    // The fallback returns the trimmed original, not an empty string
    expect(out).toBe('hello there')
  })

  it('falls back when fetch throws (network blocked)', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network error')
    })
    const out = await translateText('hello', 'hi')
    expect(out).toBe('hello')
  })

  it('persists the cache to localStorage so reloads are free', async () => {
    mockGtxOnce('नमस्ते')
    await translateText('hello', 'hi')
    // Wait a turn for the debounced LS write
    await new Promise((resolve) => setTimeout(resolve, 800))
    const raw = localStorage.getItem('neighbouraid:tx-cache')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw)
    expect(parsed['hi::hello']).toBe('नमस्ते')
  })
})

describe('a failed translation is not cached', () => {
  /**
   * The bug this guards.
   *
   * The catch block used to `memCache.set(key, trimmed)` — it stored the
   * UNTRANSLATED text under the translation's cache key, and that cache is
   * persisted to localStorage. So one failure meant that string was never
   * translated again on that device, even long after the endpoint recovered.
   *
   * It was not a rare path either: the gtx endpoint is undocumented and
   * unversioned, and currently answers anonymous callers with HTTP 429.
   */
  it('retries after a failure instead of serving the original forever', async () => {
    let calls = 0
    global.fetch = vi.fn(async () => {
      calls += 1
      if (calls === 1) return { ok: false, status: 429, json: async () => ({}) }
      return {
        ok: true,
        json: async () => [[['अनुवादित', 'original', null, null, 1, null, null, []]]],
      }
    })

    const first = await translateText('fire near gate 3', 'hi')
    expect(first).toBe('fire near gate 3') // fails soft, as it should

    const second = await translateText('fire near gate 3', 'hi')
    expect(second).toBe('अनुवादित')
    expect(calls).toBe(2) // the second view actually tried again
  })

  it('still caches a success, so a repeat view costs nothing', async () => {
    let calls = 0
    global.fetch = vi.fn(async () => {
      calls += 1
      return {
        ok: true,
        json: async () => [[['अनुवादित', 'original', null, null, 1, null, null, []]]],
      }
    })

    await translateText('fire near gate 3', 'hi')
    await translateText('fire near gate 3', 'hi')
    expect(calls).toBe(1)
  })
})
