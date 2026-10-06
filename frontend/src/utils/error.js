/**
 * Normalise an axios error into a human-readable string.
 * FastAPI returns validation errors as detail: ValidationError[] — rendering
 * that straight into JSX throws "Objects are not valid as a React child".
 */
export function apiError(err, fallback = 'Request failed') {
  const detail = err?.response?.data?.detail
  if (!detail) return err?.message ?? fallback
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return (
      detail
        .map((d) => {
          if (typeof d === 'string') return d
          const path = Array.isArray(d?.loc) ? d.loc.slice(1).join('.') : ''
          const msg = d?.msg ?? String(d)
          return path ? `${path}: ${msg}` : msg
        })
        .filter(Boolean)
        .join(' · ') || fallback
    )
  }
  return String(detail)
}
