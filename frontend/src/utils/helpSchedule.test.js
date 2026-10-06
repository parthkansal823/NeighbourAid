import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { helpSchedule, helpTimeline, localHelpTime, recordedTime } from './helpSchedule'
import en from '../i18n/en'
import hi from '../i18n/hi'
import bn from '../i18n/bn'
import mr from '../i18n/mr'
import te from '../i18n/te'
import ta from '../i18n/ta'
import gu from '../i18n/gu'
import pa from '../i18n/pa'
import kn from '../i18n/kn'
import ml from '../i18n/ml'
import or from '../i18n/or'

const NOW = Date.parse('2026-10-06T00:00:00Z')
const options = { now: NOW }
const valid = ['2026-10-07T10:00:00Z', '2026-10-07T12:00:00Z']

describe('preferred help windows', () => {
  it.each([[undefined, undefined], [null, null]])('keeps both absent times flexible', (start, end) => {
    expect(helpSchedule(start, end, options)).toEqual({ schedule_start: null, schedule_end: null })
  })

  it('keeps empty native inputs flexible but does not accept empty API strings', () => {
    expect(helpSchedule('', '', { ...options, local: true })).toEqual({ schedule_start: null, schedule_end: null })
    expect(helpSchedule('', '', options)).toEqual({ error: 'help_schedule_invalid' })
  })

  it.each([
    [valid[0], null, 'pair'], [undefined, valid[1], 'pair'],
    ['2026-10-07T10:00', valid[1], 'invalid'],
    ['wrong', valid[1], 'invalid'], [123, valid[1], 'invalid'],
    ['2026-10-06T00:00:00Z', valid[1], 'future'],
    ['2026-10-05T23:59:59Z', valid[1], 'future'],
    [valid[0], valid[0], 'order'], [valid[1], valid[0], 'order'],
    [valid[0], '2026-10-08T10:00:01Z', 'duration'],
    ['2026-10-19T12:00:00Z', '2026-10-20T00:00:01Z', 'limit'],
  ])('rejects %s → %s', (start, end, reason) => {
    expect(helpSchedule(start, end, options)).toEqual({ error: `help_schedule_${reason}` })
  })

  it('accepts inclusive 24-hour and 14-day bounds', () => {
    expect(helpSchedule('2026-10-19T00:00:00Z', '2026-10-20T00:00:00Z', options)).toEqual({
      schedule_start: '2026-10-19T00:00:00.000Z', schedule_end: '2026-10-20T00:00:00.000Z',
    })
  })

  it('normalizes timezone-aware API times to UTC', () => {
    expect(helpSchedule('2026-10-07T15:30:00+05:30', '2026-10-07T17:30:00+05:30', options)).toEqual({
      schedule_start: valid[0].replace('Z', '.000Z'), schedule_end: valid[1].replace('Z', '.000Z'),
    })
  })

  it.each([
    ['Asia/Kolkata', '2026-10-07T04:30:00.000Z'],
    ['America/New_York', '2026-10-07T14:00:00.000Z'],
  ])('converts native values in %s, rather than treating local time as UTC', (timezone, expected) => {
    const script = `import {helpSchedule} from './src/utils/helpSchedule.js';
      process.stdout.write(JSON.stringify(helpSchedule('2026-10-07T10:00','2026-10-07T12:00',{local:true,now:${NOW}})))`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: process.cwd(), env: { ...process.env, TZ: timezone }, encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).schedule_start).toBe(expected)
  })

  it('rejects rolled calendar dates in both native and aware timestamps', () => {
    expect(helpSchedule('2027-02-30T10:00', '2027-03-03T10:00', { ...options, local: true }).error).toBe('help_schedule_invalid')
    expect(recordedTime('2026-02-30T10:00:00Z')).toBeNull()
    expect(recordedTime('2026-10-07T24:00:00Z')).toBeNull()
  })
})

describe('recorded timeline and local display', () => {
  it('omits unknown events and missing, naive or invalid dates without inferring others', () => {
    const posted = { event: 'posted', at: valid[0] }
    const timeline = [posted, { event: 'accepted' }, { event: 'started', at: 'bad' },
      { event: 'done', at: '2026-10-07T10:00' }, { event: 'reminded', at: valid[1] }, null]
    expect(helpTimeline(timeline)).toEqual([posted])
    expect(helpTimeline(undefined)).toEqual([])
    expect(helpTimeline({})).toEqual([])
    expect(timeline).toHaveLength(6)
  })

  it('formats only valid recorded times, including unsupported locale fallback', () => {
    expect(localHelpTime(valid[0], 'hi')).toBeTruthy()
    expect(localHelpTime(valid[0], 'bad_locale')).toBeTruthy()
    expect(localHelpTime(null)).toBeNull()
    expect(localHelpTime('yesterday')).toBeNull()
  })
})

describe('help feature translations', () => {
  const keys = Object.keys(en).filter((key) => key.startsWith('help_schedule_') || key.startsWith('help_event_')
    || ['help_timeline', 'help_timeline_private', 'help_start_work', 'help_started'].includes(key))
  it.each(Object.entries({ hi, bn, mr, te, ta, gu, pa, kn, ml, or }))('%s has real text for every new label and error', (_lang, dict) => {
    expect(keys).toHaveLength(21)
    for (const key of keys) {
      expect(dict[key], key).toBeTruthy()
      expect(dict[key], key).not.toBe(en[key])
    }
  })
})
