/**
 * Category-based auto-dispatch suggestion strip.
 *
 * When an alert is viewed, we surface the *right* emergency number(s) for
 * that category so a witness or nearby volunteer can one-tap call the
 * correct service — ambulance for medical, 101 for fire, NDRF for floods,
 * etc. All phone numbers are India-specific and sourced from the MHA/NDMA
 * public directory (same list as EmergencyDialer).
 *
 * We intentionally don't auto-initiate the call; the Web environment can't
 * place calls silently, and even if it could, a false positive dialling 108
 * during normal use would be harmful. One tap to dial is the safest pattern.
 */

import { useEffect, useState } from 'react'
import { Ambulance, Hospital, Navigation, Phone, Siren, Truck, Waves, ShieldUser, Baby, VenusAndMars, Zap } from './icons'
import api from '../utils/api'

const CATEGORY_SERVICES = {
  medical: [
    { num: '108', label: 'Ambulance', Icon: Ambulance, tone: 'bg-emerald-600 hover:bg-emerald-700' },
    { num: '102', label: 'Medical helpline', Icon: Hospital, tone: 'bg-emerald-700 hover:bg-emerald-800' },
    { num: '112', label: 'All-in-one emergency', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
  ],
  fire: [
    { num: '101', label: 'Fire brigade', Icon: Truck, tone: 'bg-orange-600 hover:bg-orange-700' },
    { num: '112', label: 'All-in-one emergency', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
  ],
  flood: [
    { num: '1078', label: 'NDRF / disaster', Icon: Waves, tone: 'bg-blue-700 hover:bg-blue-800' },
    { num: '112', label: 'All-in-one emergency', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
  ],
  missing: [
    { num: '100', label: 'Police', Icon: ShieldUser, tone: 'bg-blue-600 hover:bg-blue-700' },
    { num: '1098', label: 'Child helpline', Icon: Baby, tone: 'bg-purple-600 hover:bg-purple-700' },
    { num: '1091', label: 'Women helpline', Icon: VenusAndMars, tone: 'bg-pink-600 hover:bg-pink-700' },
  ],
  power: [
    { num: '1912', label: 'Electricity complaints', Icon: Zap, tone: 'bg-yellow-700 hover:bg-yellow-800' },
    { num: '112', label: 'All-in-one emergency', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
  ],
  other: [
    { num: '112', label: 'All-in-one emergency', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
    { num: '100', label: 'Police', Icon: ShieldUser, tone: 'bg-blue-600 hover:bg-blue-700' },
  ],
}

/**
 * Nearby hospitals, for medical alerts only.
 *
 * The numbers above answer "who do I call". This answers the other question,
 * which nothing in the app did: a volunteer who has reached the person and
 * put them in a car needs somewhere to drive to.
 *
 * Medical only, deliberately. A hospital list on a power-cut alert is filler,
 * and filler on an emergency card costs attention the emergency needs.
 *
 * Data is OpenStreetMap via the backend (see services/hospitals.py). It can
 * be slow or empty, so it renders nothing at all until it has something —
 * never a spinner or an error. The numbers above already work; this is the
 * part that is allowed to be missing.
 */
function NearbyHospitals({ lat, lng }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (lat == null || lng == null) return
    let cancelled = false
    api
      .get('/api/geo/hospitals', { params: { lat, lng } })
      .then(({ data }) => {
        if (!cancelled) setRows(data.hospitals || [])
      })
      .catch(() => {
        /* silent — the emergency numbers above are the real answer */
      })
    return () => {
      cancelled = true
    }
  }, [lat, lng])

  if (!rows.length) return null

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="text-[11px] uppercase tracking-widest text-gray-400 mb-2">
        Nearest hospitals
      </div>
      <ul className="space-y-1">
        {rows.slice(0, 3).map((h) => (
          <li key={`${h.lat},${h.lng}`} className="flex items-center gap-2">
            <Hospital className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
              {h.name}
              {h.emergency && (
                <span className="ml-1.5 text-[10px] font-bold text-low">ER</span>
              )}
            </span>
            <span className="shrink-0 tabular-nums text-xs text-gray-500">
              {h.distance_km} km
            </span>
            {h.phone && (
              <a
                href={`tel:${h.phone}`}
                className="tap press-in inline-flex items-center justify-center rounded-lg text-gray-300 hover:bg-surface-2 hover:text-white"
                aria-label={`Call ${h.name}`}
              >
                <Phone className="h-4 w-4" aria-hidden />
              </a>
            )}
            {/* Opens the native maps app on both Android and iOS. */}
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${h.lat},${h.lng}`}
              target="_blank"
              rel="noreferrer"
              className="tap press-in inline-flex items-center justify-center rounded-lg text-gray-300 hover:bg-surface-2 hover:text-white"
              aria-label={`Directions to ${h.name}`}
            >
              <Navigation className="h-4 w-4" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function AutoDispatch({ category, compact = false, lat, lng }) {
  const services = CATEGORY_SERVICES[category] || CATEGORY_SERVICES.other
  return (
    <div className={`surface-card ${compact ? 'p-3' : 'p-4'} mb-3`}>
      <div className="text-[11px] uppercase tracking-widest text-gray-400 mb-2">
        Recommended services · one tap to call
      </div>
      <div className="flex flex-wrap gap-2">
        {services.map(({ num, label, Icon, tone }) => (
          <a
            key={num}
            href={`tel:${num}`}
            className={`tap press-in ${tone} text-white rounded-xl px-3 text-xs font-semibold inline-flex items-center gap-1.5 transition-colors`}
            title={`Call ${label} — ${num}`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className="font-black">{num}</span>
            <span className="opacity-80 hidden sm:inline">· {label}</span>
          </a>
        ))}
      </div>
      {category === 'medical' && <NearbyHospitals lat={lat} lng={lng} />}
    </div>
  )
}
