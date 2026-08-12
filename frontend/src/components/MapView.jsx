import { MapContainer, TileLayer, Marker, Popup, Circle, Polyline, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useEffect, useMemo, useRef, useState } from 'react'
import HeatLayer from './HeatLayer'
// Marker images come from the installed leaflet package so the bundler emits
// them as local assets. They used to be hot-linked from unpkg, which meant
// every pin on the crisis map depended on a third-party CDN being reachable —
// in an app whose whole point is working when the network is degraded.
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
// `Circle` is already taken by react-leaflet in this file, so the lucide dot
// comes in under an explicit alias.
import {
  ArrowUp,
  CircleDot,
  CloudRain,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  MapPin,
  Redo2,
  Star,
  Users,
} from './icons'

// Fix leaflet default icon path broken by bundlers
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const URGENCY_COLORS = {
  CRITICAL: '#ef4444',
  HIGH: '#f97316',
  MEDIUM: '#eab308',
  LOW: '#22c55e',
}

function urgencyIcon(urgency, isFocus = false) {
  const color = URGENCY_COLORS[urgency] ?? '#94a3b8'
  const ring = isFocus
    ? `<circle cx="12" cy="12" r="11" fill="none" stroke="${color}" stroke-width="2" opacity="0.5">
         <animate attributeName="r" from="6" to="14" dur="1.4s" repeatCount="indefinite" />
         <animate attributeName="opacity" from="0.7" to="0" dur="1.4s" repeatCount="indefinite" />
       </circle>`
    : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="${isFocus ? 32 : 24}" height="${isFocus ? 48 : 36}">
    ${ring}
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="white" stroke-width="1"/>
    <circle cx="12" cy="12" r="5" fill="white"/>
  </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: isFocus ? [32, 48] : [24, 36],
    iconAnchor: isFocus ? [16, 48] : [12, 36],
    popupAnchor: [0, isFocus ? -48 : -36],
  })
}

