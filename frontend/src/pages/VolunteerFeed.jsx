import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useVolunteerSocket } from '../hooks/useWebSocket'
import { useLatest } from '../hooks/useLatest'
import { GEOLOCATION_SUPPORTED, GEO_UNSUPPORTED_MESSAGE } from '../utils/geo'
import { useToast } from '../components/Toast'
import { useNotifications } from '../hooks/useNotifications'
import { ttsLocaleFor, useVoiceAlert } from '../hooks/useVoiceAlert'
import { useI18n } from '../utils/i18n'
import AlertCard from '../components/AlertCard'
import { SkeletonAlertList } from '../components/Skeleton'
import EmptyState from '../components/EmptyState'
import api from '../utils/api'
import { apiError } from '../utils/error'
import {
  AlertTriangle,
  Bell,
  MapPin,
  ShieldCheck,
  Volume2,
  VolumeX,
} from '../components/icons'

const TOAST_VARIANT = {
  CRITICAL: 'danger',
  HIGH: 'warning',
  MEDIUM: 'info',
  LOW: 'info',
}

function playPing() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.26)
  } catch {
    /* sound disabled / blocked — silent */
  }
}

// Toast and OS-notification titles are plain strings — they can't host an
// SVG — so they carry the urgency + category words instead of a glyph. The
// on-screen cards render the real CategoryIcon.

