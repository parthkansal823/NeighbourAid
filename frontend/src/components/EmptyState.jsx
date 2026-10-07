/**
 * Friendly empty-state component used when a list (alerts, check-ins,
 * search results) has nothing to show. Replaces the bare "No items" text
 * with an icon + title + (optional) action so the UI doesn't look broken.
 *
 * `icon` is a React node — pass a lucide icon element, e.g.
 * `icon={<Inbox className="h-7 w-7" />}`. It used to be an emoji string,
 * which rendered differently on every OS and read aloud as its unicode name.
 */

import { Inbox } from './icons'

export default function EmptyState({
  icon,
  title,
  body,
  action,
  className = '',
}) {
  return (
    <div
      role="status"
      className={`min-w-0 rounded-xl bg-surface-2 px-5 py-6 sm:px-6 sm:py-8 text-center ${className}`}
    >
      <div
        className="mx-auto mb-3 inline-flex items-center justify-center h-11 w-11 text-app-muted"
        aria-hidden
      >
        {icon ?? <Inbox className="h-7 w-7" />}
      </div>
      {title && <h3 className="text-base font-semibold text-app-ink">{title}</h3>}
      {body && <p className="mt-2 text-sm text-app-muted leading-relaxed max-w-sm mx-auto wrap-break-word">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
