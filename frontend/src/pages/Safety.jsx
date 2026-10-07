import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { getBrowseLocation } from '../utils/geo'
import { AlertTriangle, MapPin } from '../components/icons'
import BuddyPing from '../components/BuddyPing'
import FirstAidButton from '../components/FirstAidGuide'
import DoctorReviewPanel from '../components/DoctorReviewPanel'
import { useTimeAgo } from '../hooks/useTimeAgo'

const STATUS_STYLE = {
  safe: 'app-feedback-success',
  need_help: 'app-feedback-error',
}

function CheckinRow({ checkin }) {
  const ago = useTimeAgo(checkin.created_at)
  const lat = checkin.location?.coordinates?.[1]
  const lng = checkin.location?.coordinates?.[0]
  const directions = lat != null && lng != null ? `/map?dest=${lat},${lng}` : null

  return (
    <li
      className={`rounded-xl px-3 sm:px-4 py-3 ${STATUS_STYLE[checkin.status]}`}
    >
      <div className="flex flex-wrap items-start justify-between text-sm gap-2">
        <span className="font-semibold min-w-0 wrap-break-word">
          {checkin.status === 'safe' ? 'Safe' : 'Needs help'}: {checkin.user_name}
        </span>
        <span className="text-xs text-app-muted shrink-0 tabular-nums">{ago}</span>
      </div>
      {checkin.note && <p className="text-sm mt-1 wrap-break-word">{checkin.note}</p>}
      {directions && (
        <Link
          to={directions}
          className="inline-flex min-h-11 items-center mt-1 text-sm text-app-ink underline underline-offset-4"
        >
          Open on map
        </Link>
      )}
    </li>
  )
}

