import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { AlertTriangle } from '../components/icons'
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
    <div className="relative min-h-screen flex items-center justify-center px-4 py-8 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-72 w-[36rem] rounded-full bg-orange-500/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 right-1/4 h-56 w-72 rounded-full bg-blue-500/10 blur-3xl"
      />
      <div className="relative bg-gradient-to-b from-gray-900/95 to-gray-900/80 backdrop-blur border border-gray-800 rounded-2xl p-6 sm:p-8 w-full max-w-md shadow-2xl shadow-black/50 reveal-up">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">{t('login_title')}</h1>
          <p className="text-gray-400 text-sm">{t('login_subtitle')}</p>
        </div>

        {error && (
          <div className="bg-red-950/70 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-6 flex items-start gap-2 pop-in">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">{t('login_email')}</label>
            <input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full bg-gray-800/80 border border-gray-700 text-white rounded-lg px-4 py-2.5 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:bg-gray-800 transition-all duration-200 text-base placeholder:text-gray-600"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">{t('login_password')}</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="w-full bg-gray-800/80 border border-gray-700 text-white rounded-lg px-4 py-2.5 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:bg-gray-800 transition-all duration-200 text-base placeholder:text-gray-600"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="group relative w-full bg-gradient-to-b from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all duration-200 shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] overflow-hidden"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent skew-x-12 -translate-x-full group-hover:translate-x-[400%] transition-transform duration-700 ease-out"
            />
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

        <p className="text-center text-gray-500 text-sm mt-6">
          {t('login_no_account')}{' '}
          <Link to="/register" className="text-orange-400 hover:text-orange-300 underline-offset-2 hover:underline transition-colors">
            {t('login_register_here')}
          </Link>
        </p>
      </div>
    </div>
  )
}
