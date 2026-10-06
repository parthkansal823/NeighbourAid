import { afterEach, describe, expect, it } from 'vitest'
import { AxiosError } from 'axios'
import api from './api'

afterEach(() => localStorage.clear())

describe('API session isolation', () => {
  it('adds the current token to normal authenticated requests', async () => {
    localStorage.setItem('token', 'alice')
    await api.get('/test', { adapter: async (config) => {
      expect(config.headers.get('Authorization')).toBe('Bearer alice')
      return { data: {}, status: 200, headers: {}, config }
    } })
  })

  it('preserves a token pinned at submission time after an account switch', async () => {
    localStorage.setItem('token', 'bob')
    await api.post('/test', {}, { headers: { Authorization: 'Bearer alice' }, adapter: async (config) => {
      expect(config.headers.get('Authorization')).toBe('Bearer alice')
      return { data: {}, status: 200, headers: {}, config }
    } })
  })

  it('does not send credentials to an explicitly anonymous request', async () => {
    localStorage.setItem('token', 'alice')
    await api.post('/test', {}, { skipAuth: true, adapter: async (config) => {
      expect(config.headers.has('Authorization')).toBe(false)
      return { data: {}, status: 200, headers: {}, config }
    } })
  })

  it('a late 401 cannot log out a different account', async () => {
    localStorage.setItem('token', 'bob')
    await expect(api.get('/test', { headers: { Authorization: 'Bearer alice' }, adapter: async (config) => {
      throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, null, { status: 401 })
    } })).rejects.toThrow('expired')
    expect(localStorage.getItem('token')).toBe('bob')
  })

  it('logs out only the current rejected session', async () => {
    localStorage.setItem('token', 'alice')
    await expect(api.get('/test', { adapter: async (config) => {
      throw new AxiosError('expired', 'ERR_BAD_REQUEST', config, null, { status: 401 })
    } })).rejects.toThrow('expired')
    expect(localStorage.getItem('token')).toBeNull()
  })
})
