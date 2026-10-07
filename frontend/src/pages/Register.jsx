import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { AlertTriangle, MapPin } from '../components/icons'
import BrandLogo from '../components/BrandLogo'
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

  const inputCls = 'app-field w-full'

  return (
    <div className="auth-page app-auth-page flex items-start justify-center px-4 py-6 sm:py-10">
      <div className="app-auth-panel w-full max-w-md">
        <BrandLogo size={40} className="mb-5" alt="NeighbourAid" />
        <h1 className="text-2xl font-semibold text-app-ink tracking-tight mb-2">{t('register_title')}</h1>
        <p className="text-app-muted text-sm leading-relaxed mb-6">{t('register_subtitle')}</p>

        {error && (
          <div role="alert" className="app-feedback-error text-sm rounded-xl px-4 py-3 mb-6 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="register-name" className="app-form-label">{t('register_name')}</label>
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
            <label htmlFor="register-email" className="app-form-label">{t('login_email')}</label>
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
            <label htmlFor="register-password" className="app-form-label">{t('login_password')}</label>
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
              aria-describedby="register-password-hint"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={inputCls}
              placeholder="••••••••"
            />
            <p id="register-password-hint" className="text-xs text-app-muted leading-relaxed mt-2">
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
            <span id="register-role-label" className="app-form-label">{t('register_want_to')}</span>
            <div role="group" aria-labelledby="register-role-label" className="grid grid-cols-2 gap-2">
              {['reporter', 'volunteer'].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setForm({ ...form, role: r })}
                  aria-pressed={form.role === r}
                  className="app-choice-button min-w-0 px-3 py-3 text-sm font-medium"
                >
                  {r === 'reporter' ? t('register_role_reporter') : t('register_role_volunteer')}
                </button>
              ))}
            </div>
          </div>

          {form.role === 'volunteer' && (
            <>
              <div>
                <span id="register-skills-label" className="app-form-label">
                  Skills <span className="block text-app-muted text-xs font-normal mt-1">Helps route the right alerts to you</span>
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
            <label htmlFor="register-location" className="app-form-label">{t('register_location')}</label>
            <div className="flex flex-wrap gap-2">
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
                aria-describedby="register-location-hint"
                className="app-field flex-1 min-w-0 basis-40 tabular-nums"
              />
              <button
                type="button"
                onClick={detectLocation}
                disabled={locLoading}
                className="app-secondary-button flex-1 sm:flex-none px-4 text-sm"
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
            <p id="register-location-hint" className="text-xs text-app-muted leading-relaxed mt-2" aria-live="polite">
              {locationSet
                ? t('register_location_saved')
                : t('register_location_required')}
            </p>
          </div>

          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="app-primary-button w-full"
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

        <p className="text-center text-app-muted text-sm leading-relaxed mt-6">
          {t('register_have_account')}{' '}
          <Link to="/login" className="text-app-ink font-semibold underline underline-offset-4">
            {t('register_sign_in')}
          </Link>
        </p>
      </div>
    </div>
  )
}
