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
 * Publisher and topic metadata stay secondary to the actual headline.
 */

import { useCallback, useEffect, useState } from 'react'
import api from '../utils/api'
import { useI18n } from '../utils/i18n'
import { apiError } from '../utils/error'
import EmptyState from '../components/EmptyState'
import { Skeleton } from '../components/Skeleton'
import OfficialAdvisories from '../components/OfficialAdvisories'
import {
  Globe,
  Newspaper,
  RefreshCw,
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

function NewsCard({ item }) {
  const { t, lang } = useI18n()
  const published = new Date(item.published_at || item.published)

  return (
    <li className="surface-card min-w-0 overflow-hidden">
      <a
        href={item.link}
        target="_blank"
        rel="noreferrer"
        className="block p-4 sm:p-5 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1 text-xs text-app-muted"
          >
            {t('news_source_link')}
          </span>
          {item.topic && (
            <span
              className="rounded-full bg-surface-2 px-2 py-1 text-xs capitalize text-app-muted"
            >
              {item.topic}
            </span>
          )}
        </div>

        <h2 className="mb-2 text-base font-semibold leading-snug text-app-ink wrap-break-word">{item.title}</h2>

        {item.summary && (
          <p className="mb-4 line-clamp-2 text-sm text-app-muted leading-relaxed">{item.summary}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-app-muted">
          <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 wrap-break-word">{item.source}</span>
          {!Number.isNaN(published.getTime()) && <time dateTime={published.toISOString()}>{published.toLocaleString(lang)}</time>}
          {/*
            The domain is shown whenever it does NOT match the feed it came
            from. That mismatch is the one signal a reader can check for
            themselves, and hiding it would be hiding the reason the item
            scored lower.
          */}
          {item.domain_match === false && item.domain && (
            <span className="min-w-0 rounded border border-line px-1.5 py-0.5 text-xs text-app-ink wrap-break-word">
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
  const [source, setSource] = useState('')
  const [sources, setSources] = useState([])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get('/api/news/recent')
      setItems(data.items || [])
      setSources(data.sources || [])
    } catch (err) {
      setError(apiError(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])
  const availableSources = [...new Set(items.map(item => item.source))].sort()
  const visible = source ? items.filter(item => item.source === source) : items

  return (
    <main className="page-panel mx-auto max-w-3xl px-4 py-6 sm:py-8 sm:px-6">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-start gap-2 text-2xl font-semibold tracking-tight text-app-ink">
            <Newspaper className="h-6 w-6 shrink-0 mt-1 text-app-muted" aria-hidden />
            {t('news_title')}
          </h1>
          <p className="mt-2 text-sm text-app-muted leading-relaxed">{t('news_note')}</p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="app-secondary-button h-12 w-12 shrink-0"
          aria-label={t('news_refresh')}
        >
          <RefreshCw
            className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            aria-hidden
          />
        </button>
      </header>
      <OfficialAdvisories />
      <label className="app-form-label mb-4">
        {t('news_sources')}
        <select className="app-field mt-2 w-full" value={source} onChange={event => setSource(event.target.value)}>
          <option value="">{t('news_all_sources')}</option>
          {availableSources.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      {sources.some(item => !item.available) && <p role="status" className="mb-4 text-sm text-app-muted leading-relaxed">{t('news_feed_unavailable')}</p>}

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
          {visible.map((item) => (
            <NewsCard key={item.link} item={item} />
          ))}
        </ul>
      )}
    </main>
  )
}
