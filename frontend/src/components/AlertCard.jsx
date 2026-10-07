import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import { translateText } from '../utils/translate'
import { useToast } from './Toast'
import ShareAlert from './ShareAlert'
import NativeOverlay from './NativeOverlay'
import AutoDispatch from './AutoDispatch'
import EvidenceSummary, { evidenceFor } from './EvidenceSummary'
import { useTimeAgo } from '../hooks/useTimeAgo'
import {
  CategoryIcon,
  Clock,
  Car,
  CloudRain,
  Compass,
  Navigation,
  Dna,
  Flag,
  Globe,
  ImageIcon,
  Link2,
  MapPin,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Tag,
  Users,
  UserRoundX,
  X,
} from './icons'
import Button from './Button'

/**
 * Urgency shows as a 4px bar down the left edge, not as a tint across the
 * whole card.
 *
 * The tint was a diagonal gradient from a dark colour into near-grey, which
 * cost twice over. Contrast moved under the text — a description was
 * comfortably readable at the top-left of a CRITICAL card and marginal at
 * the bottom-right — and once four of these sat in a feed the tints blended
 * into each other, so the thing the colour existed to signal became the
 * hardest thing to compare.
 *
 * A bar is one flat block of colour at full saturation in a fixed position,
 * so urgency is legible down the edge of a scrolling list and the card body
 * keeps one predictable background behind the words.
 */
const URGENCY_BAR = {
  CRITICAL: 'bg-critical',
  HIGH: 'bg-high',
  MEDIUM: 'bg-medium',
  LOW: 'bg-low',
}

const URGENCY_BADGE = {
  CRITICAL: 'bg-critical text-white',
  HIGH: 'bg-high text-gray-950',
  MEDIUM: 'bg-medium text-gray-950',
  LOW: 'bg-low text-gray-950',
}

// Category icons live in components/icons.jsx so the card, the map pins and
// the volunteer feed can't drift apart.

function scoreBand(score, t) {
  if (score >= 70) return { label: t('card_high_conf'), color: 'text-emerald-400', bar: 'bg-emerald-500' }
  if (score >= 40) return { label: t('card_corroborated'), color: 'text-amber-400', bar: 'bg-amber-500' }
  return { label: t('card_unverified'), color: 'text-gray-400', bar: 'bg-gray-500' }
}

// Very light script-based language detection — good enough to decide
// "does this text need translation for the current user?" without shipping
// an NLP model.
function detectScript(text) {
  if (!text) return 'en'
  if (/[ऀ-ॿ]/.test(text)) return 'hi' // Devanagari
  if (/[਀-੿]/.test(text)) return 'pa' // Gurmukhi
  return 'en'
}

