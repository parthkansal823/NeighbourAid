import { describe, expect, it } from 'vitest'
import { apiError } from './error'

describe('apiError', () => {
  it('returns the API detail when the server provides one', () => {
    const err = { response: { data: { detail: 'Email already taken' } } }
    expect(apiError(err, 'fallback')).toBe('Email already taken')
  })

  it('joins a list of {msg} validation errors', () => {
    const err = {
      response: {
        data: {
          detail: [{ msg: 'too short' }, { msg: 'must be email' }],
        },
      },
    }
    expect(apiError(err, 'fallback')).toContain('too short')
  })

  it('uses the axios error message when no API detail is present', () => {
    const err = { message: 'Network Error' }
    expect(apiError(err, 'Could not load')).toBe('Network Error')
  })

  it('uses fallback when the error is undefined', () => {
    expect(apiError(undefined, 'Default')).toBe('Default')
  })
})
