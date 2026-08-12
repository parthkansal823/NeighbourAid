/**
 * Single source of truth for button styles. Variant + size + loading state
 * map to Tailwind classes; everything else (`onClick`, `type`, `disabled`,
 * etc.) passes through to the underlying `<button>`.
 *
 * Use this anywhere you'd otherwise hand-roll a 5-class `<button>` so the
 * focus ring, disabled opacity, hover lift, and tap target stay consistent.
 */

const VARIANTS = {
  primary:
    'bg-linear-to-b from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 active:from-orange-600 active:to-orange-700 text-white shadow-md shadow-orange-500/20 hover:shadow-orange-500/40',
  danger:
    'bg-linear-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 active:from-red-600 active:to-red-700 text-white shadow-md shadow-red-500/20 hover:shadow-red-500/40',
  success:
    'bg-linear-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 active:from-emerald-600 active:to-emerald-700 text-white shadow-md shadow-emerald-500/20 hover:shadow-emerald-500/40',
  secondary:
    'bg-gray-800 hover:bg-gray-700 active:bg-gray-600 text-white shadow-xs shadow-black/40 border border-gray-700/60 hover:border-gray-600',
  ghost: 'bg-transparent hover:bg-gray-800/80 text-gray-300 hover:text-white',
  outline:
    'border border-gray-700 hover:border-orange-500/60 text-gray-300 hover:text-white bg-transparent hover:bg-orange-500/5',
}

const SIZES = {
  sm: 'text-xs px-2.5 py-1.5 rounded-lg',
  md: 'text-sm px-4 py-2 rounded-lg',
  lg: 'text-base px-6 py-3 rounded-xl',
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  full = false,
  className = '',
  type = 'button',
  disabled,
  children,
  ...rest
}) {
  const base =
    'group relative inline-flex items-center justify-center gap-2 font-semibold overflow-hidden transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500'
  const tone = VARIANTS[variant] ?? VARIANTS.primary
  const sizeCls = SIZES[size] ?? SIZES.md
  const width = full ? 'w-full' : ''
  const showSheen = variant === 'primary' || variant === 'danger' || variant === 'success'
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${base} ${tone} ${sizeCls} ${width} ${className}`}
      aria-busy={loading || undefined}
      {...rest}
    >
      {showSheen && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-linear-to-r from-transparent via-white/20 to-transparent skew-x-12 -translate-x-full group-hover:translate-x-[400%] transition-transform duration-700 ease-out disabled:hidden"
        />
      )}
      {loading ? <Spinner /> : null}
      <span className="relative">{children}</span>
    </button>
  )
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 1-10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
