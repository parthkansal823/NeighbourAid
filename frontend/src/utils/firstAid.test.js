import { describe, expect, it } from 'vitest'
import { firstAidCopy, firstAidPath, FIRST_AID_SOURCES } from './firstAid'

describe('first aid safety gates', () => {
  it.each([false, undefined, 'yes', 1])('does not unlock instructions without explicit scene safety: %s', safe => {
    expect(firstAidPath({ safe, topic: 'collapse', adult: true, breathing: 'not-normal' })).toBe('unsafe')
  })
  it.each([false, undefined, 'yes'])('never uses adult CPR for a child or an unknown age: %s', adult => {
    expect(firstAidPath({ safe: true, topic: 'collapse', adult, breathing: 'not-normal' })).toBe('childHelp')
  })
  it('does not give compressions for normal or unknown breathing', () => {
    expect(firstAidPath({ safe: true, topic: 'collapse', adult: true, breathing: 'normal' })).toBe('normalHelp')
    expect(firstAidPath({ safe: true, topic: 'collapse', adult: true })).toBe('uncertain')
    expect(firstAidPath({ safe: true, topic: 'collapse', adult: true, breathing: 'not-normal' })).toBe('cpr')
  })
  it('only permits the heat-burn guide after the small-heat-burn check', () => {
    expect(firstAidPath({ safe: true, topic: 'burn' })).toBe('severeBurn')
    expect(firstAidPath({ safe: true, topic: 'burn', smallHeatBurn: true })).toBe('burn')
    expect(firstAidPath({ safe: true, topic: 'other' })).toBe('uncertain')
  })
  it('keeps English/Hindi steps aligned, speech-sized and sourced', () => {
    const en = firstAidCopy('en'), hi = firstAidCopy('hi')
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort())
    for (const topic of ['cpr', 'bleeding', 'burn']) {
      expect(hi[`${topic}Steps`]).toHaveLength(en[`${topic}Steps`].length)
      for (const copy of [en, hi]) for (const step of copy[`${topic}Steps`]) expect(step.join('. ').length).toBeLessThanOrEqual(500)
      expect(FIRST_AID_SOURCES[topic].every(s => s.url.startsWith('https://'))).toBe(true)
    }
    expect(en.cprSteps[2][1]).toContain('100–120')
    expect(hi.cprSteps[2][1]).toContain('100–120')
    expect(en.burnSteps[0][1]).toContain('20 minutes')
    expect(en.review).toContain('Not yet clinically reviewed')
  })
})