function TranslatableText({ text, sourceLang }) {
  const { lang, autoTranslate } = useI18n()
  const [translated, setTranslated] = useState(null)
  const [showing, setShowing] = useState(false)
  const [loading, setLoading] = useState(false)

  const detected = useMemo(() => sourceLang || detectScript(text), [text, sourceLang])
  const needsTranslation = detected !== lang && !!text?.trim()

  // Auto-translate on mount when the detected source differs from the
  // user's chosen language. Respects the autoTranslate pref so users on
  // limited data can leave it off.
  useEffect(() => {
    let cancelled = false
    if (!autoTranslate || !needsTranslation) return undefined
    setLoading(true)
    translateText(text, lang, sourceLang)
      .then((out) => {
        if (cancelled) return
        if (out && out !== text) {
          setTranslated(out)
          setShowing(true)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // `sourceLang` is listed even though `needsTranslation` already derives
    // from it — the rule cannot see through that, and CI runs eslint with
    // --max-warnings 0, so an unlisted dependency fails the build.
  }, [text, lang, sourceLang, autoTranslate, needsTranslation])

  const toggle = async () => {
    if (showing) {
      setShowing(false)
      return
    }
    if (translated == null) {
      setLoading(true)
      try {
        const out = await translateText(text, lang, sourceLang)
        setTranslated(out)
      } finally {
        setLoading(false)
      }
    }
    setShowing(true)
  }

  const display = showing && translated != null ? translated : text
  const canTranslate = !!text && text.trim().length > 0

  return (
    <div>
      <p className="text-gray-200 text-sm whitespace-pre-wrap wrap-break-word">{display}</p>
      {canTranslate && (
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          className="text-[11px] text-blue-300 hover:text-blue-200 mt-1 disabled:opacity-50 inline-flex items-center gap-1"
          title={showing ? 'Show original' : `Translate to ${lang.toUpperCase()}`}
        >
          <Globe className="h-3 w-3" aria-hidden />
          {loading
            ? 'translating…'
            : showing
            ? `Show original (${detected.toUpperCase()})`
            : `Translate to ${lang.toUpperCase()}`}
        </button>
      )}
    </div>
  )
}

function PhotoGallery({ alertId, photoCount, inlinePhotos }) {
  const [photos, setPhotos] = useState(inlinePhotos || [])
  const [loadedFor, setLoadedFor] = useState(inlinePhotos?.length ? alertId : null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState('')

  // Lazy-load photos the first time the user shows interest. Alert lists
  // never ship photo base64 (would balloon payloads), so we fetch on demand.
  const fetchIfNeeded = useCallback(async () => {
    if (loadedFor === alertId) return
    setLoading(true)
    setError('')
    try {
      const { data } = await api.get(`/api/alerts/${alertId}/photos`)
      setPhotos(data?.photos || [])
      setLoadedFor(alertId)
    } catch (err) {
      setError(apiError(err, 'Could not load photos'))
    } finally {
      setLoading(false)
    }
  }, [alertId, loadedFor])

  if (!photoCount) return null

  if (loadedFor !== alertId) {
    return (
      <button
        type="button"
        onClick={fetchIfNeeded}
        disabled={loading}
        className="mb-3 w-full text-xs bg-gray-900/60 hover:bg-gray-900 border border-gray-700 text-gray-300 rounded-lg py-2 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-1.5"
      >
        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
        {loading
          ? 'Loading photos…'
          : `View ${photoCount} photo${photoCount !== 1 ? 's' : ''}`}
      </button>
    )
  }

  if (error) {
    return <p className="text-xs text-red-400 mb-3">{error}</p>
  }

  if (photos.length === 0) return null

  return (
    <>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {photos.slice(0, 3).map((src, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setOpen(i)}
            className="aspect-square rounded-lg overflow-hidden border border-gray-700 bg-gray-800 group relative"
            aria-label={`Open photo ${i + 1}`}
          >
            <img
              src={src}
              alt={`evidence ${i + 1}`}
              loading="lazy"
              className="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
            />
          </button>
        ))}
      </div>
      {open != null && (<NativeOverlay>
        <div
          className="fixed inset-0 z-1050 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
        >
          <img
            src={photos[open]}
            alt={`evidence ${open + 1}`}
            className="max-w-full max-h-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setOpen(null)}
            className="absolute top-4 right-4 bg-black/70 hover:bg-black text-white w-10 h-10 rounded-full flex items-center justify-center"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
          {photos.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen((i) => (i - 1 + photos.length) % photos.length)
                }}
                className="absolute left-4 bg-black/70 hover:bg-black text-white w-10 h-10 rounded-full"
                aria-label="Previous"
              >
                ‹
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen((i) => (i + 1) % photos.length)
                }}
                className="absolute right-4 bg-black/70 hover:bg-black text-white w-10 h-10 rounded-full"
                aria-label="Next"
              >
                ›
              </button>
            </>
          )}
        </div>
      </NativeOverlay>)}
    </>
  )
}