const userDotIcon = L.divIcon({
  html: `<div style="position:relative;width:18px;height:18px;">
    <div style="position:absolute;inset:-6px;border-radius:50%;background:rgba(59,130,246,0.35);animation:user-halo 1.8s ease-out infinite;"></div>
    <div style="position:absolute;inset:0;width:18px;height:18px;border-radius:50%;background:#3b82f6;border:3px solid white;box-shadow:0 0 0 2px rgba(59,130,246,0.5);"></div>
  </div>
  <style>@keyframes user-halo{0%{transform:scale(0.5);opacity:0.7}100%{transform:scale(2.2);opacity:0}}</style>`,
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

function destinationIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 44" width="32" height="44">
    <defs>
      <radialGradient id="dg" cx="50%" cy="40%" r="50%">
        <stop offset="0%" stop-color="#fb923c" />
        <stop offset="100%" stop-color="#c2410c" />
      </radialGradient>
    </defs>
    <circle cx="16" cy="14" r="13" fill="none" stroke="#fb923c" stroke-width="2" opacity="0.6">
      <animate attributeName="r" from="6" to="18" dur="1.6s" repeatCount="indefinite" />
      <animate attributeName="opacity" from="0.8" to="0" dur="1.6s" repeatCount="indefinite" />
    </circle>
    <path d="M16 0C8.27 0 2 6.27 2 14c0 10 14 30 14 30s14-20 14-30C30 6.27 23.73 0 16 0z" fill="url(#dg)" stroke="white" stroke-width="1.5"/>
    <circle cx="16" cy="14" r="6" fill="white"/>
    <path d="M16 9.6l1.5 3.1 3.4.5-2.5 2.4.6 3.4-3-1.6-3 1.6.6-3.4-2.5-2.4 3.4-.5z" fill="#c2410c"/>
  </svg>`
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [32, 44],
    iconAnchor: [16, 44],
    popupAnchor: [0, -44],
  })
}

// Keeps the map centered on the user as their coords update. Only re-centers
// when the coords actually change so it doesn't fight user pan/zoom.
function FollowUser({ center, suspended }) {
  const map = useMap()
  const prevRef = useRef(null)
  useEffect(() => {
    if (!center || suspended) return
    const prev = prevRef.current
    if (!prev) {
      map.setView(center, 14)
    } else {
      const [lat1, lng1] = prev
      const [lat2, lng2] = center
      const movedMeters = map.distance([lat1, lng1], [lat2, lng2])
      // Only pan when the fix has actually moved meaningfully (>10 m).
      // Prevents jittery jumping from GPS noise.
      if (movedMeters > 10) map.panTo(center, { animate: true })
    }
    prevRef.current = center
  }, [center, map, suspended])
  return null
}

// When a destination is set, fit both user + dest into view once.
function FitToRoute({ from, to }) {
  const map = useMap()
  const fitRef = useRef(null)
  useEffect(() => {
    if (!from || !to) return
    const key = `${from[0].toFixed(4)}|${from[1].toFixed(4)}|${to[0].toFixed(4)}|${to[1].toFixed(4)}`
    if (fitRef.current === key) return
    fitRef.current = key
    const bounds = L.latLngBounds([from, to]).pad(0.25)
    map.fitBounds(bounds, { animate: true, duration: 0.6 })
  }, [from, to, map])
  return null
}

// Invalidates size when parent resizes (handles mobile orientation change + panel collapse)
function ResizeWatcher() {
  const map = useMap()
  useEffect(() => {
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    // also run once after mount — parent may have laid out before map
    const id = setTimeout(() => map.invalidateSize(), 100)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
      clearTimeout(id)
    }
  }, [map])
  return null
}

function Legend() {
  return (
    <div className="absolute bottom-3 right-3 z-400 bg-gray-900/90 backdrop-blur-sm border border-gray-800 rounded-xl px-3 py-2 text-[11px] text-gray-300 space-y-1 shadow-xl shadow-black/40 max-w-[160px] reveal-up">
      <div className="font-semibold text-gray-100 mb-1 flex items-center gap-1">
        <span className="inline-block w-1 h-3 bg-linear-to-b from-orange-400 to-red-500 rounded-full" />
        Urgency
      </div>
      {Object.entries(URGENCY_COLORS).map(([level, color]) => (
        <div key={level} className="flex items-center gap-1.5">
          <span
            className="inline-block w-2.5 h-2.5 rounded-full ring-1 ring-white/20"
            style={{ background: color }}
          />
          <span>{level}</span>
        </div>
      ))}
    </div>
  )
}

function fmtDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`
  return `${km.toFixed(km < 10 ? 1 : 0)} km`
}

function fmtDuration(min) {
  if (min < 1) return '<1 min'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min - h * 60)
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function prettifyStep(step) {
  if (!step) return 'Continue'
  let out = step
    .replace(/\bhead\b/gi, 'Head')
    .replace(/\barrive\b/gi, 'Arrive')
    .replace(/\buturn\b/gi, 'U-turn')
    .replace(/\bslight right\b/gi, 'Slight right')
    .replace(/\bslight left\b/gi, 'Slight left')
    .replace(/\bsharp right\b/gi, 'Sharp right')
    .replace(/\bsharp left\b/gi, 'Sharp left')
  out = out.charAt(0).toUpperCase() + out.slice(1)
  return out
}

// Maneuver -> icon. Returns a component so the caller can size and colour it
// with CSS; the old version returned arrow glyphs whose rendering depended on
// whatever font the device had.
function stepIcon(step) {
  const s = (step || '').toLowerCase()
  if (s.includes('left')) return CornerUpLeft
  if (s.includes('right')) return CornerUpRight
  if (s.includes('u-turn')) return Redo2
  if (s.includes('arrive')) return Star
  if (s.includes('continue') || s.includes('head')) return ArrowUp
  return CircleDot
}

function RoutePanel({ route, loading, error, onClear, destination }) {
  return (
    <div className="absolute top-3 left-3 z-400 bg-linear-to-b from-gray-900/95 to-gray-900/85 backdrop-blur-sm border border-gray-800 rounded-xl px-3 py-2.5 text-xs text-gray-200 shadow-2xl shadow-black/50 max-w-[240px] reveal-up">
      <div className="flex items-center gap-2 mb-1">
        <Compass className="h-4 w-4" aria-hidden />
        <span className="font-semibold text-white">Route</span>
        <button
          onClick={onClear}
          className="ml-auto text-gray-400 hover:text-white transition-colors leading-none -mt-px"
          title="Clear destination"
          aria-label="Clear destination"
        >
          ×
        </button>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-gray-400">
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Calculating directions…
        </div>
      )}
      {!loading && error && (
        <div className="text-amber-300">
          {error}
          {destination && (
            <div className="mt-1 text-[10px] text-gray-500 tabular-nums">
              dest: {destination[0].toFixed(4)}, {destination[1].toFixed(4)}
            </div>
          )}
        </div>
      )}
      {!loading && !error && route && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500 uppercase tracking-wider text-[10px]">Distance</span>
            <span className="text-orange-300 font-semibold tabular-nums">{fmtDistance(route.distanceKm)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500 uppercase tracking-wider text-[10px]">Drive time</span>
            <span className="text-emerald-300 font-semibold tabular-nums">{fmtDuration(route.durationMin)}</span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">via OSRM driving network</div>
        </div>
      )}
    </div>
  )
}

