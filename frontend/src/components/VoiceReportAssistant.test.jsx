import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '../utils/i18n'
import VoiceReportAssistant from './VoiceReportAssistant'
const mock = vi.hoisted(() => ({ onResult: null, start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), speak: vi.fn(), halt: vi.fn() }))
vi.mock('../hooks/useVoice', () => ({ useVoice: options => {
  mock.onResult = options.onResult
  return { supported: true, native: false, status: 'idle', listening: false, interim: '', error: '', start: mock.start, stop: mock.stop, cancel: mock.cancel }
} }))
vi.mock('../utils/speechPrompt', () => ({ speakPrompt: mock.speak, stopSpeechPrompt: mock.halt }))
beforeEach(() => { vi.clearAllMocks(); mock.speak.mockResolvedValue(false); localStorage.setItem('lang', 'en') })
function open(existingDescription = '') {
  const apply = vi.fn(), close = vi.fn()
  const view = render(<I18nProvider><VoiceReportAssistant categories={['medical', 'fire']} existingDescription={existingDescription} isAnonymous onApply={apply} onClose={close} /></I18nProvider>)
  return { apply, close, ...view }
}
it('opens without listening, records only after a click and requires draft + category confirmation', async () => {
  const { apply } = open('Already typed details')
  expect(mock.start).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Speak now' }))
  await waitFor(() => expect(mock.start).toHaveBeenCalledOnce())
  act(() => mock.onResult('A neighbour needs help'))
  const button = screen.getByRole('button', { name: 'Add to report' })
  expect(button).toBeDisabled()
  expect(apply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'medical' }))
  fireEvent.click(button)
  expect(apply).toHaveBeenCalledWith({ category: 'medical', description: 'Already typed details\nA neighbour needs help' })
})
it('does not start a microphone after the dialog closes during a spoken prompt', async () => {
  let finish
  mock.speak.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { unmount } = open()
  fireEvent.click(screen.getByRole('button', { name: 'Speak now' }))
  unmount()
  await act(async () => finish(true))
  expect(mock.start).not.toHaveBeenCalled()
})
it('keeps all 11 language choices, invalidates pending speech on a language change', async () => {
  let finish
  mock.speak.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  open()
  expect(screen.getAllByRole('option')).toHaveLength(11)
  fireEvent.click(screen.getByRole('button', { name: 'Speak now' }))
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'hi' } })
  await act(async () => finish(true))
  expect(mock.start).not.toHaveBeenCalled()
  expect(screen.getByText('क्या हुआ है? आपको कैसी मदद चाहिए?')).toBeInTheDocument()
})
it('does not silently truncate a long existing report', () => {
  const { apply } = open('x'.repeat(2000))
  act(() => mock.onResult('important new detail'))
  fireEvent.click(screen.getByRole('button', { name: 'medical' }))
  expect(screen.getByRole('button', { name: 'Add to report' })).toBeDisabled()
  expect(apply).not.toHaveBeenCalled()
})
