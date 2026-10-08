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
import { useDialog } from '../hooks/useDialog'
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
import HelpRelay from './HelpRelay'
import OutcomeSummary from './OutcomeSummary'
import useTextFirst from '../hooks/useTextFirst'

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
  CRITICAL: 'bg-red-700 text-[#fff]',
  HIGH: 'bg-high text-[#172033]',
  MEDIUM: 'bg-medium text-[#172033]',
  LOW: 'bg-low text-[#172033]',
}

// Category icons live in components/icons.jsx so the card, the map pins and
// the volunteer feed can't drift apart.

function scoreBand(score, t) {
  if (score >= 70) return { label: t('card_high_conf'), color: 'text-app-ink', bar: 'bg-emerald-600' }
  if (score >= 40) return { label: t('card_corroborated'), color: 'text-app-ink', bar: 'bg-amber-600' }
  return { label: t('card_unverified'), color: 'text-app-muted', bar: 'bg-gray-500' }
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
  const textFirst = useTextFirst()
  // A translation belongs to exactly one source/reader-language identity.
  // Remount on preference changes too: cancelled auto work must not leave a
  // spinner stuck or render an old result after consent/text-first changes.
  return <TranslationPanel key={JSON.stringify([text, sourceLang, lang, autoTranslate, textFirst])} text={text} sourceLang={sourceLang} lang={lang} autoTranslate={autoTranslate} textFirst={textFirst} />
}

function TranslationPanel({ text, sourceLang, lang, autoTranslate, textFirst }) {
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
    if (!autoTranslate || textFirst || !needsTranslation) return undefined
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
  }, [text, lang, sourceLang, autoTranslate, needsTranslation, textFirst])

  const toggle = async () => {
    if (showing) {
      setShowing(false)
      return
    }
    if (translated == null) {
      if (!autoTranslate && !window.confirm('Translate this report? If on-device translation is unavailable, this text is sent to Google. Translations can be wrong and are not medical instructions.')) return
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
  const canTranslate = needsTranslation || showing

  return (
    <div>
      <p className="text-[15px] leading-relaxed text-app-ink whitespace-pre-wrap wrap-break-word">{display}</p>
      {canTranslate && (
        <button
          type="button"
          onClick={toggle}
          disabled={loading}
          className="tap mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-xs font-medium text-app-muted disabled:opacity-50"
          title={showing ? 'Show original' : `Translate to ${lang.toUpperCase()}`}
        >
          <Globe className="h-4 w-4 shrink-0" aria-hidden />
          {loading
            ? 'translating…'
            : showing
            ? `Show original (${detected.toUpperCase()})`
            : `Translate to ${lang.toUpperCase()}`}
        </button>
      )}
      {showing && translated !== text && <p className="mt-1 text-xs leading-relaxed text-app-muted">Machine translation may be wrong. Check the original; this is not medical advice.</p>}
    </div>
  )
}

function PhotoGallery({ alertId, photoCount, inlinePhotos }) {
  const textFirst = useTextFirst()
  const [chosen, setChosen] = useState(false)
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

  if (loadedFor !== alertId || (textFirst && !chosen)) {
    return (
      <div className="mb-3">
      {error && <p role="alert" className="mb-2 text-sm text-app-ink">{error}</p>}
      <button
        type="button"
        onClick={() => { setChosen(true); void fetchIfNeeded() }}
        disabled={loading}
        className="tap app-secondary-button w-full"
      >
        <ImageIcon className="h-3.5 w-3.5" aria-hidden />
        {loading
          ? 'Loading photos…'
          : `View ${photoCount} photo${photoCount !== 1 ? 's' : ''}`}
      </button>
      </div>
    )
  }

  if (error) {
    return <p role="alert" className="text-sm text-app-ink mb-3">{error}</p>
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
            className="aspect-square rounded-xl overflow-hidden border border-line bg-surface-2 group relative"
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
      {open != null && (<PhotoDialog onClose={() => setOpen(null)}>
          <img
            src={photos[open]}
            alt={`evidence ${open + 1}`}
            className="max-w-full max-h-full rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setOpen(null)}
            className="absolute top-4 right-4 bg-black/70 hover:bg-black text-[#fff] w-12 h-12 rounded-full flex items-center justify-center"
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
                className="absolute left-4 bg-black/70 hover:bg-black text-[#fff] w-12 h-12 rounded-full"
                aria-label="Previous"
              >
                ‹
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen((i) => (i + 1) % photos.length)
                }}
                className="absolute right-4 bg-black/70 hover:bg-black text-[#fff] w-12 h-12 rounded-full"
                aria-label="Next"
              >
                ›
              </button>
            </>
          )}
      </PhotoDialog>)}
    </>
  )
}

