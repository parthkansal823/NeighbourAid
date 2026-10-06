import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { I18nProvider } from '../utils/i18n'
import FirstAidButton from './FirstAidGuide'
vi.mock('../utils/speechPrompt', () => ({ speakPrompt: vi.fn().mockResolvedValue(true), stopSpeechPrompt: vi.fn() }))
beforeEach(() => localStorage.setItem('lang', 'en'))
function open() {
  render(<I18nProvider><FirstAidButton /></I18nProvider>)
  const trigger = screen.getByRole('button', { name: 'First-aid guide' })
  trigger.focus()
  fireEvent.click(trigger)
}
it('keeps emergency calling reachable before any answer, then refuses unsafe assistance', () => {
  open()
  expect(screen.getByRole('link', { name: 'Call 112' })).toHaveAttribute('href', 'tel:112')
  fireEvent.click(screen.getByRole('button', { name: 'No / I am not sure' }))
  expect(screen.getByText(/Stay clear of traffic/)).toBeInTheDocument()
  expect(screen.queryByText('Push and release')).not.toBeInTheDocument()
})
it('requires adult and breathing checks and shows ALL CPR steps together', () => {
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Yes, I can safely help' }))
  fireEvent.click(screen.getByRole('button', { name: 'Person is not responding' }))
  expect(screen.queryByText('Push and release')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Yes, an adult' }))
  fireEvent.click(screen.getByRole('button', { name: 'No / only gasping' }))
  expect(screen.getByText('Push and release')).toBeInTheDocument()
  expect(screen.getAllByRole('listitem')).toHaveLength(4)
  expect(screen.queryByRole('button', { name: /complete|done|cured/i })).not.toBeInTheDocument()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'First-aid guide' })).toHaveFocus()
})
it('does not start adult CPR for a child or for normal breathing', () => {
  open()
  fireEvent.click(screen.getByRole('button', { name: 'Yes, I can safely help' }))
  fireEvent.click(screen.getByRole('button', { name: 'Person is not responding' }))
  fireEvent.click(screen.getByRole('button', { name: 'Child / baby / not sure' }))
  expect(screen.getByText(/Children and babies need different CPR/)).toBeInTheDocument()
  expect(screen.queryByText('Push and release')).not.toBeInTheDocument()
})
