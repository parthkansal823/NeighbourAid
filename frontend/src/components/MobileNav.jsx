import { NavLink } from 'react-router-dom'
import { HeartHandshake, Home, Map, Siren, User } from './icons'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'

const itemClass = ({ isActive }) =>
  `flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition-colors ${
    isActive ? 'text-orange-400' : 'text-gray-400 hover:text-white'
  }`

/**
 * The primary navigation shown on every narrow screen, whether it is the
 * website in a phone browser or the Capacitor Android app. Keeping it inside
 * the React shell avoids a second, native-only navigation that would drift
 * away from the web experience.
 */
export default function MobileNav() {
  const { user } = useAuth()
  const { t } = useI18n()
  const action = user?.role === 'volunteer'
    ? { to: '/volunteer', label: t('nav_volunteer'), Icon: HeartHandshake }
    : { to: '/post-alert', label: t('nav_report'), Icon: Siren }

  return (
    <nav
      aria-label="Primary navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex h-[4.5rem] max-w-lg items-center gap-1">
        <NavLink to="/" end className={itemClass}>
          <Home className="h-5 w-5" aria-hidden />
          <span>Home</span>
        </NavLink>
        <NavLink to="/map" className={itemClass}>
          <Map className="h-5 w-5" aria-hidden />
          <span>{t('nav_map')}</span>
        </NavLink>
        <NavLink
          to={action.to}
          className={({ isActive }) =>
            `-mt-5 flex min-h-14 min-w-14 shrink-0 flex-col items-center justify-center rounded-2xl border text-[10px] font-semibold shadow-lg shadow-black/35 transition-colors ${
              isActive
                ? 'border-orange-300 bg-orange-400 text-black'
                : 'border-orange-500 bg-orange-500 text-black hover:bg-orange-400'
            }`
          }
        >
          <action.Icon className="h-5 w-5" aria-hidden />
          <span className="max-w-16 truncate px-1">{action.label}</span>
        </NavLink>
        <NavLink to="/help" className={itemClass}>
          <HeartHandshake className="h-5 w-5" aria-hidden />
          <span>{t('nav_help')}</span>
        </NavLink>
        <NavLink to={user ? '/profile' : '/login'} className={itemClass}>
          <User className="h-5 w-5" aria-hidden />
          <span>{user ? t('nav_profile') : t('nav_login')}</span>
        </NavLink>
      </div>
    </nav>
  )
}