export default function Safety() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [list, setList] = useState([])
  const [me, setMe] = useState(null)
  const [coords, setCoords] = useState(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [usingFallbackArea, setUsingFallbackArea] = useState(false)

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
      const [nearRes, meRes] = await Promise.all([
        api.get('/api/safety/near', {
          params: { lng: coords[0], lat: coords[1], km: 10 },
        }),
        user ? api.get('/api/safety/me') : Promise.resolve({ data: null }),
      ])
      setList(nearRes.data)
      setMe(meRes.data)
      setError('')
    } catch (err) {
      setError(apiError(err, t('safety_load_failed')))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [coords, t, user])

  useEffect(() => {
    void load()
    const id = setInterval(() => {
      // Inside a timer callback, not the effect body — raising the
      // refresh flag here is a normal async state update.
      setRefreshing(true)
      void load()
    }, 30000)
    return () => clearInterval(id)
  }, [load])

  const checkin = async (status) => {
    if (!coords || !user) return
    setSaving(status)
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
      const { data } = await api.post('/api/safety/', {
        status,
        note: note.trim(),
        location: { type: 'Point', coordinates: fresh },
      })
      setMe(data)
      setRefreshing(true)
      await load()
    } catch (err) {
      setError(apiError(err, t('safety_post_failed')))
    } finally {
      setSaving('')
    }
  }

  const safeCount = list.filter((c) => c.status === 'safe').length
  const helpCount = list.filter((c) => c.status === 'need_help').length

  const visible = useMemo(() => {
    const next = list.filter((checkin) => {
      if (filter !== 'all' && checkin.status !== filter) return false
      if (!deferredSearch) return true
      const haystack = [checkin.user_name, checkin.note, checkin.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(deferredSearch)
    })

    next.sort((a, b) => {
      const priorityDelta = Number(b.status === 'need_help') - Number(a.status === 'need_help')
      if (priorityDelta !== 0) return priorityDelta
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    return next
  }, [deferredSearch, filter, list])

  return (
    <div className="page-panel max-w-2xl mx-auto px-4 py-6 sm:py-8">
      <div className="mb-5 sm:mb-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-app-ink">{t('safety_title')}</h1>
            <p className="text-app-muted text-sm leading-relaxed mt-2">{t('safety_subtitle')}</p>
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

      <div className="mb-6"><FirstAidButton /></div>
      <DoctorReviewPanel />
      {usingFallbackArea && (
        <div role="status" className="border border-line bg-surface-1 text-app-muted text-sm leading-relaxed rounded-xl px-4 py-3 mb-4 flex items-start gap-2">
          <MapPin className="h-4 w-4 shrink-0 mt-px" aria-hidden />
          <span>
            Showing a default area — we could not read your location. Enable
            location access to see check-ins around you.
          </span>
        </div>
      )}

      {error && (
        <div role="alert" className="app-feedback-error text-sm rounded-xl px-4 py-3 mb-6 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 border-y border-line py-4 mb-6">
        <SummaryCard label="Nearby" value={list.length} />
        <SummaryCard label="Need help" value={helpCount} />
        <SummaryCard label="Marked safe" value={safeCount} />
        <SummaryCard label="Visible now" value={visible.length} />
      </section>

      {helpCount > 0 && (
        <div className="app-feedback-error rounded-xl px-4 py-3 mb-6">
          <div className="font-semibold">{helpCount} nearby check-in{helpCount !== 1 ? 's' : ''} need help right now.</div>
          <div className="text-sm text-app-muted leading-relaxed mt-2">
            Open the map or resource board if you are coordinating a response.
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm">
            <Link to="/map" className="inline-flex min-h-11 items-center text-app-ink underline underline-offset-4">
              Open map
            </Link>
            <Link to="/resources" className="inline-flex min-h-11 items-center text-app-ink underline underline-offset-4">
              View resources
            </Link>
          </div>
        </div>
      )}

      {user ? (
        <section className="surface-card p-4 sm:p-5 mb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-base font-semibold text-app-ink">
              {t('safety_your')}
            </h2>
            <span className="text-xs text-app-muted leading-relaxed">
              Latest check-in wins and expires automatically after 24 hours.
            </span>
          </div>
          {me ? <MyCheckin me={me} /> : <p className="text-app-muted text-sm mb-4">{t('safety_no_active')}</p>}
          <div className="space-y-2">
            <label htmlFor="safety-note" className="app-form-label">{t('safety_note_ph')}</label>
            <input
              id="safety-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('safety_note_ph')}
              maxLength={280}
              className="app-field w-full"
            />
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => checkin('safe')}
                disabled={!coords || !!saving}
                className="app-secondary-button flex-1"
              >
                <span className="relative">{saving === 'safe' ? t('safety_saving') : `Safe: ${t('safety_i_am_safe')}`}</span>
              </button>
              <button
                onClick={() => checkin('need_help')}
                disabled={!coords || !!saving}
                className="app-danger-button flex-1"
              >
                <span className="relative">{saving === 'need_help' ? t('safety_saving') : `Help: ${t('safety_i_need_help')}`}</span>
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="border border-line bg-surface-1 rounded-xl p-4 sm:p-5 mb-6 text-sm text-app-muted leading-relaxed">
          <Link to="/login" className="inline-flex min-h-11 items-center text-app-ink font-medium underline underline-offset-4">
            {t('safety_sign_in')}
          </Link>{' '}
          {t('safety_sign_in_to')}
        </div>
      )}

      <section className="surface-card p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-base font-semibold text-app-ink">
            {t('safety_nearby')} <span className="tabular-nums">({visible.length} {t('safety_checkins')})</span>
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: 'all', label: 'All' },
              { value: 'need_help', label: 'Need help' },
              { value: 'safe', label: 'Safe' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                aria-pressed={filter === item.value}
                className="app-choice-button px-3 text-sm"
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <label htmlFor="safety-search" className="app-form-label">Search check-ins</label>
        <input
          id="safety-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, note, or status"
          className="app-field w-full mb-4"
        />

        {loading ? (
          <p role="status" className="text-app-muted text-sm">{t('map_loading')}</p>
        ) : visible.length === 0 ? (
          <p className="text-app-muted text-sm leading-relaxed">{t('safety_none_yet')}</p>
        ) : (
          <ul className="space-y-2">
            {visible.map((checkin) => (
              <CheckinRow key={`${checkin.user_name}-${checkin.created_at}`} checkin={checkin} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function MyCheckin({ me }) {
  const { t } = useI18n()
  const ago = useTimeAgo(me.created_at)
  return (
    <div className={`border rounded-lg px-3 sm:px-4 py-3 mb-4 ${STATUS_STYLE[me.status]}`}>
      <div className="flex flex-wrap items-center justify-between text-sm mb-1 gap-2">
        <span className="font-semibold min-w-0 wrap-break-word">
          {me.status === 'safe' ? t('safety_i_am_safe') : t('safety_i_need_help')}
        </span>
        <span className="text-app-muted text-xs shrink-0">{ago}</span>
      </div>
      {me.note && <p className="text-sm mt-1 wrap-break-word">{me.note}</p>}
      <p className="text-xs text-app-muted leading-relaxed mt-2">
        {t('safety_expires')} {new Date(me.expires_at).toLocaleString()}
      </p>
      {me.status === 'need_help' && (
        <BuddyPing
          compact
          message={
            me.note
              ? `Need help on NeighbourAid: ${me.note}`
              : 'I marked that I need help on NeighbourAid. Please check on me.'
          }
        />
      )}
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
