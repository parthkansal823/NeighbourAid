import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import MapView from '../components/MapView'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useI18n } from '../utils/i18n'
// `Map` is aliased: the bare name collides with the JS built-in, which also
// means ESLint's no-undef would NOT have caught it going missing.
import { Map as MapIcon, MapPin, Flame, X, ChevronDown, Maximize2, Minimize2 } from '../components/icons'
import { GEOLOCATION_SUPPORTED } from '../utils/geo'
import { isNativeApp } from '../utils/runtime'

const URGENCY_FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
// Every AlertCategory the server can send, in rough order of how often it is
// reported. Six of them — accident, gas, structure, violence, animal, water —
// were missing, which did not hide the pins but made them unfilterable: a
// volunteer looking only for road accidents, or wanting to clear a crowded
// map down to the gas leak they are equipped for, had no way to ask for it.
// The chip row is also the only place the counts per category are shown, so
// those incidents were invisible in the totals as well.
const CATEGORIES = [
  'all',
  'medical',
  'fire',
  'flood',
  'accident',
  'missing',
  'structure',
  'gas',
  'power',
  'water',
  'violence',
  'animal',
  'other',
]
const FALLBACK_CENTER = [30.7333, 76.7794] // Chandigarh

function parseLatLng(s) {
  if (!s) return null
  const parts = s.split(',').map((x) => parseFloat(x.trim()))
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null
  if (Math.abs(parts[0]) > 90 || Math.abs(parts[1]) > 180) return null
  return parts
}

