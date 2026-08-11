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
    <div className="grid grid-cols-2 gap-2">
      {SKILL_OPTIONS.map((s) => {
        const on = selected.has(s.code)
        return (
          <button
            key={s.code}
            type="button"
            onClick={() => toggle(s.code)}
            className={`text-left border rounded-lg px-3 py-2 text-xs sm:text-sm transition-colors ${
              on
                ? 'border-orange-500 bg-orange-500/20 text-orange-300'
                : 'border-gray-700 text-gray-300 hover:border-gray-500'
            }`}
          >
            <s.Icon className="h-4 w-4 inline-block mr-1.5 -mt-0.5" aria-hidden />
            {s.label}
          </button>
        )
      })}
    </div>
  )
}

export function VehicleToggle({ value, onChange }) {
  return (
    <label className="flex items-center gap-3 border border-gray-700 rounded-lg px-3 py-2.5 cursor-pointer hover:border-gray-500">
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4"
      />
      <span className="text-sm text-gray-300 inline-flex items-center gap-1.5">
        <Car className="h-4 w-4" aria-hidden />
        I have a vehicle I can use
      </span>
    </label>
  )
}

export function EmergencyContactsEditor({ value, onChange, max = 5 }) {
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
        <p className="text-xs text-gray-500">
          No contacts yet. Adding a couple means a single tap during SOS can ping the right people.
        </p>
      )}
      {contacts.map((c, i) => (
        <div key={i} className="bg-gray-950 border border-gray-800 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-widest text-gray-500">Contact {i + 1}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-xs text-red-400 hover:text-red-300"
            >
              Remove
            </button>
          </div>
          <input
            type="text"
            value={c.name || ''}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="Name (e.g. Mom)"
            maxLength={80}
            className="w-full bg-gray-900 border border-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="tel"
              inputMode="tel"
              value={c.phone || ''}
              onChange={(e) => update(i, { phone: e.target.value })}
              placeholder="Phone (optional)"
              maxLength={32}
              className="bg-gray-900 border border-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
            <input
              type="email"
              inputMode="email"
              value={c.email || ''}
              onChange={(e) => update(i, { email: e.target.value })}
              placeholder="Email (optional)"
              maxLength={120}
              className="bg-gray-900 border border-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>
      ))}
      {contacts.length < max && (
        <button
          type="button"
          onClick={add}
          className="w-full border border-dashed border-gray-700 hover:border-orange-500 text-gray-400 hover:text-orange-400 rounded-lg py-2 text-sm"
        >
          + Add contact
        </button>
      )}
    </div>
  )
}
