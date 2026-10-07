import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import api from '../utils/api'
import { apiError } from '../utils/error'
import EmptyState from '../components/EmptyState'
import { MapPin, Package, ResourceIcon } from '../components/icons'
import { getBrowseLocation } from '../utils/geo'
import { useNow } from '../hooks/useTimeAgo'

// Labels only — the glyph comes from <ResourceIcon kind=... />, which shares
// its kind→icon table with the rest of the app. These used to carry stub
// strings ('House', 'O2', 'Blood') that rendered as literal text in the pill.
const KIND_META = {
  shelter: { label: 'Shelter' },
  food: { label: 'Food' },
  blood: { label: 'Blood' },
  oxygen: { label: 'Oxygen' },
  water: { label: 'Water' },
  medical_camp: { label: 'Medical camp' },
  other: { label: 'Other' },
}

const KINDS = Object.keys(KIND_META)

function getContactAction(contact) {
  const trimmed = (contact || '').trim()
  if (!trimmed) return null
  if (trimmed.includes('@')) {
    return {
      href: `mailto:${trimmed}`,
      label: 'Email contact',
    }
  }
  const digits = trimmed.replace(/[^\d+]/g, '')
  if (digits.replace(/\D/g, '').length >= 7) {
    return {
      href: `tel:${digits}`,
      label: 'Call contact',
    }
  }
  return null
}

function isExpiringSoon(pin) {
  const expiresAt = pin.expires_at ? new Date(pin.expires_at).getTime() : null
  if (!expiresAt) return false
  return expiresAt - Date.now() <= 60 * 60 * 1000
}

function ResourceCard({ pin, mineId, onDelete }) {
  const meta = KIND_META[pin.kind] || KIND_META.other
  const expires = pin.expires_at ? new Date(pin.expires_at) : null
  // `now` comes from a ticking hook rather than a bare Date.now() in render:
  // it keeps render pure, and it means the "45m left" countdown actually
  // counts down instead of freezing at whatever it read on first paint.
  const now = useNow()
  const expiresIn = expires ? Math.max(0, Math.floor((expires - now) / 60000)) : null
  const expiringSoon = isExpiringSoon(pin)
  const isMine = mineId && pin.owner_id === mineId
  const lat = pin.location?.coordinates?.[1]
  const lng = pin.location?.coordinates?.[0]
  const directions = lat != null && lng != null ? `/map?dest=${lat},${lng}` : null
  const contactAction = getContactAction(pin.contact)

  return (
    <li className="surface-card min-w-0 px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex items-center justify-center h-9 w-9 rounded-lg bg-surface-2 text-app-muted shrink-0"
          >
            <ResourceIcon kind={pin.kind} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-app-ink font-semibold wrap-break-word">{pin.name}</h3>
            <p className="text-xs text-app-muted leading-relaxed mt-1 capitalize">
              {meta.label}
              {pin.owner_name ? ` . ${pin.owner_name}` : ''}
            </p>
          </div>
        </div>
        {expiresIn !== null && (
          <span
            className={`text-xs shrink-0 px-2 py-1 rounded-full border tabular-nums ${
              expiringSoon
                ? 'app-feedback-error'
                : 'text-app-muted bg-surface border-line'
            }`}
          >
            {expiresIn > 60 ? `${Math.floor(expiresIn / 60)}h left` : `${expiresIn}m left`}
          </span>
        )}
      </div>

      <div className="text-sm text-app-ink leading-relaxed mt-3 space-y-2">
        {pin.capacity != null && (
          <div>
            <span className="text-app-muted">Capacity:</span>{' '}
            <span className="tabular-nums">{pin.capacity}</span>
          </div>
        )}
        {pin.contact && (
          <div className="wrap-break-word">
            <span className="text-app-muted">Contact:</span> {pin.contact}
          </div>
        )}
        {pin.notes && <div className="text-app-ink wrap-break-word">{pin.notes}</div>}
      </div>

      <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {directions && (
            <Link
              to={directions}
              className="inline-flex min-h-11 items-center text-sm text-app-ink underline underline-offset-4"
            >
              Directions
            </Link>
          )}
          {contactAction && (
            <a
              href={contactAction.href}
              className="inline-flex min-h-11 items-center text-sm text-app-ink underline underline-offset-4"
            >
              {contactAction.label}
            </a>
          )}
        </div>
        {isMine && (
          <button
            onClick={() => onDelete(pin.id)}
            className="app-secondary-button px-3 text-sm"
          >
            Remove
          </button>
        )}
      </div>
    </li>
  )
}

