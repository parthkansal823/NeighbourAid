import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { AlertTriangle, CheckCircle2 } from '../components/icons'
import Button from '../components/Button'
import api from '../utils/api'
import { apiError } from '../utils/error'
import {
  EmergencyContactsEditor,
  SKILL_OPTIONS,
  SkillsPicker,
  VehicleToggle,
} from '../components/ProfileFields'

// Matches the server's own defaults in services/availability.py: all hours,
// CRITICAL always allowed through. A volunteer who never opens the setting
// behaves exactly as the app did before it existed.
const DEFAULT_AVAILABILITY = {
  timezone: 'Asia/Kolkata',
  from_hour: 0,
  to_hour: 24,
  critical_always: true,
  busy_until: null,
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)

/** 0 → "12 am", 13 → "1 pm", 24 → "midnight" (the end of the day, not its start). */
function fmtHour(h) {
  if (h === 24) return '12 am (next day)'
  const period = h < 12 ? 'am' : 'pm'
  const display = h % 12 === 0 ? 12 : h % 12
  return `${display} ${period}`
}

export default function Profile() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [me, setMe] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [locLoading, setLocLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [accuracy, setAccuracy] = useState(null)
  const [locTimestamp, setLocTimestamp] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  // local drafts so edits aren't committed until Save is tapped
  const [skillsDraft, setSkillsDraft] = useState([])
  const [vehicleDraft, setVehicleDraft] = useState(false)
  const [contactsDraft, setContactsDraft] = useState([])
  const [phoneDraft, setPhoneDraft] = useState('')
  const [availDraft, setAvailDraft] = useState(DEFAULT_AVAILABILITY)

  // `load` deliberately sets no flags on its synchronous path — it only
  // lowers them once the request settles. Raising a flag before the first
  // `await` makes it reachable synchronously from the mount effect, which
  // costs an extra render pass before paint. Callers that want a spinner
  // (the poll tick, the Refresh button) raise it themselves; the initial
  // load needs nothing, because `loading` already starts true.
  const load = useCallback(async () => {
    try {
      const [meRes, statsRes] = await Promise.all([
        api.get('/api/users/me'),
        api.get('/api/users/me/stats'),
      ])
      setMe(meRes.data)
      setStats(statsRes.data)
      setSkillsDraft(meRes.data.skills || [])
      setVehicleDraft(!!meRes.data.has_vehicle)
      setContactsDraft(meRes.data.emergency_contacts || [])
      setPhoneDraft(meRes.data.phone || '')
      // The server normalises this, so a user who predates the field still
      // gets a complete record back rather than undefined.
      const avail = { ...DEFAULT_AVAILABILITY, ...(meRes.data.availability || {}) }
      // Drop an expired snooze here rather than during render, so the UI
      // never tells someone they are unreachable when the server has
      // already started paging them again.
      if (avail.busy_until && new Date(avail.busy_until).getTime() <= Date.now()) {
        avail.busy_until = null
      }
      setAvailDraft(avail)
    } catch (err) {
      setError(apiError(err, t('profile_load_failed')))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const detectAndUpdate = async () => {
    if (!navigator.geolocation) {
      setError(t('profile_no_geo'))
      return
    }
    setLocLoading(true)
    setError('')
    setMessage('')
    navigator.geolocation.getCurrentPosition(
      async ({ coords, timestamp }) => {
        setLocLoading(false)
        setSaving(true)
        setAccuracy(coords.accuracy)
        setLocTimestamp(timestamp)
        try {
          const { data } = await api.patch('/api/users/me/location', {
            location: {
              type: 'Point',
              coordinates: [coords.longitude, coords.latitude],
            },
          })
          setMe(data)
          setMessage(t('profile_loc_saved'))
        } catch (err) {
          setError(apiError(err, t('profile_update_failed')))
        } finally {
          setSaving(false)
        }
      },
      (err) => {
        setLocLoading(false)
        setError(err.message || t('profile_update_failed'))
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  const saveSkills = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { data } = await api.patch('/api/users/me/profile', {
        skills: skillsDraft,
        has_vehicle: vehicleDraft,
      })
      setMe(data)
      setMessage('Skills updated.')
    } catch (err) {
      setError(apiError(err, 'Could not update skills'))
    } finally {
      setSaving(false)
    }
  }

  // Sent even when blank: "" is how the server is told to delete the number,
  // and a field you can only ever add is not one anyone will risk filling in.
  const savePhone = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { data } = await api.patch('/api/users/me/profile', {
        phone: phoneDraft.trim(),
      })
      setMe(data)
      setPhoneDraft(data.phone || '')
      setMessage(t(data.phone ? 'profile_phone_saved' : 'profile_phone_cleared'))
    } catch (err) {
      setError(apiError(err, t('profile_phone_failed')))
    } finally {
      setSaving(false)
    }
  }

  // The browser is the only thing that knows which "10 p.m." the user means,
  // so the zone travels with the window. Re-read on every save rather than
  // once at mount: someone who sets this on a flight should not be judged
  // against the timezone they took off in.
  const patchAvailability = async (patch) => {
    const next = {
      ...availDraft,
      ...patch,
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || availDraft.timezone,
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const { data } = await api.patch('/api/users/me/profile', {
        availability: next,
      })
      setMe(data)
      setAvailDraft({ ...DEFAULT_AVAILABILITY, ...(data.availability || {}) })
      setMessage(t('avail_saved'))
    } catch (err) {
      setError(apiError(err, t('avail_failed')))
    } finally {
      setSaving(false)
    }
  }

  const saveAvailability = () => patchAvailability({ busy_until: availDraft.busy_until })

  // "Not right now" — driving, in a meeting, at a funeral. Sent as an
  // absolute instant rather than a duration so a server restart cannot
  // extend it, and so the countdown is the same on every device.
  const snoozeTwoHours = () =>
    patchAvailability({ busy_until: new Date(Date.now() + 2 * 3600 * 1000).toISOString() })

  const saveContacts = async () => {
    setSaving(true)
    setError('')
    setMessage('')
    // Drop entries with no name to keep the list clean
    const clean = contactsDraft
      .map((c) => ({
        name: (c.name || '').trim(),
        phone: (c.phone || '').trim() || null,
        email: (c.email || '').trim() || null,
      }))
      .filter((c) => c.name.length > 0)
    try {
      const { data } = await api.patch('/api/users/me/profile', {
        emergency_contacts: clean,
      })
      setMe(data)
      setContactsDraft(data.emergency_contacts || [])
      setMessage('Emergency contacts updated.')
    } catch (err) {
      setError(apiError(err, 'Could not update emergency contacts'))
    } finally {
      setSaving(false)
    }
  }

  if (!user) return null

  if (loading) {
    return <div className="text-center text-gray-500 py-20">{t('profile_loading')}</div>
  }

  const [lng, lat] = me?.location?.coordinates ?? [0, 0]
  const contactCount = contactsDraft.length
  const readinessCount =
    (me?.role === 'volunteer' && skillsDraft.length === 0 ? 1 : 0) +
    (contactCount === 0 ? 1 : 0)

  // The end time, not a countdown. A countdown needs `Date.now()` during
  // render — which React treats as impure, and which would freeze at
  // whatever it read on the last re-render anyway. An absolute time is pure,
  // never goes stale, and is the thing someone actually wants to know.
  // Expiry is handled in `load`, where impure calls are allowed.
  const busyRemaining = availDraft.busy_until
    ? new Date(availDraft.busy_until).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
      })
    : null

  const sectionCls =
    'surface-card p-4 sm:p-5'
  const saveBtnCls =
    'group relative bg-orange-500 hover:bg-orange-400 active:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold px-4 py-2 rounded-lg hover:shadow-orange-500/40 transition-colors duration-200 overflow-hidden'

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 sm:py-10 space-y-5 sm:space-y-6">
      <div className="reveal-up">
        <h1 className="text-xl sm:text-2xl font-bold text-white">{t('profile_title')}</h1>
        <p className="text-gray-500 text-sm wrap-break-word">
          {t('profile_signed_as')} <span className="text-gray-300">{me?.email}</span>
        </p>
        <div className="flex flex-wrap gap-2 mt-3 text-xs">
          <a href="#location" className="px-2.5 py-1 rounded-full border border-gray-700 text-gray-300 hover:text-white hover:border-orange-500/50 transition-colors">
            Location
          </a>
          {me?.role === 'volunteer' && (
            <a href="#skills" className="px-2.5 py-1 rounded-full border border-gray-700 text-gray-300 hover:text-white hover:border-orange-500/50 transition-colors">
              Skills
            </a>
          )}
          <a href="#contacts" className="px-2.5 py-1 rounded-full border border-gray-700 text-gray-300 hover:text-white hover:border-orange-500/50 transition-colors">
            Contacts
          </a>
          <a href="#activity" className="px-2.5 py-1 rounded-full border border-gray-700 text-gray-300 hover:text-white hover:border-orange-500/50 transition-colors">
            Activity
          </a>
        </div>
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-2 reveal-up stagger-1">
        <Stat label="Contacts" value={contactCount} accent={contactCount > 0 ? 'text-emerald-400' : 'text-amber-400'} />
        <Stat label="Skills" value={me?.role === 'volunteer' ? skillsDraft.length : '-'} accent="text-blue-400" />
        <Stat label="Vehicle" value={me?.role === 'volunteer' ? (vehicleDraft ? 'yes' : 'no') : '-'} accent="text-violet-300" />
        <Stat label="Open tasks" value={readinessCount} accent={readinessCount === 0 ? 'text-emerald-400' : 'text-orange-400'} />
      </section>

      {error && (
        <div className="bg-red-950/70 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 flex items-start gap-2 pop-in">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div className="bg-emerald-950/70 border border-emerald-700 text-emerald-300 text-sm rounded-lg px-4 py-3 flex items-start gap-2 pop-in">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>{message}</span>
        </div>
      )}

      <section id="identity" className={`${sectionCls} reveal-up stagger-1 scroll-mt-24`}>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t('profile_identity')}
        </h2>
        <dl className="grid grid-cols-3 gap-y-2 text-sm">
          <dt className="text-gray-500">{t('profile_name')}</dt>
          <dd className="col-span-2 text-gray-200 wrap-break-word">{me?.name}</dd>
          <dt className="text-gray-500">{t('profile_role')}</dt>
          <dd className="col-span-2 capitalize text-gray-200">{me?.role}</dd>
          <dt className="text-gray-500">{t('profile_joined')}</dt>
          <dd className="col-span-2 text-gray-200">
            {me?.created_at ? new Date(me.created_at).toLocaleString() : '—'}
          </dd>
        </dl>

        {/* Optional, and the hint has to say exactly who ever sees it —
            someone deciding whether to type their number here is entitled
            to know the rule, not to be reassured in general terms. */}
        <div className="mt-4 border-t border-line pt-4">
          <label
            htmlFor="profile-phone"
            className="block text-sm font-medium text-gray-300"
          >
            {t('profile_phone')}
          </label>
          <p className="mt-1 text-xs text-gray-500">{t('profile_phone_hint')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id="profile-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={32}
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder={t('profile_phone_ph')}
              className="tap min-w-0 flex-1 rounded-lg border border-line bg-surface-1 px-3
                         text-sm text-white placeholder:text-gray-600
                         focus:border-accent focus:outline-none"
            />
            <Button
              size="sm"
              onClick={savePhone}
              loading={saving}
              disabled={phoneDraft.trim() === (me?.phone || '')}
            >
              {t('profile_phone_save')}
            </Button>
          </div>
        </div>
      </section>

      <section id="location" className={`${sectionCls} reveal-up stagger-2 scroll-mt-24`}>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
            {t('profile_home_location')}
          </h2>
          <button
            onClick={detectAndUpdate}
            disabled={locLoading || saving}
            className="text-xs bg-orange-500 hover:bg-orange-400 active:bg-orange-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 hover:shadow-orange-500/40 transition-colors duration-200 active:scale-95"
          >
            {locLoading ? t('profile_detecting') : saving ? t('profile_saving') : t('profile_update_loc')}
          </button>
        </div>
        <p className="text-gray-400 text-sm font-mono tabular-nums">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>
        {(accuracy || locTimestamp) && (
          <p className="text-[11px] text-gray-600 mt-1 tabular-nums">
            {accuracy ? `±${Math.round(accuracy)} m` : ''}
            {accuracy && locTimestamp ? ' · ' : ''}
            {locTimestamp ? new Date(locTimestamp).toLocaleString() : ''}
          </p>
        )}
        <p className="text-[11px] text-gray-600 mt-1">
          {t('profile_loc_hint')}
        </p>
      </section>

      {me?.role === 'volunteer' && (
        <section id="skills" className={`${sectionCls} reveal-up stagger-3 scroll-mt-24`}>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
            Skills &amp; availability
          </h2>
          <div className="space-y-3">
            <SkillsPicker value={skillsDraft} onChange={setSkillsDraft} />
            <VehicleToggle value={vehicleDraft} onChange={setVehicleDraft} />
            <button
              onClick={saveSkills}
              disabled={saving}
              className={saveBtnCls}
            >
              <span className="relative">{saving ? 'Saving…' : 'Save skills'}</span>
            </button>
          </div>
          {skillsDraft.length > 0 && (
            <p className="text-[11px] text-gray-500 mt-3">
              You&apos;ll get priority alerts matching:{' '}
              {SKILL_OPTIONS.filter((s) => skillsDraft.includes(s.code))
                .map((s) => s.label)
                .join(', ')}
            </p>
          )}

          {/* Quiet hours. This narrows push only — an open feed still shows
              everything, because someone reading the feed at 3 a.m. is
              awake. The point is not to hide alerts, it is to stop the
              LOW ones buzzing a pocket at an hour that makes people turn
              notifications off entirely. */}
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-medium text-gray-300">
              {t('avail_title')}
            </h3>
            <p className="mt-1 text-xs text-gray-500">{t('avail_hint')}</p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-xs text-gray-400">
                {t('avail_from')}
                <select
                  value={availDraft.from_hour}
                  onChange={(e) =>
                    setAvailDraft({ ...availDraft, from_hour: +e.target.value })
                  }
                  className="tap mt-1 block rounded-lg border border-line bg-surface-1 px-2 text-sm text-white"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{fmtHour(h)}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-400">
                {t('avail_to')}
                <select
                  value={availDraft.to_hour}
                  onChange={(e) =>
                    setAvailDraft({ ...availDraft, to_hour: +e.target.value })
                  }
                  className="tap mt-1 block rounded-lg border border-line bg-surface-1 px-2 text-sm text-white"
                >
                  {[...HOURS, 24].map((h) => (
                    <option key={h} value={h}>{fmtHour(h)}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-3 flex items-start gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={availDraft.critical_always}
                onChange={(e) =>
                  setAvailDraft({ ...availDraft, critical_always: e.target.checked })
                }
                className="mt-0.5 h-4 w-4 accent-orange-500"
              />
              <span>
                {t('avail_critical_always')}
                <span className="block text-xs text-gray-500">
                  {t('avail_critical_hint')}
                </span>
              </span>
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={saveAvailability} loading={saving}>
                {t('avail_save')}
              </Button>
              <Button size="sm" variant="ghost" onClick={snoozeTwoHours}>
                {t('avail_snooze')}
              </Button>
              {busyRemaining && (
                <span className="text-[11px] text-orange-300">
                  {t('avail_busy_until')} {busyRemaining}
                </span>
              )}
            </div>
            <p className="mt-2 text-[11px] text-gray-600">
              {t('avail_timezone')}: {availDraft.timezone}
            </p>
          </div>
        </section>
      )}

      <section id="contacts" className={`${sectionCls} reveal-up stagger-4 scroll-mt-24`}>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-1">
          Emergency contacts
        </h2>
        <p className="text-[11px] text-gray-500 mb-3">
          Tap a buddy chip during an SOS — the right phone/message app opens pre-filled.
        </p>
        <EmergencyContactsEditor value={contactsDraft} onChange={setContactsDraft} />
        <button
          onClick={saveContacts}
          disabled={saving}
          className={`mt-3 ${saveBtnCls}`}
        >
          <span className="relative">{saving ? 'Saving…' : 'Save contacts'}</span>
        </button>
      </section>

      <section id="activity" className={`${sectionCls} reveal-up stagger-5 scroll-mt-24`}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest">
            {t('profile_activity')}
          </h2>
          {stats?.trust && (
            <TrustBadge trust={stats.trust} />
          )}
        </div>
        {stats?.role === 'reporter' ? (
          <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
            <Stat label={t('profile_stat_posted')} value={stats.posted} />
            <Stat label={t('profile_stat_open')} value={stats.open} />
            <Stat label={t('profile_stat_resolved')} value={stats.resolved} accent="text-emerald-400" />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
            <Stat label={t('profile_stat_accepted')} value={stats?.accepted ?? 0} />
            <Stat label={t('profile_stat_inprogress')} value={stats?.in_progress ?? 0} accent="text-blue-400" />
            <Stat label={t('profile_stat_resolved')} value={stats?.resolved ?? 0} accent="text-emerald-400" />
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, accent = 'text-orange-400' }) {
  return (
    <div className="bg-gray-950/80 border border-gray-800 rounded-lg py-3 px-2 transition-colors duration-200 hover:border-gray-700">
      <div className={`text-xl sm:text-2xl font-bold tabular-nums ${accent}`}>{value}</div>
      <div className="text-[10px] sm:text-[11px] text-gray-500 uppercase tracking-widest mt-0.5">
        {label}
      </div>
    </div>
  )
}

function TrustBadge({ trust }) {
  const style =
    trust.label === 'trusted'
      ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800'
      : trust.label === 'reliable'
      ? 'bg-blue-900/40 text-blue-300 border-blue-800'
      : trust.label === 'new'
      ? 'bg-gray-800 text-gray-300 border-gray-700'
      : 'bg-amber-900/40 text-amber-300 border-amber-800'
  return (
    <span
      className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full border ${style}`}
      title={`${trust.resolved}/${trust.accepted} alerts resolved · trust ${trust.score}`}
    >
      {trust.label}
    </span>
  )
}
