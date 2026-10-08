import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '../utils/i18n'
import DevicePreferences from './DevicePreferences'

describe('device data and translation controls', () => {
  it('starts external auto-translation off and makes the recipient clear before opt-in', () => {
    render(<I18nProvider><DevicePreferences /></I18nProvider>)
    expect(screen.getByRole('checkbox', { name: /Automatically translate reports/ })).not.toBeChecked()
    expect(screen.getByText(/report text is sent to Google/)).toBeVisible()
    fireEvent.click(screen.getByRole('checkbox', { name: /Automatically translate reports/ }))
    expect(localStorage.getItem('autoTranslate')).toBe('1')
  })
  it('saves text-first mode and distinguishes translation clearing from offline report deletion', () => {
    localStorage.setItem('neighbouraid:tx-cache', JSON.stringify({ 'hi::private synthetic text': 'translation' }))
    localStorage.setItem('offline-synthetic-sentinel', 'keep')
    render(<I18nProvider><DevicePreferences /></I18nProvider>)
    fireEvent.click(screen.getByRole('checkbox', { name: /Text-first mode/ }))
    expect(localStorage.getItem('neighbouraid:text-first')).toBe('1')
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved translations' }))
    expect(localStorage.getItem('neighbouraid:tx-cache')).toBeNull()
    expect(localStorage.getItem('offline-synthetic-sentinel')).toBe('keep')
    expect(screen.getByRole('status')).toHaveTextContent('cleared from this device')
  })
})
