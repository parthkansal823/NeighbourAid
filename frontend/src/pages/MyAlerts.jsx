import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useI18n } from '../utils/i18n'
import { SkeletonAlertList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import ResponderTracker from '../components/ResponderTracker'
import {
  AlertTriangle,
  ArrowRight,
  CloudRain,
  Link2,
  MapPin,
  Siren,
  Users,
} from '../components/icons'

const URGENCY_BADGE = {
  CRITICAL: 'bg-gradient-to-b from-red-500 to-red-600 text-white shadow-sm shadow-red-500/40',
  HIGH: 'bg-gradient-to-b from-orange-400 to-orange-500 text-white shadow-sm shadow-orange-500/40',
  MEDIUM: 'bg-gradient-to-b from-yellow-400 to-yellow-500 text-black shadow-sm shadow-yellow-500/40',
  LOW: 'bg-gradient-to-b from-green-500 to-green-600 text-white shadow-sm shadow-green-500/30',
}

const STATUS_BADGE = {
  open: 'bg-blue-900/60 text-blue-300 border-blue-800/60',
  accepted: 'bg-purple-900/60 text-purple-300 border-purple-800/60',
  resolved: 'bg-gray-800/80 text-gray-400 border-gray-700/60',
}

const STATUS_DOT = {
  open: 'bg-blue-400 animate-pulse',
  accepted: 'bg-purple-400 animate-pulse',
  resolved: 'bg-gray-500',
}

function useTimeAgo(iso) {
  const { t } = useI18n()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [])
  if (!iso) return ''
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (Number.isNaN(diff) || diff < 0) return `0${t('t_sec')}`
  if (diff < 60) return `${diff}${t('t_sec')}`
  if (diff < 3600) return `${Math.floor(diff / 60)}${t('t_min')}`
  if (diff < 86400) return `${Math.floor(diff / 3600)}${t('t_hr')}`
  return `${Math.floor(diff / 86400)}${t('t_day')}`
}

function AlertRow({ a, onCancel, cancelling, index = 0 }) {
  const { t } = useI18n()
  const ago = useTimeAgo(a.created_at)
  return (
    <div
      className="bg-gradient-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-xl p-3 sm:p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-gray-700 hover:shadow-lg hover:shadow-black/40 reveal-up"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold capitalize text-white">{t(`cat_${a.category}`) ?? a.category}</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${URGENCY_BADGE[a.urgency]}`}>
            {a.urgency}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 capitalize border ${STATUS_BADGE[a.status]}`}>
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[a.status]}`} />
            {a.status}
          </span>
        </div>
        <span className="text-xs text-gray-500 shrink-0 tabular-nums">{ago}</span>
      </div>
      <p className="text-gray-300 text-sm break-words">{a.description}</p>
      {a.address && (
        <p className="text-gray-500 text-xs mt-1.5 flex gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
          <span className="line-clamp-1">{a.address}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2 sm:gap-3 mt-2 text-[11px] text-gray-500">
        <span className="tabular-nums">Verified {a.verified_score ?? 0}/100</span>
        <span>
          <Users className="h-3 w-3 inline-block mr-1 -mt-0.5" aria-hidden />{a.witnesses ?? 1}{' '}
          {(a.witnesses ?? 1) !== 1 ? t('card_witness_many') : t('card_witness_one')}
        </span>
        {a.corroborating_ids?.length ? (
          <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" aria-hidden />{a.corroborating_ids.length} {t('card_similar_nearby')}</span>
        ) : null}
        {a.weather_match ? <span className="inline-flex items-center gap-1"><CloudRain className="h-3 w-3" aria-hidden />{t('card_weather_match')}</span> : null}
      </div>
      {a.status === 'open' && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => onCancel(a.id)}
            disabled={cancelling}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
          >
            {cancelling ? t('mine_cancelling') : t('mine_cancel')}
          </button>
        </div>
      )}
      {a.status === 'accepted' && <ResponderTracker alert={a} />}
    </div>
  )
}

export default function MyAlerts() {
  const { t } = useI18n()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/api/alerts/mine')
      setAlerts(data)
      setError('')
    } catch (err) {
      setError(apiError(err, t('mine_load_failed')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  const cancel = async (id) => {
    setCancelling(id)
    try {
      await api.delete(`/api/alerts/${id}`)
      setAlerts((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      setError(apiError(err, t('mine_cancel_failed')))
    } finally {
      setCancelling(null)
    }
  }

  const groups = {
    open: alerts.filter((a) => a.status === 'open'),
    accepted: alerts.filter((a) => a.status === 'accepted'),
    resolved: alerts.filter((a) => a.status === 'resolved'),
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
      <div className="flex items-center justify-between mb-5 sm:mb-6 gap-3 reveal-up">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('mine_title')}</h1>
          <p className="text-gray-400 text-xs sm:text-sm mt-1 tabular-nums">
            {alerts.length} {t('mine_summary')} · {groups.open.length} {t('mine_open')} · {groups.accepted.length} {t('mine_in_progress')}
          </p>
        </div>
        <Link
          to="/post-alert"
          className="bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white text-sm font-semibold px-3 sm:px-4 py-2 rounded-lg shadow-md shadow-red-500/20 hover:shadow-red-500/40 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] whitespace-nowrap"
        >
          + {t('mine_new')}
        </Link>
      </div>

      {error && (
        <div className="bg-red-950/70 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-6 flex items-start gap-2 pop-in">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <SkeletonAlertList count={3} />
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={<Siren className="h-7 w-7" />}
          title={t('mine_empty')}
          action={
            <Link
              to="/post-alert"
              className="inline-block bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl shadow-md shadow-red-500/20 hover:shadow-red-500/40 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]"
            >
              {t('mine_post_first')}
              <ArrowRight className="h-4 w-4 inline-block ml-1.5 -mt-0.5" aria-hidden />
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {alerts.map((a, i) => (
            <AlertRow
              key={a.id}
              a={a}
              onCancel={cancel}
              cancelling={cancelling === a.id}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  )
}
