import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { LanguageMenu } from './Navbar'
import { ArrowLeft, Menu, X } from './icons'
import BrandLogo from './BrandLogo'
import NativeUpdateSettings from './NativeUpdateSettings'

/** Compact Android header. The website keeps its existing Navbar. */
export default function NativeHeader({ onOpenEmergency }) {
  const { user, logout } = useAuth()
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const menuButton = useRef(null)
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const screenTitle = {
    '/map': t('nav_map'),
    '/post-alert': t('post_title'),
    '/my-alerts': t('nav_my_alerts'),
    '/volunteer': t('nav_volunteer'),
    '/profile': t('nav_profile'),
    '/safety': t('nav_safety'),
    '/resources': t('nav_resources'),
    '/news': t('nav_news'),
    '/help': t('help_title'),
    '/app-updates': 'App updates',
    '/login': t('nav_login'),
    '/register': t('nav_join'),
  }[pathname]

  useEffect(() => { setOpen(false) }, [pathname])
  useEffect(() => {
    if (!open) return undefined
    const closeOutside = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        menuButton.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const links = [
    { to: '/safety', key: 'nav_safety' },
    { to: '/resources', key: 'nav_resources' },
    { to: '/news', key: 'nav_news' },
    ...(user?.role === 'reporter' ? [{ to: '/my-alerts', key: 'nav_my_alerts' }] : []),
    ...(!user ? [{ to: '/register', key: 'nav_join' }] : []),
  ]
  return (
    <header ref={ref} className="app-header sticky top-0 z-[1100] border-b border-line bg-surface">
      <div className="native-header-row mx-auto flex min-h-14 max-w-5xl items-center justify-between gap-2 px-3">
        {screenTitle ? (
          <div className="flex min-w-0 items-center gap-1">
            <button type="button" onClick={() => { setOpen(false); window.history.length > 1 ? navigate(-1) : navigate('/') }} className="tap inline-flex shrink-0 items-center justify-center rounded-lg text-app-ink hover:bg-surface-2" aria-label="Go back"><ArrowLeft className="h-5 w-5" aria-hidden /></button>
            <p className="native-header-title truncate text-base font-semibold text-app-ink">{screenTitle}</p>
          </div>
        ) : (
          <Link to="/" className="tap flex min-w-0 items-center gap-2 rounded-lg text-base font-semibold tracking-tight text-app-ink" onClick={() => setOpen(false)}>
            <BrandLogo size={28} />
            <span className="truncate">NeighbourAid</span>
          </Link>
        )}
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => { setOpen(false); onOpenEmergency() }} className="native-emergency-button tap rounded-lg px-2 text-sm font-semibold" aria-label={t('dialer_open')}>112</button>
          <LanguageMenu />
          <button ref={menuButton} type="button" onClick={() => setOpen((value) => !value)} className="tap flex items-center justify-center rounded-lg text-app-ink hover:bg-surface-2" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="native-menu">
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>
      {open && <nav id="native-menu" aria-label="More navigation" className="native-more-menu absolute inset-x-0 top-full max-h-[calc(100dvh-10rem)] overflow-y-auto border-b border-line bg-surface p-3 shadow-lg">
        {links.map(({ to, key }) => <Link key={to} to={to} onClick={() => setOpen(false)} className="flex min-h-12 items-center rounded-lg px-3 text-base text-app-ink hover:bg-surface-2">{t(key)}</Link>)}
        {user && <button type="button" onClick={() => { logout(); setOpen(false); navigate('/') }} className="flex min-h-12 w-full items-center rounded-lg px-3 text-base text-app-muted">{t('nav_logout')}</button>}
        <NativeUpdateSettings />
      </nav>}
    </header>
  )
}
