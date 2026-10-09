/**
 * Public-facing state for the asynchronous, two-stage alert review.
 *
 * `status` remains the dispatch lifecycle (open/accepted/resolved). Keeping
 * this separate prevents a reviewer transition from accidentally making an
 * alert look resolved or removing the controls a volunteer needs. The
 * backend may omit `review_status` while a rollout is in progress; omission
 * deliberately preserves the legacy visible behaviour.
 */
const REVIEW_STATUS_ALIASES = {
  pending: 'pending_first_review',
  first_pass_approved: 'approved',
  under_review: 'needs_review',
  verified: 'reviewed',
}

const REVIEW_STATUSES = new Set([
  'pending_first_review',
  'pending_second_review',
  'provisional',
  'approved',
  'reviewed',
  'needs_review',
  'restricted',
])

function normalise(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/gu, '_')
}

export function reviewStatusFor(alert) {
  const value = normalise(alert?.review_status)
  const status = REVIEW_STATUS_ALIASES[value] ?? value
  return REVIEW_STATUSES.has(status) ? status : null
}

export function isEmergencyAlert(alert) {
  const urgency = String(alert?.urgency ?? '').trim().toUpperCase()
  return urgency === 'CRITICAL' || urgency === 'HIGH'
}

/**
 * A non-emergency report held before its first review, or restricted after
 * review, must not linger in a stale REST/WebSocket view. Emergency grades
 * deliberately fail open: visibility and immediate action outrank an
 * asynchronous model result, and the server enforces the same invariant.
 */
export function isCommunityVisibleAlert(alert) {
  const reviewStatus = reviewStatusFor(alert)
  if (isEmergencyAlert(alert)) return true
  return reviewStatus !== 'pending_first_review' && reviewStatus !== 'pending_second_review' && reviewStatus !== 'restricted'
}

/**
 * Display language is intentionally cautious. A model review is useful
 * context, never proof that a report is true and never a reason to wait to
 * call emergency services for immediate danger.
 */
export function reviewPresentation(alert) {
  switch (reviewStatusFor(alert)) {
    case 'pending_first_review':
      return {
        label: 'Initial review pending',
        detail: 'This urgent alert is visible now while its safety review continues.',
        tone: 'pending',
      }
    case 'provisional':
      return {
        label: 'Provisional — review continuing',
        detail: 'Urgent alerts stay visible while automated safety review continues.',
        tone: 'pending',
      }
    case 'pending_second_review':
      return {
        label: 'Detailed review pending',
        detail: 'A stronger local safety review is checking this report before it is shared.',
        tone: 'pending',
      }
    case 'approved':
      return {
        label: 'Initial review passed',
        detail: 'A more detailed safety review is still running.',
        tone: 'approved',
      }
    case 'reviewed':
      return {
        label: 'Automated review complete',
        detail: 'This is not emergency-service confirmation.',
        tone: 'reviewed',
      }
    case 'needs_review':
      return {
        label: 'Review in progress',
        detail: 'Do not wait for review if there is immediate danger.',
        tone: 'pending',
      }
    case 'restricted':
      return {
        label: 'Safety review in progress',
        detail: 'This urgent alert remains visible while its review continues.',
        tone: 'restricted',
      }
    default:
      return null
  }
}
