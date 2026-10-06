import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { AlertTriangle, MapPin } from '../components/icons'
import { apiError } from '../utils/error'
import { SkillsPicker, VehicleToggle } from '../components/ProfileFields'

export default function Register() {
  const { register } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'reporter',
    location: { type: 'Point', coordinates: [76.7794, 30.7333] },
    skills: [],
    has_vehicle: false,
    emergency_contacts: [],
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [locLoading, setLocLoading] = useState(false)
  const [locationSet, setLocationSet] = useState(false)

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not available in this browser.')
      return
    }
    setLocLoading(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setForm((f) => ({
          ...f,
          location: { type: 'Point', coordinates: [coords.longitude, coords.latitude] },
        }))
        setLocationSet(true)
        setLocLoading(false)
      },
      (err) => {
        setLocLoading(false)
        setError(err.message || 'Could not detect your location.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }, [])

  // Offer the fix up front so the field is usually filled before they reach it.
  useEffect(() => {
    detectLocation()
  }, [detectLocation])

  const submit = async (e) => {
    e.preventDefault()
    // Home location isn't cosmetic: it gates the 2 km witness radius and is
    // the fallback position shown to a reporter tracking their responder.
    // Registering on the placeholder coordinates silently plants the account
    // in Chandigarh regardless of where the person actually is.
    if (!locationSet) {
      setError(t('register_location_required'))
      return
    }
    setError('')
    setLoading(true)
    try {
      // Only volunteers need skills/vehicle — reporters skip those fields.
      const payload =
        form.role === 'volunteer'
          ? form
          : { ...form, skills: [], has_vehicle: false }
      await register(payload)
      navigate(form.role === 'volunteer' ? '/volunteer' : '/')
    } catch (err) {
      setError(apiError(err, t('register_failed')))
    } finally {
      setLoading(false)
    }
  }

  const [lng, lat] = form.location.coordinates

  const inputCls =
    'w-full bg-gray-800/80 border border-gray-700 text-white rounded-lg px-4 py-2.5 focus:outline-hidden focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:bg-gray-800 transition-colors duration-200 text-base placeholder:text-gray-600'

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-8 sm:py-12 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-72 w-xl rounded-full bg-orange-500/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 left-1/4 h-56 w-72 rounded-full bg-emerald-500/10 blur-3xl"
      />
      <div className="relative surface-card p-6 sm:p-8 w-full max-w-md reveal-up">
        <h1 className="text-2xl font-bold text-white mb-2">{t('register_title')}</h1>
        <p className="text-gray-400 text-sm mb-6 sm:mb-8">{t('register_subtitle')}</p>

        {error && (
          <div className="bg-red-950/70 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-6 flex items-start gap-2 pop-in">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="register-name" className="block text-sm text-gray-400 mb-1.5">{t('register_name')}</label>
            <input
              id="register-name"
              required
              autoComplete="name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls}
              placeholder="Your full name"
            />
          </div>

          <div>
            <label htmlFor="register-email" className="block text-sm text-gray-400 mb-1.5">{t('login_email')}</label>
            <input
              id="register-email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={inputCls}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="register-password" className="block text-sm text-gray-400 mb-1.5">{t('login_password')}</label>
            <input
              id="register-password"
              type="password"
              required
              // Must match UserCreate on the server (min 8, ≥1 letter, ≥1
              // digit). This said 6, so the browser happily accepted a
              // password the API then rejected with a raw 422.
              minLength={8}
              pattern="(?=.*[A-Za-z])(?=.*\d).{8,}"
              title={t('register_password_hint')}
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={inputCls}
              placeholder="••••••••"
            />
            <p className="text-[11px] text-gray-500 mt-1">
              {t('register_password_hint')}
            </p>
          </div>

          <div>
            {/*
              A group, not a field: htmlFor points at one control, and this
              label describes two buttons. aria-labelledby on the container is
              what ties them together, so a screen reader announces "Want to,
              group" before reading the options instead of two bare buttons
              with no idea what the choice is about.
            */}
            <span id="register-role-label" className="block text-sm text-gray-400 mb-1.5">{t('register_want_to')}</span>
            <div role="group" aria-labelledby="register-role-label" className="grid grid-cols-2 gap-3">
              {['reporter', 'volunteer'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setForm({ ...form, role: r })}
                  className={`py-3 rounded-xl border font-semibold capitalize transition-colors duration-200 text-sm sm:text-base ${
                    form.role === r
                      ? 'border-orange-500 bg-orange-500/15 text-orange-300'
                      : 'border-gray-700 text-gray-400 hover:border-orange-500/40 hover:text-gray-200 hover:bg-gray-800/40'
                  }`}
                >
                  {r === 'reporter' ? t('register_role_reporter') : t('register_role_volunteer')}
                </button>
              ))}
            </div>
          </div>

          {form.role === 'volunteer' && (
            <>
              <div>
                <span id="register-skills-label" className="block text-sm text-gray-400 mb-1.5">
                  Skills <span className="text-gray-600 text-xs">· helps route the right alerts to you</span>
                </span>
                <div role="group" aria-labelledby="register-skills-label">
                  <SkillsPicker
                    value={form.skills}
                    onChange={(skills) => setForm((f) => ({ ...f, skills }))}
                  />
                </div>
              </div>
              <VehicleToggle
                value={form.has_vehicle}
                onChange={(has_vehicle) => setForm((f) => ({ ...f, has_vehicle }))}
              />
            </>
          )}

          <div>
            <label htmlFor="register-location" className="block text-sm text-gray-400 mb-1.5">{t('register_location')}</label>
            <div className="flex gap-2">
              <input
                id="register-location"
                readOnly
                value={
                  locationSet
                    ? `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                    : locLoading
                      ? t('register_detecting')
                      : t('register_location_placeholder')
                }
                className={`flex-1 min-w-0 bg-gray-800/80 border rounded-lg px-3 sm:px-4 py-2.5 text-sm ${
                  locationSet
                    ? 'border-emerald-700/70 ring-1 ring-emerald-700/30 text-gray-300 tabular-nums'
                    : 'border-amber-700/70 text-amber-300/90'
                }`}
              />
              <button
                type="button"
                onClick={detectLocation}
                disabled={locLoading}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2.5 rounded-lg text-sm transition-colors duration-200 disabled:opacity-50 whitespace-nowrap active:scale-95"
              >
                {locLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                    </svg>
                    {t('register_detecting')}
                  </span>
                ) : (
                  <>
                  <MapPin className="h-4 w-4 inline-block mr-1 -mt-0.5" aria-hidden />
                  {t('register_detect')}
                </>
                )}
              </button>
            </div>
            <p
              className={`text-[11px] mt-1 ${
                locationSet ? 'text-emerald-400' : 'text-amber-400/90'
              }`}
            >
              {locationSet
                ? t('register_location_saved')
                : t('register_location_required')}
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative w-full tap bg-accent hover:bg-orange-400 active:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed text-gray-950 font-semibold py-3 rounded-xl transition-colors duration-200 press-in overflow-hidden"
          >
            <span className="relative inline-flex items-center justify-center gap-2">
              {loading && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {loading ? t('register_submitting') : t('register_submit')}
            </span>
          </button>
        </form>

        <p className="text-center text-gray-500 text-sm mt-6">
          {t('register_have_account')}{' '}
          <Link to="/login" className="text-orange-400 hover:text-orange-300 underline-offset-2 hover:underline transition-colors">
            {t('register_sign_in')}
          </Link>
        </p>
      </div>
    </div>
  )
}
