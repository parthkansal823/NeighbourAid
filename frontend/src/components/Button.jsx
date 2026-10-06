/**
 * Single source of truth for button styles. Variant + size + loading state
 * map to Tailwind classes; everything else (`onClick`, `type`, `disabled`,
 * etc.) passes through to the underlying `<button>`.
 *
 * Use this anywhere you'd otherwise hand-roll a 5-class `<button>` so the
 * focus ring, disabled state, and tap target stay consistent.
 *
 * WHAT CHANGED, AND WHY
 *
 * Every variant used to be a vertical gradient with a coloured drop shadow,
 * plus a white sheen that swept across on hover. Three things were wrong
 * with that, in rising order of seriousness:
 *
 *  1. The gradient moved the contrast ratio down the face of the button, so
 *     white label text was comfortably readable at the top edge and marginal
 *     at the bottom. On a phone in daylight that is the whole difference.
 *  2. `hover:-translate-y-0.5` has no hover on a touchscreen, so it fired on
 *     *tap* — the control jumped upward out from under the finger during the
 *     press. The sheen was hover-only too, which meant it never played on
 *     the devices most people use and only ever cost desktop users a
 *     700ms composited animation.
 *  3. `size="sm"` was `py-1.5`, about 28px tall. The button component is
 *     where a 44px floor either holds or does not, and it did not.
 *
 * Now: flat fill, one hairline border where a border is needed, a press that
 * only scales, and every size clearing 44px.
 */

import { Spinner } from './icons'

// Flat fills. Hover moves one step lighter, active one step darker — the
// same two-step pattern for all six so a new variant is obvious to add.
const VARIANTS = {
  primary: 'bg-accent hover:bg-orange-400 active:bg-orange-600 text-gray-950',
  danger: 'bg-critical hover:bg-red-400 active:bg-red-600 text-white',
  success: 'bg-low hover:bg-green-400 active:bg-green-600 text-gray-950',
  secondary:
    'bg-surface-2 hover:bg-[#242c3c] active:bg-surface-1 text-white border border-line',
  ghost: 'bg-transparent hover:bg-surface-1 text-gray-300 hover:text-white',
  outline:
    'bg-transparent border border-line hover:border-accent text-gray-200 hover:text-white',
}

// `tap` supplies the 44px floor; the padding here only controls how much
// wider than the floor a given size sits. `sm` is smaller in type and
// horizontal padding, never in hit area.
const SIZES = {
  sm: 'text-xs px-3 rounded-lg',
  md: 'text-sm px-4 rounded-xl',
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
    'tap press-in inline-flex items-center justify-center gap-2 font-semibold ' +
    'transition-colors disabled:opacity-50 disabled:cursor-not-allowed ' +
    'focus-visible:outline-solid focus-visible:outline-2 ' +
    'focus-visible:outline-offset-2 focus-visible:outline-accent'
  const tone = VARIANTS[variant] ?? VARIANTS.primary
  const sizeCls = SIZES[size] ?? SIZES.md
  const width = full ? 'w-full' : ''
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={`${base} ${tone} ${sizeCls} ${width} ${className}`}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      <span>{children}</span>
    </button>
  )
}