export default function MapDashboard() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const [alerts, setAlerts] = useState([])
  const [urgencyFilter, setUrgencyFilter] = useState('ALL')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [userCenter, setUserCenter] = useState(null)
  const [locationAccuracy, setLocationAccuracy] = useState(null)
  const [locationTime, setLocationTime] = useState(null)
  // Both seeded from a module constant: whether the browser has a
  // geolocation API is fixed for the page, and the watch below starts
  // immediately when it does — so discovering either inside an effect and
  // setState-ing the result just costs an extra render before first paint.
  const [locating, setLocating] = useState(GEOLOCATION_SUPPORTED)
  const [locationError, setLocationError] = useState(
    GEOLOCATION_SUPPORTED ? '' : 'Geolocation not supported in this browser'
  )
  const [error, setError] = useState('')
  const [showHeat, setShowHeat] = useState(false)
  const [heatPoints, setHeatPoints] = useState([])
  const watchIdRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [smallScreen, setSmallScreen] = useState(() => window.matchMedia('(max-width: 639px)').matches)
  const toolbarRef = useRef(null)
  const mapPageRef = useRef(null)
  const expandButtonRef = useRef(null)
  const [controlsHeight, setControlsHeight] = useState(144)
  const compact = isNativeApp() || smallScreen || expanded

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)')
    const change = () => setSmallScreen(media.matches)
    media.addEventListener('change', change)
    return () => media.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => setControlsHeight(toolbar.offsetHeight))
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!expanded) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const close = (event) => {
      if (event.key === 'Escape') { setExpanded(false); expandButtonRef.current?.focus() }
      if (event.key === 'Tab') {
        const controls = Array.from(mapPageRef.current?.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]') || [])
        const first = controls[0], last = controls.at(-1)
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', close)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', close)
    }
  }, [expanded])

  // Parse ?dest=lat,lng&focus=alertId — these come from "Directions" links
  // throughout the app (alert cards, share pages, resource pins).
  const destination = useMemo(
    () => parseLatLng(searchParams.get('dest')),
    [searchParams]
  )
  const focusId = searchParams.get('focus') || null

  const clearDestination = useCallback(() => {
    const next = new URLSearchParams(searchParams)
    next.delete('dest')
    next.delete('focus')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  // Start a live geolocation watch — coords + accuracy + timestamp update as
  // the browser/device reports fresher fixes. This keeps "My location" truly
  // current rather than frozen at the first fix.
  useEffect(() => {
    // The unsupported case is already reflected in initial state above.
    if (!GEOLOCATION_SUPPORTED) return undefined
    const onOk = ({ coords, timestamp }) => {
      setUserCenter([coords.latitude, coords.longitude])
      setLocationAccuracy(coords.accuracy)
      setLocationTime(timestamp)
      setLocationError('')
      setLocating(false)
    }
    const onErr = (err) => {
      setLocationError(err.message || 'Unable to read location')
      setLocating(false)
    }
    navigator.geolocation.getCurrentPosition(onOk, onErr, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    })
    watchIdRef.current = navigator.geolocation.watchPosition(onOk, onErr, {
      enableHighAccuracy: true,
      maximumAge: 10000,
    })
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const center = userCenter ?? FALLBACK_CENTER
    let cancelled = false

    const fetchAlerts = async () => {
      if (document.visibilityState === 'hidden') return
      try {
        const { data } = await api.get('/api/alerts/nearby', {
          params: { lat: center[0], lng: center[1], km: 50 },
        })
        if (!cancelled) {
          setAlerts(data)
          setError('')
        }
      } catch (err) {
        if (!cancelled) setError(apiError(err, t('map_failed')))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchAlerts()
    const id = setInterval(fetchAlerts, 15000)
    const onVis = () => {
      if (document.visibilityState === 'visible') fetchAlerts()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [userCenter, t])

  useEffect(() => {
    if (!showHeat) return undefined
    const center = userCenter ?? FALLBACK_CENTER
    let cancelled = false
    const fetchHeat = async () => {
      try {
        const { data } = await api.get('/api/alerts/heatmap', {
          params: { lat: center[0], lng: center[1], km: 50, hours: 72 },
        })
        if (!cancelled) setHeatPoints(data.points || [])
      } catch {
        /* silent — heatmap is decorative */
      }
    }
    fetchHeat()
    const id = setInterval(fetchHeat, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [showHeat, userCenter])

  const recenterNow = () => {
    if (!navigator.geolocation) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        setUserCenter([coords.latitude, coords.longitude])
        setLocationAccuracy(coords.accuracy)
        setLocationTime(timestamp)
        setLocationError('')
        setLocating(false)
      },
      (err) => {
        setLocationError(err.message || 'Unable to read location')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  const visible = useMemo(
    () =>
      alerts.filter(
        (a) =>
          (urgencyFilter === 'ALL' || a.urgency === urgencyFilter) &&
          (categoryFilter === 'all' || a.category === categoryFilter)
      ),
    [alerts, urgencyFilter, categoryFilter]
  )

  const urgencyCounts = alerts.reduce((acc, a) => {
    acc[a.urgency] = (acc[a.urgency] ?? 0) + 1
    return acc
  }, {})

  const categoryCounts = alerts.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] ?? 0) + 1
    return acc
  }, {})

  const locStatus = locationError
    ? locationError
    : userCenter
    ? `${userCenter[0].toFixed(4)}, ${userCenter[1].toFixed(4)}${
        locationAccuracy ? ` · ±${Math.round(locationAccuracy)} m` : ''
      }${locationTime ? ` · ${new Date(locationTime).toLocaleTimeString()}` : ''}`
    : 'Locating…'

  return (
    <div ref={mapPageRef} className={`map-page relative flex flex-col h-[calc(100vh-57px)]${compact ? ' map-compact' : ''}${expanded ? ' map-expanded' : ''}`} style={{ '--map-controls-height': `${controlsHeight}px` }}>
      <div ref={toolbarRef} className="map-toolbar glass border-b border-gray-800 px-3 sm:px-6 py-2 sm:py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h1 className="text-white font-semibold text-sm sm:text-base inline-flex items-center gap-2">
            <MapIcon className="h-4 w-4" aria-hidden />
            {t(compact ? 'nav_map' : 'map_title')}
          </h1>
          {compact && <button type="button" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-controls="map-urgency-filters map-category-filters" className="tap ml-auto inline-flex items-center gap-1 rounded-lg border border-line px-2 text-xs text-gray-200">
            {t('map_filters')}{(urgencyFilter !== 'ALL' || categoryFilter !== 'all') && <span className="h-1.5 w-1.5 rounded-full bg-orange-400" aria-hidden />}
            <ChevronDown className={`h-4 w-4${filtersOpen ? ' rotate-180' : ''}`} aria-hidden />
          </button>}
          <button ref={expandButtonRef} type="button" onClick={() => setExpanded((value) => !value)} aria-pressed={expanded} aria-label={t(expanded ? 'map_exit_fullscreen' : 'map_fullscreen')} title={t(expanded ? 'map_exit_fullscreen' : 'map_fullscreen')} className="tap inline-flex shrink-0 items-center justify-center rounded-lg border border-line text-gray-200">
            {expanded ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
          </button>
          {(!compact || filtersOpen) && <div id="map-urgency-filters" role="group" aria-label="Urgency" className="map-filters flex gap-1.5 flex-wrap">
            {URGENCY_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setUrgencyFilter(f)}
                aria-pressed={urgencyFilter === f}
                className={`text-[11px] sm:text-xs px-2.5 sm:px-3 py-1 rounded-full border transition-colors duration-200 ${
                  urgencyFilter === f
                    ? 'border-orange-500 bg-orange-500/15 text-orange-200'
                    : 'border-gray-700 text-gray-400 hover:border-orange-500/40 hover:text-gray-200'
                }`}
              >
                {f === 'ALL' ? t('map_all') : f}
                {f !== 'ALL' && urgencyCounts[f] ? (
                  <span className="ml-1 text-gray-500 tabular-nums">({urgencyCounts[f]})</span>
                ) : null}
              </button>
            ))}
          </div>}
          <span className="text-gray-500 text-[11px] sm:text-xs ml-auto w-full sm:w-auto order-last sm:order-0">
            {loading
              ? t('map_loading')
              : error
              ? error
              : (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="tabular-nums">{visible.length}</span>{' '}
                  {visible.length !== 1 ? t('map_active_alerts_many') : t('map_active_alerts_one')}{' '}
                  · {t('map_refresh_note')}
                </span>
              )}
          </span>
        </div>

        {(!compact || filtersOpen) && <div id="map-category-filters" role="group" aria-label={t('post_category')} className="map-filters flex gap-1.5 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              aria-pressed={categoryFilter === cat}
              className={`text-[11px] sm:text-xs px-2.5 sm:px-3 py-1 rounded-full border transition-colors duration-200 ${
                categoryFilter === cat
                  ? 'border-blue-500 bg-blue-500/15 text-blue-200'
                  : 'border-gray-700 text-gray-500 hover:border-blue-500/40 hover:text-gray-300'
              }`}
            >
              {cat === 'all' ? t('map_all') : t(`cat_${cat}`)}
              {cat !== 'all' && categoryCounts[cat] ? (
                <span className="ml-1 text-gray-500 tabular-nums">({categoryCounts[cat]})</span>
              ) : null}
            </button>
          ))}
        </div>}

        <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500">
          <span className="truncate flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse shrink-0" />
            <span className="truncate tabular-nums inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />{locStatus}</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {destination && (
              <button
                onClick={clearDestination}
                className="text-xs border border-orange-700/60 bg-orange-500/15 text-orange-300 hover:bg-orange-500/25 hover:text-orange-200 px-2 py-0.5 rounded-md transition-colors duration-200"
                title="Clear destination"
              >
                <><X className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" aria-hidden />Clear route</>
              </button>
            )}
            <button
              onClick={() => setShowHeat((v) => !v)}
              className={`text-xs border px-2 py-0.5 rounded-md transition-colors duration-200 ${
                showHeat
                  ? 'border-orange-500 bg-orange-500/15 text-orange-200'
                  : 'border-gray-700 text-gray-300 hover:border-orange-500/40'
              }`}
              title="Toggle 72-hour heatmap overlay"
            >
              <><Flame className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" aria-hidden />{showHeat ? 'Heat on' : 'Heat'}</>
            </button>
            <button
              onClick={recenterNow}
              disabled={locating}
              className="text-xs border border-gray-700 hover:border-blue-500/60 hover:text-white text-gray-300 px-2 py-0.5 rounded-md transition-colors duration-200 disabled:opacity-50"
              title={t('map_recenter')}
              aria-label={t('map_recenter')}
            >
              {locating ? (
                <span className="inline-flex items-center gap-1">
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </span>
              ) : (
                '⟳'
              )}
            </button>
          </div>
        </div>
      </div>

      <div className="map-body flex-1 p-2 sm:p-4 min-h-0">
        <MapView
          alerts={visible}
          center={userCenter}
          accuracy={locationAccuracy}
          heatPoints={heatPoints}
          showHeat={showHeat}
          destination={destination}
          focusId={focusId}
          onClearDestination={clearDestination}
        />
      </div>
    </div>
  )
}
