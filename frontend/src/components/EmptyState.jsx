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
      className={`relative bg-linear-to-b from-gray-900/80 to-gray-900/40 border border-gray-800 rounded-2xl p-8 sm:p-10 text-center reveal-up overflow-hidden ${className}`}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-10 mx-auto h-32 w-48 rounded-full bg-orange-500/10 blur-3xl"
      />
      <div
        className="relative mx-auto mb-3 inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-800/80 border border-gray-700/60 text-gray-400 shadow-inner shadow-black/40"
        aria-hidden
      >
        {icon ?? <Inbox className="h-7 w-7" />}
      </div>
      {title && <h3 className="relative text-base font-semibold text-gray-100 mb-1">{title}</h3>}
      {body && <p className="relative text-sm text-gray-500 mb-5 leading-relaxed max-w-sm mx-auto">{body}</p>}
      {action && <div className="relative">{action}</div>}
    </div>
  )
}
