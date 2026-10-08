import { useEffect, useRef } from 'react'
import { NavLink } from 'react-router-dom'
import { HeartHandshake, Home, Inbox, Map, ShieldCheck, Siren, User } from './icons'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import useKeyboardInsets from '../hooks/useKeyboardInsets'

const itemClass = (native) => ({ isActive }) =>
  `${native ? 'native-tab min-h-16 text-xs leading-tight' : 'text-[11px]'} flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 font-medium transition-colors ${
    isActive ? (native ? 'native-tab-active text-accent' : 'text-orange-400') : 'text-app-muted hover:text-app-ink'
  }`

/**
 * The primary navigation shown on every narrow screen, whether it is the
 * website in a phone browser or the Capacitor Android app. Keeping it inside
 * the React shell avoids a second, native-only navigation that would drift
 * away from the web experience.
 */
export default function MobileNav({ native = false }) {
  const { user } = useAuth()
  const { t } = useI18n()
  const { keyboardOpen } = useKeyboardInsets()
  const nav = useRef(null)

  useEffect(() => {
    if (!native) return undefined
    const element = nav.current
    const shell = element?.closest('.native-app')
    if (!shell) return undefined
    const measure = () => shell.style.setProperty('--app-nav-height', `${element.getBoundingClientRect().height}px`)
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); shell.style.removeProperty('--app-nav-height') }
  }, [native, keyboardOpen])

  const action = user?.role === 'volunteer'
    ? { to: '/volunteer', label: t(native ? 'nav_respond_short' : 'nav_volunteer'), Icon: HeartHandshake }
    : { to: '/post-alert', label: t(native ? 'nav_report_short' : 'nav_report'), Icon: Siren }
  const secondary = user?.role === 'reporter'
    ? { to: '/my-alerts', label: t('nav_my_alerts'), Icon: Inbox }
    : { to: '/safety', label: t('nav_safety'), Icon: ShieldCheck }
  const SecondaryIcon = secondary.Icon

  return (
    <nav
      ref={nav}
      aria-label="Primary navigation"
      hidden={native && keyboardOpen}
      className={native ? 'mobile-nav fixed inset-x-0 bottom-0 z-[1000] border-t border-line bg-surface px-2 pb-[env(safe-area-inset-bottom)]' : 'fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden'}
    >
      <div className={native ? 'mx-auto flex min-h-16 max-w-2xl items-stretch gap-1' : 'mx-auto flex h-[4.5rem] max-w-lg items-center gap-1'}>
        <NavLink to="/" end className={itemClass(native)}>
          <Home className="h-5 w-5" aria-hidden />
          <span>{native ? t('nav_home') : 'Home'}</span>
        </NavLink>
        <NavLink to="/map" className={itemClass(native)}>
          <Map className="h-5 w-5" aria-hidden />
          <span>{t('nav_map')}</span>
        </NavLink>
        <NavLink
          to={action.to}
          className={({ isActive }) =>
            native ? `native-tab native-tab-action flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1 py-2 text-xs font-semibold leading-tight text-accent transition-colors ${isActive ? 'native-tab-active' : ''}` : `-mt-5 flex min-h-14 min-w-14 shrink-0 flex-col items-center justify-center rounded-2xl border text-[10px] font-semibold shadow-lg shadow-black/35 transition-colors ${isActive ? 'border-orange-300 bg-orange-400 text-black' : 'border-orange-500 bg-orange-500 text-black hover:bg-orange-400'}`
          }
        >
          <action.Icon className={native ? 'native-tab-action-icon h-5 w-5' : 'h-5 w-5'} aria-hidden />
          <span className={native ? 'break-words text-center' : 'max-w-16 truncate px-1'}>{action.label}</span>
        </NavLink>
        <NavLink to={secondary.to} className={itemClass(native)}>
          <SecondaryIcon className="h-5 w-5" aria-hidden />
          <span>{secondary.label}</span>
        </NavLink>
        <NavLink to={user ? '/profile' : '/login'} className={itemClass(native)}>
          <User className="h-5 w-5" aria-hidden />
          <span>{user ? t('nav_profile') : t('nav_login')}</span>
        </NavLink>
      </div>
    </nav>
  )
}
