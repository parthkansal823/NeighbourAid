/** Shared mark for real web, demo and native app; text beside it names the brand. */
export default function BrandLogo({ size = 40, className = '', alt = '' }) {
  return (
    <img
      src="/brand-logo.png"
      width={size}
      height={size}
      alt={alt}
      aria-hidden={alt === '' ? true : undefined}
      className={`block shrink-0 rounded-xl object-contain ${className}`}
    />
  )
}
