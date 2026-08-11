import { useEffect, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import api from '../utils/api'
import { AlertTriangle } from './icons'

/**
 * Live tracker for an accepted alert. Polls /api/alerts/{id}/responder
 * every 8 seconds while visible and shows the responder's position
 * relative to the alert location, an Uber-style "your volunteer is on
 * the way" widget.
 *
 * Polling cadence is deliberately slow (8s) because exact-second
 * precision isn't useful — the volunteer's coords already only update
 * over WS when they've moved more than a few metres.
 */

const responderIcon = L.divIcon({
  html: `<div style="
    width:18px;height:18px;border-radius:50%;
    background:#10b981;border:3px solid white;
    box-shadow:0 0 0 3px rgba(16,185,129,0.4);
  "></div>`,
  className: '',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
})

const targetIcon = L.divIcon({
  html: `<div style="
    width:14px;height:14px;border-radius:50%;
    background:#ef4444;border:3px solid white;
    box-shadow:0 0 0 3px rgba(239,68,68,0.4);
  "></div>`,
  className: '',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
})

export default function ResponderTracker({ alert }) {
  const [responder, setResponder] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let id = null
    const tick = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { data } = await api.get(`/api/alerts/${alert.id}/responder`)
        if (!cancelled) {
          setResponder(data)
          setError('')
        }
      } catch (err) {
        if (!cancelled)
          setError(err?.response?.data?.detail || 'Could not load responder position')
      }
    }
    tick()
    id = setInterval(tick, 8000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void tick()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      if (id) clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [alert.id])

  if (alert.status !== 'accepted') return null
  if (error)
    return (
      <p className="text-xs text-amber-300 mt-2 inline-flex items-center gap-1">
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
        {error}
      </p>
    )
  if (!responder) return null

  const [aLng, aLat] = alert.location?.coordinates ?? [0, 0]
  const responderCoords = responder.coordinates // [lng, lat]
  const center = responderCoords
    ? [
        (aLat + responderCoords[1]) / 2,
        (aLng + responderCoords[0]) / 2,
      ]
    : [aLat, aLng]

  return (
    <div className="mt-3 border border-emerald-800 rounded-lg overflow-hidden">
      <div className="bg-emerald-950/60 text-emerald-200 text-[11px] px-3 py-1.5 flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              responder.live ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'
            }`}
            aria-hidden
          />
          <span>
            {responder.responder_name || 'Volunteer'} ·{' '}
            {responder.live ? 'live' : 'last known'}
          </span>
        </span>
        {responder.eta_minutes != null && (
          <span className="text-emerald-300 font-semibold">
            ETA {responder.eta_minutes} min
          </span>
        )}
      </div>
      <div className="h-40 relative">
        <MapContainer
          center={center}
          zoom={14}
          scrollWheelZoom={false}
          dragging={false}
          touchZoom={false}
          doubleClickZoom={false}
          zoomControl={false}
          className="w-full h-full"
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution=""
          />
          <Marker position={[aLat, aLng]} icon={targetIcon}>
            <Tooltip>Crisis location</Tooltip>
          </Marker>
          {responderCoords && (
            <Marker
              position={[responderCoords[1], responderCoords[0]]}
              icon={responderIcon}
            >
              <Tooltip>{responder.responder_name || 'Volunteer'}</Tooltip>
            </Marker>
          )}
        </MapContainer>
      </div>
    </div>
  )
}