export default function Resources() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [coords, setCoords] = useState(null)
  const [pins, setPins] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [usingFallbackArea, setUsingFallbackArea] = useState(false)
  const [expiringOnly, setExpiringOnly] = useState(false)

  const [kind, setKind] = useState('shelter')
  const [name, setName] = useState('')
  const [contact, setContact] = useState('')
  const [capacity, setCapacity] = useState('')
  const [notes, setNotes] = useState('')
  const [validHours, setValidHours] = useState(24)
  const [posting, setPosting] = useState(false)

  const deferredSearch = useDeferredValue(search.trim().toLowerCase())

  useEffect(() => {
    let cancelled = false
    getBrowseLocation().then(({ coords: c, isFallback }) => {
      if (cancelled) return
      setCoords(c)
      setUsingFallbackArea(isFallback)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // `load` deliberately sets no flags on its synchronous path — it only
  // lowers them once the request settles. Raising a flag before the first
  // `await` makes it reachable synchronously from the mount effect, which
  // costs an extra render pass before paint. Callers that want a spinner
  // (the poll tick, the Refresh button) raise it themselves; the initial
  // load needs nothing, because `loading` already starts true.
  const load = useCallback(async () => {
    if (!coords) return

    try {
      const { data } = await api.get('/api/resources/near', {
        params: { lat: coords[1], lng: coords[0], km: 25 },
      })
      setPins(data)
      setError('')
    } catch (err) {
      setError(apiError(err, t('res_load_failed')))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [coords, t])

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      // Inside a timer callback, not the effect body — raising the
      // refresh flag here is a normal async state update.
      setRefreshing(true)
      void load()
    }, 60000)
    return () => clearInterval(id)
  }, [load])

  const onSubmit = async (e) => {
    e.preventDefault()
    if (!user) return
    if (name.trim().length < 2) {
      setError(t('res_name_too_short'))
      return
    }
    if (!coords) {
      setError(t('res_no_location'))
      return
    }
    setPosting(true)
    setError('')
    try {
      const fresh = await new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(coords)
        navigator.geolocation.getCurrentPosition(
          (p) => resolve([p.coords.longitude, p.coords.latitude]),
          () => resolve(coords),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        )
      })
      await api.post('/api/resources/', {
        kind,
        name: name.trim(),
        contact: contact.trim() || null,
        capacity: capacity === '' ? null : Math.max(0, parseInt(capacity, 10) || 0),
        notes: notes.trim() || null,
        location: { type: 'Point', coordinates: fresh },
        valid_for_hours: Math.min(336, Math.max(1, parseInt(validHours, 10) || 24)),
      })
      setName('')
      setContact('')
      setCapacity('')
      setNotes('')
      setRefreshing(true)
      await load()
    } catch (err) {
      setError(apiError(err, t('res_post_failed')))
    } finally {
      setPosting(false)
    }
  }

  const onDelete = async (id) => {
    try {
      await api.delete(`/api/resources/${id}`)
      setPins((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      setError(apiError(err, t('res_delete_failed')))
    }
  }

  const mineMarker = user?.name || null
  const mineCount = pins.filter((p) => mineMarker && p.owner_name === mineMarker).length
  const expiringSoonCount = pins.filter((p) => isExpiringSoon(p)).length

  const filtered = useMemo(() => {
    const next = pins.filter((pin) => {
      if (filter !== 'all' && pin.kind !== filter) return false
      if (expiringOnly && !isExpiringSoon(pin)) return false
      if (!deferredSearch) return true

      const haystack = [
        pin.name,
        pin.contact,
        pin.notes,
        pin.owner_name,
        pin.kind,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return haystack.includes(deferredSearch)
    })

    next.sort((a, b) => {
      const soonDelta = Number(isExpiringSoon(b)) - Number(isExpiringSoon(a))
      if (soonDelta !== 0) return soonDelta
      return new Date(a.expires_at || 0).getTime() - new Date(b.expires_at || 0).getTime()
    })

    return next
  }, [deferredSearch, expiringOnly, filter, pins])

  const inputCls = 'app-field w-full'

  return (
    <div className="page-panel max-w-3xl mx-auto px-4 py-6 sm:py-8">
      <div className="mb-5 sm:mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-app-ink">{t('res_title')}</h1>
            <p className="text-app-muted text-sm leading-relaxed mt-2">{t('res_subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setRefreshing(true)
              void load()
            }}
            disabled={loading || refreshing}
            className="app-secondary-button text-sm px-3"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {usingFallbackArea && (
        <div role="status" className="border border-line bg-surface-1 text-app-muted text-sm leading-relaxed rounded-xl px-4 py-3 mb-4 flex items-start gap-2">
          <MapPin className="h-4 w-4 shrink-0 mt-px" aria-hidden />
          <span>
            Showing a default area — we could not read your location. Enable
            location access to see resources around you.
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="app-feedback-error text-sm rounded-xl px-4 py-3 mb-6 flex items-start gap-2">
          <span aria-hidden className="text-base shrink-0 mt-px">!</span>
          <span>{error}</span>
        </div>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 border-y border-line py-4 mb-6">
        <SummaryCard label="Nearby pins" value={pins.length} />
        <SummaryCard label="My pins" value={mineCount} />
        <SummaryCard label="Expiring soon" value={expiringSoonCount} />
        <SummaryCard label="Visible now" value={filtered.length} />
      </section>

      {user ? (
        <form
          onSubmit={onSubmit}
          className="surface-card p-4 sm:p-5 mb-6 space-y-4"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-app-ink">
              {t('res_pin_a_resource')}
            </h2>
            <span className="text-xs text-app-muted leading-relaxed">
              New pins appear to anyone browsing this board nearby.
            </span>
          </div>

          <div role="group" aria-labelledby="resource-kind-label" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <span id="resource-kind-label" className="sr-only">Resource type</span>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                aria-pressed={kind === k}
                className="app-choice-button min-w-0 px-3 py-3 text-sm"
              >
                <ResourceIcon kind={k} className="h-3.5 w-3.5 inline-block mr-1.5 -mt-0.5" />
                {KIND_META[k].label}
              </button>
            ))}
          </div>

          <div>
            <label htmlFor="resource-name" className="app-form-label">{t('res_name_ph')}</label>
            <input
              id="resource-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('res_name_ph')}
              maxLength={120}
              required
              className={inputCls}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="min-w-0">
              <label htmlFor="resource-contact" className="app-form-label">{t('res_contact_ph')}</label>
              <input
                id="resource-contact"
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={t('res_contact_ph')}
                maxLength={120}
                className={inputCls}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor="resource-capacity" className="app-form-label">{t('res_capacity_ph')}</label>
              <input
                id="resource-capacity"
                type="number"
                min="0"
                max="100000"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder={t('res_capacity_ph')}
                className={`${inputCls} tabular-nums`}
              />
            </div>
          </div>

          <div>
            <label htmlFor="resource-notes" className="app-form-label">{t('res_notes_ph')}</label>
            <textarea
              id="resource-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('res_notes_ph')}
              maxLength={500}
              rows={2}
              className={inputCls}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm text-app-muted">
            <label htmlFor="res-valid">{t('res_valid_for')}</label>
            <input
              id="res-valid"
              type="number"
              min="1"
              max="336"
              value={validHours}
              onChange={(e) => setValidHours(e.target.value)}
              className="app-field w-20 tabular-nums"
            />
            <span>{t('res_hours')}</span>
          </div>

          <button
            type="submit"
            disabled={posting || !coords}
            aria-busy={posting}
            className="app-primary-button w-full"
          >
            <span className="relative">{posting ? t('res_posting') : t('res_post')}</span>
          </button>
        </form>
      ) : (
        <div className="border border-line bg-surface-1 rounded-xl p-4 sm:p-5 mb-6 text-sm text-app-muted leading-relaxed">
          <Link to="/login" className="inline-flex min-h-11 items-center text-app-ink font-medium underline underline-offset-4">
            {t('safety_sign_in')}
          </Link>{' '}
          {t('res_sign_in_to')}
        </div>
      )}

      <section className="surface-card p-4 sm:p-5 mb-6">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-base font-semibold text-app-ink">
            {t('res_nearby')} <span className="tabular-nums">({filtered.length})</span>
          </h2>
          <label className="inline-flex min-h-11 items-center gap-3 text-sm text-app-muted cursor-pointer">
            <input
              type="checkbox"
              checked={expiringOnly}
              onChange={(e) => setExpiringOnly(e.target.checked)}
              className="h-5 w-5 shrink-0 accent-accent"
            />
            Expiring within 1 hour
          </label>
        </div>

        <div className="space-y-3 mb-4">
          <label htmlFor="resources-search" className="app-form-label">Search resources</label>
          <input
            id="resources-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, contact, notes, or owner"
            className={inputCls}
          />
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setFilter('all')}
              aria-pressed={filter === 'all'}
              className="app-choice-button px-3 text-sm"
            >
              {t('res_all')}
            </button>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
                className="app-choice-button px-3 text-sm"
              >
                {KIND_META[k].label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p role="status" className="text-app-muted text-sm">{t('res_loading')}</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Package className="h-7 w-7" />}
            title={t('res_none_yet')}
            body={t('res_none_body')}
          />
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((pin) => (
              <ResourceCard
                key={pin.id}
                pin={pin}
                mineId={mineMarker && pin.owner_name === mineMarker ? pin.owner_id : null}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SummaryCard({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-xl font-semibold tabular-nums text-app-ink">{value}</div>
      <div className="text-xs text-app-muted leading-relaxed mt-1">
        {label}
      </div>
    </div>
  )
}
