import { describe, expect, it } from 'vitest'
import { LANGUAGES, speechLocaleFor } from './i18n'
import { assistantCopy, joinVoiceDraft } from './assistantCopy'

describe('voice interview language coverage', () => {
  it.each(LANGUAGES.map(l => [l.code]))('%s has complete prompts and its own recognition locale', code => {
    const copy = assistantCopy(code)
    expect(Object.keys(copy)).toEqual(Object.keys(assistantCopy('en')))
    expect(Object.values(copy).every(s => typeof s === 'string' && s.trim().length > 0)).toBe(true)
    expect(copy.question.length).toBeLessThanOrEqual(500)
    expect(speechLocaleFor(code).split('-')[0]).toBe(code)
    if (code !== 'en') expect(copy.question).not.toBe(assistantCopy('en').question)
  })
  it('preserves the existing draft and never truncates a medical detail', () => {
    expect(joinVoiceDraft(' Previous words ', ' New words ')).toBe('Previous words\nNew words')
    expect(joinVoiceDraft('', 'Help')).toBe('Help')
    expect(joinVoiceDraft('x'.repeat(2000), 'A child is trapped').length).toBeGreaterThan(2000)
  })
})
