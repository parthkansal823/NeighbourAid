import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EvidenceSummary, { evidenceFor } from './EvidenceSummary'
import { I18nProvider } from '../utils/i18n'

describe('Evidence explanation', () => {
  it('does not count the reporter as an independent witness', () => {
    expect(evidenceFor({ witnesses: 1 }).witnesses).toBe(0)
    expect(evidenceFor({ witnesses: 4 }).witnesses).toBe(3)
    expect(evidenceFor({ witnesses: -4 }).witnesses).toBe(0)
  })
  it('does not interpret missing vision review as a match', () => {
    expect(evidenceFor({ photo_evidence_score: 30 }).photoReview).toBe('not_checked')
  })
  it('explains that attachments and scores cannot prove truth', () => {
    render(<I18nProvider><EvidenceSummary alert={{ witnesses: 1, photo_evidence_score: 30 }} /></I18nProvider>)
    expect(screen.getByText(/not proof/i)).toBeInTheDocument()
    expect(screen.getByText(/contents have not been checked/i)).toBeInTheDocument()
    expect(screen.queryByText(/100%|high confidence/i)).not.toBeInTheDocument()
  })
})
