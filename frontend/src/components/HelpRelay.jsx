import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/AuthContext'
import api from '../utils/api'
import { apiError } from '../utils/error'
import OutcomeSummary from './OutcomeSummary'
import { SkillsPicker } from './ProfileFields'

/** Account/lead changes remount so private coordination cannot leak for a frame. */
export default function HelpRelay(props) {
  const { user } = useAuth()
  if (!user) return null
  const relevant = ['accepted', 'resolved'].includes(props.alert.status) && (
    props.alert.reporter_id === user.id || props.alert.accepted_by === user.id ||
    props.alert.handoff_offered_to_me || (user.role === 'volunteer' && props.alert.backup_requested)
  )
  if (!relevant) return null
  return <RelayPanel key={`${user?.id || 'public'}:${props.alert.id}:${props.alert.accepted_by || ''}`} {...props} user={user} />
}

function RelayPanel({ alert, user, onChanged }) {
  const [refreshError, setRefreshError] = useState('')
  const [offered, setOffered] = useState(false)
  const [declined, setDeclined] = useState(false)
  const [note, setNote] = useState('')
  const [candidate, setCandidate] = useState('')
  const [skills, setSkills] = useState([])
  const [expanded, setExpanded] = useState(false)
  const noteId = useId(), candidateId = useId()
  const participant = Boolean(user && (alert.reporter_id === user.id || alert.accepted_by === user.id || alert.handoff_offered_to_me))
  const mayOffer = user?.role === 'volunteer' && alert.status === 'accepted' && alert.backup_requested && !participant
  const client = useQueryClient()
  const queryKey = ['coordination', user.id, alert.id]
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const { data } = await api.get(`/api/alerts/${alert.id}/coordination`, { signal })
      return data
    },
    enabled: participant && !declined, staleTime: 0, gcTime: 60000, retry: false,
    refetchInterval: () => document.visibilityState === 'visible' ? 15000 : false,
    refetchIntervalInBackground: false,
  })
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({ method, path, payload }) => {
      const { data } = await api[method](`/api/alerts/${alert.id}/${path}`, payload)
      return data
    },
    onMutate: async () => { setRefreshError(''); await client.cancelQueries({ queryKey }) },
    onSuccess: async (data, variables) => {
      if (variables.key === 'offer') setOffered(true)
      else if (variables.key === 'decline-handoff') setDeclined(true)
      else client.setQueryData(queryKey, data)
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: ['coordination-inbox', user.id] }),
      ])
      try { await onChanged?.() } catch { setRefreshError('Change saved, but the alert could not refresh. Try refreshing again.') }
    },
  })
  const error = refreshError || (mutation.error ? apiError(mutation.error, 'Could not save this change. Try again.') : query.error ? apiError(query.error, 'Could not refresh help coordination.') : '')
  const forbidden = [query.error, mutation.error].some(cause => [401, 403, 404].includes(cause?.response?.status))
  // Never render retained private data after a known permission revocation.
  const coordination = participant && !forbidden ? query.data : null
  const busy = mutation.isPending ? mutation.variables?.key || 'saving' : ''
  const disabled = Boolean(busy) || (participant && Boolean(query.error))
  const mutate = async (key, method, path, payload) => {
    if (disabled) return
    mutation.mutate({ key, method, path, payload })
  }
  if (!participant && !mayOffer) return null
  if (declined) return <p role="status" className="mt-3 text-sm text-app-muted">Lead handoff declined. The current lead stays responsible.</p>
  const isLead = coordination?.lead_id === user?.id && coordination?.can_manage
  const accepted = coordination?.status === 'accepted'
  const offers = coordination?.backup?.offers || []
  const button = 'tap app-secondary-button w-full sm:w-auto'
  return <section className="mt-4 border-t border-line pt-4" aria-labelledby={`${noteId}-title`} aria-busy={Boolean(busy)}>
    <h3 id={`${noteId}-title`} className="text-base font-semibold text-app-ink">Help relay</h3>
    <p className="mt-1 text-xs leading-relaxed text-app-muted">Volunteer coordination, not an ambulance dispatch or emergency-service confirmation.</p>
    {error && <p role="alert" className="mt-3 app-feedback-error rounded-xl p-3 text-sm">{error}<button type="button" className={`${button} mt-2`} disabled={Boolean(busy)} onClick={() => { mutation.reset(); setRefreshError(''); if (participant) void query.refetch() }}>Retry</button></p>}
    {coordination && <p className="mt-2 text-xs text-app-muted">{query.error ? 'Cached, not current. Last checked ' : 'Server checked '}<time dateTime={new Date(query.dataUpdatedAt).toISOString()}>{new Date(query.dataUpdatedAt).toLocaleTimeString()}</time>{query.isFetching ? '. Refreshing…' : '.'}</p>}
    {mayOffer && <div className="mt-3 space-y-3">
      <p className="text-sm text-app-ink">Extra help requested{alert.backup_needed_skills?.length ? `: ${alert.backup_needed_skills.join(', ')}` : '.'}</p>
      <label htmlFor={noteId} className="app-form-label">Offer note (optional)</label>
      <textarea id={noteId} maxLength={500} value={note} onChange={event => setNote(event.target.value)} className="app-field w-full" rows={2} />
      <button type="button" disabled={Boolean(busy) || offered} className={button} onClick={() => { void mutate('offer', 'post', 'backup/offer', { note: note.trim() }) }}>{offered ? 'Help offered' : busy === 'offer' ? 'Sending offer…' : 'Offer backup help'}</button>
      <p className="text-xs leading-relaxed text-app-muted">Offering does not make you the lead or share anyone&apos;s phone or live location.</p>
    </div>}
    {participant && !coordination && !error && <p role="status" className="mt-3 text-sm text-app-muted">Loading private coordination…</p>}
    {coordination && <fieldset disabled={disabled} className="min-w-0 border-0 p-0" aria-label="Relay actions">
      <OutcomeSummary alert={{ ...alert, status: coordination.status, outcome: coordination.outcome, outcome_at: coordination.outcome_at, response_progress: coordination.progress }} />
      {coordination.can_accept_handoff && coordination.handoff && <div className="rounded-xl border border-line bg-surface-2 p-3 space-y-3">
        <p className="text-sm text-app-ink">The current lead offered you this response. They remain responsible until you accept.</p>
        <button type="button" className="tap app-primary-button w-full" disabled={Boolean(busy)} onClick={() => { void mutate('accept-handoff', 'post', 'handoff/accept', { handoff_id: coordination.handoff.id }) }}>Accept lead handoff</button>
        <button type="button" className={button} disabled={Boolean(busy)} onClick={() => { void mutate('decline-handoff', 'post', 'handoff/decline', { handoff_id: coordination.handoff.id }) }}>Decline handoff</button>
        <p className="text-xs text-app-muted">Accepting does not enable live location sharing. Consent starts off.</p>
      </div>}
      {isLead && accepted && <div className="space-y-3 border-t border-line pt-3">
        <h4 className="text-sm font-semibold text-app-ink">Your response</h4>
        <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={Boolean(busy) || coordination.progress === 'on_the_way' || coordination.progress === 'arrived'} onClick={() => { void mutate('progress', 'patch', 'progress', { progress: 'on_the_way' }) }}>I&apos;m on the way</button><button type="button" className={button} disabled={Boolean(busy) || coordination.progress === 'arrived'} onClick={() => { void mutate('arrived', 'patch', 'progress', { progress: 'arrived' }) }}>I&apos;ve arrived</button></div>
        {coordination.can_share_location && <div className="rounded-xl bg-surface-2 p-3">
          <h4 className="text-sm font-semibold text-app-ink">Live location sharing</h4>
          <p className="mt-1 text-xs leading-relaxed text-app-muted">{coordination.location_sharing?.enabled ? 'Sharing is enabled for this alert only. The reporter can see fresh positions while this app is open, until you stop or consent expires.' : 'Off. Nearby matching can use your location without showing it to the reporter. Choose to share fresh positions for 30 minutes.'}</p>
          {coordination.location_sharing?.enabled && coordination.location_sharing.expires_at && <p className="mt-2 text-xs text-app-muted">Expires {new Date(coordination.location_sharing.expires_at).toLocaleTimeString()}</p>}
          <button type="button" className={`${button} mt-3`} disabled={Boolean(busy)} onClick={() => { void mutate('sharing', 'patch', 'location-sharing', { enabled: !coordination.location_sharing?.enabled, duration_minutes: 30 }) }}>{coordination.location_sharing?.enabled ? 'Stop sharing location' : 'Share location for 30 minutes'}</button>
        </div>}
      </div>}
      {coordination.can_manage && accepted && <div className="mt-4 border-t border-line pt-3 space-y-3">
        <button type="button" className={button} aria-expanded={expanded} aria-controls={`${noteId}-backup`} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide backup controls' : 'Backup and handoff'}</button>
        {expanded && <div id={`${noteId}-backup`} className="space-y-3">
          <label htmlFor={noteId} className="app-form-label">Backup note (optional)</label>
          <textarea id={noteId} maxLength={500} value={note} onChange={event => setNote(event.target.value)} className="app-field w-full" rows={2} />
          {!coordination.backup?.requested && <fieldset className="min-w-0"><legend className="app-form-label mb-2">Helpful skills (optional)</legend><SkillsPicker value={skills} onChange={setSkills} /></fieldset>}
          <button type="button" disabled={Boolean(busy)} className={button} onClick={() => { void mutate('backup', coordination.backup?.requested ? 'delete' : 'post', 'backup', coordination.backup?.requested ? undefined : { needed_skills: skills, note: note.trim() }) }}>{coordination.backup?.requested ? 'Stop requesting backup' : 'Request backup help'}</button>
          {coordination.backup?.requested && <p className="text-xs text-app-muted">Request is visible to volunteers. An offer is not an accepted handoff.</p>}
          {offers.length > 0 && <ul className="space-y-2">{offers.map(offer => <li key={offer.volunteer_id} className="min-w-0 rounded-xl bg-surface-2 p-3 text-sm text-app-ink"><span className="wrap-break-word font-medium">{offer.name || 'Volunteer'}</span>{offer.note && <p className="mt-1 break-words text-app-muted">{offer.note}</p>}</li>)}</ul>}
          {isLead && coordination.can_handoff && offers.length > 0 && <>
            <label htmlFor={candidateId} className="app-form-label">Offer lead role to</label>
            <select id={candidateId} className="app-field w-full" value={candidate} onChange={event => setCandidate(event.target.value)}><option value="">Choose a volunteer who offered</option>{offers.filter(offer => offer.volunteer_id !== user.id).map(offer => <option key={offer.volunteer_id} value={offer.volunteer_id}>{offer.name || 'Volunteer'}</option>)}</select>
            <button type="button" disabled={Boolean(busy) || !candidate || Boolean(coordination.handoff)} className={button} onClick={() => { void mutate('handoff', 'post', 'handoff', { volunteer_id: candidate }) }}>Offer lead handoff</button>
          </>}
          {coordination.handoff && <p role="status" className="text-sm text-app-muted">Handoff is awaiting the named volunteer&apos;s acceptance. Current lead stays responsible.</p>}
          {coordination.handoff && isLead && coordination.can_handoff && <button type="button" className={button} disabled={Boolean(busy)} onClick={() => { void mutate('cancel-handoff', 'delete', 'handoff') }}>Cancel handoff offer</button>}
        </div>}
      </div>}
      {coordination.can_confirm_safe && coordination.outcome !== 'reporter_confirmed_safe' && <div className="mt-4 border-t border-line pt-3"><p className="mb-3 text-xs leading-relaxed text-app-muted">Only confirm if you, the reporter, are now safe. This is your report, not a medical assessment.</p><button type="button" className={button} disabled={Boolean(busy)} onClick={() => { if (window.confirm('Confirm that you are now safe? This closes the report.')) void mutate('confirm', 'patch', 'confirm-safe', {}) }}>I am safe now</button></div>}
    </fieldset>}
  </section>
}