function PhotoDialog({ children, onClose }) {
  const dialog = useDialog(onClose)
  return <NativeOverlay><div ref={dialog} tabIndex={-1} className="fixed inset-0 z-1050 bg-black/85 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Report photo">{children}</div></NativeOverlay>
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
    <div className="mt-2 mb-3 bg-surface-2 rounded-xl px-3 py-3 text-sm text-app-ink flex items-center gap-2 flex-wrap">
      <Car className="h-4 w-4 shrink-0" aria-hidden />
      {editing ? (
        <>
          <input
            type="number"
            min={0}
            max={240}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="app-field w-24 px-2 py-1"
            aria-label="ETA in minutes"
          />
          <span>minutes</span>
          <button
            onClick={submit}
            disabled={saving}
            className="tap app-primary-button"
          >
            {saving ? '…' : 'Save'}
          </button>
          <button
            onClick={() => {
              setEditing(false)
              setError('')
            }}
            className="tap app-secondary-button"
          >
            Cancel
          </button>
          {error && <span role="alert" className="text-app-ink text-sm w-full">{error}</span>}
        </>
      ) : (
        <>
          {alert.eta_minutes != null ? (
            <span>
              ETA: <strong>{alert.eta_minutes} min</strong>
            </span>
          ) : (
            <span className="text-app-muted">No ETA posted yet</span>
          )}
          {canEdit && (
            <button
              onClick={() => {
                setValue(String(alert.eta_minutes ?? ''))
                setEditing(true)
              }}
              className="tap app-secondary-button ml-auto"
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
    <div className="mt-4 border-t border-line pt-4">
      <p className="text-sm font-semibold text-app-ink">
        {t('match_title')}
      </p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="min-w-0 flex-1 break-words text-app-ink">
              {r.name}
              <span className="mt-0.5 block text-xs text-app-muted">
                {t(`res_kind_${r.kind}`) ?? r.kind}
              </span>
            </span>
            {r.contact && (
              <a
                href={`tel:${r.contact}`}
                className="tap app-secondary-button shrink-0"
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
  const textFirst = useTextFirst()
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
  const resolve = () => {
    if (window.confirm('Report that this emergency is resolved? This is a volunteer report, not a confirmation that the reporter is safe.')) return run('resolve', () => api.patch(`/api/alerts/${alert.id}/resolve`))
  }
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
      className="alert-card surface-card relative min-w-0 overflow-hidden p-4 pl-5 sm:p-5 sm:pl-6"
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
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-blue-500/50 bg-surface-2 px-3 py-2 text-sm font-semibold text-app-ink">
          <span aria-hidden>▲</span>
          <span>{t('drill_badge')}</span>
        </div>
      )}
      {isSkillMatch && (
        <div className="mb-2 mr-2 inline-flex items-center gap-1.5 text-xs font-medium text-app-muted">
          <Sparkles className="h-4 w-4" aria-hidden /> Matches your skills
        </div>
      )}
      {alert.is_anonymous && (
        <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-app-muted">
          <UserRoundX className="h-4 w-4" aria-hidden /> Anonymous tip
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <CategoryIcon
            category={alert.category}
            className="h-5 w-5 shrink-0 text-app-muted"
          />
          <span className="font-semibold capitalize text-app-ink wrap-break-word">
            {t(`cat_${alert.category}`) ?? alert.category}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-semibold px-2 py-1 rounded-md ${URGENCY_BADGE[alert.urgency]}`}>
            {alert.urgency}
          </span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-app-muted">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 font-medium capitalize text-app-ink">
          <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${alert.status === 'open' ? 'bg-blue-500' : alert.status === 'accepted' ? 'bg-purple-500' : 'bg-gray-500'}`} />
          {alert.status === 'resolved' ? 'Closed' : alert.status}
        </span>
          {/* Minutes, with the distance as the secondary figure. "4.2 km"
              tells a volunteer nothing about whether they are the right
              person to go — a 4.2 km walk is 78 minutes. "78 min" is the
              number they can act on. See backend services/dispatch.py. */}
          {typeof alert.your_eta_minutes === 'number' ? (
            <span
              className="tabular-nums"
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
              <span className="tabular-nums">
                {alert.your_distance_km.toFixed(1)} km
              </span>
            )
          )}
          <span className="tabular-nums">{createdAgo}</span>
      </div>

      <div className="mb-3">
        <OutcomeSummary alert={alert} />
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
        <p className="text-app-muted text-sm leading-relaxed mb-3 flex items-start gap-2">
          <MapPin className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span className="min-w-0 wrap-break-word">{alert.address}</span>
        </p>
      )}

      <EtaStrip alert={alert} onUpdate={onUpdate} canEdit={canSetEta} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-app-muted mb-3">
        {alert.photo_evidence_score > 0 && (
          <span
            className="inline-flex items-center gap-1.5"
            title={t('evidence_attachment')}
          >
            <ImageIcon className="h-3 w-3" aria-hidden />
            {t('evidence_photos')}
          </span>
        )}
        {alert.vulnerability && (
          <span
            className="capitalize inline-flex items-center gap-1.5"
          >
            <Dna className="h-3 w-3" aria-hidden />
            {alert.vulnerability}
          </span>
        )}
        {alert.time_sensitivity && (
          <span
            className="capitalize inline-flex items-center gap-1.5"
          >
            <Clock className="h-3 w-3" aria-hidden />
            {alert.time_sensitivity}
          </span>
        )}
        {alert.language && alert.language !== 'en' && (
          <span
            className="uppercase"
          >
            {alert.language}
          </span>
        )}
        {alert.triggers?.length ? (
          <span
            className="max-w-full wrap-break-word inline-flex items-center gap-1.5"
          >
            <Tag className="h-3 w-3" aria-hidden />
            {alert.triggers.join(', ')}
          </span>
        ) : null}
      </div>

      <div className="bg-surface-2 rounded-xl px-3 py-3 mb-4">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className={`font-semibold ${band.color}`}>{band.label}</span>
          <span className="text-app-muted tabular-nums">{score}/100</span>
        </div>
        <div className="w-full h-1.5 bg-line rounded-full overflow-hidden">
          <div
            className={`h-full ${band.bar}`}
            style={{ width: `${score}%` }}
          />
        </div>
        <EvidenceSummary alert={alert} />
        <div className="flex flex-wrap gap-x-3 gap-y-2 mt-3 text-xs text-app-muted">
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
            <span className="inline-flex items-center gap-1" title="Flagged by community">
              <Flag className="h-3 w-3" aria-hidden />
              {alert.flags}
            </span>
          )}
        </div>
      </div>

      <div className="alert-card-actions border-t border-line pt-3">
        <div className="flex w-full items-center gap-2 flex-wrap">
          {user && (
            <button
              type="button"
              onClick={() => setShowUpdates((v) => !v)}
              aria-expanded={showUpdates}
              aria-controls={updatesPanelId}
              className={`tap app-secondary-button${showUpdates ? ' bg-surface-2' : ''}`}
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              <span>{t('card_updates')}</span>
              {updatesLoaded && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs tabular-nums">{updates.length}</span>}
            </button>
          )}
          <ShareAlert alert={alert} />
          <Link
            to={mapsUrl}
            className="tap app-secondary-button"
            title="Open in NeighbourAid map"
          >
            <Compass className="h-3.5 w-3.5" aria-hidden />
            {t('card_directions')}
          </Link>
          {/*
            rel includes noopener: target=_blank without it hands the opened
            page a reference back to this window.
          */}
          <a
            href={navigateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="tap app-secondary-button"
            title={t('card_navigate_tip')}
          >
            <Navigation className="h-3.5 w-3.5" aria-hidden />
            {t('card_navigate')}
          </a>
          {user && !isOwn && !flagged && (
            <button
              onClick={flag}
              disabled={loading === 'flag'}
              className="tap app-secondary-button"
              title="Flag as fake or spam"
            >
              <Flag className="h-3.5 w-3.5" aria-hidden />
              Flag
            </button>
          )}
          {user && !isOwn && alert.status !== 'resolved' && (
            <Button
              size="md"
              variant="secondary"
              onClick={witness}
              loading={loading === 'witness'}
              title={t('card_see_too_tip')}
            >
              {t('card_see_too')}
            </Button>
          )}
          {user?.role === 'volunteer' && alert.status === 'open' && (
            <Button
              size="md"
              onClick={accept}
              loading={loading === 'accept'}
              className="w-full sm:w-auto"
            >
              {t('card_accept')}
            </Button>
          )}
          {isAcceptedByMe && alert.status === 'accepted' && (
            <Button
              size="md"
              variant="success"
              onClick={resolve}
              loading={loading === 'resolve'}
              className="w-full sm:w-auto"
            >
              Report resolved
            </Button>
          )}
        </div>
      </div>

      <MatchingResources alertId={alert.id} category={alert.category} />
      <HelpRelay alert={alert} onChanged={async () => { const { data } = await api.get(`/api/alerts/${alert.id}`, { params: { include_photos: !textFirst } }); onUpdate?.(data) }} />

      {showUpdates && (
        <section id={updatesPanelId} aria-label={t('card_updates')} className="mt-4 border-t border-line pt-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <MessageCircle className="h-4 w-4 shrink-0 text-app-muted" aria-hidden />
              <h3 className="text-sm font-semibold text-app-ink">{t('card_updates')}</h3>
            </div>
            <button
              type="button"
              onClick={() => { void fetchUpdates() }}
              disabled={loadingUpdates}
              className="tap app-secondary-button h-11 w-11 shrink-0"
              aria-label={t('card_updates')}
            >
              <RefreshCw className={`h-4 w-4 ${loadingUpdates ? 'animate-spin' : ''}`} aria-hidden />
            </button>
          </div>
          {loadingUpdates ? (
            <p role="status" className="py-2 text-sm text-app-muted">{t('card_loading_updates')}</p>
          ) : updatesError ? (
            <div role="alert" className="rounded-xl bg-surface-2 px-3 py-3 text-sm leading-relaxed text-app-ink">
              {updatesError}
            </div>
          ) : latestFirstUpdates.length === 0 ? (
            <p className="py-3 text-sm leading-relaxed text-app-muted">{t('card_no_updates')}</p>
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
                className="app-field min-h-24 w-full resize-y px-3 py-2.5 leading-relaxed"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <output id={`${updateComposerId}-count`} className="text-xs tabular-nums text-app-muted">{newUpdate.length}/500</output>
                <button
                  type="submit"
                  disabled={!canPostUpdate}
                  aria-busy={loading === 'post'}
                  className="tap app-primary-button"
                >
                  <Send className="h-4 w-4" aria-hidden />
                  <span>{loading === 'post' ? '…' : t('card_send')}</span>
                </button>
              </div>
              {updateError && <p id={`${updateComposerId}-error`} role="alert" className="mt-2 text-sm leading-relaxed text-app-ink">{updateError}</p>}
            </form>
          )}
        </section>
      )}

      {error && <p role="alert" className="rounded-xl bg-surface-2 p-3 text-app-ink text-sm mt-3">{error}</p>}
    </div>
  )
}

function UpdateRow({ update, latest }) {
  const updateAgo = useTimeAgo(update.created_at)
  return (
    <li className="relative text-xs">
      <span aria-hidden className={`absolute -left-[1.34rem] top-3 h-2.5 w-2.5 rounded-full border-2 border-surface-1 ${latest ? 'bg-app-ink' : 'bg-app-muted'}`} />
      <article className="rounded-xl bg-surface-2 px-3 py-3">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2 text-app-muted">
          <div className="min-w-0">
            <span className="block wrap-break-word font-medium text-app-ink">{update.author_name}</span>
            {update.author_role && <span className="mt-0.5 block text-xs capitalize text-app-muted">{update.author_role}</span>}
          </div>
          <span className="shrink-0 whitespace-nowrap pt-0.5">{updateAgo}</span>
        </div>
        <TranslatableText text={update.body} />
      </article>
    </li>
  )
}
