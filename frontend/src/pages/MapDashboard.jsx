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
  const [smallScreen, setSmallScreen] = useState(() => window.matchMedia('(max-width: 1023px)').matches)
  const toolbarRef = useRef(null)
  const mapPageRef = useRef(null)
  const expandButtonRef = useRef(null)
  const [controlsHeight, setControlsHeight] = useState(144)
  const compact = isNativeApp() || smallScreen || expanded

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)')
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
      <div ref={toolbarRef} className="map-toolbar border-b border-line bg-surface-1 px-3 sm:px-6 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <h1 className="text-app-ink font-semibold text-base inline-flex items-center gap-2">
            <MapIcon className="h-4 w-4" aria-hidden />
            {t(compact ? 'nav_map' : 'map_title')}
          </h1>
          {compact && <button type="button" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-controls="map-filter-panel" className="app-secondary-button ml-auto">
            {t('map_filters')}{(urgencyFilter !== 'ALL' || categoryFilter !== 'all') && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />}
            <ChevronDown className={`h-4 w-4${filtersOpen ? ' rotate-180' : ''}`} aria-hidden />
          </button>}
          <button ref={expandButtonRef} type="button" onClick={() => setExpanded((value) => !value)} aria-pressed={expanded} aria-label={t(expanded ? 'map_exit_fullscreen' : 'map_fullscreen')} title={t(expanded ? 'map_exit_fullscreen' : 'map_fullscreen')} className="app-secondary-button shrink-0">
            {expanded ? <Minimize2 className="h-4 w-4" aria-hidden /> : <Maximize2 className="h-4 w-4" aria-hidden />}
          </button>
          <span role="status" className={`text-xs leading-relaxed w-full ${error ? 'text-[var(--app-danger)]' : 'text-app-muted'}`}>
            {loading
              ? t('map_loading')
              : error
              ? error
              : (
                <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--app-success)]" aria-hidden />
                  <span className="tabular-nums">{visible.length}</span>{' '}
                  {visible.length !== 1 ? t('map_active_alerts_many') : t('map_active_alerts_one')}
                  {!compact && <span>· {t('map_refresh_note')}</span>}
                </span>
              )}
          </span>
        </div>

        {(!compact || filtersOpen) && <div id="map-filter-panel" className="space-y-2">
          <div id="map-urgency-filters" role="group" aria-label={t('map_urgency_legend')} className="map-filters flex gap-2 flex-wrap">
            {URGENCY_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setUrgencyFilter(f)}
                aria-pressed={urgencyFilter === f}
                className="app-choice-button capitalize"
              >
                {f === 'ALL' ? t('map_all').toLocaleLowerCase() : f.toLowerCase()}
                {f !== 'ALL' && urgencyCounts[f] ? (
                  <span className="text-app-muted tabular-nums">({urgencyCounts[f]})</span>
                ) : null}
              </button>
            ))}
          </div>

          <div id="map-category-filters" role="group" aria-label={t('post_category')} className="map-filters flex gap-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              aria-pressed={categoryFilter === cat}
              className="app-choice-button capitalize"
            >
              {cat === 'all' ? t('map_all').toLocaleLowerCase() : t(`cat_${cat}`)}
              {cat !== 'all' && categoryCounts[cat] ? (
                <span className="text-app-muted tabular-nums">({categoryCounts[cat]})</span>
              ) : null}
            </button>
          ))}
          </div>
        </div>}

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-app-muted">
          <span title={locStatus} className="min-w-0 flex-1 basis-32 flex items-center gap-1.5">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate tabular-nums">{locStatus}</span>
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {destination && (
              <button
                type="button"
                onClick={clearDestination}
                className="app-secondary-button"
                title="Clear destination"
              >
                <><X className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" aria-hidden />Clear route</>
              </button>
            )}
            {(!compact || filtersOpen) && <button
              type="button"
              onClick={() => setShowHeat((v) => !v)}
              aria-pressed={showHeat}
              className="app-choice-button"
              title="Toggle 72-hour heatmap overlay"
            >
              <><Flame className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" aria-hidden />{showHeat ? 'Heat on' : 'Heat'}</>
            </button>}
            <button
              type="button"
              onClick={recenterNow}
              disabled={locating}
              className="app-secondary-button shrink-0"
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
