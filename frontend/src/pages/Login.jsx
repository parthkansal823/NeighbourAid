import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { AlertTriangle } from '../components/icons'
import BrandLogo from '../components/BrandLogo'
import { apiError } from '../utils/error'

export default function Login() {
  const { login } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await login(form.email, form.password)
      navigate(data.role === 'volunteer' ? '/volunteer' : '/')
    } catch (err) {
      setError(apiError(err, t('login_failed')))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page app-auth-page flex items-start justify-center px-4 py-6 sm:py-10">
      <div className="app-auth-panel w-full max-w-md">
        <div className="mb-6">
          <BrandLogo size={40} className="mb-5" alt="NeighbourAid" />
          <h1 className="text-2xl font-semibold text-app-ink tracking-tight mb-2">{t('login_title')}</h1>
          <p className="text-app-muted text-sm leading-relaxed">{t('login_subtitle')}</p>
        </div>

        {error && (
          <div role="alert" className="app-feedback-error text-sm rounded-xl px-4 py-3 mb-6 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-5">
          <div>
            {/*
              htmlFor/id pairing, not decoration. These labels used to sit
              beside their input as plain text with nothing tying them
              together, so a screen reader announced every field in the app as
              an unlabelled edit box — you could hear "blank, edit text" twice
              and have no way to know which one was the password. Tapping the
              label also did nothing. Both are fixed by the association alone.
            */}
            <label htmlFor="login-email" className="app-form-label">{t('login_email')}</label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="app-field w-full"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="app-form-label">{t('login_password')}</label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="app-field w-full"
              placeholder="••••••••"
            />
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
              {loading ? t('login_submitting') : t('login_submit')}
            </span>
          </button>
        </form>

        <p className="text-center text-app-muted text-sm leading-relaxed mt-6">
          {t('login_no_account')}{' '}
          <Link to="/register" className="text-app-ink font-semibold underline underline-offset-4">
            {t('login_register_here')}
          </Link>
        </p>
      </div>
    </div>
  )
}
