import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebUpdateNotice from './WebUpdateNotice'
import { registerScreenNavigationGuard } from '../utils/androidBack'

const mocks = vi.hoisted(() => ({ native: false }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native } }))
let serviceWorker, registration, waiting
const cleanup = []
beforeEach(() => {
  vi.stubEnv('PROD', true)
  mocks.native = false
  waiting = { postMessage: vi.fn() }
  registration = new EventTarget()
  Object.assign(registration, { waiting, installing: null, update: vi.fn().mockResolvedValue(undefined) })
  serviceWorker = new EventTarget()
  Object.assign(serviceWorker, { controller: {}, register: vi.fn().mockResolvedValue(registration) })
  vi.stubGlobal('navigator', { onLine: true, serviceWorker })
})
afterEach(() => { cleanup.splice(0).forEach(dispose => dispose()); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('safe website upgrades', () => {
  it('does not discard a new draft started while the worker activates', async () => {
    const reload = vi.fn()
    const canLeave = vi.fn(() => true)
    cleanup.push(registerScreenNavigationGuard(canLeave))
    render(<WebUpdateNotice reload={reload} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reload to update' }))
    canLeave.mockReturnValue(false)
    act(() => serviceWorker.dispatchEvent(new Event('controllerchange')))
    expect(reload).not.toHaveBeenCalled()
    canLeave.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reload to update' }))
    expect(reload).toHaveBeenCalledOnce()
  })
  it('requires explicit safe approval before activation and reload', async () => {
    const reload = vi.fn()
    const canLeave = vi.fn(() => false)
    cleanup.push(registerScreenNavigationGuard(canLeave))
    render(<WebUpdateNotice reload={reload} />)
    const button = await screen.findByRole('button', { name: 'Reload to update' })
    expect(serviceWorker.register).toHaveBeenCalledWith('/service-worker.js')
    act(() => serviceWorker.dispatchEvent(new Event('controllerchange')))
    expect(reload).not.toHaveBeenCalled()
    fireEvent.click(button)
    expect(waiting.postMessage).not.toHaveBeenCalled()
    canLeave.mockReturnValue(true)
    fireEvent.click(button)
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled()
    act(() => serviceWorker.dispatchEvent(new Event('controllerchange')))
    expect(reload).toHaveBeenCalledOnce()
  })
  it('does not show an upgrade prompt on first install or register on native', async () => {
    serviceWorker.controller = null
    const view = render(<WebUpdateNotice />)
    await waitFor(() => expect(serviceWorker.register).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    view.unmount()
    serviceWorker.register.mockClear()
    mocks.native = true
    render(<WebUpdateNotice />)
    expect(serviceWorker.register).not.toHaveBeenCalled()
  })
  it('keeps the existing screen when activating the waiting worker fails', async () => {
    waiting.postMessage.mockImplementation(() => { throw new Error('worker gone') })
    const reload = vi.fn()
    render(<WebUpdateNotice reload={reload} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reload to update' }))
    expect(screen.getByRole('status')).toHaveTextContent('Reload could not start')
    act(() => serviceWorker.dispatchEvent(new Event('controllerchange')))
    expect(reload).not.toHaveBeenCalled()
  })
})
