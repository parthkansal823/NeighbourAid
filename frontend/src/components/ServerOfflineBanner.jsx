/**
 * Tells a visitor the real API is not running, instead of letting the app
 * look broken.
 *
 * The frontend is on Cloudflare permanently; the API is on a laptop that gets
 * switched on for a demo. Anyone can open the site at any time, and most of
 * the time nothing is behind it. Without this they would get spinners, then a
 * different error on each page, none of which say the one true thing: it is
 * off right now, come back later.
 *
 * Shown as a strip rather than a blocking modal on purpose. The parts of the
 * app that do not need the server still work — the emergency dialer, the
 * offline report queue, the language switcher — and a modal would take those
 * away to announce bad news.
 */

import { useI18n } from '../utils/i18n'
import { useServerStatus } from '../hooks/useServerStatus'

export default function ServerOfflineBanner() {
  const { t } = useI18n()
  const { state } = useServerStatus()

  // 'checking' deliberately renders nothing: a banner that flashes on every
  // page load while the first probe is in flight would be worse than the
  // problem it solves.
  if (state !== 'offline') return null

  return (
    <div
      // `status`, not `alert`: this is a standing condition, not something
      // that just happened, and `alert` interrupts a screen reader mid-
      // sentence to say so.
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[1100] w-full border-b border-amber-500/40 bg-amber-500/15 px-4 py-2.5 text-center text-sm text-amber-200 backdrop-blur"
    >
      <span className="font-medium">{t('server_off_title')}</span>{' '}
      <span className="text-amber-200/80">{t('server_off_body')}</span>
    </div>
  )
}
