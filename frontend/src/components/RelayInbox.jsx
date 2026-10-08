import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import api from '../utils/api'
import HelpRelay from './HelpRelay'

/** Named handoffs are discoverable even beyond the GPS radius. */
export default function RelayInbox({ visibleAlertIds = [] }) {
  const { user, token } = useAuth()
  if (user?.role !== 'volunteer') return null
  return <Inbox key={`${user.id}:${token || ''}`} userId={user.id} visibleAlertIds={visibleAlertIds} />
}
function Inbox({ userId, visibleAlertIds }) {
  const query = useQuery({
    queryKey: ['coordination-inbox', userId],
    queryFn: async ({ signal }) => {
      const { data } = await api.get('/api/alerts/coordination/mine', { signal })
      return Array.isArray(data) ? data : []
    },
    staleTime: 0, gcTime: 60000, retry: false,
    refetchInterval: () => document.visibilityState === 'visible' ? 15000 : false,
    refetchIntervalInBackground: false,
  })
  const error = query.error ? 'Your relay tasks could not refresh. Check your connection and retry.' : ''
  const forbidden = [401, 403, 404].includes(query.error?.response?.status)
  const rows = forbidden ? [] : query.data || []
  const handoffs = rows.filter(row => row.handoff_offered_to_me === true || !visibleAlertIds.includes(row.id))
  if (!error && handoffs.length === 0) return null
  return <section className="mb-5 rounded-2xl border border-line bg-surface-1 p-4" aria-label="Your relay tasks">
    <h2 className="text-base font-semibold text-app-ink">Your relay tasks</h2>
    <p className="mt-1 text-xs leading-relaxed text-app-muted">Assigned tasks outside your nearby feed and offers addressed to you appear here, regardless of distance. A handoff needs your explicit acceptance.</p>
    {error && <p role="status" className="mt-3 text-sm text-app-muted">{error}</p>}
    {query.dataUpdatedAt > 0 && <p className="mt-2 text-xs text-app-muted">{error ? 'Cached offers, not current. Last checked ' : 'Server checked '}{new Date(query.dataUpdatedAt).toLocaleTimeString()}</p>}
    <button type="button" disabled={query.isFetching} onClick={() => { void query.refetch() }} className="tap app-secondary-button mt-3">Refresh relay inbox</button>
    <ul className="mt-3 space-y-3">{handoffs.map(alert => <li key={alert.id} className="min-w-0 border-t border-line pt-3"><Link to={`/alert/${encodeURIComponent(alert.id)}`} className="tap block wrap-break-word text-sm font-medium text-app-ink underline underline-offset-4">{alert.headline || `${alert.category || 'Emergency'} report`}</Link><p className="text-xs text-app-muted">{alert.handoff_offered_to_me ? 'Lead handoff offered to you' : 'You are the current lead'}</p>{!error && <HelpRelay alert={alert} onChanged={() => query.refetch()} />}</li>)}</ul>
  </section>
}
