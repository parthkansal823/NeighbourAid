import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { I18nProvider } from '../utils/i18n'
import OutcomeSummary, { outcomeLabel } from './OutcomeSummary'

describe('truthful alert outcomes', () => {
  it.each([
    ['expired_unconfirmed', 'Closed after expiry; safety not confirmed'],
    ['practice_ended', 'Practice drill ended'],
    ['volunteer_reported_resolved', 'Volunteer reported resolved'],
    ['reporter_confirmed_safe', 'Reporter confirmed safe'],
    ['resolution_unconfirmed', 'Closed; safety not confirmed'],
  ])('uses the recorded source for %s', (outcome, label) => {
    render(<I18nProvider><OutcomeSummary alert={{ status: 'resolved', outcome }} /></I18nProvider>)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
  it('does not infer safety from a legacy resolved status', () => {
    expect(outcomeLabel({ status: 'resolved' })).toBe('Closed; safety not confirmed')
  })
  it('records volunteered progress separately from outcome and never invents a timestamp', () => {
    const { container } = render(<I18nProvider><OutcomeSummary alert={{ status: 'accepted', response_progress: 'arrived' }} /></I18nProvider>)
    expect(screen.getByText('Volunteer reports: arrived')).toBeInTheDocument()
    expect(container.querySelector('time')).toBeNull()
    expect(screen.queryByText('Reporter confirmed safe')).not.toBeInTheDocument()
  })
})
