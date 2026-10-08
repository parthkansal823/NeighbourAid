import { useId, useState } from 'react'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useI18n } from '../utils/i18n'

const CATEGORIES = ['medical', 'fire', 'flood', 'accident', 'missing', 'violence', 'animal', 'gas', 'power', 'water', 'structure', 'other']
export const DEFAULT_NOTIFICATION_PREFERENCES = { enabled: true, categories: [], skill_matching: true, radius_km: 25, include_sensitive_preview: false }

/** Account filters are not device permission, subscription or delivery proof. */
export default function NotificationPreferencesEditor({ value, onSaved, disabled = false }) {
  const { t } = useI18n()
  const id = useId()
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_NOTIFICATION_PREFERENCES, ...value, categories: [...(value?.categories || [])] }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const set = patch => { setDraft(previous => ({ ...previous, ...patch })); setMessage('') }
  const category = selected => {
    const next = new Set(draft.categories)
    if (next.has(selected)) next.delete(selected)
    else next.add(selected)
    set({ categories: [...next] })
  }
  const preview = event => {
    const enabled = event.target.checked
    if (enabled && !window.confirm('Allow report descriptions and reported locations in browser push previews? Anyone who can see your lock screen may see these details.')) return
    set({ include_sensitive_preview: enabled })
  }
  const save = async () => {
    const radius = Number(draft.radius_km)
    if (!Number.isFinite(radius) || radius < 1 || radius > 25) { setError('Choose a matching radius between 1 and 25 km.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const { data } = await api.patch('/api/users/me/profile', { notification_preferences: { ...draft, radius_km: radius } })
      if (!data.notification_preferences) throw new Error('The server did not confirm these preferences. Refresh and try again.')
      setDraft(data.notification_preferences)
      onSaved?.(data)
      setMessage('Notification preferences saved. This does not enable device permissions or guarantee delivery.')
    } catch (err) { setError(apiError(err, 'Could not save notification preferences. Try again.')) }
    finally { setBusy(false) }
  }
  const checkbox = 'mt-0.5 h-5 w-5 shrink-0 accent-accent'
  return <section id="notification-preferences" className="min-w-0 rounded-2xl border border-line bg-surface-1 p-4 sm:p-5 lg:col-span-2" aria-labelledby={`${id}-title`} aria-busy={busy}>
    <h2 id={`${id}-title`} className="text-base font-semibold text-app-ink">Alert notification preferences</h2>
    <p className="mt-2 text-sm leading-relaxed text-app-muted">These account filters apply to matched live alerts and configured browser push. They do not enable phone permissions, register a device, or provide native background emergency delivery.</p>
    <fieldset disabled={busy || disabled} className="mt-3 min-w-0 space-y-3">
      <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2 text-sm text-app-ink"><input type="checkbox" checked={draft.enabled} onChange={event => set({ enabled: event.target.checked })} className={checkbox} /><span>Receive matched alerts<span className="mt-1 block text-xs leading-relaxed text-app-muted">Turning this off stops matched incoming alerts, not reports already visible in your nearby feed.</span></span></label>
      <label htmlFor={`${id}-radius`} className="app-form-label">Maximum matching radius (km)</label>
      <input id={`${id}-radius`} type="number" inputMode="decimal" min={1} max={25} step="any" value={draft.radius_km} onChange={event => set({ radius_km: event.target.value })} className="app-field w-full sm:max-w-48" aria-describedby={`${id}-radius-hint`} />
      <p id={`${id}-radius-hint`} className="text-xs leading-relaxed text-app-muted">Availability and service range can narrow matches further. Your limit is never a promise that help will arrive.</p>
      <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2 text-sm text-app-ink"><input type="checkbox" checked={draft.skill_matching} onChange={event => set({ skill_matching: event.target.checked })} className={checkbox} /><span>Use my registered skills for matching<span className="mt-1 block text-xs leading-relaxed text-app-muted">Skills are self-reported, not a training certification. Do not enter a dangerous scene without appropriate training.</span></span></label>
      <fieldset className="min-w-0"><legend className="app-form-label mb-2">Categories</legend><p className="mb-2 text-xs leading-relaxed text-app-muted">Leave all unchecked to allow every category. Selected categories restrict matching.</p><div className="grid grid-cols-1 gap-x-4 min-[360px]:grid-cols-2 sm:grid-cols-3">{CATEGORIES.map(code => <label key={code} className="flex min-h-12 cursor-pointer items-center gap-3 py-2 text-sm text-app-ink"><input type="checkbox" checked={draft.categories.includes(code)} onChange={() => category(code)} className="h-5 w-5 shrink-0 accent-accent" /><span>{t(`cat_${code}`)}</span></label>)}</div></fieldset>
      <label className="flex min-h-12 cursor-pointer items-start gap-3 border-t border-line py-3 text-sm text-app-ink"><input type="checkbox" checked={draft.include_sensitive_preview} onChange={preview} className={checkbox} /><span>Show detailed browser push previews<span className="mt-1 block text-xs leading-relaxed text-app-muted">Off by default. Enabling this can show a report description and its reported location on the lock screen. Minimal previews are safer on shared devices.</span></span></label>
      <button type="button" onClick={() => { void save() }} className="tap app-primary-button w-full sm:w-auto">{busy ? 'Saving preferences…' : 'Save notification preferences'}</button>
    </fieldset>
    {error && <p role="alert" className="mt-3 text-sm text-app-muted">{error}</p>}
    {message && <p role="status" className="mt-3 text-sm leading-relaxed text-app-muted">{message}</p>}
  </section>
}
