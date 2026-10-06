function searchText(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

/**
 * Keep the viewer-specific versions of posted/offered requests ahead of the
 * public nearby copies. This preserves released contact details and owner
 * offers, while retaining the API's ordering within each list.
 *
 * Search only public job fields, never contact details or offer notes.
 */
export function filterHelpRequests({
  nearby = [],
  posted = [],
  offered = [],
  query = '',
  kind = '',
  scope = 'all',
} = {}) {
  const personalIds = new Set([...posted, ...offered].map((item) => item.id))
  const terms = searchText(query).split(' ').filter(Boolean)
  const seen = new Set()

  return [...posted, ...offered, ...nearby].filter((item) => {
    // Deduplicate before matching: a stale public copy must not bring back
    // a request whose personal copy is already accepted or cancelled.
    if (seen.has(item.id)) return false
    seen.add(item.id)

    if (scope === 'open' && item.status !== 'open') return false
    if (scope === 'mine' && !personalIds.has(item.id)) return false
    if (kind && item.kind !== kind) return false

    const text = [item.kind, item.title, item.description].map(searchText).join(' ')
    return terms.every((term) => text.includes(term))
  })
}
