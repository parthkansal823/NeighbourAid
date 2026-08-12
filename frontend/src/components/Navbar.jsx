import { useEffect, useRef, useState } from 'react'
import { Globe, LifeBuoy, Siren } from './icons'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'

const navLink = ({ isActive }) =>
  `relative py-1 transition-colors after:absolute after:left-0 after:right-0 after:-bottom-1 after:h-0.5 after:rounded-full after:bg-linear-to-r after:from-orange-400 after:to-amber-300 after:origin-left after:transition-transform after:duration-300 ${
    isActive
      ? 'text-white after:scale-x-100'
      : 'text-gray-400 hover:text-white after:scale-x-0 hover:after:scale-x-100'
  }`

function LanguageMenu() {
  const { lang, setLang, languages, t, autoTranslate, setAutoTranslate } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = languages.find((l) => l.code === lang) ?? languages[0]

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs border border-gray-700 hover:border-orange-500/60 hover:bg-orange-500/5 text-gray-300 hover:text-white px-2.5 py-1 rounded-md transition-all duration-200"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Change language"
        title="Change language"
      >
        <Globe className="h-3.5 w-3.5" aria-hidden />
        <span>{current.short}</span>
        <svg
          aria-hidden
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 w-64 glass border border-gray-800 rounded-lg shadow-2xl shadow-black/50 z-50 overflow-hidden pop-in">
          {/* Scrolls once the list outgrows the viewport, so the auto-translate
              row below stays reachable no matter how many languages we ship. */}
          <ul role="listbox" className="max-h-64 overflow-y-auto">
            {languages.map((l) => (
              <li key={l.code}>
                <button
                  role="option"
                  aria-selected={l.code === lang}
                  onClick={() => {
                    setLang(l.code)
                    setOpen(false)
                  }}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    l.code === lang
                      ? 'bg-orange-500/20 text-orange-300'
                      : 'text-gray-200 hover:bg-gray-800/80'
                  }`}
                >
                  {l.label}
                </button>
              </li>
            ))}
          </ul>

          {/*
            Auto-translate is on by default — a volunteer who can't read the
            report can't act on it — but it says plainly where the text goes
            and can be switched off here. That disclosure is the whole point:
            alert bodies include anonymous reports, and previously they were
            sent to a third party without the user ever being told.
          */}
          <div className="border-t border-gray-800 px-3 py-2.5">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={autoTranslate}
                onChange={(e) => setAutoTranslate(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-orange-500"
              />
              <span className="min-w-0">
                <span className="block text-xs text-gray-200">
                  {t('lang_auto_translate')}
                </span>
                <span className="block text-[10px] leading-snug text-amber-300/80 mt-0.5">
                  {t('lang_auto_translate_warning')}
                </span>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Navbar() {
  const { user, logout } = useAuth()
  const { t } = useI18n()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 6)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handleLogout = () => {
    logout()
    setMenuOpen(false)
    navigate('/')
  }

  const closeMenu = () => setMenuOpen(false)

  return (
    <nav
      className={`sticky top-0 z-40 glass border-b transition-all duration-300 ${
        scrolled
          ? 'border-gray-800 shadow-lg shadow-black/30'
          : 'border-gray-900'
      }`}
    >
      <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-2">
        <Link
          to="/"
          onClick={closeMenu}
          className="group flex items-center gap-2 text-lg sm:text-xl font-bold tracking-tight"
        >
          <LifeBuoy
            aria-hidden
            className="h-6 w-6 text-orange-400 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6"
          />
          <span className="text-gradient-brand">NeighbourAid</span>
        </Link>

        <div className="hidden md:flex items-center gap-5 text-sm">
          <NavLink to="/" className={navLink}>
            Home
          </NavLink>
          <NavLink to="/map" className={navLink}>
            {t('nav_map')}
          </NavLink>
          <NavLink to="/safety" className={navLink}>
            {t('nav_safety')}
          </NavLink>
          <NavLink to="/resources" className={navLink}>
            {t('nav_resources')}
          </NavLink>

          {!user ? (
            <>
              <NavLink to="/login" className={navLink}>
                {t('nav_login')}
              </NavLink>
              {/* Reporting works without an account, so the red action is
                  reachable from every page — not buried behind signup. */}
              <Link
                to="/post-alert"
                className="bg-linear-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white px-4 py-1.5 rounded-lg shadow-md shadow-red-500/20 hover:shadow-red-500/40 transition-all duration-200 hover:-translate-y-0.5 inline-flex items-center gap-1.5"
              >
                <Siren className="h-4 w-4" aria-hidden />
                {t('nav_report')}
              </Link>
              <Link
                to="/register"
                className="border border-gray-700 hover:border-orange-500/60 text-gray-300 hover:text-white px-3 py-1.5 rounded-lg transition-all duration-200"
              >
                {t('nav_join')}
              </Link>
            </>
          ) : (
            <>
              {user.role === 'reporter' && (
                <>
                  <NavLink to="/my-alerts" className={navLink}>
                    {t('nav_my_alerts')}
                  </NavLink>
                  <Link
                    to="/post-alert"
                    className="bg-linear-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white px-4 py-1.5 rounded-lg shadow-md shadow-red-500/20 hover:shadow-red-500/40 transition-all duration-200 hover:-translate-y-0.5"
                  >
                    {t('nav_report')}
                  </Link>
                </>
              )}
              {user.role === 'volunteer' && (
                <Link
                  to="/volunteer"
                  className="bg-linear-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white px-4 py-1.5 rounded-lg shadow-md shadow-emerald-500/20 hover:shadow-emerald-500/40 transition-all duration-200 hover:-translate-y-0.5"
                >
                  {t('nav_volunteer')}
                </Link>
              )}
              <NavLink to="/profile" className={navLink}>
                {user.name || t('nav_profile')}{' '}
                <span className="text-gray-600">·</span>{' '}
                <span className="capitalize text-gray-300">{user.role}</span>
              </NavLink>
              <button
                onClick={handleLogout}
                className="text-gray-400 hover:text-red-400 transition-colors"
              >
                {t('nav_logout')}
              </button>
            </>
          )}

          <LanguageMenu />
        </div>

        <div className="flex md:hidden items-center gap-2">
          <LanguageMenu />
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="text-gray-300 hover:text-white p-2 -mr-2 rounded-lg transition-colors"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            <div className="relative w-[22px] h-[22px]">
              <span
                className={`absolute left-0 top-[5px] block h-0.5 w-full rounded-full bg-current transition-all duration-300 ${
                  menuOpen ? 'translate-y-[6px] rotate-45' : ''
                }`}
              />
              <span
                className={`absolute left-0 top-[11px] block h-0.5 w-full rounded-full bg-current transition-all duration-200 ${
                  menuOpen ? 'opacity-0 -translate-x-2' : 'opacity-100'
                }`}
              />
              <span
                className={`absolute left-0 top-[17px] block h-0.5 w-full rounded-full bg-current transition-all duration-300 ${
                  menuOpen ? 'translate-y-[-6px] -rotate-45' : ''
                }`}
              />
            </div>
          </button>
        </div>
      </div>

      <div
        className={`md:hidden overflow-hidden border-t border-gray-800/60 transition-all duration-300 ease-out ${
          menuOpen ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="px-4 py-3 space-y-1 text-sm glass">
          {[
            { to: '/', label: 'Home' },
            { to: '/map', label: t('nav_map') },
            { to: '/safety', label: t('nav_safety') },
            { to: '/resources', label: t('nav_resources') },
          ].map((item) => (
            <NavLink
              key={item.to}
              onClick={closeMenu}
              to={item.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-orange-500/15 text-white border-l-2 border-orange-400 pl-[10px]'
                    : 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          {!user ? (
            <>
              <NavLink
                onClick={closeMenu}
                to="/login"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-orange-500/15 text-white border-l-2 border-orange-400 pl-[10px]'
                      : 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
                  }`
                }
              >
                {t('nav_login')}
              </NavLink>
              <Link
                onClick={closeMenu}
                to="/post-alert"
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-linear-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white text-center font-semibold shadow-md shadow-red-500/20 transition-all"
              >
                <Siren className="h-4 w-4" aria-hidden />
                {t('nav_report')}
              </Link>
              <Link
                onClick={closeMenu}
                to="/register"
                className="block px-3 py-2 rounded-lg border border-gray-700 hover:border-orange-500/60 text-gray-300 hover:text-white text-center transition-all"
              >
                {t('nav_join')}
              </Link>
            </>
          ) : (
            <>
              {user.role === 'reporter' && (
                <>
                  <NavLink
                    onClick={closeMenu}
                    to="/my-alerts"
                    className={({ isActive }) =>
                      `block px-3 py-2 rounded-lg transition-colors ${
                        isActive
                          ? 'bg-orange-500/15 text-white border-l-2 border-orange-400 pl-[10px]'
                          : 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
                      }`
                    }
                  >
                    {t('nav_my_alerts')}
                  </NavLink>
                  <Link
                    onClick={closeMenu}
                    to="/post-alert"
                    className="block px-3 py-2 rounded-lg bg-linear-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white text-center font-semibold shadow-md shadow-red-500/20 transition-all"
                  >
                    {t('nav_report')}
                  </Link>
                </>
              )}
              {user.role === 'volunteer' && (
                <Link
                  onClick={closeMenu}
                  to="/volunteer"
                  className="block px-3 py-2 rounded-lg bg-linear-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white text-center font-semibold shadow-md shadow-emerald-500/20 transition-all"
                >
                  {t('nav_volunteer')}
                </Link>
              )}
              <NavLink
                onClick={closeMenu}
                to="/profile"
                className={({ isActive }) =>
                  `block px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-orange-500/15 text-white border-l-2 border-orange-400 pl-[10px]'
                      : 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
                  }`
                }
              >
                {user.name || t('nav_profile')}{' '}
                <span className="text-gray-600">·</span>{' '}
                <span className="capitalize text-gray-400">{user.role}</span>
              </NavLink>
              <button
                onClick={handleLogout}
                className="w-full text-left px-3 py-2 rounded-lg text-red-400 hover:bg-red-950/40 transition-colors"
              >
                {t('nav_logout')}
              </button>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
