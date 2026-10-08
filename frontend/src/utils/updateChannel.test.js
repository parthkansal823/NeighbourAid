import { describe, expect, it } from 'vitest'
import { hasReleaseUpdateChannel } from './updateChannel'

describe('signed release update channel', () => {
  it('allows checks only for the explicit release channel', () => {
    expect(hasReleaseUpdateChannel({ channel: 'release', versionCode: 42 })).toBe(true)
  })

  it.each([null, {}, { channel: 'debug' }, { channel: 'demo' }, { channel: 'Release' }, { channel: 'unknown' }])(
    'does not confuse a development or unknown build with a release: %j', build => {
      expect(hasReleaseUpdateChannel(build)).toBe(false)
    },
  )

  it('uses the bundled channel, not the size of its version code', () => {
    expect(hasReleaseUpdateChannel()).toBe(__APP_BUILD__.channel === 'release')
    expect(hasReleaseUpdateChannel({ channel: 'debug', versionCode: 999999 })).toBe(false)
  })
})
