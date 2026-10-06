import { Link } from 'react-router-dom'
import { useI18n } from '../utils/i18n'
import { ArrowRight, Map, ShieldCheck, Wrench } from './icons'
import OfficialAdvisories from './OfficialAdvisories'

/** Action-first home for the installed app; no demo counts or new API calls. */
export default function NativeHome({ heroPrimary, stats }) {
  const { t } = useI18n()
  return (
    <div className="px-4 pt-6">
      <h1 className="max-w-md text-[1.75rem] font-bold leading-tight tracking-tight text-white">{t('home_title_1')}</h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-gray-400">{t('native_home_subtitle')}</p>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Link to={heroPrimary.to} className={`flex min-h-14 items-center justify-center rounded-xl px-3 py-3 text-center text-sm font-semibold ${heroPrimary.tone} ${heroPrimary.tone.includes('text-black') ? '' : 'text-white'}`}>{heroPrimary.label}</Link>
        <Link to="/map" className="flex min-h-14 items-center justify-center gap-2 rounded-xl border border-line bg-surface-1 px-3 py-3 text-center text-sm font-medium text-white"><Map className="h-5 w-5 shrink-0" aria-hidden />{t('nav_map')}</Link>
      </div>
      <OfficialAdvisories compact />
      <Link to="/help" className="mt-5 flex items-start gap-3 rounded-2xl border border-line bg-surface-1 p-4">
        <Wrench className="mt-1 h-5 w-5 shrink-0 text-orange-400" aria-hidden />
        <div className="min-w-0 flex-1"><h2 className="font-semibold text-white">{t('help_title')}</h2><p className="mt-1 text-sm leading-relaxed text-gray-400">{t('help_subtitle')}</p></div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
      </Link>
      {stats && <div className="mt-5 grid grid-cols-2 gap-3" aria-label={t('nav_map')}>
        {[['active_alerts', 'home_stats_active'], ['critical_open', 'home_stats_critical']].map(([key, label]) => <div key={key} className="rounded-xl border border-line p-4"><p className={`text-2xl font-semibold tabular-nums ${key === 'critical_open' ? 'text-red-300' : 'text-white'}`}>{stats[key] ?? '—'}</p><p className="mt-1 text-xs leading-relaxed text-gray-400">{t(label)}</p></div>)}
      </div>}
      <div className="mt-5 divide-y divide-line rounded-2xl border border-line">
        {[{ to: '/safety', key: 'nav_safety', Icon: ShieldCheck }, { to: '/resources', key: 'nav_resources', Icon: Wrench }].map(({ to, key, Icon }) => <Link key={to} to={to} className="flex min-h-14 items-center gap-3 px-4 py-3 text-sm text-gray-200"><Icon className="h-5 w-5 text-gray-400" aria-hidden /><span className="flex-1">{t(key)}</span><ArrowRight className="h-4 w-4 text-gray-500" aria-hidden /></Link>)}
      </div>
    </div>
  )
}
