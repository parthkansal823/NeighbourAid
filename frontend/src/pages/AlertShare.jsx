import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import api from '../utils/api'
import { apiError } from '../utils/error'
import FirstAidButton from '../components/FirstAidGuide'
import {
  ArrowRight,
  CategoryIcon,
  Compass,
  Link2,
  MapPin,
  PhoneCall,
} from '../components/icons'

const URGENCY_BADGE = {
  CRITICAL: 'bg-red-700 text-[#fff]',
  HIGH: 'bg-high text-[#172033]',
  MEDIUM: 'bg-medium text-[#172033]',
  LOW: 'bg-low text-[#172033]',
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
      <div role="status" className="flex items-center justify-center py-20 text-app-muted">
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
      <div className="max-w-lg mx-auto px-4 py-12 text-center">
        <Link2 className="h-10 w-10 mx-auto mb-4 text-app-muted" aria-hidden />
        <h1 className="text-xl font-semibold text-app-ink mb-2">Alert unavailable</h1>
        <p role="alert" className="text-app-muted text-sm leading-relaxed mb-6">{error || 'The link may have expired.'}</p>
        <Link to="/" className="tap app-secondary-button">
          Go to NeighbourAid <ArrowRight className="h-4 w-4 inline-block ml-1 -mt-0.5" aria-hidden />
        </Link>
      </div>
    )
  }

  const [lng, lat] = alert.location?.coordinates ?? [0, 0]
  const mapsUrl = `/map?dest=${lat},${lng}&focus=${alert.id}`

  return (
    <div className="page-panel max-w-2xl mx-auto px-4 py-6 sm:py-8 space-y-6">
      <section className="surface-card min-w-0 p-4 sm:p-6 overflow-hidden">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <div className="flex min-w-0 items-center gap-2">
            <CategoryIcon category={alert.category} className="h-5 w-5 shrink-0 text-app-muted" />
            <h1 className="font-semibold capitalize text-app-ink text-xl wrap-break-word">{alert.category}</h1>
          </div>
          <span className={`text-xs font-semibold px-2 py-1 rounded-md ${URGENCY_BADGE[alert.urgency]}`}>
            {alert.urgency}
          </span>
        </div>
        {alert.status && <p className="mb-3 text-xs font-medium capitalize text-app-muted">{alert.status}</p>}
        <p className="text-[15px] leading-relaxed text-app-ink whitespace-pre-wrap wrap-break-word">{alert.description}</p>
        {alert.address && (
          <p className="text-app-muted text-sm leading-relaxed mt-4 flex items-start gap-2">
            <MapPin className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span className="min-w-0 wrap-break-word">{alert.address}</span>
          </p>
        )}
        <div className="alert-share-actions flex flex-wrap gap-2 mt-5 border-t border-line pt-4">
          {['medical', 'fire', 'accident'].includes(alert.category) && <FirstAidButton />}
          <Link
            to={mapsUrl}
            className="tap app-primary-button"
          >
            <Compass className="h-4 w-4 shrink-0" aria-hidden />Directions
          </Link>
          <a
            href="tel:112"
            className="tap inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-[#fff] hover:bg-red-800"
          >
            <PhoneCall className="h-4 w-4 inline-block mr-1.5 -mt-0.5" aria-hidden />112 Emergency
          </a>
          <Link
            to="/register"
            className="tap app-secondary-button"
          >
            Join NeighbourAid <ArrowRight className="h-4 w-4 inline-block ml-1 -mt-0.5" aria-hidden />
          </Link>
        </div>
      </section>

      {alert.photos?.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-app-ink mb-3">
            Photos
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {alert.photos.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`evidence ${i + 1}`}
                loading="lazy"
                className="w-full min-w-0 aspect-square object-cover rounded-xl border border-line bg-surface-2"
              />
            ))}
          </div>
        </section>
      )}

      <p className="text-sm leading-relaxed text-app-muted">
        This is a public snapshot shared from NeighbourAid. Join to witness or accept alerts.
      </p>
    </div>
  )
}
