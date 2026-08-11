import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../utils/api'
import { Siren } from './icons'
import { apiError } from '../utils/error'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import BuddyPing from './BuddyPing'

export default function QuickSOS() {
  const { user } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  if (!user || user.role !== 'reporter') return null

  const fire = () => {
    if (!navigator.geolocation) {
      setError(t('sos_no_geo'))
      return
    }
    setLoading(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          await api.post('/api/alerts/', {
            category: 'other',
            description:
              'SOS — critical help needed at my location. Unable to provide details right now.',
            location: {
              type: 'Point',
              coordinates: [coords.longitude, coords.latitude],
            },
          })
          navigate('/my-alerts')
        } catch (err) {
          setError(apiError(err, t('sos_failed')))
        } finally {
          setLoading(false)
        }
      },
      (err) => {
        setLoading(false)
        setError(err.message || t('sos_no_gps'))
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  const confirm = () => {
    if (window.confirm(t('sos_confirm'))) {
      fire()
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-4 flex flex-col items-center">
      <div className="w-full sm:max-w-md bg-red-950/60 border border-red-700 rounded-2xl px-4 sm:px-5 py-3 sm:py-4 flex items-center gap-3 sm:gap-4">
        <Siren className="h-8 w-8 sm:h-9 sm:w-9 text-red-300 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-red-200 text-sm sm:text-base">{t('sos_button')}</div>
          <p className="text-[11px] sm:text-xs text-red-300/80 mt-0.5 truncate">
            {t('sos_sub')}
          </p>
        </div>
        <button
          onClick={confirm}
          disabled={loading}
          className="bg-red-600 hover:bg-red-500 disabled:opacity-60 text-white font-bold px-3 sm:px-4 py-2 rounded-lg whitespace-nowrap text-sm sm:text-base"
        >
          {loading ? t('sos_sending') : t('sos_send')}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}
      <div className="w-full sm:max-w-md">
        <BuddyPing
          message="SOS — I posted a critical alert on NeighbourAid from my current location. Please check on me."
        />
      </div>
    </div>
  )
}
