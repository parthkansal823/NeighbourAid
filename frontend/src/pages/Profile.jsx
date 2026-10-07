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
    return <div role="status" className="text-center text-app-muted py-16">{t('profile_loading')}</div>
  }

  const [lng, lat] = me?.location?.coordinates ?? [0, 0]

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

  const sectionCls = 'min-w-0 rounded-2xl border border-line bg-surface-1 p-4 sm:p-5 scroll-mt-24'
  const saveBtnCls = 'app-primary-button w-full sm:w-auto px-5'

  return (
    <div className="page-panel max-w-4xl mx-auto px-4 py-6 sm:py-8 space-y-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-app-ink">{t('profile_title')}</h1>
        <p className="text-app-muted text-sm leading-relaxed mt-2 wrap-break-word">
          {t('profile_signed_as')} <span className="text-app-ink">{me?.email}</span>
        </p>
        <nav aria-label={t('profile_title')} className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-sm">
          <a href="#location" className="inline-flex min-h-11 items-center text-app-muted underline underline-offset-4">
            Location
          </a>
          {me?.role === 'volunteer' && (
            <a href="#skills" className="inline-flex min-h-11 items-center text-app-muted underline underline-offset-4">
              Skills
            </a>
          )}
          <a href="#contacts" className="inline-flex min-h-11 items-center text-app-muted underline underline-offset-4">
            Contacts
          </a>
          <a href="#activity" className="inline-flex min-h-11 items-center text-app-muted underline underline-offset-4">
            Activity
          </a>
        </nav>
      </header>

      {error && (
        <div role="alert" className="app-feedback-error text-sm rounded-xl px-4 py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      )}
      {message && (
        <div role="status" className="app-feedback-success text-sm rounded-xl px-4 py-3 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>{message}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 items-start gap-4">
      <section id="identity" className={sectionCls}>
        <h2 className="text-base font-semibold text-app-ink mb-4">
          {t('profile_identity')}
        </h2>
        <dl className="grid grid-cols-3 gap-x-3 gap-y-3 text-sm leading-relaxed">
          <dt className="text-app-muted">{t('profile_name')}</dt>
          <dd className="col-span-2 text-app-ink wrap-break-word">{me?.name}</dd>
          <dt className="text-app-muted">{t('profile_role')}</dt>
          <dd className="col-span-2 capitalize text-app-ink">{me?.role}</dd>
          <dt className="text-app-muted">{t('profile_joined')}</dt>
          <dd className="col-span-2 text-app-ink">
            {me?.created_at ? new Date(me.created_at).toLocaleString() : '—'}
          </dd>
        </dl>

        {/* Optional, and the hint has to say exactly who ever sees it —
            someone deciding whether to type their number here is entitled
            to know the rule, not to be reassured in general terms. */}
        <div className="mt-4 border-t border-line pt-4">
          <label
            htmlFor="profile-phone"
            className="app-form-label"
          >
            {t('profile_phone')}
          </label>
          <p id="profile-phone-hint" className="mt-1 text-xs text-app-muted leading-relaxed">{t('profile_phone_hint')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              id="profile-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={32}
              aria-describedby="profile-phone-hint"
              value={phoneDraft}
              onChange={(e) => setPhoneDraft(e.target.value)}
              placeholder={t('profile_phone_ph')}
              className="app-field min-w-0 flex-1 basis-40"
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

      <section id="location" className={sectionCls}>
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-base font-semibold text-app-ink">
            {t('profile_home_location')}
          </h2>
          <button
            onClick={detectAndUpdate}
            disabled={locLoading || saving}
            className="app-secondary-button px-3 text-sm"
          >
            {locLoading ? t('profile_detecting') : saving ? t('profile_saving') : t('profile_update_loc')}
          </button>
        </div>
        <p className="text-app-ink text-sm tabular-nums">
          {lat.toFixed(5)}, {lng.toFixed(5)}
        </p>
        {(accuracy || locTimestamp) && (
          <p className="text-xs text-app-muted mt-2 tabular-nums">
            {accuracy ? `±${Math.round(accuracy)} m` : ''}
            {accuracy && locTimestamp ? ' · ' : ''}
            {locTimestamp ? new Date(locTimestamp).toLocaleString() : ''}
          </p>
        )}
        <p className="text-xs text-app-muted leading-relaxed mt-2">
          {t('profile_loc_hint')}
        </p>
      </section>

      {me?.role === 'volunteer' && (
        <section id="skills" className={sectionCls}>
          <h2 className="text-base font-semibold text-app-ink mb-4">
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
            <p className="text-xs text-app-muted leading-relaxed mt-3">
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
            <h3 className="text-sm font-semibold text-app-ink">
              {t('avail_title')}
            </h3>
            <p className="mt-2 text-xs text-app-muted leading-relaxed">{t('avail_hint')}</p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="text-sm text-app-muted min-w-0">
                {t('avail_from')}
                <select
                  value={availDraft.from_hour}
                  onChange={(e) =>
                    setAvailDraft({ ...availDraft, from_hour: +e.target.value })
                  }
                  className="app-field w-full mt-2"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>{fmtHour(h)}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-app-muted min-w-0">
                {t('avail_to')}
                <select
                  value={availDraft.to_hour}
                  onChange={(e) =>
                    setAvailDraft({ ...availDraft, to_hour: +e.target.value })
                  }
                  className="app-field w-full mt-2"
                >
                  {[...HOURS, 24].map((h) => (
                    <option key={h} value={h}>{fmtHour(h)}</option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-4 flex min-h-12 items-start gap-3 py-2 text-sm text-app-ink cursor-pointer">
              <input
                type="checkbox"
                checked={availDraft.critical_always}
                onChange={(e) =>
                  setAvailDraft({ ...availDraft, critical_always: e.target.checked })
                }
                className="mt-0.5 h-5 w-5 shrink-0 accent-accent"
              />
              <span>
                {t('avail_critical_always')}
                <span className="block text-xs text-app-muted leading-relaxed mt-1">
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
                <span className="text-xs text-app-muted">
                  {t('avail_busy_until')} {busyRemaining}
                </span>
              )}
            </div>
            <p className="mt-3 text-xs text-app-muted wrap-break-word">
              {t('avail_timezone')}: {availDraft.timezone}
            </p>
          </div>
        </section>
      )}

      <section id="contacts" className={sectionCls}>
        <h2 className="text-base font-semibold text-app-ink mb-2">
          Emergency contacts
        </h2>
        <p className="text-xs text-app-muted leading-relaxed mb-4">
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

      <section id="activity" className={`${sectionCls} lg:col-span-2`}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <h2 className="text-base font-semibold text-app-ink">
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
            <Stat label={t('profile_stat_resolved')} value={stats.resolved} />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
            <Stat label={t('profile_stat_accepted')} value={stats?.accepted ?? 0} />
            <Stat label={t('profile_stat_inprogress')} value={stats?.in_progress ?? 0} />
            <Stat label={t('profile_stat_resolved')} value={stats?.resolved ?? 0} />
          </div>
        )}
      </section>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface py-4 px-2">
      <div className="text-xl sm:text-2xl font-semibold text-app-ink tabular-nums">{value}</div>
      <div className="text-xs text-app-muted leading-snug mt-1">
        {label}
      </div>
    </div>
  )
}

function TrustBadge({ trust }) {
  return (
    <span
      className="text-xs capitalize font-medium px-2.5 py-1 rounded-full border border-line bg-surface text-app-muted"
      title={`${trust.resolved}/${trust.accepted} alerts resolved · trust ${trust.score}`}
    >
      {trust.label}
    </span>
  )
}
