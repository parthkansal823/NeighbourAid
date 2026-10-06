import { describe, expect, it } from 'vitest'
import { LANGUAGES } from './i18n'
import { voiceCopy, voiceErrorMessage } from './voiceCopy'

describe('voice recovery copy', () => {
  it.each(LANGUAGES.map(language => language.code))('covers every control and error in %s', code => {
    const copy = voiceCopy(code)
    expect(Object.keys(copy)).toEqual(Object.keys(voiceCopy('en')))
    expect(Object.values(copy).every(text => text.trim().length > 0)).toBe(true)
    if (code !== 'en') for (const key of Object.keys(copy)) expect(copy[key]).not.toBe(voiceCopy('en')[key])
  })
  it('gives actionable messages without displaying raw vendor error codes', () => {
    expect(voiceErrorMessage('not-allowed', 'en')).toMatch(/Allow microphone/)
    expect(voiceErrorMessage('network', 'hi')).toMatch(/इंटरनेट/)
    expect(voiceErrorMessage('random vendor error', 'en')).toBe(voiceCopy('en').failed)
    expect(voiceCopy('unknown')).toBe(voiceCopy('en'))
  })
})
