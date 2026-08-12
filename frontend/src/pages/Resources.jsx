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

function ResourceCard({ pin, mineId, onDelete, index = 0 }) {
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
    <li
      className="group bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-xl px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-700 hover:shadow-lg hover:shadow-black/40 reveal-up"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-start gap-3">
          <span
            aria-hidden
            className="inline-flex items-center justify-center h-8 w-8 rounded-full border border-orange-500/30 bg-orange-500/10 text-orange-200 shrink-0"
          >
            <ResourceIcon kind={pin.kind} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="text-white font-semibold truncate">{pin.name}</h3>
            <p className="text-xs text-gray-400 mt-0.5 capitalize">
              {meta.label}
              {pin.owner_name ? ` . ${pin.owner_name}` : ''}
            </p>
          </div>
        </div>
        {expiresIn !== null && (
          <span
            className={`text-[10px] uppercase tracking-wider shrink-0 px-2 py-0.5 rounded-full border tabular-nums ${
              expiringSoon
                ? 'text-amber-300 bg-amber-950/40 border-amber-800/60'
                : 'text-gray-400 bg-gray-800/60 border-gray-700/60'
            }`}
          >
            {expiresIn > 60 ? `${Math.floor(expiresIn / 60)}h left` : `${expiresIn}m left`}
          </span>
        )}
      </div>

      <div className="text-xs text-gray-300 mt-3 space-y-1.5">
        {pin.capacity != null && (
          <div>
            <span className="text-gray-500">Capacity:</span>{' '}
            <span className="tabular-nums">{pin.capacity}</span>
          </div>
        )}
        {pin.contact && (
          <div className="wrap-break-word">
            <span className="text-gray-500">Contact:</span> {pin.contact}
          </div>
        )}
        {pin.notes && <div className="text-gray-300 wrap-break-word">{pin.notes}</div>}
      </div>

      <div className="flex items-center justify-between mt-3 gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {directions && (
            <Link
              to={directions}
              className="text-xs text-blue-300 hover:text-blue-200 underline-offset-2 hover:underline transition-colors"
            >
              Directions
            </Link>
          )}
          {contactAction && (
            <a
              href={contactAction.href}
              className="text-xs text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline transition-colors"
            >
              {contactAction.label}
            </a>
          )}
        </div>
        {isMine && (
          <button
            onClick={() => onDelete(pin.id)}
            className="text-xs text-red-400 hover:text-red-300 transition-colors"
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

  const inputCls =
    'w-full bg-gray-800/80 border border-gray-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-hidden focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:bg-gray-800 transition-all duration-200 placeholder:text-gray-600'

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
      <div className="mb-5 sm:mb-6 reveal-up">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">{t('res_title')}</h1>
            <p className="text-gray-400 text-sm mt-1">{t('res_subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setRefreshing(true)
              void load()
            }}
            className="text-xs border border-gray-700 hover:border-orange-500/50 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition-all duration-200"
          >
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {usingFallbackArea && (
        <div className="bg-amber-950/60 border border-amber-800/70 text-amber-300 text-xs rounded-lg px-4 py-2.5 mb-4 flex items-start gap-2">
          <MapPin className="h-4 w-4 shrink-0 mt-px" aria-hidden />
          <span>
            Showing a default area — we could not read your location. Enable
            location access to see resources around you.
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-950/70 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-6 flex items-start gap-2 pop-in">
          <span aria-hidden className="text-base shrink-0 mt-px">!</span>
          <span>{error}</span>
        </div>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6 reveal-up stagger-1">
        <SummaryCard label="Nearby pins" value={pins.length} accent="text-orange-300" />
        <SummaryCard label="My pins" value={mineCount} accent="text-blue-300" />
        <SummaryCard label="Expiring soon" value={expiringSoonCount} accent="text-amber-300" />
        <SummaryCard label="Visible now" value={filtered.length} accent="text-emerald-300" />
      </section>

      {user ? (
        <form
          onSubmit={onSubmit}
          className="bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-xl p-4 sm:p-5 mb-6 space-y-3 reveal-up stagger-1 shadow-lg shadow-black/20"
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
              {t('res_pin_a_resource')}
            </h2>
            <span className="text-[11px] text-gray-500">
              New pins appear to anyone browsing this board nearby.
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`text-xs px-3 py-2 rounded-lg border transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${
                  kind === k
                    ? 'border-orange-500 bg-linear-to-b from-orange-500/25 to-orange-500/10 text-orange-200 shadow-xs shadow-orange-500/15'
                    : 'border-gray-700 text-gray-300 hover:border-orange-500/40 hover:bg-gray-800/40'
                }`}
              >
                <ResourceIcon kind={k} className="h-3.5 w-3.5 inline-block mr-1.5 -mt-0.5" />
                {KIND_META[k].label}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('res_name_ph')}
            maxLength={120}
            required
            className={inputCls}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder={t('res_contact_ph')}
              maxLength={120}
              className={inputCls}
            />
            <input
              type="number"
              min="0"
              max="100000"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder={t('res_capacity_ph')}
              className={`${inputCls} tabular-nums`}
            />
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('res_notes_ph')}
            maxLength={500}
            rows={2}
            className={inputCls}
          />

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <label htmlFor="res-valid">{t('res_valid_for')}</label>
            <input
              id="res-valid"
              type="number"
              min="1"
              max="336"
              value={validHours}
              onChange={(e) => setValidHours(e.target.value)}
              className="w-20 bg-gray-800/80 border border-gray-700 text-white rounded-lg px-2 py-1 text-sm focus:outline-hidden focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 transition-all tabular-nums"
            />
            <span>{t('res_hours')}</span>
          </div>

          <button
            type="submit"
            disabled={posting || !coords}
            className="group relative w-full bg-linear-to-b from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg shadow-md shadow-orange-500/20 hover:shadow-orange-500/40 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] overflow-hidden"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-linear-to-r from-transparent via-white/25 to-transparent skew-x-12 -translate-x-full group-hover:translate-x-[400%] transition-transform duration-700 ease-out"
            />
            <span className="relative">{posting ? t('res_posting') : t('res_post')}</span>
          </button>
        </form>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-5 mb-6 text-sm text-gray-400">
          <a href="/login" className="text-orange-400 hover:text-orange-300 underline-offset-2 hover:underline">
            {t('safety_sign_in')}
          </a>{' '}
          {t('res_sign_in_to')}
        </div>
      )}

      <section className="bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-xl p-4 sm:p-5 mb-6 shadow-lg shadow-black/20">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
            {t('res_nearby')} . <span className="tabular-nums">{filtered.length}</span>
          </h2>
          <label className="inline-flex items-center gap-2 text-xs text-gray-400">
            <input
              type="checkbox"
              checked={expiringOnly}
              onChange={(e) => setExpiringOnly(e.target.checked)}
              className="rounded-sm border-gray-700 bg-gray-900"
            />
            Expiring within 1 hour
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] gap-3 mb-3">
          <input
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
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-all duration-200 hover:-translate-y-0.5 ${
                filter === 'all'
                  ? 'border-orange-500 bg-orange-500/15 text-orange-200 shadow-xs shadow-orange-500/15'
                  : 'border-gray-700 text-gray-400 hover:border-orange-500/40 hover:text-gray-200'
              }`}
            >
              {t('res_all')}
            </button>
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-all duration-200 hover:-translate-y-0.5 ${
                  filter === k
                    ? 'border-orange-500 bg-orange-500/15 text-orange-200 shadow-xs shadow-orange-500/15'
                    : 'border-gray-700 text-gray-400 hover:border-orange-500/40 hover:text-gray-200'
                }`}
              >
                {KIND_META[k].label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm">{t('res_loading')}</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Package className="h-7 w-7" />}
            title={t('res_none_yet')}
            body={t('res_none_body')}
          />
        ) : (
          <ul className="space-y-2.5">
            {filtered.map((pin, index) => (
              <ResourceCard
                key={pin.id}
                pin={pin}
                mineId={mineMarker && pin.owner_name === mineMarker ? pin.owner_id : null}
                onDelete={onDelete}
                index={index}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function SummaryCard({ label, value, accent }) {
  return (
    <div className="bg-gray-900/80 border border-gray-800 rounded-xl px-3 py-3">
      <div className={`text-xl font-semibold tabular-nums ${accent}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-widest text-gray-500 mt-1">
        {label}
      </div>
    </div>
  )
}
