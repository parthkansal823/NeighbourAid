import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { getBrowseLocation } from '../utils/geo'
import { AlertTriangle, MapPin } from '../components/icons'
import BuddyPing from '../components/BuddyPing'
import { useTimeAgo } from '../hooks/useTimeAgo'

const STATUS_STYLE = {
  safe: 'bg-linear-to-br from-green-900/60 to-green-950/40 text-green-300 border-green-700/70',
  need_help: 'bg-linear-to-br from-red-900/60 to-red-950/40 text-red-300 border-red-700/70',
}

function CheckinRow({ checkin, index = 0 }) {
  const ago = useTimeAgo(checkin.created_at)
  const lat = checkin.location?.coordinates?.[1]
  const lng = checkin.location?.coordinates?.[0]
  const directions = lat != null && lng != null ? `/map?dest=${lat},${lng}` : null

  return (
    <li
      className={`border rounded-lg px-3 sm:px-4 py-2.5 sm:py-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-black/30 reveal-up ${STATUS_STYLE[checkin.status]}`}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-center justify-between text-sm gap-2">
        <span className="font-semibold truncate">
          {checkin.status === 'safe' ? 'Safe' : 'Needs help'} . {checkin.user_name}
        </span>
        <span className="text-xs text-gray-400 shrink-0 tabular-nums">{ago}</span>
      </div>
      {checkin.note && <p className="text-sm mt-1 wrap-break-word">{checkin.note}</p>}
      {directions && (
        <Link
          to={directions}
          className="inline-flex mt-2 text-xs text-blue-200 hover:text-white underline-offset-2 hover:underline"
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
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
      <div className="mb-5 sm:mb-6 reveal-up">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-white">{t('safety_title')}</h1>
            <p className="text-gray-400 text-sm mt-1">{t('safety_subtitle')}</p>
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
            location access to see check-ins around you.
          </span>
        </div>
      )}

      {error && (
        <div className="bg-red-950/70 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-6 flex items-start gap-2 pop-in">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6 reveal-up stagger-1">
        <SummaryCard label="Nearby" value={list.length} accent="text-orange-300" />
        <SummaryCard label="Need help" value={helpCount} accent="text-red-300" />
        <SummaryCard label="Marked safe" value={safeCount} accent="text-emerald-300" />
        <SummaryCard label="Visible now" value={visible.length} accent="text-blue-300" />
      </section>

      {helpCount > 0 && (
        <div className="bg-red-950/40 border border-red-800 text-red-200 rounded-xl px-4 py-3 mb-6 reveal-up">
          <div className="font-semibold">{helpCount} nearby check-in{helpCount !== 1 ? 's' : ''} need help right now.</div>
          <div className="text-sm text-red-300 mt-1">
            Open the map or resource board if you are coordinating a response.
          </div>
          <div className="flex gap-3 mt-2 text-sm">
            <Link to="/map" className="text-white underline-offset-2 hover:underline">
              Open map
            </Link>
            <Link to="/resources" className="text-white underline-offset-2 hover:underline">
              View resources
            </Link>
          </div>
        </div>
      )}

      {user ? (
        <section className="bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-xl p-4 sm:p-5 mb-6 reveal-up stagger-1 shadow-lg shadow-black/20">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
              {t('safety_your')}
            </h2>
            <span className="text-[11px] text-gray-500">
              Latest check-in wins and expires automatically after 24 hours.
            </span>
          </div>
          {me ? <MyCheckin me={me} /> : <p className="text-gray-500 text-sm mb-4">{t('safety_no_active')}</p>}
          <div className="space-y-2">
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('safety_note_ph')}
              maxLength={280}
              className="w-full bg-gray-800/80 border border-gray-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-hidden focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:bg-gray-800 transition-all duration-200 placeholder:text-gray-600"
            />
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => checkin('safe')}
                disabled={!coords || !!saving}
                className="group relative flex-1 bg-linear-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg shadow-md shadow-emerald-500/20 hover:shadow-emerald-500/40 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] overflow-hidden"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-linear-to-r from-transparent via-white/25 to-transparent skew-x-12 -translate-x-full group-hover:translate-x-[400%] transition-transform duration-700 ease-out"
                />
                <span className="relative">{saving === 'safe' ? t('safety_saving') : `Safe: ${t('safety_i_am_safe')}`}</span>
              </button>
              <button
                onClick={() => checkin('need_help')}
                disabled={!coords || !!saving}
                className="group relative flex-1 bg-linear-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg shadow-md shadow-red-500/20 hover:shadow-red-500/40 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] overflow-hidden"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-linear-to-r from-transparent via-white/25 to-transparent skew-x-12 -translate-x-full group-hover:translate-x-[400%] transition-transform duration-700 ease-out"
                />
                <span className="relative">{saving === 'need_help' ? t('safety_saving') : `Help: ${t('safety_i_need_help')}`}</span>
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 sm:p-5 mb-6 text-sm text-gray-400">
          <a href="/login" className="text-orange-400 hover:text-orange-300 underline-offset-2 hover:underline">
            {t('safety_sign_in')}
          </a>{' '}
          {t('safety_sign_in_to')}
        </div>
      )}

      <section className="bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-xl p-4 sm:p-5 shadow-lg shadow-black/20">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
            {t('safety_nearby')} . <span className="tabular-nums">{visible.length}</span> {t('safety_checkins')}
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
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-all duration-200 hover:-translate-y-0.5 ${
                  filter === item.value
                    ? 'border-orange-500 bg-orange-500/15 text-orange-200 shadow-xs shadow-orange-500/15'
                    : 'border-gray-700 text-gray-400 hover:border-orange-500/40 hover:text-gray-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, note, or status"
          className="w-full bg-gray-800/80 border border-gray-700 text-white rounded-lg px-4 py-2 text-sm focus:outline-hidden focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:bg-gray-800 transition-all duration-200 placeholder:text-gray-600 mb-3"
        />

        {loading ? (
          <p className="text-gray-500 text-sm">{t('map_loading')}</p>
        ) : visible.length === 0 ? (
          <p className="text-gray-500 text-sm">{t('safety_none_yet')}</p>
        ) : (
          <ul className="space-y-2">
            {visible.map((checkin, index) => (
              <CheckinRow key={`${checkin.user_name}-${checkin.created_at}`} checkin={checkin} index={index} />
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
      <div className="flex items-center justify-between text-xs mb-1 gap-2">
        <span className="font-semibold uppercase truncate">
          {me.status === 'safe' ? t('safety_i_am_safe') : t('safety_i_need_help')}
        </span>
        <span className="text-gray-400 shrink-0">{ago}</span>
      </div>
      {me.note && <p className="text-sm mt-1 wrap-break-word">{me.note}</p>}
      <p className="text-[11px] text-gray-400 mt-2">
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