void RoutePanel

// Fetches a driving route between user + destination from OSRM's free demo
// server. Returns { coords: [[lat,lng]…], distanceKm, durationMin } or null
// on failure (no API key, but rate-limited; treat as best-effort).
function useOsrmRoute(from, to) {
  const [route, setRoute] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const fromLat = from?.[0]
  const fromLng = from?.[1]
  const toLat = to?.[0]
  const toLng = to?.[1]

  useEffect(() => {
    if (
      fromLat == null ||
      fromLng == null ||
      toLat == null ||
      toLng == null
    ) {
      setRoute(null)
      setError('')
      return undefined
    }
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setError('')
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson&steps=true`
    fetch(url, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error('Routing service unavailable')
        return r.json()
      })
      .then((data) => {
        if (cancelled) return
        const r = data?.routes?.[0]
        if (!r?.geometry?.coordinates?.length) {
          setError('No driving route found.')
          setRoute(null)
          return
        }
        setRoute({
          coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
          distanceKm: r.distance / 1000,
          durationMin: r.duration / 60,
          steps: (r.legs || [])
            .flatMap((leg) => leg.steps || [])
            .map((step) => ({
              instruction:
                step.maneuver?.instruction ||
                [step.maneuver?.modifier, step.name].filter(Boolean).join(' ') ||
                'Continue',
              distanceKm: (step.distance || 0) / 1000,
              durationMin: (step.duration || 0) / 60,
            }))
            .filter((step) => step.distanceKm > 0.02)
            .slice(0, 6),
        })
      })
      .catch((err) => {
        if (cancelled || err.name === 'AbortError') return
        setError('Could not load driving route.')
        setRoute(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [fromLat, fromLng, toLat, toLng])

  return { route, loading, error }
}

function RichRoutePanel({ route, loading, error, onClear, destination }) {
  return (
    <div className="absolute top-3 left-3 z-410 bg-linear-to-b from-gray-900/95 to-gray-900/85 backdrop-blur-sm border border-gray-800 rounded-xl px-3 py-2.5 text-xs text-gray-200 shadow-2xl shadow-black/50 max-w-[280px] reveal-up">
      <div className="flex items-center gap-2 mb-1">
        <Compass className="h-4 w-4" aria-hidden />
        <span className="font-semibold text-white">Live directions</span>
        <button
          onClick={onClear}
          className="ml-auto text-gray-400 hover:text-white transition-colors leading-none -mt-px"
          title="Clear destination"
          aria-label="Clear destination"
        >
          ×
        </button>
      </div>
      {loading && (
        <div className="flex items-center gap-2 text-gray-400">
          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Calculating directions...
        </div>
      )}
      {!loading && error && (
        <div className="text-amber-300">
          {error}
          {destination && (
            <div className="mt-1 text-[10px] text-gray-500 tabular-nums">
              dest: {destination[0].toFixed(4)}, {destination[1].toFixed(4)}
            </div>
          )}
        </div>
      )}
      {!loading && !error && route && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500 uppercase tracking-wider text-[10px]">Distance</span>
            <span className="text-orange-300 font-semibold tabular-nums">{fmtDistance(route.distanceKm)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500 uppercase tracking-wider text-[10px]">Drive time</span>
            <span className="text-emerald-300 font-semibold tabular-nums">{fmtDuration(route.durationMin)}</span>
          </div>
          {route.steps?.length > 0 && (
            <div className="pt-1 border-t border-gray-800/80">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
                Next steps
              </div>
              <ol className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {route.steps.map((step, idx) => (
                  <li key={`${idx}-${step.instruction}`} className="flex items-start gap-2">
                    {(() => {
                      const StepIcon = stepIcon(step.instruction)
                      return (
                        <StepIcon
                          className="h-3.5 w-3.5 text-orange-300 shrink-0 mt-0.5"
                          aria-hidden
                        />
                      )
                    })()}
                    <div className="min-w-0">
                      <div className="text-gray-100 leading-snug">
                        {prettifyStep(step.instruction)}
                      </div>
                      <div className="text-[10px] text-gray-500 tabular-nums">
                        {fmtDistance(step.distanceKm)}
                        {typeof step.durationMin === 'number'
                          ? ` · ${fmtDuration(step.durationMin)}`
                          : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="text-[10px] text-gray-500 mt-1">via OSRM driving network</div>
        </div>
      )}
    </div>
  )
}

export default function MapView({
  alerts,
  center,
  accuracy,
  heatPoints,
  showHeat = false,
  destination,
  focusId,
  onClearDestination,
}) {
  const defaultCenter = center ?? [30.7333, 76.7794]

  // Cap the accuracy circle to something sensible so a 5 km fix doesn't swamp
  // the whole map. Also hide it entirely if we have no fix yet.
  const cappedAccuracy = useMemo(() => {
    if (!accuracy || !center) return null
    return Math.min(accuracy, 2000)
  }, [accuracy, center])

  const { route, loading: routeLoading, error: routeError } = useOsrmRoute(
    destination ? center : null,
    destination
  )

  // When a destination is set, suspend follow-user pan so the user can see
  // the full route without it constantly recentering.
  const followSuspended = !!destination

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        className="w-full h-full rounded-xl"
        style={{ minHeight: '300px' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ResizeWatcher />
        {showHeat && heatPoints?.length > 0 && <HeatLayer points={heatPoints} />}
        {center && <FollowUser center={center} suspended={followSuspended} />}
        {destination && center && <FitToRoute from={center} to={destination} />}

        {/* Route polyline — render a darker casing under a brighter line so
         * it stands out against any tile colour. */}
        {route?.coords?.length > 0 && (
          <>
            <Polyline
              positions={route.coords}
              pathOptions={{
                color: '#0b0f19',
                weight: 8,
                opacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
            <Polyline
              positions={route.coords}
              pathOptions={{
                color: '#fb923c',
                weight: 5,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </>
        )}

        {/* Fallback dashed great-circle line if routing failed but we have
         * both endpoints — at least the user sees direction + distance. */}
        {!route && destination && center && (
          <Polyline
            positions={[center, destination]}
            pathOptions={{
              color: '#fb923c',
              weight: 3,
              opacity: 0.7,
              dashArray: '6 8',
              lineCap: 'round',
            }}
          />
        )}

        {center && (
          <>
            <Marker position={center} icon={userDotIcon}>
              <Popup>
                <div className="text-xs">
                  <strong>Your location</strong>
                  <br />
                  {center[0].toFixed(5)}, {center[1].toFixed(5)}
                  {accuracy ? <><br />±{Math.round(accuracy)} m</> : null}
                </div>
              </Popup>
            </Marker>
            {cappedAccuracy && cappedAccuracy > 15 && (
              <Circle
                center={center}
                radius={cappedAccuracy}
                pathOptions={{ color: '#3b82f6', weight: 1, fillOpacity: 0.08 }}
              />
            )}
          </>
        )}

        {destination && (
          <Marker position={destination} icon={destinationIcon()}>
            <Popup>
              <div className="text-xs">
                <strong>Destination</strong>
                <br />
                {destination[0].toFixed(5)}, {destination[1].toFixed(5)}
                {route && (
                  <>
                    <br />
                    {fmtDistance(route.distanceKm)} · {fmtDuration(route.durationMin)} drive
                  </>
                )}
              </div>
            </Popup>
          </Marker>
        )}

        {alerts.map((alert) => {
          const [lng, lat] = alert.location.coordinates
          const isFocus = focusId && alert.id === focusId
          return (
            <Marker key={alert.id} position={[lat, lng]} icon={urgencyIcon(alert.urgency, isFocus)}>
              <Popup>
                <div className="text-sm max-w-[240px]">
                  <p className="font-bold capitalize">{alert.category}</p>
                  <p className="text-xs text-gray-600 mb-1">
                    {alert.urgency} · {alert.status} · verified {alert.verified_score ?? 0}/100
                  </p>
                  <p className="mb-1">{alert.description}</p>
                  {alert.address ? (
                    <p className="text-[11px] text-gray-500 mt-1 flex items-start gap-1">
                      <MapPin className="h-3 w-3 shrink-0 mt-px" aria-hidden />
                      {alert.address}
                    </p>
                  ) : null}
                  <p className="text-[11px] text-gray-500 mt-1 inline-flex items-center gap-1">
                    <Users className="h-3 w-3" aria-hidden />
                    {alert.witnesses ?? 1} witness
                    {(alert.witnesses ?? 1) !== 1 ? 'es' : ''}
                    {alert.weather_match ? (
                      <>
                        {' · '}
                        <CloudRain className="h-3 w-3" aria-hidden />
                        weather-match
                      </>
                    ) : null}
                  </p>
                </div>
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
      {destination && (
        <RichRoutePanel
          route={route}
          loading={routeLoading}
          error={routeError}
          destination={destination}
          onClear={onClearDestination}
        />
      )}
      <Legend />
    </div>
  )
}