export default function VolunteerFeed() {
  const { token, user } = useAuth()
  const { push: toast } = useToast()
  const notif = useNotifications()
  const voiceAlert = useVoiceAlert()
  const { t, lang } = useI18n()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [coords, setCoords] = useState(null)
  const [status, setStatus] = useState('connecting')
  // Seed both from a module constant rather than discovering the capability
  // inside an effect: if the browser has no geolocation API we already know
  // at first render that there is nothing to load and what to say about it.
  const [loading, setLoading] = useState(GEOLOCATION_SUPPORTED)
  const [error, setError] = useState('')
  const [geoError, setGeoError] = useState(
    GEOLOCATION_SUPPORTED ? '' : GEO_UNSUPPORTED_MESSAGE
  )
  const knownIds = useRef(new Set())
  const watchIdRef = useRef(null)

  // Keep the volunteer's location fresh — they may be moving toward a crisis.
  // The watch updates both the server proximity and the "nearby" fetch.
  //
  // On failure we deliberately leave `coords` null rather than substituting a
  // default city. Every alert here is filtered by distance from this point,
  // so a fabricated location doesn't degrade the feed — it silently shows a
  // volunteer someone else's neighbourhood while hiding the emergencies on
  // their own street.
  useEffect(() => {
    // The unsupported case is already reflected in initial state above.
    if (!GEOLOCATION_SUPPORTED) return undefined
    navigator.geolocation.getCurrentPosition(
      ({ coords: c }) => {
        setGeoError('')
        setCoords([c.longitude, c.latitude])
      },
      (err) => {
        setGeoError(
          err?.code === 1
            ? 'Location permission is blocked. Enable it for this site to receive nearby alerts.'
            : 'Could not read your location, so nearby alerts cannot be found.'
        )
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords: c }) => {
        setCoords((prev) => {
          if (!prev) return [c.longitude, c.latitude]
          // Only update when the fix moved more than ~15 m — avoids jitter
          const [oldLng, oldLat] = prev
          const dx = (c.longitude - oldLng) * 111320 * Math.cos((c.latitude * Math.PI) / 180)
          const dy = (c.latitude - oldLat) * 111320
          const moved = Math.sqrt(dx * dx + dy * dy)
          if (moved > 15) return [c.longitude, c.latitude]
          return prev
        })
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 15000 }
    )
    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
        watchIdRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!coords) return undefined
    let cancelled = false
    // `background` covers both the poll ticks and the very first load: on
    // mount `loading` already starts true, and re-raising it synchronously
    // from the effect body just forces an extra render before paint. On a
    // coords change we'd rather keep showing the previous alerts than blank
    // the feed behind a skeleton.
    const loadAlerts = async (background = false) => {
      const [lng, lat] = coords
      try {
        const { data } = await api.get('/api/alerts/nearby', {
          params: { lat, lng, km: 10 },
        })
        if (cancelled) return
        setAlerts(data)
        knownIds.current = new Set([
          ...knownIds.current,
          ...data.map((a) => a.id),
        ])
        setError('')
      } catch (err) {
        if (!cancelled) setError(apiError(err, t('vol_failed')))
      } finally {
        if (!cancelled && !background) setLoading(false)
      }
    }

    void loadAlerts()
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadAlerts(true)
      }
    }, 30000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void loadAlerts(true)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [coords, t])

  // voiceAlert.speak captures language inside its closure — keep these fresh
  // via refs so onAlert's dep array stays stable across language switches.
  // useLatest updates them after commit; mutating during render is unsafe
  // under React 19's concurrent rendering.
  const notifyRef = useLatest(notif.notify)
  const voiceSpeakRef = useLatest(voiceAlert.speak)
  const langRef = useLatest(lang)

  const onAlert = useCallback(
    (incoming) => {
      const isNew = !knownIds.current.has(incoming.id)
      knownIds.current.add(incoming.id)
      setAlerts((prev) => {
        const exists = prev.some((a) => a.id === incoming.id)
        if (exists) return prev.map((a) => (a.id === incoming.id ? incoming : a))
        return [incoming, ...prev]
      })
      if (isNew && incoming.status === 'open') {
        playPing()
        // Hands-free TTS for CRITICAL only — anything lower is too noisy.
        if (incoming.urgency === 'CRITICAL') {
          const distancePart =
            typeof incoming.your_distance_km === 'number'
              ? `${incoming.your_distance_km.toFixed(1)} kilometres away`
              : ''
          voiceSpeakRef.current?.(
            `Critical ${incoming.category} alert${distancePart ? `, ${distancePart}` : ''}`,
            { lang: ttsLocaleFor(langRef.current) }
          )
        }
        const distance =
          typeof incoming.your_distance_km === 'number'
            ? ` · ${incoming.your_distance_km.toFixed(1)} km away`
            : ''
        const skillTag = incoming.is_skill_match ? ' · MATCHES YOUR SKILLS' : ''
        const title = `${incoming.urgency} · ${incoming.category}${skillTag}`
        toast({
          variant: TOAST_VARIANT[incoming.urgency] ?? 'info',
          title,
          body: `${incoming.description.slice(0, 140)}${distance}`,
        })
        notifyRef.current?.({
          title,
          body: `${incoming.description.slice(0, 140)}${distance}`,
          tag: `alert-${incoming.id}`,
          // CRITICAL alerts stay visible until the volunteer interacts
          requireInteraction: incoming.urgency === 'CRITICAL',
          data: { alertId: incoming.id, url: `/alert/${incoming.id}` },
          onClick: () => navigate(`/alert/${incoming.id}`),
        })
      }
    },
    // The *Ref entries are stable useRef containers — listed so the
    // dependency array is honest, without destabilising the callback.
    [toast, navigate, langRef, notifyRef, voiceSpeakRef]
  )

  useVolunteerSocket({ token, coordinates: coords, onAlert, onStatus: setStatus })

  // SW-routed click messages arrive here when a background notification is tapped
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return undefined
    const onMsg = (event) => {
      const { type, target } = event.data || {}
      if (type === 'notification-click' && target) navigate(target)
    }
    navigator.serviceWorker.addEventListener('message', onMsg)
    return () => navigator.serviceWorker.removeEventListener('message', onMsg)
  }, [navigate])

  const notifEnabled = notif.permission === 'granted'

  const updateAlert = (updated) => {
    setAlerts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
  }

  const openAlerts = alerts.filter((a) => a.status === 'open')
  const acceptedAlerts = alerts.filter(
    (a) => a.status === 'accepted' && a.accepted_by === user?.id
  )
  const connected = status === 'open'

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-8">
      <div className="flex items-center justify-between mb-5 sm:mb-6 gap-3 reveal-up">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('vol_title')}</h1>
          <p className="text-gray-400 text-xs sm:text-sm mt-1">{t('vol_subtitle')}</p>
        </div>
        <div
          className={`flex items-center gap-2 shrink-0 px-2.5 py-1 rounded-full border transition-colors ${
            connected
              ? 'border-emerald-700/60 bg-emerald-950/40'
              : 'border-gray-700 bg-gray-900/60'
          }`}
          aria-live="polite"
        >
          <span className="relative flex h-2 w-2" aria-hidden>
            {connected && (
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            )}
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                connected ? 'bg-emerald-400' : 'bg-gray-500'
              }`}
            />
          </span>
          <span className={`text-xs capitalize ${connected ? 'text-emerald-300' : 'text-gray-400'}`}>
            {connected ? t('vol_live') : status}
          </span>
        </div>
      </div>

      {error && (
        <div className="bg-red-950/70 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-6 flex items-start gap-2 pop-in">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {notif.permission === 'default' && (
        <div className="bg-linear-to-br from-gray-900 to-gray-900/60 border border-gray-800 rounded-xl px-4 py-3 mb-6 flex flex-col sm:flex-row sm:items-center gap-3 reveal-up stagger-1 shadow-md shadow-black/20">
          <div className="text-sm text-gray-300 flex-1">
            {t('vol_enable_notif')}
          </div>
          <button
            onClick={notif.request}
            className="text-xs bg-linear-to-b from-orange-500 to-orange-600 hover:from-orange-400 hover:to-orange-500 text-white px-3 py-1.5 rounded-lg shadow-xs shadow-orange-500/20 hover:shadow-orange-500/40 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 whitespace-nowrap self-start sm:self-auto inline-flex items-center gap-1.5"
          >
            <Bell className="h-3.5 w-3.5" aria-hidden />
            {t('vol_enable')}
          </button>
        </div>
      )}
      {notifEnabled && (
        <div className="text-[11px] text-gray-600 mb-2">{t('vol_notif_on')}</div>
      )}

      {voiceAlert.supported && (
        <button
          type="button"
          onClick={() => voiceAlert.setEnabled((v) => !v)}
          className={`text-[11px] mb-4 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 ${
            voiceAlert.enabled
              ? 'border-blue-700 bg-blue-950/40 text-blue-300 shadow-xs shadow-blue-500/15'
              : 'border-gray-700 text-gray-500 hover:text-gray-300 hover:border-blue-500/40'
          }`}
          title="Read out CRITICAL alerts via your device's voice"
        >
          {voiceAlert.enabled ? (
            <Volume2 className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <VolumeX className="h-3.5 w-3.5" aria-hidden />
          )}
          <span>Voice alerts {voiceAlert.enabled ? 'on' : 'off'}</span>
        </button>
      )}

      {geoError ? (
        <EmptyState
          icon={<MapPin className="h-7 w-7" />}
          title="Location needed"
          body={`${geoError} Nearby alerts are matched by distance, so we won't guess a location for you.`}
        />
      ) : loading ? (
        <SkeletonAlertList count={3} />
      ) : (
        <>
          <section className="mb-8 reveal-up stagger-2">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
              {t('vol_open')} — <span className="tabular-nums">{openAlerts.length}</span>
            </h2>
            {openAlerts.length === 0 ? (
              <EmptyState
                icon={<ShieldCheck className="h-7 w-7" />}
                title={t('vol_no_open')}
                body="When a reporter posts within 10 km — or anywhere matching your skills — it will land here in real time."
              />
            ) : (
              <div className="space-y-3">
                {openAlerts.map((a) => (
                  <AlertCard key={a.id} alert={a} onUpdate={updateAlert} />
                ))}
              </div>
            )}
          </section>

          {acceptedAlerts.length > 0 && (
            <section className="reveal-up stagger-3">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-3">
                {t('vol_active')} — <span className="tabular-nums">{acceptedAlerts.length}</span>
              </h2>
              <div className="space-y-3">
                {acceptedAlerts.map((a) => (
                  <AlertCard key={a.id} alert={a} onUpdate={updateAlert} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
