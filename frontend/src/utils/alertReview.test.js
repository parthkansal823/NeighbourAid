import { describe, expect, it } from 'vitest'
import {
  isCommunityVisibleAlert,
  isEmergencyAlert,
  reviewPresentation,
  reviewStatusFor,
} from './alertReview'

describe('alert review state', () => {
  it('accepts only known optional review states and normalises wire-format separators', () => {
    expect(reviewStatusFor({ review_status: 'needs-review' })).toBe('needs_review')
    expect(reviewStatusFor({ review_status: ' UNDER REVIEW ' })).toBe('needs_review')
    expect(reviewStatusFor({ review_status: 'unknown_future_state' })).toBeNull()
    expect(reviewStatusFor({})).toBeNull()
  })

  it('keeps the dispatch lifecycle independent from review status', () => {
    expect(reviewStatusFor({ status: 'resolved' })).toBeNull()
    expect(reviewStatusFor({ status: 'open', review_status: 'approved' })).toBe('approved')
  })

  it('holds non-emergency reports that have not passed first review or were restricted', () => {
    expect(isCommunityVisibleAlert({ urgency: 'MEDIUM', review_status: 'pending_first_review' })).toBe(false)
    expect(isCommunityVisibleAlert({ urgency: 'MEDIUM', review_status: 'pending_second_review' })).toBe(false)
    expect(isCommunityVisibleAlert({ urgency: 'LOW', review_status: 'restricted' })).toBe(false)
    expect(isCommunityVisibleAlert({ urgency: 'MEDIUM', review_status: 'needs_review' })).toBe(true)
    expect(isCommunityVisibleAlert({ urgency: 'LOW' })).toBe(true)
  })

  it('fails open for HIGH and CRITICAL alerts regardless of an asynchronous review state', () => {
    expect(isEmergencyAlert({ urgency: 'high' })).toBe(true)
    expect(isEmergencyAlert({ urgency: 'CRITICAL' })).toBe(true)
    expect(isCommunityVisibleAlert({ urgency: 'HIGH', review_status: 'pending_first_review' })).toBe(true)
    expect(isCommunityVisibleAlert({ urgency: 'CRITICAL', review_status: 'restricted' })).toBe(true)
  })

  it('uses cautious labels rather than treating model review as proof', () => {
    expect(reviewPresentation({ review_status: 'provisional' })).toMatchObject({
      label: 'Provisional — review continuing',
      tone: 'pending',
    })
    expect(reviewPresentation({ review_status: 'reviewed' }).detail).toContain('not emergency-service confirmation')
    expect(reviewPresentation({ review_status: 'pending_second_review' }).label).toBe('Detailed review pending')
    expect(reviewPresentation({})).toBeNull()
  })
})
