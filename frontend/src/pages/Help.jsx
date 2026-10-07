/**
 * Paid neighbourhood help — an electrician, a plumber, someone to look at a
 * laptop that will not start.
 *
 * A separate page from the alert feed, for the same reason it is a separate
 * collection on the server (see backend routes/help.py): none of the
 * emergency machinery applies to a dead fuse box, and a paid job must never
 * compete for space in a feed whose whole point is that the most urgent
 * thing is at the top.
 *
 * Money here is an expectation, not a transaction. A requester states a
 * budget range, a worker quotes a price, and the two of them settle it
 * between themselves. The app deliberately does not touch the payment — see
 * the server module for why that is a deliberate line rather than a gap.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { useToast } from '../components/Toast'
import { getBrowseLocation } from '../utils/geo'
import { filterHelpRequests } from '../utils/helpFilters'
import { helpSchedule, helpTimeline, localHelpTime, recordedTime } from '../utils/helpSchedule'
import Button from '../components/Button'
import EmptyState from '../components/EmptyState'
import VoiceInput from '../components/VoiceInput'
import { joinVoiceDraft } from '../utils/assistantCopy'
import { Skeleton } from '../components/Skeleton'
import { HELP_ICONS, HelpIcon, Handshake, MapPin, Plus, Search, X } from '../components/icons'

// Mirrors HelpKind in backend routes/help.py. A closed set on both sides:
// free text would make the list unfilterable, and finding the one person who
// does the thing is the entire value of the page.
const KINDS = Object.keys(HELP_ICONS)

function rupees(min, max) {
  if (!min && !max) return null
  if (min && max && min !== max) return `₹${min}–₹${max}`
  return `₹${max || min}`
}

export function RequestCard({ item, onOffer, onAccept, onStart, onDone, onWithdraw, viewerId, busy }) {
  const { t, lang } = useI18n()
  const isMine = Boolean(viewerId && item.requester_id === viewerId)
  const isWorker = Boolean(viewerId && item.accepted_worker_id === viewerId)
  const participant = isMine || isWorker
  const timeline = participant ? helpTimeline(item.timeline) : []
  const started = timeline.some((entry) => entry.event === 'started') || Boolean(recordedTime(item.work_started_at))
  const scheduleStart = localHelpTime(item.schedule_start, lang)
  const scheduleEnd = localHelpTime(item.schedule_end, lang)
  const budget = rupees(item.budget_min, item.budget_max)
  const offers = item.offers || []
  // Both end states. Neither can be acted on further, by either side.
  const closed = item.status === 'done' || item.status === 'cancelled'

  return (
    <li className="surface-card min-w-0 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-lg bg-surface-2 p-2 text-app-muted">
          <HelpIcon kind={item.kind} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-app-ink leading-snug wrap-break-word">{item.title}</h2>
            {item.status !== 'open' && (
              <span
                className={`rounded-full border px-2 py-1 text-xs ${
                  item.status === 'cancelled'
                    ? 'app-feedback-error'
                    : 'border-line text-app-muted'
                }`}
              >
                {t(`help_status_${item.status}`)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs capitalize text-app-muted">
            {item.kind}
          </p>
          {item.description && (
            <p className="mt-3 text-sm text-app-ink leading-relaxed wrap-break-word">{item.description}</p>
          )}

          <div className="mt-3 text-sm text-app-ink leading-relaxed">
            {scheduleStart && scheduleEnd ? (
              <div className="space-y-1">
                <p className="font-medium">{t('help_schedule_title')}</p>
                <p className="flex flex-wrap gap-x-2 gap-y-1 break-words">
                  <time dateTime={item.schedule_start}>{scheduleStart}</time>
                  <span aria-hidden="true">–</span>
                  <time dateTime={item.schedule_end}>{scheduleEnd}</time>
                </p>
                <p className="text-xs text-app-muted">{t('help_schedule_local')}</p>
              </div>
            ) : <p className="text-app-muted">{t('help_schedule_flexible')}</p>}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-app-muted">
            {budget && <span className="font-semibold text-app-ink">{budget}</span>}
            <span>
              {item.offer_count} {t('help_offers')}
            </span>
            {/* Released only once an offer is accepted — see the server's
                serializer. Until then a public listing would be a phone
                number waiting to be scraped. */}
            {participant && item.contact && (
              <span className="text-app-ink wrap-break-word">{item.contact}</span>
            )}
          </div>

          {isMine && offers.length > 0 && item.status === 'open' && (
            <ul className="mt-3 space-y-2 border-t border-line pt-3">
              {offers.map((o) => (
                <li key={o.worker_id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 basis-32 text-sm text-app-ink wrap-break-word">
                    {o.worker_name}
                    {o.note && <span className="block mt-1 text-app-muted">{o.note}</span>}
                  </span>
                  <span className="shrink-0 font-semibold text-app-ink">₹{o.price}</span>
                  <Button
                    size="sm"
                    onClick={() => onAccept(item.id, o.worker_id)}
                    loading={busy === `${item.id}:${o.worker_id}`}
                  >
                    {t('help_accept')}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {/* The whole reason cancelled rows are kept rather than deleted:
              a worker who quoted and rearranged an afternoon gets told, in
              the same place the job used to be. */}
          {!isMine && item.status === 'cancelled' && (
            <p className="app-feedback-error mt-3 rounded-xl px-3 py-3 text-sm leading-relaxed">
              {t('help_cancelled_note')}
            </p>
          )}

          {timeline.length > 0 && (
            <section className="mt-4 border-t border-line pt-3" aria-label={t('help_timeline')}>
              <h3 className="text-sm font-semibold text-app-ink">{t('help_timeline')}</h3>
              <p className="mt-1 text-xs text-app-muted leading-relaxed">{t('help_timeline_private')}</p>
              <ol className="mt-2 space-y-2 border-l border-line pl-3">
                {timeline.map((entry, index) => (
                  <li key={`${entry.event}:${entry.at}:${index}`} className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    <span className="text-app-ink">{t(`help_event_${entry.event}`)}</span>
                    <time className="break-words text-app-muted" dateTime={entry.at}>{localHelpTime(entry.at, lang)}</time>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {viewerId && !isMine && item.status === 'open' && (
              <Button size="sm" variant="outline" onClick={() => onOffer(item)}>
                {t('help_offer')}
              </Button>
            )}
            {isWorker && item.status === 'accepted' && !started && (
              <Button size="sm" onClick={() => onStart(item.id)} loading={busy === `start:${item.id}`}>
                {t('help_start_work')}
              </Button>
            )}
            {isMine && !closed && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDone(item.id)}
                loading={busy === `done:${item.id}`}
              >
                {t('help_mark_done')}
              </Button>
            )}
            {isMine && !closed && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onWithdraw(item.id)}
                loading={busy === `withdraw:${item.id}`}
                className="text-app-muted"
              >
                {t('help_withdraw')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  )
}

export default function Help() {
  const { user, token } = useAuth()
  // Remount immediately on an account change: effect-only clearing would
  // expose the previous account's private rows for one render.
  return <HelpBoard key={`${user?.id || 'public'}:${token || ''}`} user={user} />
}

function HelpBoard({ user }) {
  const { t } = useI18n()
  const { push: toast } = useToast()

  const [rows, setRows] = useState([])
  const [mine, setMine] = useState({ posted: [], offered: [] })
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('all')
  const [coords, setCoords] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [offerFor, setOfferFor] = useState(null)
  const requestId = useRef(0)
  const mounted = useRef(true)
  const browseCoords = useRef(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestId.current += 1 }
  }, [])

  const load = useCallback(async () => {
    if (!mounted.current) return
    const sequence = ++requestId.current
    const current = () => mounted.current && requestId.current === sequence
    setLoading(true)
    try {
      // getBrowseLocation never rejects — it falls back to a default area
      // rather than leaving a browse screen with nothing to render. It
      // returns [lng, lat], GeoJSON order, which is the opposite of what
      // the query string wants.
      let at = browseCoords.current
      if (!at) {
        const { coords: lngLat } = await getBrowseLocation()
        if (!current()) return
        at = { lng: lngLat[0], lat: lngLat[1] }
        browseCoords.current = at
        setCoords(at)
      }
      const { data } = await api.get('/api/help/near', {
        params: { lat: at.lat, lng: at.lng, ...(kind ? { kind } : {}) },
      })
      if (!current()) return
      if (user) {
        const { data: own } = await api.get('/api/help/mine')
        if (!current()) return
        setMine(own || { posted: [], offered: [] })
      }
      setRows(data || [])
    } catch (err) {
      if (current()) toast({ variant: 'error', title: t('help_load_error'), body: apiError(err) })
    } finally {
      if (current()) setLoading(false)
    }
  }, [kind, user, toast, t])

  useEffect(() => {
    void load()
    return () => { requestId.current += 1 }
  }, [load])

  const posted = user ? mine.posted || [] : []
  const offered = user ? mine.offered || [] : []
  const activeScope = !user && scope === 'mine' ? 'all' : scope
  const filtered = filterHelpRequests({ nearby: rows, posted, offered, query, kind, scope: activeScope })
  const hasFilters = Boolean(query.trim() || kind || activeScope !== 'all')

  const clearFilters = () => {
    setQuery('')
    setKind('')
    setScope('all')
  }

  const accept = async (id, workerId) => {
    setBusy(`${id}:${workerId}`)
    try {
      await api.patch(`/api/help/${id}/accept`, null, { params: { worker_id: workerId } })
      if (!mounted.current) return
      toast({ variant: 'success', title: t('help_accepted') })
      await load()
    } catch (err) {
      if (mounted.current) toast({ variant: 'error', title: apiError(err) })
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  const markDone = async (id) => {
    setBusy(`done:${id}`)
    try {
      await api.patch(`/api/help/${id}/done`)
      if (!mounted.current) return
      await load()
    } catch (err) {
      if (mounted.current) toast({ variant: 'error', title: apiError(err) })
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  const startWork = async (id) => {
    setBusy(`start:${id}`)
    try {
      await api.patch(`/api/help/${id}/start`)
      if (!mounted.current) return
      toast({ variant: 'success', title: t('help_started') })
      await load()
    } catch (err) {
      if (mounted.current) toast({ variant: 'error', title: apiError(err) })
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  // Confirmed, because the server may not be able to undo it: a request with
  // no offers is deleted outright. One with offers is only marked cancelled,
  // but the requester cannot tell which case they are in from the card, so
  // both get the same prompt.
  const withdraw = async (id) => {
    if (!window.confirm(t('help_withdraw_confirm'))) return
    setBusy(`withdraw:${id}`)
    try {
      const { data } = await api.delete(`/api/help/${id}`)
      if (!mounted.current) return
      toast({
        variant: 'success',
        title:
          data?.status === 'cancelled'
            ? t('help_withdrawn_notified')
            : t('help_withdrawn'),
      })
      await load()
    } catch (err) {
      if (mounted.current) toast({ variant: 'error', title: apiError(err) })
    } finally {
      if (mounted.current) setBusy('')
    }
  }

  return (
    <main className="page-panel mx-auto max-w-3xl px-4 py-6 sm:py-8 sm:px-6">
      <header className="mb-5">
        <h1 className="flex items-start gap-2 text-2xl font-semibold tracking-tight text-app-ink">
          <Handshake className="h-6 w-6 shrink-0 mt-1 text-app-muted" aria-hidden />
          {t('help_title')}
        </h1>
        <p className="mt-2 text-sm text-app-muted leading-relaxed">{t('help_subtitle')}</p>
      </header>

      <div role="search" aria-label={t('help_search')} className="mb-4 space-y-4">
        <div>
          <label htmlFor="help-search" className="app-form-label">
            {t('help_search')}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-app-muted" aria-hidden />
            <input
              id="help-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('help_search_placeholder')}
              className="app-field w-full pl-12"
              aria-controls="help-results"
            />
          </div>
        </div>

        <fieldset>
          <legend className="app-form-label">{t('help_filter_view')}</legend>
          <div className="flex flex-wrap gap-2">
            {['all', 'open', ...(user ? ['mine'] : [])].map((view) => (
              <button
                key={view}
                type="button"
                className="app-choice-button px-3 text-sm"
                aria-pressed={activeScope === view}
                aria-controls="help-results"
                onClick={() => setScope(view)}
              >
                {t(`help_filter_${view}`)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="app-form-label">{t('help_kind')}</legend>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="app-choice-button px-3 text-sm"
              aria-pressed={kind === ''}
              aria-controls="help-results"
              onClick={() => setKind('')}
            >
              {t('help_all')}
            </button>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                className="app-choice-button px-3 text-sm capitalize"
                aria-pressed={kind === k}
                aria-controls="help-results"
                onClick={() => setKind(k)}
              >
                <HelpIcon kind={k} className="h-4 w-4 shrink-0" aria-hidden />
                {k}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-app-muted">
            {!loading && <>{t('help_results')}: {filtered.length}</>}
          </p>
          <Button size="sm" variant="ghost" onClick={clearFilters} disabled={!hasFilters}>
            {t('help_clear_filters')}
          </Button>
        </div>
      </div>

      {user && (
        <Button className="mb-4" onClick={() => setShowForm((v) => !v)} full>
          {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showForm ? t('help_cancel') : t('help_post')}
        </Button>
      )}

      {showForm && (
        <RequestForm
          coords={coords}
          onDone={async () => {
            setShowForm(false)
            await load()
          }}
        />
      )}

      {offerFor && (
        <OfferForm
          request={offerFor}
          onClose={() => setOfferFor(null)}
          onDone={async () => {
            setOfferFor(null)
            await load()
          }}
        />
      )}

      <div id="help-results" aria-busy={loading}>
        {loading ? (
          <ul className="space-y-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i} className="surface-card p-4">
                <Skeleton className="mb-2 h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))}
          </ul>
        ) : !filtered.length ? (
          <EmptyState
            icon={hasFilters ? <Search className="h-8 w-8" aria-hidden /> : <MapPin className="h-8 w-8" aria-hidden />}
            title={t(hasFilters ? 'help_no_matches' : 'help_empty')}
            body={t(hasFilters ? 'help_no_matches_body' : 'help_empty_body')}
            action={hasFilters && (
              <Button variant="outline" onClick={clearFilters}>{t('help_clear_filters')}</Button>
            )}
          />
        ) : (
          <ul className="space-y-3">
            {filtered.map((item) => (
              <RequestCard
                key={item.id}
                item={item}
                viewerId={user?.id}
                busy={busy}
                onOffer={setOfferFor}
                onAccept={accept}
                onStart={startWork}
                onDone={markDone}
                onWithdraw={withdraw}
              />
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}

export function RequestForm({ coords, onDone }) {
  const { t } = useI18n()
  const { push: toast } = useToast()
  const [form, setForm] = useState({
    kind: 'electrician',
    title: '',
    description: '',
    budget_min: '',
    budget_max: '',
    contact: '',
    schedule_start: '',
    schedule_end: '',
  })
  const [saving, setSaving] = useState(false)
  const [scheduleError, setScheduleError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (form.description.length > 1000) {
      toast({ variant: 'warning', title: `${t('help_details')}: max 1,000 characters` })
      return
    }
    const schedule = helpSchedule(form.schedule_start, form.schedule_end, { local: true })
    setScheduleError(schedule.error || '')
    if (schedule.error) return
    if (!coords) {
      toast({ variant: 'error', title: t('help_need_location') })
      return
    }
    setSaving(true)
    try {
      await api.post('/api/help/', {
        kind: form.kind,
        title: form.title,
        description: form.description,
        location: { type: 'Point', coordinates: [coords.lng, coords.lat] },
        budget_min: Number(form.budget_min) || 0,
        budget_max: Number(form.budget_max) || 0,
        contact: form.contact,
        ...schedule,
      })
      toast({ variant: 'success', title: t('help_posted') })
      await onDone()
    } catch (err) {
      toast({ variant: 'error', title: apiError(err) })
    } finally {
      setSaving(false)
    }
  }

  const field = 'app-field w-full'

  return (
    <form onSubmit={submit} className="surface-card min-w-0 mb-4 space-y-4 p-4 sm:p-5">
      <div>
        <label htmlFor="help-kind" className="app-form-label">
          {t('help_kind')}
        </label>
        <select
          id="help-kind"
          className={field}
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value })}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="help-title" className="app-form-label">
          {t('help_what')}
        </label>
        <input
          id="help-title"
          required
          minLength={4}
          maxLength={120}
          className={field}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder={t('help_what_ph')}
        />
      </div>

      <div>
        <label htmlFor="help-desc" className="app-form-label">
          {t('help_details')}
        </label>
        <textarea
          id="help-desc"
          rows={3}
          maxLength={1000}
          className={field}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <div className="mt-3"><VoiceInput onText={text => setForm(old => ({ ...old, description: joinVoiceDraft(old.description, text) }))} /></div>
        {form.description.length > 1000 && <p role="alert" className="app-feedback-error mt-2 rounded-xl p-3 text-sm">{t('help_details')}: max 1,000 characters</p>}
      </div>

      <fieldset>
        <legend className="app-form-label">
          {t('help_budget')}
        </legend>
        <div className="grid grid-cols-2 min-w-0 gap-3">
          <div className="min-w-0">
            <label htmlFor="help-budget-min" className="app-form-label">{t('help_budget_min')}</label>
            <input
              id="help-budget-min"
              type="number"
              min={0}
              className={field}
              value={form.budget_min}
              onChange={(e) => setForm({ ...form, budget_min: e.target.value })}
              placeholder="₹ min"
              aria-label={t('help_budget_min')}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="help-budget-max" className="app-form-label">{t('help_budget_max')}</label>
            <input
              id="help-budget-max"
              type="number"
              min={0}
              className={field}
              value={form.budget_max}
              onChange={(e) => setForm({ ...form, budget_max: e.target.value })}
              placeholder="₹ max"
              aria-label={t('help_budget_max')}
            />
          </div>
        </div>
        <p className="mt-2 text-xs text-app-muted leading-relaxed">{t('help_budget_hint')}</p>
      </fieldset>

      <fieldset aria-describedby="help-schedule-hint">
        <legend className="app-form-label">{t('help_schedule_title')}</legend>
        <p id="help-schedule-hint" className="mb-3 text-xs text-app-muted leading-relaxed">{t('help_schedule_hint')}</p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          {['start', 'end'].map((edge) => (
            <div key={edge} className="min-w-0">
              <label htmlFor={`help-schedule-${edge}`} className="app-form-label">
                {t(`help_schedule_${edge}`)}
              </label>
              <input
                id={`help-schedule-${edge}`}
                type="datetime-local"
                step={60}
                className={`${field} min-h-11 min-w-0`}
                value={form[`schedule_${edge}`]}
                onChange={(e) => { setForm({ ...form, [`schedule_${edge}`]: e.target.value }); setScheduleError('') }}
                aria-describedby={`help-schedule-hint${scheduleError ? ' help-schedule-error' : ''}`}
                aria-invalid={Boolean(scheduleError)}
              />
            </div>
          ))}
        </div>
        {scheduleError && <p id="help-schedule-error" role="alert" className="app-feedback-error mt-2 rounded-xl p-3 text-sm">{t(scheduleError)}</p>}
      </fieldset>

      <div>
        <label htmlFor="help-contact" className="app-form-label">
          {t('help_contact')}
        </label>
        <input
          id="help-contact"
          maxLength={120}
          className={field}
          value={form.contact}
          onChange={(e) => setForm({ ...form, contact: e.target.value })}
          placeholder={t('help_contact_ph')}
        />
        {/* Stated plainly because the alternative is someone assuming the
            worst and leaving it blank, which makes the listing useless. */}
        <p className="mt-2 text-xs text-app-muted leading-relaxed">{t('help_contact_hint')}</p>
      </div>

      <Button type="submit" loading={saving} full>
        {t('help_post_submit')}
      </Button>
    </form>
  )
}

function OfferForm({ request, onClose, onDone }) {
  const { t } = useI18n()
  const { push: toast } = useToast()
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post(`/api/help/${request.id}/offers`, {
        price: Number(price) || 0,
        note,
      })
      toast({ variant: 'success', title: t('help_offer_sent') })
      await onDone()
    } catch (err) {
      toast({ variant: 'error', title: apiError(err) })
    } finally {
      setSaving(false)
    }
  }

  const field = 'app-field w-full'

  return (
    <form onSubmit={submit} className="surface-card min-w-0 mb-4 space-y-4 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 font-semibold text-app-ink wrap-break-word">
          {t('help_your_offer')} · {request.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="app-secondary-button h-12 w-12 shrink-0"
          aria-label={t('help_cancel')}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div>
        <label htmlFor="offer-price" className="app-form-label">
          {t('help_your_price')}
        </label>
        <input
          id="offer-price"
          type="number"
          min={0}
          required
          className={field}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder="₹"
        />
      </div>
      <div>
        <label htmlFor="offer-note" className="app-form-label">
          {t('help_when')}
        </label>
        <input
          id="offer-note"
          maxLength={300}
          className={field}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('help_when_ph')}
        />
      </div>
      <Button type="submit" loading={saving} full>
        {t('help_send_offer')}
      </Button>
    </form>
  )
}
