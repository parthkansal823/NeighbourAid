import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import api from '../utils/api'
import QuickSOS from '../components/QuickSOS'
import { OFFLINE_QUEUE_EVENT, listPending } from '../utils/offlineQueue'

export default function Home() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [stats, setStats] = useState(null)
  const [leaderboard, setLeaderboard] = useState([])
  const [news, setNews] = useState([])
  const [me, setMe] = useState(null)
  const [myStats, setMyStats] = useState(null)
  const [pendingOffline, setPendingOffline] = useState(0)

  useEffect(() => {
    let cancelled = false

    const refreshPending = async () => {
      if (user?.role !== 'reporter') {
        if (!cancelled) setPendingOffline(0)
        return
      }
      try {
        const rows = await listPending()
        if (!cancelled) setPendingOffline(rows.length)
      } catch {
        if (!cancelled) setPendingOffline(0)
      }
    }

    const load = async () => {
      if (document.visibilityState === 'hidden') return

      const requests = [
        api.get('/api/stats/'),
        api.get('/api/stats/leaderboard', { params: { limit: 5, days: 30 } }),
        api.get('/api/news/recent'),
        user ? api.get('/api/users/me') : Promise.resolve(null),
        user ? api.get('/api/users/me/stats') : Promise.resolve(null),
      ]

      const [statsRes, leaderboardRes, newsRes, meRes, myStatsRes] =
        await Promise.allSettled(requests)

      if (cancelled) return

      if (statsRes.status === 'fulfilled') {
        setStats(statsRes.value.data)
      }
      if (leaderboardRes.status === 'fulfilled') {
        setLeaderboard(leaderboardRes.value.data.top || [])
      }
      if (newsRes.status === 'fulfilled') {
        setNews((newsRes.value.data.items || []).slice(0, 6))
      }
      if (meRes.status === 'fulfilled' && meRes.value) {
        setMe(meRes.value.data)
      } else if (!user) {
        setMe(null)
      }
      if (myStatsRes.status === 'fulfilled' && myStatsRes.value) {
        setMyStats(myStatsRes.value.data)
      } else if (!user) {
        setMyStats(null)
      }

      await refreshPending()
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void load()
      }
    }
    const onQueueChange = (event) => {
      if (typeof event?.detail?.remaining === 'number') {
        setPendingOffline(event.detail.remaining)
      } else {
        void refreshPending()
      }
    }

    void load()
    const id = setInterval(() => void load(), 60000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener(OFFLINE_QUEUE_EVENT, onQueueChange)

    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener(OFFLINE_QUEUE_EVENT, onQueueChange)
    }
  }, [user])

  const urgencyLevels = [
    { level: 'CRITICAL', color: 'bg-red-600', example: t('urgency_example_critical') },
    { level: 'HIGH', color: 'bg-orange-500', example: t('urgency_example_high') },
    { level: 'MEDIUM', color: 'bg-yellow-500', example: t('urgency_example_medium') },
    { level: 'LOW', color: 'bg-green-600', example: t('urgency_example_low') },
  ]

  // Signed-out visitors get "Report a Crisis", not "Get Started". Reporting is
  // the reason someone lands here mid-emergency, and it no longer needs an
  // account — routing them through signup first cost minutes that matter.
  const heroPrimary = !user
    ? { to: '/post-alert', label: t('home_cta_report'), tone: 'from-red-600 to-red-700 hover:to-red-500' }
    : user.role === 'reporter'
    ? { to: '/post-alert', label: t('home_cta_report'), tone: 'from-red-600 to-red-700 hover:to-red-500' }
    : { to: '/volunteer', label: t('home_cta_volunteer'), tone: 'from-green-600 to-green-700 hover:to-green-500' }

  const contactCount = me?.emergency_contacts?.length ?? 0
  const skillCount = me?.skills?.length ?? 0
  const trustLabel = myStats?.trust?.label ?? 'new'

  const personalStats = useMemo(() => {
    if (!user || !myStats) return []
    if (user.role === 'reporter') {
      return [
        { label: 'Open alerts', value: myStats.open ?? 0, accent: 'text-red-400' },
        { label: 'Resolved', value: myStats.resolved ?? 0, accent: 'text-emerald-400' },
        { label: 'Buddy contacts', value: contactCount, accent: 'text-blue-400' },
        { label: 'Queued offline', value: pendingOffline, accent: pendingOffline > 0 ? 'text-amber-400' : 'text-gray-300' },
      ]
    }
    return [
      { label: 'Accepted', value: myStats.accepted ?? 0, accent: 'text-orange-400' },
      { label: 'In progress', value: myStats.in_progress ?? 0, accent: 'text-blue-400' },
      { label: 'Resolved', value: myStats.resolved ?? 0, accent: 'text-emerald-400' },
      { label: 'Trust', value: trustLabel, accent: 'text-violet-300' },
    ]
  }, [contactCount, myStats, pendingOffline, trustLabel, user])

  const readinessItems = useMemo(() => {
    if (!user) return []

    const items = []

    if (contactCount === 0) {
      items.push({
        title: 'Add emergency contacts',
        body: 'Unlock one-tap buddy pings from SOS, safety check-ins, and public crisis flows.',
        to: '/profile#contacts',
        cta: 'Open contacts',
      })
    }

    if (user.role === 'volunteer' && skillCount === 0) {
      items.push({
        title: 'Tell the system what you can handle',
        body: 'Skills help NeighbourAid route the right crisis to you faster.',
        to: '/profile#skills',
        cta: 'Add skills',
      })
    }

    if (user.role === 'volunteer' && me && !me.has_vehicle) {
      items.push({
        title: 'Review your travel availability',
        body: 'Mark whether you can travel so responders nearby are ranked more accurately.',
        to: '/profile#skills',
        cta: 'Update availability',
      })
    }

    if (user.role === 'reporter' && pendingOffline > 0) {
      items.push({
        title: `${pendingOffline} queued alert${pendingOffline !== 1 ? 's' : ''} waiting to send`,
        body: 'They will flush automatically on reconnect, but you can still review them right now.',
        to: '/my-alerts',
        cta: 'Review alerts',
      })
    }

    return items
  }, [contactCount, me, pendingOffline, skillCount, user])

  const hubCards = useMemo(() => {
    const base = [
      {
        title: 'Live crisis map',
        body: 'See active alerts, focus links, route guidance, and the heat overlay in one place.',
        to: '/map',
        cta: 'Open map',
        badge: stats ? `${stats.active_alerts} live` : 'Public',
        tone: 'from-blue-500/20 to-cyan-500/5 border-blue-500/30',
        chips: ['Routes', 'Focus links', 'Heatmap'],
      },
      {
        title: 'Safety board',
        body: 'Track who nearby is safe, who needs help, and use buddy pings during area-wide incidents.',
        to: '/safety',
        cta: 'View safety board',
        badge: 'Community',
        tone: 'from-emerald-500/20 to-emerald-500/5 border-emerald-500/30',
        chips: ['Check-ins', 'Need help', 'Buddy ping'],
      },
      {
        title: 'Resource board',
        body: 'Browse or pin shelters, food, water, oxygen, blood, and medical camps around you.',
        to: '/resources',
        cta: 'Browse resources',
        badge: 'Public',
        tone: 'from-amber-500/20 to-orange-500/5 border-amber-500/30',
        chips: ['Shelters', 'Food', 'Oxygen'],
      },
    ]

    if (!user) {
      return [
        ...base,
        {
          title: 'Join as a reporter',
          body: 'Post GPS alerts with offline queueing, photos, AI triage, and public share links.',
          to: '/register',
          cta: 'Create account',
          badge: 'Reporter',
          tone: 'from-red-500/20 to-red-500/5 border-red-500/30',
          chips: ['SOS', 'Offline queue', 'Share page'],
        },
        {
          title: 'Join as a volunteer',
          body: 'Get live alerts, accept tasks, publish ETA, and resolve incidents from the field.',
          to: '/register',
          cta: 'Volunteer now',
          badge: 'Volunteer',
          tone: 'from-green-500/20 to-green-500/5 border-green-500/30',
          chips: ['Live feed', 'ETA', 'Resolve'],
        },
        {
          title: 'Set up your readiness',
          body: 'Emergency numbers, language switching, and crisis tools are all designed for mobile use.',
          to: '/login',
          cta: 'Sign in',
          badge: 'Ready in minutes',
          tone: 'from-violet-500/20 to-violet-500/5 border-violet-500/30',
          chips: ['Mobile-first', 'Multilingual', 'Fast setup'],
        },
      ]
    }

    if (user.role === 'reporter') {
      return [
        {
          title: 'Reporter desk',
          body: 'Create a full alert with GPS, evidence photos, voice input, and auto-retry when offline.',
          to: '/post-alert',
          cta: 'Post an alert',
          badge: pendingOffline > 0 ? `${pendingOffline} queued` : 'Reporter',
          tone: 'from-red-500/20 to-red-500/5 border-red-500/30',
          chips: ['Voice input', 'Photos', 'AI triage'],
        },
        {
          title: 'Track my alerts',
          body: 'Watch volunteer progress, responder ETA, and the public share experience for your incidents.',
          to: '/my-alerts',
          cta: 'Open my alerts',
          badge: `${myStats?.open ?? 0} open`,
          tone: 'from-orange-500/20 to-orange-500/5 border-orange-500/30',
          chips: ['Responder ETA', 'Share links', 'Witnesses'],
        },
        ...base,
        {
          title: 'Profile and safety net',
          body: 'Keep contacts ready so SOS and check-ins can reach the right people instantly.',
          to: '/profile',
          cta: 'Open profile',
          badge: `${contactCount} contacts`,
          tone: 'from-violet-500/20 to-violet-500/5 border-violet-500/30',
          chips: ['Contacts', 'Location', 'Readiness'],
        },
      ]
    }

    return [
      {
        title: 'Volunteer command',
        body: 'Stay in the live feed, get socket-driven assignments, and keep response ETAs updated.',
        to: '/volunteer',
        cta: 'Open volunteer feed',
        badge: `${myStats?.in_progress ?? 0} active`,
        tone: 'from-green-500/20 to-green-500/5 border-green-500/30',
        chips: ['Live alerts', 'ETA', 'Resolve'],
      },
      ...base,
      {
        title: 'Improve routing accuracy',
        body: 'Keep your skills, transport, contacts, and home location tuned so the right alerts reach you first.',
        to: '/profile',
        cta: 'Open profile',
        badge: `${skillCount} skills`,
        tone: 'from-violet-500/20 to-violet-500/5 border-violet-500/30',
        chips: ['Skills', 'Vehicle', 'Contacts'],
      },
      {
        title: 'See reporter view',
        body: 'Open the public map and resource surfaces to understand what reporters and families are seeing.',
        to: '/map',
        cta: 'Review public surfaces',
        badge: 'Shared view',
        tone: 'from-slate-500/20 to-slate-500/5 border-slate-500/30',
        chips: ['Map', 'Resource board', 'Safety board'],
      },
    ]
  }, [contactCount, myStats, pendingOffline, skillCount, stats, user])

  return (
    <div className="min-h-screen bg-gray-950">
      <QuickSOS />

      <section className="relative max-w-4xl mx-auto px-4 sm:px-6 pt-10 sm:pt-20 pb-10 sm:pb-16 text-center overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-72 max-w-md rounded-full bg-orange-500/15 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-8 left-1/4 -z-10 h-40 w-40 rounded-full bg-blue-500/10 blur-3xl"
        />
        <div className="inline-flex items-center gap-2 bg-orange-500/15 text-orange-300 text-[11px] sm:text-xs font-semibold px-3 py-1 rounded-full mb-4 sm:mb-6 uppercase tracking-widest border border-orange-500/30 reveal-up">
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-400" />
          </span>
          {t('home_badge')}
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-white mb-4 sm:mb-6 leading-tight tracking-tight reveal-up stagger-1">
          {t('home_title_1')}
          <br />
          <span className="text-gradient-brand">
            {t('home_title_2')}
          </span>
        </h1>
        <p className="text-gray-400 text-base sm:text-lg max-w-2xl mx-auto mb-8 sm:mb-10 px-2 leading-relaxed reveal-up stagger-2">
          {t('home_subtitle')}
        </p>

        <div className="flex flex-col sm:flex-row flex-wrap justify-center gap-3 sm:gap-4 reveal-up stagger-3">
          <Link
            to={heroPrimary.to}
            className={`group relative overflow-hidden bg-linear-to-r ${heroPrimary.tone} text-white font-semibold px-6 sm:px-8 py-3 rounded-xl transition-all duration-300 shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]`}
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-linear-to-r from-transparent via-white/25 to-transparent skew-x-12 -translate-x-full group-hover:translate-x-[400%] transition-transform duration-700 ease-out"
            />
            <span className="relative">{heroPrimary.label}</span>
          </Link>
          <Link
            to="/map"
            className="border border-gray-700 hover:border-orange-500/60 text-gray-300 hover:text-white font-semibold px-6 sm:px-8 py-3 rounded-xl transition-all duration-300 hover:-translate-y-0.5 hover:bg-orange-500/5 active:translate-y-0 active:scale-[0.98]"
          >
            {t('home_cta_map')}
          </Link>
        </div>
      </section>

      {personalStats.length > 0 && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 -mt-4 sm:-mt-8 mb-6 reveal-up stagger-4">
          <div className="bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-2xl p-4 sm:p-5 shadow-xl shadow-black/30">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-white">
                  {user?.role === 'reporter' ? 'Reporter command center' : 'Volunteer command center'}
                </h2>
                <p className="text-sm text-gray-400">
                  Your fastest path into every workflow already in the app.
                </p>
              </div>
              <Link
                to="/profile"
                className="text-sm text-orange-300 hover:text-orange-200 underline-offset-2 hover:underline"
              >
                Tune profile
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              {personalStats.map((item, index) => (
                <StatTile
                  key={item.label}
                  value={item.value}
                  label={item.label}
                  accent={item.accent}
                  delay={index * 60}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {stats && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 mb-6 reveal-up stagger-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
            <StatTile value={stats.active_alerts} label={t('home_stats_active')} delay={0} />
            <StatTile value={stats.critical_open} label={t('home_stats_critical')} accent="text-red-400" delay={60} />
            <StatTile value={stats.last_24h} label={t('home_stats_24h')} delay={120} />
            <StatTile
              value={stats.volunteers_online ?? '-'}
              label={t('home_stats_volunteers')}
              accent="text-emerald-400"
              delay={180}
            />
          </div>
        </section>
      )}

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <div className="flex items-end justify-between gap-3 mb-4 sm:mb-6 flex-wrap">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-white">Jump into a workflow</h2>
            <p className="text-sm text-gray-400 mt-1">
              The app already has strong crisis flows - this hub makes them visible and easy to use.
            </p>
          </div>
          {user ? (
            <span className="text-xs uppercase tracking-widest text-gray-500">
              Tailored for {user.role}
            </span>
          ) : (
            <span className="text-xs uppercase tracking-widest text-gray-500">
              Public tools plus onboarding
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {hubCards.map((card, index) => (
            <FlowCard key={`${card.title}-${index}`} card={card} index={index} />
          ))}
        </div>
      </section>

      {user && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 pb-8 sm:pb-10">
          <div className="bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-2xl p-4 sm:p-5 shadow-xl shadow-black/30 reveal-up">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h2 className="text-lg font-semibold text-white">Readiness checklist</h2>
                <p className="text-sm text-gray-400">
                  These small setup tasks make the crisis flows above work better under pressure.
                </p>
              </div>
              <span className="text-xs uppercase tracking-widest text-gray-500">
                {readinessItems.length === 0 ? 'Ready' : `${readinessItems.length} action${readinessItems.length !== 1 ? 's' : ''}`}
              </span>
            </div>

            {readinessItems.length === 0 ? (
              <div className="border border-emerald-800/60 bg-emerald-950/20 rounded-xl px-4 py-3 text-sm text-emerald-200">
                Your core setup looks ready. Use the workflow cards above to report, respond, or coordinate.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {readinessItems.map((item) => (
                  <Link
                    key={item.title}
                    to={item.to}
                    className="group bg-gray-950/80 border border-gray-800 rounded-xl p-4 hover:border-orange-500/40 hover:-translate-y-0.5 transition-all duration-200"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-white">{item.title}</h3>
                      <span className="text-xs text-orange-300 group-hover:text-orange-200">
                        {item.cta}
                      </span>
                    </div>
                    <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                      {item.body}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 sm:mb-8 text-center">{t('home_how_title')}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
          {[
            { step: '1', title: t('home_how_1_title'), desc: t('home_how_1_desc') },
            { step: '2', title: t('home_how_2_title'), desc: t('home_how_2_desc') },
            { step: '3', title: t('home_how_3_title'), desc: t('home_how_3_desc') },
          ].map(({ step, title, desc }, i) => (
            <div
              key={step}
              className="group relative bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-xl p-5 sm:p-6 card-hoverable reveal-up overflow-hidden"
              style={{ animationDelay: `${100 + i * 100}ms` }}
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full bg-orange-500/0 group-hover:bg-orange-500/10 blur-2xl transition-all duration-500"
              />
              <div className="relative inline-flex items-center justify-center w-11 h-11 rounded-xl bg-linear-to-br from-orange-500/30 to-orange-500/5 text-orange-300 text-xl font-black mb-3 border border-orange-500/30 shadow-inner shadow-orange-500/10 group-hover:scale-110 transition-transform duration-300">
                {step}
              </div>
              <h3 className="relative font-semibold text-white mb-2">{title}</h3>
              <p className="relative text-gray-400 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {leaderboard.length > 0 && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-4 sm:mb-6 text-center">
            {t('home_leaderboard_title')}{' '}
            <span className="text-gray-500 text-base font-normal block sm:inline">. {t('home_leaderboard_since')}</span>
          </h2>
          <div className="bg-linear-to-b from-gray-900 to-gray-900/70 border border-gray-800 rounded-xl divide-y divide-gray-800/70 overflow-hidden shadow-lg shadow-black/30">
            {leaderboard.map((v, i) => {
              const trust = v.trust
              const trustStyle =
                trust?.label === 'trusted'
                  ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800'
                  : trust?.label === 'reliable'
                  ? 'bg-blue-900/40 text-blue-300 border-blue-800'
                  : trust?.label === 'new'
                  ? 'bg-gray-800 text-gray-300 border-gray-700'
                  : 'bg-amber-900/40 text-amber-300 border-amber-800'
              const podiumGlow =
                i === 0
                  ? 'group-hover:shadow-amber-500/20'
                  : i === 1
                  ? 'group-hover:shadow-gray-300/15'
                  : i === 2
                  ? 'group-hover:shadow-amber-700/15'
                  : ''
              return (
                <div
                  key={`${v.name}-${i}`}
                  className={`group relative flex items-center justify-between gap-3 px-4 sm:px-5 py-3 hover:bg-gray-800/40 transition-all duration-200 hover:pl-6 ${podiumGlow}`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 bottom-0 w-0.5 bg-linear-to-b from-orange-400 to-amber-300 scale-y-0 group-hover:scale-y-100 origin-top transition-transform duration-300"
                  />
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg font-black text-orange-400 w-7 text-center shrink-0 tabular-nums">
                      {['1', '2', '3'][i] ? `#${i + 1}` : `#${i + 1}`}
                    </span>
                    <span className="text-gray-200 truncate group-hover:text-white transition-colors">{v.name}</span>
                    {trust && (
                      <span
                        className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded-full border ${trustStyle} hidden sm:inline`}
                        title={`${trust.resolved}/${trust.accepted} accepted alerts resolved . trust ${trust.score}`}
                      >
                        {trust.label}
                      </span>
                    )}
                  </div>
                  <span className="text-sm text-gray-400 whitespace-nowrap tabular-nums group-hover:text-orange-300 transition-colors">
                    {v.resolved} {t('home_leaderboard_resolved')}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {news.length > 0 && (
        <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
          <h2 className="text-xl sm:text-2xl font-bold text-white mb-2 text-center">
            {t('home_news_title')}
          </h2>
          <p className="text-gray-500 text-xs sm:text-sm text-center mb-4 sm:mb-6 px-2">
            {t('home_news_subtitle')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {news.map((n) => {
              const trust = n.trust || 'unverified'
              const score = typeof n.authenticity_score === 'number' ? n.authenticity_score : null
              const trustStyle =
                trust === 'verified'
                  ? 'bg-emerald-900/50 border-emerald-700 text-emerald-300'
                  : trust === 'reputable'
                  ? 'bg-blue-900/40 border-blue-700 text-blue-300'
                  : trust === 'unverified'
                  ? 'bg-yellow-900/40 border-yellow-700 text-yellow-300'
                  : 'bg-red-900/40 border-red-700 text-red-300'
              const trustIcon =
                trust === 'verified' ? 'OK' : trust === 'reputable' ? 'OK' : 'CAUTION'
              const topic = n.topic || 'other'
              const topicColor =
                topic === 'fire'
                  ? 'bg-orange-900/40 text-orange-300 border-orange-800'
                  : topic === 'flood'
                  ? 'bg-blue-900/40 text-blue-300 border-blue-800'
                  : topic === 'earthquake'
                  ? 'bg-purple-900/40 text-purple-300 border-purple-800'
                  : topic === 'accident'
                  ? 'bg-red-900/40 text-red-300 border-red-800'
                  : topic === 'medical'
                  ? 'bg-emerald-900/40 text-emerald-300 border-emerald-800'
                  : topic === 'power'
                  ? 'bg-yellow-900/40 text-yellow-300 border-yellow-800'
                  : topic === 'missing'
                  ? 'bg-pink-900/40 text-pink-300 border-pink-800'
                  : topic === 'rescue'
                  ? 'bg-teal-900/40 text-teal-300 border-teal-800'
                  : 'bg-gray-800 text-gray-300 border-gray-700'
              return (
                <a
                  key={n.link}
                  href={n.link}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-xl p-4 block card-hoverable overflow-hidden"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-px left-1/2 h-px w-1/2 -translate-x-1/2 bg-linear-to-r from-transparent via-orange-400/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                  <div className="flex items-center gap-2 flex-wrap text-[11px] mb-2">
                    <span className={`px-1.5 py-0.5 rounded-full border uppercase font-semibold ${topicColor}`}>
                      {topic}
                    </span>
                    <span className="uppercase tracking-wider text-gray-500 truncate">
                      {n.source}
                    </span>
                    <span
                      className={`ml-auto text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${trustStyle} whitespace-nowrap flex items-center gap-1`}
                      title={
                        n.domain_match
                          ? `Link resolves to ${n.domain}`
                          : `Link points outside ${n.domain || 'source'}`
                      }
                    >
                      <span>{trustIcon}</span>
                      <span className="capitalize">{trust}</span>
                      {score != null && <span className="opacity-70 tabular-nums">. {score}</span>}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-gray-100 line-clamp-2 mb-1 group-hover:text-white transition-colors">
                    {n.title}
                  </h3>
                  {n.summary && (
                    <p className="text-xs text-gray-400 line-clamp-2">{n.summary}</p>
                  )}
                </a>
              )
            })}
          </div>
        </section>
      )}

      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10 sm:py-12">
        <h2 className="text-xl sm:text-2xl font-bold text-white mb-6 sm:mb-8 text-center">{t('home_urgency_title')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {urgencyLevels.map(({ level, color, example }, i) => (
            <div
              key={level}
              className="flex items-center gap-3 sm:gap-4 bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-xl p-3 sm:p-4 card-hoverable reveal-up"
              style={{ animationDelay: `${i * 70}ms` }}
            >
              <div
                className={`${color} text-white text-xs font-bold px-3 py-1.5 rounded-lg min-w-[80px] text-center shrink-0 shadow-md ${
                  level === 'CRITICAL' ? 'shadow-red-500/40' : level === 'HIGH' ? 'shadow-orange-500/30' : ''
                }`}
              >
                {level}
              </div>
              <p className="text-gray-300 text-sm leading-relaxed">{example}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function FlowCard({ card, index }) {
  return (
    <Link
      to={card.to}
      className={`group bg-linear-to-br ${card.tone} border rounded-2xl p-4 sm:p-5 reveal-up hover:-translate-y-1 hover:shadow-xl hover:shadow-black/30 transition-all duration-300`}
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <span className="text-[11px] uppercase tracking-widest text-gray-300">
          {card.badge}
        </span>
        <span className="text-sm text-orange-200 group-hover:text-white transition-colors">
          {card.cta}
        </span>
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{card.title}</h3>
      <p className="text-sm text-gray-300 leading-relaxed">{card.body}</p>
      <div className="flex flex-wrap gap-2 mt-4">
        {card.chips.map((chip) => (
          <span
            key={chip}
            className="text-[11px] uppercase tracking-wide px-2 py-1 rounded-full bg-black/20 border border-white/10 text-gray-200"
          >
            {chip}
          </span>
        ))}
      </div>
    </Link>
  )
}

function StatTile({ value, label, accent = 'text-orange-400', delay = 0 }) {
  return (
    <div
      className="group relative bg-linear-to-br from-gray-900/90 to-gray-900/60 backdrop-blur-sm border border-gray-800 rounded-xl py-3 px-3 sm:px-4 text-center card-hoverable overflow-hidden reveal-up"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-px h-px bg-linear-to-r from-transparent via-orange-400/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
      />
      <div className={`text-xl sm:text-2xl font-bold tabular-nums ${accent} transition-transform duration-300 group-hover:scale-110`}>
        {value}
      </div>
      <div className="text-[10px] sm:text-[11px] text-gray-500 uppercase tracking-widest mt-0.5">
        {label}
      </div>
    </div>
  )
}
