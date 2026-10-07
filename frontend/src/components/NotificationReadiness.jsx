import { Bell, BellRing, CheckCircle2, Info, ShieldCheck } from './icons'
import { useI18n } from '../utils/i18n'

const COPY = {
  ready: {
    icon: CheckCircle2,
    title: 'Background alerts are ready',
    body: 'Nearby emergencies can reach this device even when the app is closed.',
  },
  blocked: {
    icon: Bell,
    title: 'Notifications are blocked',
    body: 'Allow notifications for NeighbourAid in your browser or phone settings, then return here.',
  },
  setup: {
    icon: Info,
    title: 'Background alerts are not connected',
    body: 'Live alerts still appear while this app is open. Background delivery will be available once this service is connected.',
  },
  failed: {
    icon: Info,
    title: 'Could not enable background alerts',
    body: 'Check your connection, then try again. Live alerts still appear while this app is open.',
  },
  stopFailed: {
    icon: Info,
    title: 'Could not turn off background alerts',
    body: 'The change could not be confirmed. Check your connection, then try turning them off again.',
  },
  foreground: {
    icon: ShieldCheck,
    title: 'Live alerts are active in this app',
    body: 'This device cannot receive background emergency alerts here. Keep NeighbourAid open to stay connected.',
  },
  off: {
    icon: BellRing,
    title: 'Stay reachable for nearby emergencies',
    body: 'Turn on background alerts so this device can notify you when a matched emergency is reported.',
  },
}

/**
 * A device-readiness panel rather than a vague "enable notifications" banner.
 * It names the exact delivery state and only offers an action the person can
 * use in that state; users should never think they are protected when they
 * are merely looking at an open feed.
 */
export default function NotificationReadiness({
  connected,
  permission,
  pushSupported,
  pushEnabled,
  busy,
  result,
  onEnable,
  onDisable,
}) {
  const { t } = useI18n()
  const state = result === 'unsubscribe-failed'
    ? 'stopFailed'
    : pushEnabled || result === 'ready'
      ? 'ready'
      : permission === 'denied' || result === 'denied'
      ? 'blocked'
      : result === 'not-configured'
        ? 'setup'
        : result === 'failed'
          ? 'failed'
          : !pushSupported
            ? 'foreground'
            : 'off'
  const { icon: Icon, title, body } = COPY[state]
  const canEnable = pushSupported && !pushEnabled && permission !== 'denied'

  return (
    <section className={`notification-readiness notification-readiness--${state}`} aria-labelledby="notification-readiness-title">
      <div className="notification-readiness-header">
        <span className="notification-readiness-icon" aria-hidden><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="notification-readiness-status" aria-live="polite">
            <span className={`notification-readiness-dot${connected ? ' is-connected' : ''}`} aria-hidden />
            {connected ? 'Live connection' : 'Reconnecting'}
          </div>
          <h2 id="notification-readiness-title" className="notification-readiness-title">{title}</h2>
        </div>
      </div>

      <p className="notification-readiness-copy">{state === 'blocked' ? t('vol_push_denied') : state === 'setup' ? t('vol_push_unavailable') : state === 'failed' ? t('vol_push_failed') : body}</p>

      {pushEnabled && (
        <button type="button" onClick={onDisable} disabled={busy} className="tap notification-readiness-secondary">
          {busy ? 'Turning off…' : 'Turn off background alerts'}
        </button>
      )}
      {canEnable && (
        <button type="button" onClick={onEnable} disabled={busy} className="tap notification-readiness-primary">
          <BellRing className="h-4 w-4" aria-hidden />
          {busy ? t('vol_enabling') : result === 'failed' ? 'Try again' : t('vol_enable')}
        </button>
      )}
      {state === 'foreground' && <p className="notification-readiness-note">{permission === 'granted' ? t('vol_notif_on') : 'No permission prompt will appear until you choose to enable alerts on a supported device.'}</p>}
    </section>
  )
}
