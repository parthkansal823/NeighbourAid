import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../utils/api'
import { useI18n } from '../utils/i18n'
import { activeAdvisories, advisoryCopy, SACHET } from '../utils/advisories'

export default function OfficialAdvisories({ compact = false }) {
  const { lang } = useI18n()
  const copy = advisoryCopy(lang)
  const demo = import.meta.env.MODE === 'demo'
  const [snapshot, setSnapshot] = useState({ status: demo ? 'demo' : 'checking', items: [] })
  const [area, setArea] = useState('')
  const [clock, setClock] = useState(Date.now)
  const [retry, setRetry] = useState(0)
  const [guide, setGuide] = useState('flood')
  useEffect(() => {
    if (demo) return undefined
    let live = true
    let busy = false
    const controller = new AbortController()
    const load = async () => {
      if (busy || !navigator.onLine || document.visibilityState === 'hidden') return
      busy = true
      try {
        const { data } = await api.get('/api/advisories/', { signal: controller.signal, skipAuth: true })
        if (live) setSnapshot(data)
      } catch {
        if (live) setSnapshot(previous => ({ ...previous, status: previous.items?.length ? 'stale' : 'unavailable' }))
      } finally { busy = false }
    }
    const tick = () => { setClock(Date.now()); void load() }
    void load()
    const refresh = setInterval(tick, 120000)
    const expiry = setInterval(() => setClock(Date.now()), 10000)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('online', tick)
    return () => {
      live = false
      controller.abort()
      clearInterval(refresh)
      clearInterval(expiry)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('online', tick)
    }
  }, [demo, retry])
  const all = activeAdvisories(snapshot.items, lang, clock)
  const items = all.filter(item => item.area.toLocaleLowerCase().includes(area.trim().toLocaleLowerCase()))
  const status = demo ? 'demo' : !navigator.onLine ? 'unavailable' : snapshot.status
  const notice = status === 'available' ? null : copy[status] || copy.unavailable
  const date = raw => Number.isFinite(Date.parse(raw)) ? new Date(raw).toLocaleString(lang) : '—'

  if (compact) return <section className="surface-card mt-5 p-4" aria-label={copy.title}>
    <h2 className="font-semibold text-white">{copy.title}</h2>
    <p className="mt-1 text-sm leading-relaxed text-gray-400">{notice || (all.length ? `${all.length} · ${copy.scope}` : copy.empty)}</p>
    <Link to="/news#official-advisories" className="tap mt-2 inline-flex items-center text-sm text-orange-300 underline underline-offset-4">{copy.open}</Link>
  </section>

  return <section id="official-advisories" className="mb-8 scroll-mt-6 border-b border-line pb-6" aria-labelledby="official-title">
    <div className="flex items-start justify-between gap-3">
      <div><h2 id="official-title" className="text-xl font-semibold text-white">{copy.title}</h2><p className="mt-2 text-sm leading-relaxed text-gray-400">{copy.scope}</p></div>
      {!demo && <button type="button" onClick={() => setRetry(n => n + 1)} className="tap shrink-0 rounded-lg border border-line px-3 text-sm text-gray-200">{copy.refresh}</button>}
    </div>
    {notice && <p role="status" className="mt-3 text-sm leading-relaxed text-orange-300">{notice}</p>}
    {snapshot.partial && <p className="mt-2 text-sm text-orange-300">{copy.partial}</p>}
    {snapshot.checked_at && <p className="mt-2 text-xs text-gray-400">{copy.checked}: {date(snapshot.checked_at)}</p>}
    <a href={SACHET} target="_blank" rel="noopener noreferrer" className="tap mt-2 inline-flex items-center text-sm text-orange-300 underline underline-offset-4">NDMA SACHET</a>
    {!demo && <label className="mt-3 block text-sm text-gray-300">{copy.filter}<input value={area} onChange={event => setArea(event.target.value)} placeholder={copy.placeholder} className="tap mt-1 w-full rounded-lg border border-line bg-surface px-3" /></label>}
    {!items.length && status === 'available' && <p role="status" className="mt-4 text-sm text-gray-400">{copy.empty}</p>}
    <ul className="mt-4 space-y-4">
      {items.map(item => <li key={item.cap_identifier} className="surface-card overflow-hidden border-l-4 border-l-orange-500 p-4">
        <h3 className="break-words font-semibold leading-snug text-white">{item.headline || item.event}</h3>
        <p className="mt-2 break-words text-sm text-gray-200">{item.area}</p>
        <p className="mt-2 text-xs text-orange-300">{[item.severity, item.certainty, item.urgency].filter(Boolean).join(' · ')}</p>
        <p className="mt-2 break-words text-xs text-gray-400">{item.source} · {copy.language}: {item.language}</p>
        <dl className="mt-3 space-y-1 text-xs text-gray-400">{[['issued_at', copy.issued], ['effective_at', copy.starts], ['expires_at', copy.ends]].map(([key, label]) => <div key={key} className="flex flex-wrap gap-x-2"><dt>{label}:</dt><dd>{date(item[key])}</dd></div>)}</dl>
        <details className="mt-3 text-sm text-gray-300"><summary className="tap flex cursor-pointer items-center font-medium text-white">{copy.instruction}</summary>
          {item.description && <p lang={item.language} className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{item.description}</p>}
          <p lang={item.language} className="mt-3 whitespace-pre-wrap break-words leading-relaxed">{item.instruction || copy.missing}</p>
        </details>
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="tap mt-2 inline-flex items-center text-sm text-orange-300 underline underline-offset-4">{copy.source}</a>
      </li>)}
    </ul>
    <details className="mt-5 text-sm text-gray-300">
      <summary className="tap flex cursor-pointer items-center font-medium text-white">{copy.guidance}</summary>
      <p className="mt-2 leading-relaxed">{copy.priority}</p>
      <div className="my-3 flex gap-2">{['flood', 'lightning'].map(key => <button type="button" key={key} aria-pressed={guide === key} onClick={() => setGuide(key)} className={`tap rounded-lg border px-3 ${guide === key ? 'border-orange-500 text-orange-300' : 'border-line'}`}>{copy[key]}</button>)}</div>
      <ul className="ml-5 list-disc space-y-2 leading-relaxed">{copy[`${guide}Steps`].map(step => <li key={step}>{step}</li>)}</ul>
      <a href={`https://www.weather.gov/safety/${guide === 'flood' ? 'flood-during' : 'lightning-indoors'}`} target="_blank" rel="noopener noreferrer" className="tap mt-3 inline-flex items-center text-xs text-orange-300 underline">{copy.guideSource}</a>
    </details>
  </section>
}