function EtaStrip({ alert, onUpdate, canEdit }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(alert.eta_minutes ?? ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    const n = parseInt(value, 10)
    if (Number.isNaN(n) || n < 0 || n > 240) {
      setError('Enter 0–240 minutes')
      return
    }
    setSaving(true)
    setError('')
    try {
      const { data } = await api.patch(`/api/alerts/${alert.id}/eta`, {
        eta_minutes: n,
      })
      onUpdate?.(data)
      setEditing(false)
    } catch (err) {
      setError(apiError(err, 'Could not set ETA'))
    } finally {
      setSaving(false)
    }
  }

  if (alert.eta_minutes == null && !canEdit) return null

  return (
    <div className="mt-2 mb-3 bg-blue-950/40 border border-blue-800 rounded-lg px-3 py-2 text-xs text-blue-200 flex items-center gap-2 flex-wrap">
      <Car className="h-4 w-4 shrink-0" aria-hidden />
      {editing ? (
        <>
          <input
            type="number"
            min={0}
            max={240}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="bg-gray-900 border border-blue-700 text-blue-100 w-20 px-2 py-1 rounded-md text-xs"
          />
          <span>minutes</span>
          <button
            onClick={submit}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded-md text-xs disabled:opacity-60"
          >
            {saving ? '…' : 'Save'}
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setError('')
            }}
            className="text-blue-300 hover:text-white px-2 py-1 text-xs"
          >
            Cancel
          </button>
          {error && <span className="text-red-300 text-[11px] w-full">{error}</span>}
        </>
      ) : (
        <>
          {alert.eta_minutes != null ? (
            <span>
              ETA: <strong className="text-blue-100">{alert.eta_minutes} min</strong>
            </span>
          ) : (
            <span className="text-blue-300">No ETA posted yet</span>
          )}
          {canEdit && (
            <button
              onClick={() => {
                setValue(String(alert.eta_minutes ?? ''))
                setEditing(true)
              }}
              className="ml-auto text-xs underline hover:text-white"
            >
              {alert.eta_minutes != null ? 'Update' : 'Set ETA'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// Categories the backend maps to no resource kind at all. Checked here so a
// missing-person card never fires a request that can only ever return [];
// the server has the same list and is the authority — this is a round trip
// saved, not a second source of truth.
const NO_RESOURCE_MATCH = new Set(['missing', 'violence', 'animal', 'power', 'other'])

/**
 * Pinned resources that would actually help this alert.
 *
 * The data for both halves has been in the app for a long time and never
 * met: someone pins an oxygen cylinder, someone else reports that a person
 * cannot breathe, and the two show on different screens.
 *
 * Renders nothing at all when there is no match — an empty "Nearby
 * resources" heading on a card in an emergency is worse than no heading.
 */
function MatchingResources({ alertId, category }) {
  const { t } = useI18n()
  const [rows, setRows] = useState([])

  useEffect(() => {
    if (!alertId || NO_RESOURCE_MATCH.has(category)) return
    let cancelled = false
    api
      .get(`/api/alerts/${alertId}/resources`)
      .then(({ data }) => {
        if (!cancelled) setRows(data.resources || [])
      })
      // Silent. This decorates a card; a failed decoration must not put an
      // error where a volunteer is looking for an address.
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [alertId, category])

  if (!rows.length) return null

  return (
    <div className="mt-3 rounded-lg border border-teal-500/30 bg-teal-500/5 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-teal-300">
        {t('match_title')}
      </p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-gray-200">
              {r.name}
              <span className="ml-1.5 text-[11px] uppercase tracking-wider text-teal-400/80">
                {t(`res_kind_${r.kind}`) ?? r.kind}
              </span>
            </span>
            {r.contact && (
              <a
                href={`tel:${r.contact}`}
                className="tap shrink-0 rounded-full bg-teal-600 px-2.5 text-[11px] text-white transition-colors hover:bg-teal-500"
              >
                {t('responder_call')}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function AlertCard({ alert, onUpdate }) {
  const { user } = useAuth()
  const { t } = useI18n()
  const { push: toast } = useToast()
  const [loading, setLoading] = useState(null)
  const [error, setError] = useState('')
  const [showUpdates, setShowUpdates] = useState(false)
  const [updates, setUpdates] = useState([])
  const [newUpdate, setNewUpdate] = useState('')
  const [loadingUpdates, setLoadingUpdates] = useState(false)
  const [updatesLoaded, setUpdatesLoaded] = useState(false)
  const [updatesError, setUpdatesError] = useState('')
  const [updateError, setUpdateError] = useState('')
  const [flagged, setFlagged] = useState(false)
  const updatesPanelId = useId()
  const updateComposerId = useId()

  const createdAgo = useTimeAgo(alert.created_at)

  const fetchUpdates = useCallback(async () => {
    setLoadingUpdates(true)
    setUpdatesError('')
    try {
      const { data } = await api.get(`/api/alerts/${alert.id}/updates`)
      setUpdates(Array.isArray(data) ? data : [])
      setUpdatesLoaded(true)
    } catch (err) {
      setUpdatesError(apiError(err, t('card_update_failed')))
    } finally {
      setLoadingUpdates(false)
    }
  }, [alert.id, t])

  useEffect(() => {
    if (showUpdates) fetchUpdates()
  }, [showUpdates, fetchUpdates])

  const postUpdate = async (event) => {
    event.preventDefault()
    const body = newUpdate.trim()
    if (body.length < 3) {
      setUpdateError(t('card_update_too_short'))
      return
    }
    setLoading('post')
    setUpdateError('')
    try {
      const { data } = await api.post(`/api/alerts/${alert.id}/updates`, { body })
      setUpdates((prev) => [data, ...prev])
      setUpdatesLoaded(true)
      setNewUpdate('')
    } catch (err) {
      setUpdateError(apiError(err, t('card_update_failed')))
    } finally {
      setLoading(null)
    }
  }

  const run = async (key, fn) => {
    setLoading(key)
    setError('')
    try {
      const { data } = await fn()
      onUpdate?.(data)
    } catch (err) {
      setError(apiError(err, `Failed to ${key}`))
    } finally {
      setLoading(null)
    }
  }

  const accept = () => run('accept', () => api.patch(`/api/alerts/${alert.id}/accept`))
  const resolve = () => run('resolve', () => api.patch(`/api/alerts/${alert.id}/resolve`))
  const witness = () => run('witness', () => api.post(`/api/alerts/${alert.id}/witness`))

  const flag = async () => {
    if (flagged) return
    if (!window.confirm('Flag this alert as fake or spam?')) return
    setLoading('flag')
    try {
      const { data } = await api.post(`/api/alerts/${alert.id}/flag`)
      setFlagged(true)
      toast({
        variant: 'info',
        title: 'Flagged',
        body: `Thanks — current flag count: ${data.flags}`,
      })
    } catch (err) {
      setError(apiError(err, 'Failed to flag alert'))
    } finally {
      setLoading(null)
    }
  }

  const score = Math.max(0, Math.min(100, Number(alert.verified_score) || 0))
  const band = scoreBand(score, t)
  const witnesses = evidenceFor(alert).witnesses
  const isOwn = user?.id && alert.reporter_id === user.id
  const [lng, lat] = alert.location?.coordinates ?? [0, 0]
  const mapsUrl = `/map?dest=${lat},${lng}&focus=${alert.id}`
  // Turn-by-turn in whatever maps app the volunteer already uses.
  //
  // The in-app map above shows WHERE the alert is; it cannot route anyone
  // there. A volunteer who accepts an alert needs actual navigation, and
  // until now the only way to get it was to copy coordinates out by hand —
  // on a phone, mid-emergency.
  //
  // The universal Google Maps URL is deliberate: it opens the installed app
  // on Android and iOS and falls back to the browser on desktop, needs no
  // API key, and costs nothing. A `geo:` URI would be more neutral but does
  // nothing on desktop and is unreliable on iOS.
  //
  // Routed by coordinates, never by the address string — the coordinates are
  // exact and the address is a best-effort label that is sometimes just a
  // town name.
  const navigateUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`

  const canSetEta =
    user?.role === 'volunteer' &&
    alert.status === 'accepted' &&
    alert.accepted_by === user.id
  const isAcceptedByMe = user?.role === 'volunteer' && alert.accepted_by === user?.id

  const isSkillMatch = alert.is_skill_match === true
  const photoCount = alert.photo_count ?? (alert.photos?.length ?? 0)
  const latestFirstUpdates = useMemo(() => [...updates].sort((a, b) => {
    const aTime = Date.parse(a?.created_at) || 0
    const bTime = Date.parse(b?.created_at) || 0
    return bTime - aTime
  }), [updates])
  const canPostUpdate = newUpdate.trim().length >= 3 && loading !== 'post'

  return (
    <div
      className={`surface-card alert-enter relative overflow-hidden p-4 pl-5 sm:p-5 sm:pl-6 ${
        isSkillMatch ? 'ring-1 ring-accent/50' : ''
      }`}
    >
      {/* The urgency bar. aria-hidden because the badge below states the
          urgency in words — this is the same information for the eye, and
          announcing it twice is noise on a screen reader. */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 ${URGENCY_BAR[alert.urgency] ?? 'bg-gray-600'}`}
      />
      {/* A full-width bar, not a pill beside the others. Every other badge
          here modifies how urgent the alert is; this one says the alert is
          not real, and someone scanning a feed at speed has to register
          that before anything else on the card. */}
      {alert.is_drill && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-blue-500/50 bg-blue-500/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-blue-300">
          <span aria-hidden>▲</span>
          <span>{t('drill_badge')}</span>
        </div>
      )}
      {isSkillMatch && (
        <div className="mb-2 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest bg-accent-soft text-accent border border-accent/40 px-2 py-0.5 rounded-full">
          <Sparkles className="h-3 w-3 animate-pulse" aria-hidden /> Matches your skills
        </div>
      )}
      {alert.is_anonymous && (
        <div className="mb-2 ml-1 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest bg-gray-800/80 text-gray-300 border border-gray-700 px-2 py-0.5 rounded-full">
          <UserRoundX className="h-3 w-3" aria-hidden /> Anonymous tip
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <CategoryIcon
            category={alert.category}
            className="h-5 w-5 shrink-0 transition-transform duration-200 hover:scale-110"
          />
          <span className="font-semibold capitalize text-white truncate">
            {t(`cat_${alert.category}`) ?? alert.category}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${URGENCY_BADGE[alert.urgency]} ${alert.urgency === 'CRITICAL' ? 'glow-red' : ''}`}>
            {alert.urgency}
          </span>
          {/* Minutes, with the distance as the secondary figure. "4.2 km"
              tells a volunteer nothing about whether they are the right
              person to go — a 4.2 km walk is 78 minutes. "78 min" is the
              number they can act on. See backend services/dispatch.py. */}
          {typeof alert.your_eta_minutes === 'number' ? (
            <span
              className="text-[11px] text-gray-300 bg-surface-2 border border-line px-2 py-0.5 rounded-full tabular-nums"
              title={
                typeof alert.your_distance_km === 'number'
                  ? `${alert.your_distance_km.toFixed(1)} km away`
                  : undefined
              }
            >
              ~{alert.your_eta_minutes} {t('card_min_away')}
            </span>
          ) : (
            typeof alert.your_distance_km === 'number' && (
              <span className="text-[11px] text-gray-400 bg-surface-2 border border-line px-2 py-0.5 rounded-full">
                {alert.your_distance_km.toFixed(1)} km
              </span>
            )
          )}
          <span className="text-xs text-gray-400 whitespace-nowrap tabular-nums">{createdAgo}</span>
        </div>
      </div>

      <div className="mb-3">
        <TranslatableText text={alert.description} sourceLang={alert.language} />
      </div>

      {/*
        Coordinates drive the nearby-hospital lookup inside AutoDispatch.
        GeoJSON order is [lng, lat] — swapping them here would not error, it
        would quietly list hospitals from somewhere else entirely.
      */}
      {(alert.urgency === 'CRITICAL' || alert.urgency === 'HIGH') && (
        <AutoDispatch
          category={alert.category}
          lat={alert.location?.coordinates?.[1]}
          lng={alert.location?.coordinates?.[0]}
        />
      )}

      <PhotoGallery
        alertId={alert.id}
        photoCount={photoCount}
        inlinePhotos={alert.photos}
      />

      {alert.address && (
        <p className="text-gray-500 text-xs mb-3 flex items-start gap-1">
          <MapPin className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
          <span className="line-clamp-2">{alert.address}</span>
        </p>
      )}

      <EtaStrip alert={alert} onUpdate={onUpdate} canEdit={canSetEta} />

      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 text-[11px] mb-3">
        {alert.photo_evidence_score > 0 && (
          <span
            className="bg-emerald-900/50 border border-emerald-700 text-emerald-200 px-2 py-0.5 rounded-full inline-flex items-center gap-1"
            title={t('evidence_attachment')}
          >
            <ImageIcon className="h-3 w-3" aria-hidden />
            {t('evidence_photos')}
          </span>
        )}
        {alert.vulnerability && (
          <span
            className="bg-pink-900/50 border border-pink-700 text-pink-200 px-2 py-0.5 rounded-full capitalize inline-flex items-center gap-1"
          >
            <Dna className="h-3 w-3" aria-hidden />
            {alert.vulnerability}
          </span>
        )}
        {alert.time_sensitivity && (
          <span
            className={`border px-2 py-0.5 rounded-full capitalize inline-flex items-center gap-1 ${
              alert.time_sensitivity === 'immediate'
                ? 'bg-red-900/50 border-red-700 text-red-200'
                : 'bg-gray-900/60 border-gray-800 text-gray-300'
            }`}
          >
            <Clock className="h-3 w-3" aria-hidden />
            {alert.time_sensitivity}
          </span>
        )}
        {alert.language && alert.language !== 'en' && (
          <span
            className="bg-blue-900/40 border border-blue-800 text-blue-200 px-2 py-0.5 rounded-full uppercase"
          >
            {alert.language}
          </span>
        )}
        {alert.triggers?.length ? (
          <span
            className="bg-gray-900/60 border border-gray-800 text-gray-400 px-2 py-0.5 rounded-full inline-flex items-center gap-1"
          >
            <Tag className="h-3 w-3" aria-hidden />
            {alert.triggers.join(', ')}
          </span>
        ) : null}
      </div>

      <div className="bg-gray-900/60 border border-gray-800 rounded-lg px-3 py-2 mb-3 backdrop-blur-xs">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className={`font-semibold ${band.color}`}>{band.label}</span>
          <span className="text-gray-500 tabular-nums">{score}/100</span>
        </div>
        <div className="w-full h-1.5 bg-gray-800/80 rounded-full overflow-hidden">
          <div
            className={`h-full ${band.bar} transition-[width] duration-700 ease-out`}
            style={{ width: `${score}%` }}
          />
        </div>
        <EvidenceSummary alert={alert} />
        <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-gray-400">
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" aria-hidden />
            {witnesses} {witnesses !== 1 ? t('card_witness_many') : t('card_witness_one')}
          </span>
          {alert.corroborating_ids?.length ? (
            <span className="inline-flex items-center gap-1">
              <Link2 className="h-3 w-3" aria-hidden />
              {alert.corroborating_ids.length} {t('card_similar_nearby')}
            </span>
          ) : null}
          {alert.weather_match ? (
            <span className="inline-flex items-center gap-1" title="Live weather consistent">
              <CloudRain className="h-3 w-3" aria-hidden />
              {t('card_weather_match')}
            </span>
          ) : null}
          {alert.flags > 0 && (
            <span className="text-red-300 inline-flex items-center gap-1" title="Flagged by community">
              <Flag className="h-3 w-3" aria-hidden />
              {alert.flags}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span
          className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 capitalize border ${
            alert.status === 'open'
              ? 'bg-blue-900/60 text-blue-300 border-blue-800/60'
              : alert.status === 'accepted'
              ? 'bg-purple-900/60 text-purple-300 border-purple-800/60'
              : 'bg-gray-800/80 text-gray-400 border-gray-700/60'
          }`}
        >
          <span
            className={`inline-block w-1.5 h-1.5 rounded-full ${
              alert.status === 'open'
                ? 'bg-blue-400 animate-pulse'
                : alert.status === 'accepted'
                ? 'bg-purple-400 animate-pulse'
                : 'bg-gray-500'
            }`}
          />
          {alert.status}
        </span>

        <div className="flex gap-1.5 sm:gap-2 flex-wrap justify-end">
          {user && (
            <button
              type="button"
              onClick={() => setShowUpdates((v) => !v)}
              aria-expanded={showUpdates}
              aria-controls={updatesPanelId}
              className={`tap inline-flex items-center gap-1.5 rounded-xl border px-3 text-xs font-medium transition-colors ${
                showUpdates
                  ? 'border-orange-500/60 bg-orange-500/10 text-orange-200'
                  : 'border-line bg-surface-2 text-gray-200 hover:border-orange-500/50 hover:text-white'
              }`}
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              <span>{t('card_updates')}</span>
              {updatesLoaded && <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[10px] tabular-nums">{updates.length}</span>}
            </button>
          )}
          <ShareAlert alert={alert} />
          <Link
            to={mapsUrl}
            className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg transition-colors hover:bg-gray-800/60 inline-flex items-center gap-1"
            title="Open in NeighbourAid map"
          >
            <Compass className="h-3.5 w-3.5" aria-hidden />
            {t('card_directions')}
          </Link>
          {/*
            Styled brighter than the surrounding links because for a
            responding volunteer this is the action, not a detail. rel
            includes noopener: target=_blank without it hands the opened page
            a reference back to this window.
          */}
          <a
            href={navigateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-300 hover:text-emerald-200 px-2 py-1 rounded-lg transition-colors hover:bg-emerald-500/10 inline-flex items-center gap-1"
            title={t('card_navigate_tip')}
          >
            <Navigation className="h-3.5 w-3.5" aria-hidden />
            {t('card_navigate')}
          </a>
          {user && !isOwn && !flagged && (
            <button
              onClick={flag}
              disabled={loading === 'flag'}
              className="text-xs text-gray-500 hover:text-red-400 px-2 py-1 rounded-lg transition-colors inline-flex items-center gap-1"
              title="Flag as fake or spam"
            >
              <Flag className="h-3.5 w-3.5" aria-hidden />
              Flag
            </button>
          )}
          {user && !isOwn && alert.status !== 'resolved' && (
            <Button
              size="sm"
              variant="outline"
              onClick={witness}
              loading={loading === 'witness'}
              title={t('card_see_too_tip')}
            >
              {t('card_see_too')}
            </Button>
          )}
          {user?.role === 'volunteer' && alert.status === 'open' && (
            <Button
              size="sm"
              onClick={accept}
              loading={loading === 'accept'}
            >
              {t('card_accept')}
            </Button>
          )}
          {isAcceptedByMe && alert.status === 'accepted' && (
            <Button
              size="sm"
              variant="success"
              onClick={resolve}
              loading={loading === 'resolve'}
            >
              {t('card_resolve')}
            </Button>
          )}
        </div>
      </div>

      <MatchingResources alertId={alert.id} category={alert.category} />

      {showUpdates && (
        <section id={updatesPanelId} aria-label={t('card_updates')} className="mt-4 rounded-2xl border border-line bg-black/20 p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-500/10 text-orange-300">
                <MessageCircle className="h-4 w-4" aria-hidden />
              </div>
              <h3 className="text-sm font-semibold text-white">{t('card_updates')}</h3>
            </div>
            <button
              type="button"
              onClick={() => { void fetchUpdates() }}
              disabled={loadingUpdates}
              className="tap inline-flex shrink-0 items-center justify-center rounded-xl text-gray-300 transition-colors hover:bg-surface-2 hover:text-white disabled:opacity-50"
              aria-label={t('card_updates')}
            >
              <RefreshCw className={`h-4 w-4 ${loadingUpdates ? 'animate-spin' : ''}`} aria-hidden />
            </button>
          </div>
          {loadingUpdates ? (
            <p role="status" className="py-2 text-xs text-gray-400">{t('card_loading_updates')}</p>
          ) : updatesError ? (
            <div role="alert" className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-200">
              {updatesError}
            </div>
          ) : latestFirstUpdates.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-3 py-3 text-xs leading-relaxed text-gray-400">{t('card_no_updates')}</p>
          ) : (
            <ol className="ml-2 space-y-3 border-l border-line pl-4" aria-live="polite">
              {latestFirstUpdates.map((u, index) => (
                <UpdateRow key={u.id} update={u} latest={index === 0} />
              ))}
            </ol>
          )}
          {user && alert.status !== 'resolved' && (
            <form onSubmit={postUpdate} className="mt-4 border-t border-line pt-3">
              <label htmlFor={updateComposerId} className="sr-only">{t('card_update_ph')}</label>
              <textarea
                id={updateComposerId}
                value={newUpdate}
                onChange={(e) => { setNewUpdate(e.target.value); if (updateError) setUpdateError('') }}
                placeholder={t('card_update_ph')}
                maxLength={500}
                rows={3}
                aria-invalid={Boolean(updateError)}
                aria-describedby={`${updateComposerId}-count${updateError ? ` ${updateComposerId}-error` : ''}`}
                className="min-h-24 w-full resize-y rounded-xl border border-line bg-gray-950 px-3 py-2.5 text-sm leading-relaxed text-gray-100 placeholder:text-gray-500 focus:outline-hidden focus:border-orange-500"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <output id={`${updateComposerId}-count`} className="text-xs tabular-nums text-gray-500">{newUpdate.length}/500</output>
                <button
                  type="submit"
                  disabled={!canPostUpdate}
                  aria-busy={loading === 'post'}
                  className="tap inline-flex items-center justify-center gap-1.5 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-black transition-colors hover:bg-orange-400 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Send className="h-4 w-4" aria-hidden />
                  <span>{loading === 'post' ? '…' : t('card_send')}</span>
                </button>
              </div>
              {updateError && <p id={`${updateComposerId}-error`} role="alert" className="mt-2 text-xs leading-relaxed text-red-300">{updateError}</p>}
            </form>
          )}
        </section>
      )}

      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </div>
  )
}

function UpdateRow({ update, latest }) {
  const updateAgo = useTimeAgo(update.created_at)
  return (
    <li className="relative text-xs">
      <span aria-hidden className={`absolute -left-[1.34rem] top-3 h-2.5 w-2.5 rounded-full border-2 border-surface-1 ${latest ? 'bg-orange-400' : 'bg-gray-600'}`} />
      <article className="rounded-xl border border-line bg-gray-950 px-3 py-2.5">
        <div className="mb-1.5 flex items-start justify-between gap-2 text-gray-500">
          <div className="min-w-0">
            <span className="block truncate font-medium text-gray-200">{update.author_name}</span>
            {update.author_role && <span className="mt-0.5 inline-flex rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] capitalize text-gray-400">{update.author_role}</span>}
          </div>
          <span className="shrink-0 whitespace-nowrap pt-0.5">{updateAgo}</span>
        </div>
        <TranslatableText text={update.body} />
      </article>
    </li>
  )
}
