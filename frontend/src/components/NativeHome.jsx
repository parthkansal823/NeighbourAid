import { Link } from 'react-router-dom'
import { useI18n } from '../utils/i18n'
import { ArrowRight, HeartHandshake, Map, ShieldCheck, Siren, Wrench } from './icons'
import OfficialAdvisories from './OfficialAdvisories'

/** Action-first home for the installed app; no demo counts or new API calls. */
export default function NativeHome({ heroPrimary, stats }) {
  const { t } = useI18n()
  const ActionIcon = heroPrimary.to === '/volunteer' ? HeartHandshake : Siren
  return (
    <div className="native-home mx-auto max-w-2xl px-4 pb-6 pt-6 sm:px-6">
      <header className="native-home-intro">
        <h1 className="max-w-md text-2xl font-semibold leading-tight tracking-tight text-app-ink">{t('home_title_1')}</h1>
        <p className="mt-2 max-w-md text-base leading-relaxed text-app-muted">{t('native_home_subtitle')}</p>
      </header>
      <div className="native-home-actions mt-6 grid gap-3 sm:grid-cols-2">
        <Link to={heroPrimary.to} className="app-primary-button min-h-14 gap-2"><ActionIcon className="h-5 w-5 shrink-0" aria-hidden />{heroPrimary.label}<ArrowRight className="ml-auto h-5 w-5 shrink-0" aria-hidden /></Link>
        <Link to="/map" className="app-secondary-button min-h-14 gap-2"><Map className="h-5 w-5 shrink-0" aria-hidden />{t('nav_map')}<ArrowRight className="ml-auto h-5 w-5 shrink-0" aria-hidden /></Link>
      </div>
      {stats && <dl className="native-home-stats mt-6 grid grid-cols-2 gap-4 border-y border-line py-4">
        {[['active_alerts', 'home_stats_active'], ['critical_open', 'home_stats_critical']].map(([key, label]) => <div key={key}><dd className="text-2xl font-semibold tabular-nums text-app-ink">{stats[key] ?? '—'}</dd><dt className="mt-1 text-sm leading-relaxed text-app-muted">{t(label)}</dt></div>)}
      </dl>}
      <Link to="/help" className="native-home-callout mt-6 flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-4">
        <Wrench className="mt-0.5 h-5 w-5 shrink-0 text-app-muted" aria-hidden />
        <div className="min-w-0 flex-1"><h2 className="text-base font-semibold text-app-ink">{t('help_title')}</h2><p className="mt-1 text-sm leading-relaxed text-app-muted">{t('help_subtitle')}</p></div>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-app-muted" aria-hidden />
      </Link>
      <div className="native-home-links mt-4 divide-y divide-line">
        {[{ to: '/safety', key: 'nav_safety', Icon: ShieldCheck }, { to: '/resources', key: 'nav_resources', Icon: Wrench }].map(({ to, key, Icon }) => <Link key={to} to={to} className="flex min-h-16 items-center gap-3 py-3 text-base text-app-ink"><Icon className="h-5 w-5 text-app-muted" aria-hidden /><span className="flex-1">{t(key)}</span><ArrowRight className="h-4 w-4 text-app-muted" aria-hidden /></Link>)}
      </div>
      <OfficialAdvisories compact />
    </div>
  )
}
