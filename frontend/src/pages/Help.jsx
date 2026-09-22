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

import { useCallback, useEffect, useState } from 'react'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { useToast } from '../components/Toast'
import { getBrowseLocation } from '../utils/geo'
import Button from '../components/Button'
import EmptyState from '../components/EmptyState'
import { Skeleton } from '../components/Skeleton'
import { HELP_ICONS, HelpIcon, Handshake, MapPin, Plus, X } from '../components/icons'

// Mirrors HelpKind in backend routes/help.py. A closed set on both sides:
// free text would make the list unfilterable, and finding the one person who
// does the thing is the entire value of the page.
const KINDS = Object.keys(HELP_ICONS)

function rupees(min, max) {
  if (!min && !max) return null
  if (min && max && min !== max) return `₹${min}–₹${max}`
  return `₹${max || min}`
}

function RequestCard({ item, onOffer, onAccept, onDone, onWithdraw, isMine, busy }) {
  const { t } = useI18n()
  const budget = rupees(item.budget_min, item.budget_max)
  const offers = item.offers || []
  // Both end states. Neither can be acted on further, by either side.
  const closed = item.status === 'done' || item.status === 'cancelled'

  return (
    <li className="surface-card alert-enter p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-xl bg-surface-2 p-2 text-accent">
          <HelpIcon kind={item.kind} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold text-white">{item.title}</h2>
            {item.status !== 'open' && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${
                  item.status === 'cancelled'
                    ? 'border-red-500/40 text-red-300'
                    : 'border-line text-gray-400'
                }`}
              >
                {t(`help_status_${item.status}`)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs uppercase tracking-wider text-gray-500">
            {item.kind}
          </p>
          {item.description && (
            <p className="mt-2 text-sm text-gray-300">{item.description}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-400">
            {budget && <span className="font-semibold text-accent">{budget}</span>}
            <span>
              {item.offer_count} {t('help_offers')}
            </span>
            {/* Released only once an offer is accepted — see the server's
                serializer. Until then a public listing would be a phone
                number waiting to be scraped. */}
            {item.contact && (
              <span className="text-gray-300">{item.contact}</span>
            )}
          </div>

          {isMine && offers.length > 0 && item.status === 'open' && (
            <ul className="mt-3 space-y-2 border-t border-line pt-3">
              {offers.map((o) => (
                <li key={o.worker_id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
                    {o.worker_name}
                    {o.note && <span className="text-gray-500"> · {o.note}</span>}
                  </span>
                  <span className="shrink-0 font-semibold text-accent">₹{o.price}</span>
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
            <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-sm text-red-200">
              {t('help_cancelled_note')}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {!isMine && item.status === 'open' && (
              <Button size="sm" variant="outline" onClick={() => onOffer(item)}>
                {t('help_offer')}
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
                className="text-red-300 hover:text-red-200"
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
  const { t } = useI18n()
  const { user } = useAuth()
  const { push: toast } = useToast()

  const [rows, setRows] = useState([])
  const [mine, setMine] = useState({ posted: [], offered: [] })
  const [kind, setKind] = useState('')
  const [coords, setCoords] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [offerFor, setOfferFor] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // getBrowseLocation never rejects — it falls back to a default area
      // rather than leaving a browse screen with nothing to render. It
      // returns [lng, lat], GeoJSON order, which is the opposite of what
      // the query string wants.
      let at = coords
      if (!at) {
        const { coords: lngLat } = await getBrowseLocation()
        at = { lng: lngLat[0], lat: lngLat[1] }
        setCoords(at)
      }
      const { data } = await api.get('/api/help/near', {
        params: { lat: at.lat, lng: at.lng, ...(kind ? { kind } : {}) },
      })
      setRows(data || [])
      if (user) {
        const { data: own } = await api.get('/api/help/mine')
        setMine(own)
      }
    } catch (err) {
      toast({ variant: 'error', title: t('help_load_error'), body: apiError(err) })
    } finally {
      setLoading(false)
    }
  }, [coords, kind, user, toast, t])

  useEffect(() => {
    void load()
  }, [load])

  const myIds = new Set((mine.posted || []).map((r) => r.id))

  const accept = async (id, workerId) => {
    setBusy(`${id}:${workerId}`)
    try {
      await api.patch(`/api/help/${id}/accept`, null, { params: { worker_id: workerId } })
      toast({ variant: 'success', title: t('help_accepted') })
      await load()
    } catch (err) {
      toast({ variant: 'error', title: apiError(err) })
    } finally {
      setBusy('')
    }
  }

  const markDone = async (id) => {
    setBusy(`done:${id}`)
    try {
      await api.patch(`/api/help/${id}/done`)
      await load()
    } catch (err) {
      toast({ variant: 'error', title: apiError(err) })
    } finally {
      setBusy('')
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
      toast({
        variant: 'success',
        title:
          data?.status === 'cancelled'
            ? t('help_withdrawn_notified')
            : t('help_withdrawn'),
      })
      await load()
    } catch (err) {
      toast({ variant: 'error', title: apiError(err) })
    } finally {
      setBusy('')
    }
  }

  // The requester's own rows are merged into the browse list so "what I
  // asked for" and "what my neighbours need" are one scroll, not two tabs.
  // A tab the user has to remember to check is a tab where offers go unread.
  const combined = [
    ...(mine.posted || []),
    ...rows.filter((r) => !myIds.has(r.id)),
  ]

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
          <Handshake className="h-6 w-6 text-accent" aria-hidden />
          {t('help_title')}
        </h1>
        <p className="mt-1 text-sm text-gray-500">{t('help_subtitle')}</p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="chip"
          aria-pressed={kind === ''}
          onClick={() => setKind('')}
        >
          {t('help_all')}
        </button>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="chip"
            aria-pressed={kind === k}
            onClick={() => setKind(k)}
          >
            <HelpIcon kind={k} className="h-4 w-4" />
            {k}
          </button>
        ))}
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

      {loading ? (
        <ul className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="surface-card p-4">
              <Skeleton className="mb-2 h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </li>
          ))}
        </ul>
      ) : !combined.length ? (
        <EmptyState
          icon={<MapPin className="h-8 w-8" aria-hidden />}
          title={t('help_empty')}
          body={t('help_empty_body')}
        />
      ) : (
        <ul className="space-y-3">
          {combined.map((item) => (
            <RequestCard
              key={item.id}
              item={item}
              isMine={myIds.has(item.id)}
              busy={busy}
              onOffer={setOfferFor}
              onAccept={accept}
              onDone={markDone}
              onWithdraw={withdraw}
            />
          ))}
        </ul>
      )}
    </main>
  )
}

function RequestForm({ coords, onDone }) {
  const { t } = useI18n()
  const { push: toast } = useToast()
  const [form, setForm] = useState({
    kind: 'electrician',
    title: '',
    description: '',
    budget_min: '',
    budget_max: '',
    contact: '',
  })
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
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
      })
      toast({ variant: 'success', title: t('help_posted') })
      await onDone()
    } catch (err) {
      toast({ variant: 'error', title: apiError(err) })
    } finally {
      setSaving(false)
    }
  }

  const field =
    'w-full rounded-xl border border-line bg-surface-1 px-4 py-3 text-white placeholder:text-gray-600 focus:border-accent focus:outline-none'

  return (
    <form onSubmit={submit} className="surface-card mb-4 space-y-3 p-4">
      <div>
        <label htmlFor="help-kind" className="mb-1.5 block text-sm text-gray-400">
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
        <label htmlFor="help-title" className="mb-1.5 block text-sm text-gray-400">
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
        <label htmlFor="help-desc" className="mb-1.5 block text-sm text-gray-400">
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
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-sm text-gray-400">
          {t('help_budget')}
        </legend>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            className={field}
            value={form.budget_min}
            onChange={(e) => setForm({ ...form, budget_min: e.target.value })}
            placeholder="₹ min"
            aria-label={t('help_budget_min')}
          />
          <span className="text-gray-600">–</span>
          <input
            type="number"
            min={0}
            className={field}
            value={form.budget_max}
            onChange={(e) => setForm({ ...form, budget_max: e.target.value })}
            placeholder="₹ max"
            aria-label={t('help_budget_max')}
          />
        </div>
        <p className="mt-1.5 text-xs text-gray-600">{t('help_budget_hint')}</p>
      </fieldset>

      <div>
        <label htmlFor="help-contact" className="mb-1.5 block text-sm text-gray-400">
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
        <p className="mt-1.5 text-xs text-gray-600">{t('help_contact_hint')}</p>
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

  const field =
    'w-full rounded-xl border border-line bg-surface-1 px-4 py-3 text-white placeholder:text-gray-600 focus:border-accent focus:outline-none'

  return (
    <form onSubmit={submit} className="surface-card mb-4 space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-white">
          {t('help_your_offer')} · {request.title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="tap press-in inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-white"
          aria-label={t('help_cancel')}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div>
        <label htmlFor="offer-price" className="mb-1.5 block text-sm text-gray-400">
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
        <label htmlFor="offer-note" className="mb-1.5 block text-sm text-gray-400">
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
