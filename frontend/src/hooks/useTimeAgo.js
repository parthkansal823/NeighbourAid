import { useEffect, useState } from 'react'
import { useI18n } from '../utils/i18n'

/** How often the label re-computes. Alert cards show minute-granularity ages,
 *  so a 30 s tick is plenty and keeps timers cheap on long feeds. */
const TICK_MS = 30000

/**
 * Relative "2m / 3h / 1d" label for an ISO timestamp, refreshed on a timer.
 *
 * Three near-identical copies of this lived in AlertCard, MyAlerts and Safety,
 * and they had drifted: one returned `''` for a future timestamp where the
 * others returned `0s`.
 *
 * They also read `Date.now()` directly in the render body and used a dummy
 * `tick` counter to force re-renders. That makes render impure — two renders
 * with identical props could produce different output — which React 19 flags,
 * and which misbehaves under concurrent rendering where a render may be
 * discarded and replayed. Holding `now` in state keeps render a pure function
 * of props + state; the interval is the only thing that advances it.
 */
export function useNow(intervalMs = TICK_MS) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function useTimeAgo(iso) {
  const { t } = useI18n()
  const now = useNow()

  if (!iso) return ''
  const parsed = new Date(iso).getTime()
  if (Number.isNaN(parsed)) return ''

  // Clamp negatives: a clock skew between server and device shouldn't render
  // an alert as "-3m old".
  const diff = Math.max(0, Math.floor((now - parsed) / 1000))
  if (diff < 60) return `${diff}${t('t_sec')}`
  if (diff < 3600) return `${Math.floor(diff / 60)}${t('t_min')}`
  if (diff < 86400) return `${Math.floor(diff / 3600)}${t('t_hr')}`
  return `${Math.floor(diff / 86400)}${t('t_day')}`
}
