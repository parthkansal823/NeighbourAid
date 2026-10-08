import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useI18n } from '../utils/i18n'
import { SkeletonAlertList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import ResponderTracker from '../components/ResponderTracker'
import OutcomeSummary from '../components/OutcomeSummary'
import HelpRelay from '../components/HelpRelay'
import { useTimeAgo } from '../hooks/useTimeAgo'
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
  CRITICAL: 'bg-red-700 text-[#fff]',
  HIGH: 'bg-high text-[#172033]',
  MEDIUM: 'bg-medium text-[#172033]',
  LOW: 'bg-low text-[#172033]',
}

const STATUS_DOT = {
  open: 'bg-blue-500',
  accepted: 'bg-purple-500',
  resolved: 'bg-gray-500',
}

function AlertRow({ a, onCancel, cancelling, onChanged }) {
  const { t } = useI18n()
  const ago = useTimeAgo(a.created_at)
  return (
    <div
      className="surface-card min-w-0 p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold capitalize text-app-ink">{t(`cat_${a.category}`) ?? a.category}</span>
          <span className={`text-xs font-semibold px-2 py-1 rounded-md ${URGENCY_BADGE[a.urgency]}`}>
            {a.urgency}
          </span>
          <span className="text-xs px-2 py-1 rounded-md inline-flex items-center gap-1.5 capitalize bg-surface-2 text-app-ink">
            <span aria-hidden className={`inline-block w-1.5 h-1.5 rounded-full ${STATUS_DOT[a.status]}`} />
            {a.status === 'resolved' ? 'Closed' : a.status}
          </span>
        </div>
        <span className="text-xs text-app-muted tabular-nums">{ago}</span>
      </div>
      <p className="text-app-ink text-[15px] leading-relaxed whitespace-pre-wrap wrap-break-word">{a.description}</p>
      <OutcomeSummary alert={a} />
      {a.address && (
        <p className="text-app-muted text-sm leading-relaxed mt-3 flex gap-2">
          <MapPin className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span className="min-w-0 wrap-break-word">{a.address}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-2 mt-3 text-xs text-app-muted">
        <span className="tabular-nums">Evidence {Math.max(0, Math.min(100, a.verified_score ?? 0))}/100</span>
        <span>
          <Users className="h-3 w-3 inline-block mr-1 -mt-0.5" aria-hidden />{Math.max(0, (a.witnesses ?? 1) - 1)}{' '}
          {Math.max(0, (a.witnesses ?? 1) - 1) !== 1 ? t('card_witness_many') : t('card_witness_one')}
        </span>
        {a.corroborating_ids?.length ? (
          <span className="inline-flex items-center gap-1"><Link2 className="h-3 w-3" aria-hidden />{a.corroborating_ids.length} {t('card_similar_nearby')}</span>
        ) : null}
        {a.weather_match ? <span className="inline-flex items-center gap-1"><CloudRain className="h-3 w-3" aria-hidden />{t('card_weather_match')}</span> : null}
      </div>
      {a.status === 'open' && (
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() => onCancel(a.id)}
            disabled={cancelling}
            className="tap app-secondary-button"
          >
            {cancelling ? t('mine_cancelling') : t('mine_cancel')}
          </button>
        </div>
      )}
      {a.status === 'accepted' && <ResponderTracker alert={a} />}
      {['accepted', 'resolved'].includes(a.status) && <HelpRelay alert={a} onChanged={onChanged} />}
    </div>
  )
}

export default function MyAlerts() {
  const { t } = useI18n()
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [cancelling, setCancelling] = useState(null)

  // `load` deliberately sets no flags on its synchronous path — it only
  // lowers them once the request settles. Raising a flag before the first
  // `await` makes it reachable synchronously from the mount effect, which
  // costs an extra render pass before paint. Callers that want a spinner
  // (the poll tick, the Refresh button) raise it themselves; the initial
  // load needs nothing, because `loading` already starts true.
  const load = useCallback(async () => {
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
    void load()
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
    <div className="page-panel max-w-2xl mx-auto px-4 py-6 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-5 sm:mb-6 gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-app-ink">{t('mine_title')}</h1>
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-app-muted text-sm mt-2 tabular-nums">
            <span>{alerts.length} {t('mine_summary')}</span><span>{groups.open.length} {t('mine_open')}</span><span>{groups.accepted.length} {t('mine_in_progress')}</span>
          </p>
        </div>
        <Link
          to="/post-alert"
          className="tap app-primary-button w-full sm:w-auto"
        >
          + {t('mine_new')}
        </Link>
      </div>

      {error && (
        <div role="alert" className="bg-surface-2 border border-line text-app-ink text-sm rounded-xl px-4 py-3 mb-6 flex items-start gap-2">
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
              className="tap app-primary-button"
            >
              {t('mine_post_first')}
              <ArrowRight className="h-4 w-4 inline-block ml-1.5 -mt-0.5" aria-hidden />
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {alerts.map((a) => (
            <AlertRow
              key={a.id}
              a={a}
              onCancel={cancel}
              cancelling={cancelling === a.id}
              onChanged={load}
            />
          ))}
        </div>
      )}
    </div>
  )
}
