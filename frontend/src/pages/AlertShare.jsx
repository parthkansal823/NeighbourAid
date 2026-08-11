import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../utils/api'
import { apiError } from '../utils/error'
import {
  ArrowRight,
  CategoryIcon,
  Compass,
  Link2,
  MapPin,
  PhoneCall,
} from '../components/icons'

const URGENCY_BADGE = {
  CRITICAL: 'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-sm shadow-red-500/40',
  HIGH: 'bg-gradient-to-b from-orange-400 to-orange-500 text-white shadow-sm shadow-orange-500/40',
  MEDIUM: 'bg-gradient-to-b from-yellow-400 to-yellow-500 text-black shadow-sm shadow-yellow-500/40',
  LOW: 'bg-gradient-to-b from-green-500 to-green-600 text-white shadow-sm shadow-green-500/30',
}


export default function AlertShare() {
  const { id } = useParams()
  const [alert, setAlert] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .get(`/api/alerts/${id}`)
      .then(({ data }) => {
        if (!cancelled) setAlert(data)
      })
      .catch((err) => {
        if (!cancelled) setError(apiError(err, 'Alert not found'))
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
          <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        Loading…
      </div>
    )
  }

  if (error || !alert) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 text-center reveal-up">
        <Link2 className="h-12 w-12 mx-auto mb-4 text-gray-500" aria-hidden />
        <h1 className="text-xl font-bold text-white mb-2">Alert unavailable</h1>
        <p className="text-gray-400 text-sm mb-6">{error || 'The link may have expired.'}</p>
        <Link to="/" className="text-orange-400 hover:text-orange-300 underline-offset-2 hover:underline">
          Go to NeighbourAid <ArrowRight className="h-4 w-4 inline-block ml-1 -mt-0.5" aria-hidden />
        </Link>
      </div>
    )
  }

  const [lng, lat] = alert.location?.coordinates ?? [0, 0]
  const mapsUrl = `/map?dest=${lat},${lng}&focus=${alert.id}`

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <section className="relative bg-gradient-to-b from-gray-900/95 to-gray-900/80 border border-gray-800 rounded-2xl p-5 sm:p-6 shadow-xl shadow-black/40 reveal-up overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-12 -right-8 h-40 w-40 rounded-full bg-orange-500/10 blur-3xl"
        />
        <div className="relative flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <CategoryIcon category={alert.category} className="h-6 w-6 shrink-0" />
            <span className="font-semibold capitalize text-white text-lg">{alert.category}</span>
          </div>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${URGENCY_BADGE[alert.urgency]}`}>
            {alert.urgency}
          </span>
        </div>
        <p className="relative text-gray-200 whitespace-pre-wrap">{alert.description}</p>
        {alert.address && (
          <p className="relative text-gray-500 text-sm mt-3 flex items-start gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
            <span>{alert.address}</span>
          </p>
        )}
        <div className="relative flex flex-wrap gap-2 mt-4">
          <Link
            to={mapsUrl}
            className="group relative bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-md shadow-blue-500/20 hover:shadow-blue-500/40 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] overflow-hidden"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent skew-x-12 -translate-x-full group-hover:translate-x-[400%] transition-transform duration-700 ease-out"
            />
            <span className="relative inline-flex items-center gap-1.5"><Compass className="h-4 w-4" aria-hidden />Directions</span>
          </Link>
          <a
            href="tel:112"
            className="bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-md shadow-red-500/20 hover:shadow-red-500/40 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
          >
            <PhoneCall className="h-4 w-4 inline-block mr-1.5 -mt-0.5" aria-hidden />112 Emergency
          </a>
          <Link
            to="/register"
            className="border border-orange-500/60 text-orange-300 hover:text-orange-200 hover:bg-orange-500/10 text-sm font-semibold px-4 py-2 rounded-lg transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0"
          >
            Join NeighbourAid <ArrowRight className="h-4 w-4 inline-block ml-1 -mt-0.5" aria-hidden />
          </Link>
        </div>
      </section>

      {alert.photos?.length > 0 && (
        <section className="bg-gradient-to-b from-gray-900/90 to-gray-900/70 border border-gray-800 rounded-2xl p-4 reveal-up stagger-1">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
            Photos
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {alert.photos.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`evidence ${i + 1}`}
                className="aspect-square object-cover rounded-lg border border-gray-700 bg-gray-800 hover:scale-[1.02] hover:border-orange-500/40 transition-all duration-200 cursor-zoom-in"
              />
            ))}
          </div>
        </section>
      )}

      <p className="text-center text-[11px] text-gray-500">
        This is a public snapshot shared from NeighbourAid. Join to witness or accept alerts.
      </p>
    </div>
  )
}
