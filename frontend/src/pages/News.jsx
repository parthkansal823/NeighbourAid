/**
 * Crisis news, as its own page.
 *
 * This used to be a section near the bottom of Home, capped at six items,
 * below the stats, the actions and the leaderboard. Two things were wrong
 * with that: nobody scrolled to it, and the cap was arbitrary — the feed
 * routinely carries more than six items and there was no way to see them.
 *
 * It also does not belong on Home. Home answers "what do I do now"; this
 * answers "what is happening", which is a different question asked in a
 * different mood, and mixing them made both harder to scan.
 *
 * The trust and topic chips were inline ternary chains — eight `? :` arms
 * each, repeated per card. They are lookup tables here, so adding a topic is
 * one line instead of an edit inside an expression.
 */

import { useCallback, useEffect, useState } from 'react'
import api from '../utils/api'
import { useI18n } from '../utils/i18n'
import { apiError } from '../utils/error'
import EmptyState from '../components/EmptyState'
import { Skeleton } from '../components/Skeleton'
import {
  BadgeCheck,
  Globe,
  Newspaper,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
} from '../components/icons'

/**
 * How much to believe it.
 *
 * The backend scores each item from the publisher's reputation and whether
 * the link's domain matches the feed it arrived on (`domain_match`) — a
 * mismatch is the usual signature of a syndicated or spoofed item. Showing
 * that judgement matters more here than in most news UIs: during a crisis,
 * a plausible-looking false report spreads faster than the correction.
 */
const TRUST = {
  verified: { cls: 'border-low/40 bg-low/10 text-low', Icon: BadgeCheck },
  reputable: { cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300', Icon: BadgeCheck },
  unverified: { cls: 'border-medium/40 bg-medium/10 text-medium', Icon: TriangleAlert },
  suspicious: { cls: 'border-critical/40 bg-critical/10 text-critical', Icon: ShieldAlert },
}

const TOPIC = {
  fire: 'border-high/40 text-high',
  flood: 'border-sky-500/40 text-sky-300',
  earthquake: 'border-purple-500/40 text-purple-300',
  accident: 'border-critical/40 text-critical',
  medical: 'border-low/40 text-low',
  power: 'border-medium/40 text-medium',
  missing: 'border-pink-500/40 text-pink-300',
  rescue: 'border-cyan-500/40 text-cyan-300',
  other: 'border-line text-gray-400',
}

function NewsCard({ item }) {
  const trust = TRUST[item.trust] ?? TRUST.unverified
  const TrustIcon = trust.Icon
  const topicCls = TOPIC[item.topic] ?? TOPIC.other

  return (
    <li className="surface-card alert-enter press-in overflow-hidden">
      <a
        href={item.link}
        target="_blank"
        rel="noreferrer"
        className="block p-4 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${trust.cls}`}
          >
            <TrustIcon className="h-3 w-3" aria-hidden />
            {item.trust}
            {typeof item.authenticity_score === 'number' && (
              <span className="tabular-nums opacity-70">{item.authenticity_score}</span>
            )}
          </span>
          {item.topic && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${topicCls}`}
            >
              {item.topic}
            </span>
          )}
        </div>

        <h2 className="mb-1 font-semibold leading-snug text-white">{item.title}</h2>

        {item.summary && (
          <p className="mb-3 line-clamp-2 text-sm text-gray-400">{item.summary}</p>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{item.source}</span>
          {/*
            The domain is shown whenever it does NOT match the feed it came
            from. That mismatch is the one signal a reader can check for
            themselves, and hiding it would be hiding the reason the item
            scored lower.
          */}
          {item.domain_match === false && item.domain && (
            <span className="shrink-0 rounded border border-medium/40 px-1.5 text-[10px] text-medium">
              {item.domain}
            </span>
          )}
        </div>
      </a>
    </li>
  )
}

export default function News() {
  const { t } = useI18n()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/news/recent')
      setItems(data.items || [])
    } catch (err) {
      setError(apiError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-white">
            <Newspaper className="h-6 w-6 text-accent" aria-hidden />
            {t('news_title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500">{t('news_subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="tap press-in inline-flex items-center justify-center rounded-xl border border-line text-gray-300 hover:bg-surface-2 hover:text-white disabled:opacity-50"
          aria-label={t('news_refresh')}
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            aria-hidden
          />
        </button>
      </header>

      {loading && !items.length ? (
        <ul className="space-y-3" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="surface-card p-4">
              <Skeleton className="mb-2 h-3 w-24" />
              <Skeleton className="mb-2 h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </li>
          ))}
        </ul>
      ) : error ? (
        <EmptyState title={t('news_error')} body={error} />
      ) : !items.length ? (
        <EmptyState title={t('news_empty')} body={t('news_empty_body')} />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <NewsCard key={item.link} item={item} />
          ))}
        </ul>
      )}
    </main>
  )
}
