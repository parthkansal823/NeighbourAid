import { useEffect, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import api from '../utils/api'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import useTextFirst from '../hooks/useTextFirst'
import { PhoneCall } from './icons'

const responderIcon = L.divIcon({ html: '<div style="width:18px;height:18px;border-radius:50%;background:#52677b;border:3px solid white"></div>', className: '', iconSize: [18, 18], iconAnchor: [9, 9] })
const targetIcon = L.divIcon({ html: '<div style="width:14px;height:14px;border-radius:50%;background:#b42318;border:3px solid white"></div>', className: '', iconSize: [14, 14], iconAnchor: [7, 7] })
const point = coords => Array.isArray(coords) && coords.length === 2 && coords.every(Number.isFinite) && Math.abs(coords[0]) <= 180 && Math.abs(coords[1]) <= 90

export function positionState(responder, now) {
  if (!responder?.sharing_enabled || !Number.isFinite(Date.parse(responder.sharing_expires_at)) || Date.parse(responder.sharing_expires_at) <= now) return 'disabled'
  const at = Date.parse(responder.position_updated_at)
  const freshness = Number.isFinite(responder.freshness_seconds) && responder.freshness_seconds > 0 ? responder.freshness_seconds : 90
  if (responder.position_state === 'stale' || (Number.isFinite(at) && now - at >= freshness * 1000)) return 'stale'
  if (responder.position_state !== 'live' || !Number.isFinite(at) || at > now + 5000 || !point(responder.coordinates)) return 'unavailable'
  return 'live'
}

/** Account/lead-scoped polling; no saved-home or unknown-freshness map fallback. */
export default function ResponderTracker({ alert }) {
  const { user } = useAuth()
  return <Tracker key={`${user?.id || 'public'}:${alert.id}:${alert.accepted_by || ''}`} alert={alert} />
}
function Tracker({ alert }) {
  const { t } = useI18n()
  const textFirst = useTextFirst()
  const [mapChosen, setMapChosen] = useState(false)
  const [responder, setResponder] = useState(null)
  const [clock, setClock] = useState(() => Date.now())
  const [error, setError] = useState('')
  useEffect(() => {
    if (alert.status !== 'accepted') return undefined
    let cancelled = false, running = false
    const tick = async () => {
      if (document.visibilityState !== 'visible' || running) return
      running = true
      try {
        const { data } = await api.get(`/api/alerts/${alert.id}/responder`)
        if (!cancelled) { setResponder(data); setClock(Date.now()); setError('') }
      } catch {
        if (!cancelled) { setResponder(null); setError('Responder details could not refresh. No position is shown.') }
      } finally { running = false }
    }
    void tick()
    const timer = setInterval(tick, 8000)
    document.addEventListener('visibilitychange', tick)
    return () => { cancelled = true; clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [alert.id, alert.status])
  useEffect(() => {
    if (!responder) return undefined
    const freshness = Number.isFinite(responder.freshness_seconds) && responder.freshness_seconds > 0 ? responder.freshness_seconds : 90
    const deadline = Math.min(Date.parse(responder.sharing_expires_at), Date.parse(responder.position_updated_at) + freshness * 1000)
    const refreshClock = () => setClock(Date.now())
    const delay = deadline - Date.now()
    const timer = Number.isFinite(delay) && delay > 0 ? setTimeout(refreshClock, delay + 1) : null
    window.addEventListener('focus', refreshClock)
    document.addEventListener('visibilitychange', refreshClock)
    return () => { if (timer !== null) clearTimeout(timer); window.removeEventListener('focus', refreshClock); document.removeEventListener('visibilitychange', refreshClock) }
  }, [responder])
  if (alert.status !== 'accepted') return null
  if (error) return <p role="status" className="mt-3 text-sm text-app-muted">{error}</p>
  if (!responder) return <p role="status" className="mt-3 text-sm text-app-muted">Checking responder details…</p>
  const state = positionState(responder, clock)
  const callNumber = responder.responder_phone || responder.reporter_phone
  const target = alert.location?.coordinates
  const showMap = state === 'live' && point(target) && (!textFirst || mapChosen)
  const labels = { disabled: 'Live location sharing is off or has expired.', unavailable: 'Sharing is on, but no fresh position is available.', stale: 'Last position is stale. It is not shown as a live position.', live: 'Fresh position shared with consent.' }
  return <section className="mt-3 overflow-hidden rounded-xl border border-line bg-surface-2" aria-label="Responder location">
    <div className="space-y-2 p-3 text-sm text-app-ink">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{responder.responder_name || 'Volunteer'}</span>{callNumber && <a href={`tel:${callNumber}`} className="tap app-secondary-button"><PhoneCall className="h-4 w-4" aria-hidden />{t('responder_call')}</a>}</div>
      <p role="status" className="text-xs leading-relaxed text-app-muted">{labels[state]}</p>
      {responder.position_updated_at && Number.isFinite(Date.parse(responder.position_updated_at)) && state !== 'disabled' && <p className="text-xs text-app-muted">Position recorded <time dateTime={responder.position_updated_at}>{new Date(responder.position_updated_at).toLocaleTimeString()}</time>{Number.isFinite(responder.position_accuracy_m) && responder.position_accuracy_m >= 0 ? `; reported accuracy ±${Math.round(responder.position_accuracy_m)} m` : '; accuracy not reported'}</p>}
      {Number.isFinite(responder.eta_minutes) && <p className="text-xs text-app-muted">Volunteer&apos;s estimate: {responder.eta_minutes} min. Not a confirmed arrival.</p>}
      {state === 'live' && textFirst && !mapChosen && <button type="button" onClick={() => setMapChosen(true)} className="tap app-secondary-button w-full">Load responder map</button>}
    </div>
    {showMap && <div className="relative h-40"><MapContainer center={[(target[1] + responder.coordinates[1]) / 2, (target[0] + responder.coordinates[0]) / 2]} zoom={14} scrollWheelZoom={false} dragging={false} touchZoom={false} doubleClickZoom={false} zoomControl={false} className="h-full w-full"><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" /><Marker position={[target[1], target[0]]} icon={targetIcon} title="Reported incident location" alt="Reported incident location" keyboard><Tooltip>Reported incident location</Tooltip></Marker><Marker position={[responder.coordinates[1], responder.coordinates[0]]} icon={responderIcon} title="Volunteer's live shared location" alt="Volunteer's live shared location" keyboard><Tooltip>{responder.responder_name || 'Volunteer'}</Tooltip></Marker></MapContainer></div>}
  </section>
}
