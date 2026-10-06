/**
 * Tiny skeleton primitives. Use in place of "Loading…" text so the layout
 * doesn't jump when real content arrives.
 *
 * Examples:
 *   <Skeleton className="h-5 w-24" />
 *   <SkeletonCard lines={3} />
 *   <SkeletonAlertList count={3} />
 */

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

export function SkeletonCard({ lines = 2 }) {
  return (
    <div
      className="bg-gray-900/80 border border-gray-800 rounded-xl p-4 space-y-2.5 reveal-up"
      aria-hidden="true"
    >
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3 ${i === 0 ? 'w-full' : i === lines - 1 ? 'w-3/5' : 'w-4/5'}`} />
      ))}
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
    </div>
  )
}

export function SkeletonAlertList({ count = 3 }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading alerts">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <SkeletonCard lines={3} />
        </div>
      ))}
    </div>
  )
}
