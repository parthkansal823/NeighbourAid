import { useId } from 'react'

/**
 * Shared UI fragments for volunteer skills, vehicle flag, and emergency
 * contacts. Used by Register (at sign-up) and Profile (edit later).
 */

import {
  Accessibility,
  Car,
  HeartPulse,
  Baby,
  Languages,
  Stethoscope,
  Waves,
  Zap,
} from './icons'

export const SKILL_OPTIONS = [
  { code: 'medical', label: 'Medical background', Icon: Stethoscope },
  { code: 'cpr', label: 'CPR trained', Icon: HeartPulse },
  { code: 'swim', label: 'Can swim / flood rescue', Icon: Waves },
  { code: 'driver', label: 'Driver / has vehicle', Icon: Car },
  { code: 'electrician', label: 'Electrician', Icon: Zap },
  { code: 'translator', label: 'Multilingual', Icon: Languages },
  { code: 'elderly_care', label: 'Elderly care', Icon: Accessibility },
  { code: 'child_care', label: 'Child care', Icon: Baby },
]

export function SkillsPicker({ value, onChange }) {
  const selected = new Set(value || [])
  const toggle = (code) => {
    const next = new Set(selected)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    onChange([...next])
  }
  return (
    <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-2">
      {SKILL_OPTIONS.map((s) => {
        const on = selected.has(s.code)
        return (
          <button
            key={s.code}
            type="button"
            onClick={() => toggle(s.code)}
            aria-pressed={on}
            className="app-choice-button flex min-w-0 items-center gap-2 text-left px-3 py-3 text-sm"
          >
            <s.Icon className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 leading-snug">{s.label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function VehicleToggle({ value, onChange }) {
  return (
    <label className="flex min-h-12 items-center gap-3 rounded-xl border border-line px-3 py-3 cursor-pointer">
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 shrink-0 accent-accent"
      />
      <span className="text-sm text-app-ink inline-flex items-center gap-2">
        <Car className="h-4 w-4 shrink-0" aria-hidden />
        I have a vehicle I can use
      </span>
    </label>
  )
}

export function EmergencyContactsEditor({ value, onChange, max = 5 }) {
  const editorId = useId()
  const contacts = value || []
  const update = (i, patch) => {
    const next = contacts.map((c, idx) => (idx === i ? { ...c, ...patch } : c))
    onChange(next)
  }
  const add = () => {
    if (contacts.length >= max) return
    onChange([...contacts, { name: '', phone: '', email: '' }])
  }
  const remove = (i) => onChange(contacts.filter((_, idx) => idx !== i))

  return (
    <div className="space-y-3">
      {contacts.length === 0 && (
        <p className="text-sm text-app-muted leading-relaxed">
          No contacts yet. Adding a couple means a single tap during SOS can ping the right people.
        </p>
      )}
      {contacts.map((c, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-app-ink">Contact {i + 1}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove contact ${i + 1}`}
              className="min-h-11 rounded-lg px-2 text-sm text-app-muted underline underline-offset-4"
            >
              Remove
            </button>
          </div>
          <div>
            <label htmlFor={`${editorId}-${i}-name`} className="app-form-label">Name</label>
            <input
              id={`${editorId}-${i}-name`}
              type="text"
              value={c.name || ''}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Name (e.g. Mom)"
              maxLength={80}
              autoComplete="off"
              className="app-field w-full"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="min-w-0">
              <label htmlFor={`${editorId}-${i}-phone`} className="app-form-label">Phone (optional)</label>
              <input
                id={`${editorId}-${i}-phone`}
                type="tel"
                inputMode="tel"
                value={c.phone || ''}
                onChange={(e) => update(i, { phone: e.target.value })}
                placeholder="Phone (optional)"
                maxLength={32}
                autoComplete="off"
                className="app-field w-full"
              />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${editorId}-${i}-email`} className="app-form-label">Email (optional)</label>
              <input
                id={`${editorId}-${i}-email`}
                type="email"
                inputMode="email"
                value={c.email || ''}
                onChange={(e) => update(i, { email: e.target.value })}
                placeholder="Email (optional)"
                maxLength={120}
                autoComplete="off"
                className="app-field w-full"
              />
            </div>
          </div>
        </div>
      ))}
      {contacts.length < max && (
        <button
          type="button"
          onClick={add}
          className="app-secondary-button w-full text-sm"
        >
          + Add contact
        </button>
      )}
    </div>
  )
}
