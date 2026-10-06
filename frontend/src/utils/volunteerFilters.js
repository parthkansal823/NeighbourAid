function searchText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

export function isMyAcceptedAlert(alert, userId) {
  // Missing IDs must never make unassigned alerts look like this user's tasks.
  return typeof userId === 'string' && userId.trim().length > 0 &&
    alert.status === 'accepted' && alert.accepted_by === userId
}

/**
 * Filter the feed's open alerts and this account's accepted tasks locally.
 * Active CRITICAL alerts bypass BOTH search and view, even when accepted by
 * someone else. Resolved/cancelled alerts never return through that exception.
 * Search public card fields only; preserve server order and the source objects.
 */
export function filterVolunteerAlerts({
  alerts = [],
  userId,
  query = '',
  scope = 'all',
  categoryLabels = {},
} = {}) {
  const terms = searchText(query).split(' ').filter(Boolean)

  return alerts.filter((alert) => {
    if (alert.status !== 'open' && alert.status !== 'accepted') return false
    if (alert.urgency === 'CRITICAL') return true

    const mine = isMyAcceptedAlert(alert, userId)
    if (scope === 'open' && alert.status !== 'open') return false
    if (scope === 'mine' && !mine) return false
    if (alert.status !== 'open' && !mine) return false
    if (terms.length === 0) return true

    const text = [
      alert.category, categoryLabels[alert.category], alert.headline,
      alert.description, alert.address,
    ].map(searchText).join(' ')
    return terms.every((term) => text.includes(term))
  })
}
