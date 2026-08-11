import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useVoice } from '../hooks/useVoice'
import { useI18n } from '../utils/i18n'
import { approxKb, compressImage } from '../utils/photo'
import {
  OFFLINE_QUEUE_EVENT,
  enqueueAlert,
  listPending,
} from '../utils/offlineQueue'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'
import {
  AlertTriangle,
  Camera,
  Check,
  MapPin,
  Mic,
  MicOff,
  Siren,
  UserRoundX,
  WifiOff,
} from '../components/icons'

const CATEGORIES = ['medical', 'flood', 'fire', 'missing', 'power', 'other']
const MAX_PHOTOS = 3

export default function PostAlert() {
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const { user } = useAuth()
  const { push: toast } = useToast()
  // No session → post through the public anonymous endpoint. It's rate-limited
  // per IP server-side and the alert is tagged `is_anonymous` so volunteers
  // know they can't call the reporter back for details.
  const isAnonymous = !user
  const endpoint = isAnonymous ? '/api/alerts/anonymous' : '/api/alerts/'
  const fileInputRef = useRef(null)
  const [form, setForm] = useState({
    category: 'medical',
    description: '',
    location: { type: 'Point', coordinates: [76.7794, 30.7333] },
  })
  const [photos, setPhotos] = useState([])
  const [locLoading, setLocLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [locationSet, setLocationSet] = useState(false)
  const [photoProcessing, setPhotoProcessing] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  const voiceLang = lang === 'hi' ? 'hi-IN' : lang === 'pa' ? 'pa-IN' : 'en-IN'
  const voice = useVoice({
    lang: voiceLang,
    onResult: (text, isFinal) => {
      if (isFinal) {
        setForm((f) => ({
          ...f,
          description: f.description ? `${f.description} ${text}` : text,
        }))
      }
    },
  })

  useEffect(() => {
    const refreshPending = () => {
      listPending().then((rows) => setPendingCount(rows.length)).catch(() => {})
    }

    refreshPending()
    const onOnline = () => {
      setOnline(true)
      refreshPending()
    }
    const onOffline = () => setOnline(false)
    const onQueueChange = (event) => {
      const remaining = event?.detail?.remaining
      if (typeof remaining === 'number') {
        setPendingCount(remaining)
        return
      }
      refreshPending()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener(OFFLINE_QUEUE_EVENT, onQueueChange)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener(OFFLINE_QUEUE_EVENT, onQueueChange)
    }
  }, [])

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Geolocation is not available in this browser.')
      return
    }
    setLocLoading(true)
    setError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setForm((f) => ({
          ...f,
          location: { type: 'Point', coordinates: [coords.longitude, coords.latitude] },
        }))
        setLocationSet(true)
        setLocLoading(false)
      },
      (err) => {
        setLocLoading(false)
        setError(err.message || 'Could not read your location.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }, [])

  // Ask for the fix as soon as the page opens. Location is mandatory to
  // submit, and someone reporting an emergency shouldn't have to discover
  // that by being blocked at the end of the form.
  useEffect(() => {
    detectLocation()
  }, [detectLocation])

  const onPhotoPick = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    setPhotoProcessing(true)
    setError('')
    try {
      const room = Math.max(0, MAX_PHOTOS - photos.length)
      const picks = files.slice(0, room)
      const compressed = []
      for (const f of picks) {
        try {
          const data = await compressImage(f)
          compressed.push(data)
        } catch (err) {
          setError(err.message || 'Could not process photo')
        }
      }
      if (compressed.length) {
        setPhotos((prev) => [...prev, ...compressed].slice(0, MAX_PHOTOS))
      }
    } finally {
      setPhotoProcessing(false)
      // Reset the file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const removePhoto = (i) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (form.description.trim().length < 10) {
      setError(t('post_min_chars'))
      return
    }
    // The form seeds `location` with a placeholder so the map/inputs have
    // something to render. Submitting that placeholder would dispatch
    // volunteers to a spot the reporter has never been — the single worst
    // failure mode this app has — so require a real fix first.
    if (!locationSet) {
      setError(t('post_location_required'))
      return
    }
    setError('')
    setSubmitting(true)
    const payload = { ...form, photos }
    try {
      const { data } = await api.post(endpoint, payload)
      // Anonymous reporters have no /my-alerts to return to — send them to the
      // alert's own page so they can still watch it get picked up and share it.
      navigate(isAnonymous ? `/alert/${data.id}` : '/my-alerts')
    } catch (err) {
      // If we're offline or the network is unreachable, queue it for later
      const isNetwork =
        err?.code === 'ERR_NETWORK' ||
        err?.message === 'Network Error' ||
        !navigator.onLine
      if (isNetwork) {
        try {
          await enqueueAlert(payload)
          const rows = await listPending()
          setPendingCount(rows.length)
          toast({
            variant: 'warning',
            title: 'Saved offline',
            body: 'Alert queued — it will send automatically when you reconnect.',
          })
          // /my-alerts is reporter-only; sending an anonymous reporter there
          // would bounce them straight back to the login screen.
          navigate(isAnonymous ? '/' : '/my-alerts')
          return
        } catch {
          setError('Could not queue alert offline — try again.')
        }
      } else {
        setError(apiError(err, t('post_failed')))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const [lng, lat] = form.location.coordinates

  return (
    <div className="relative min-h-screen flex items-start sm:items-center justify-center px-4 py-8 sm:py-12 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-72 w-[36rem] rounded-full bg-red-500/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-24 right-1/4 h-56 w-72 rounded-full bg-orange-500/10 blur-3xl"
      />
      <div className="relative bg-gradient-to-b from-gray-900/95 to-gray-900/80 backdrop-blur border border-gray-800 rounded-2xl p-5 sm:p-8 w-full max-w-lg shadow-2xl shadow-black/50 reveal-up">
        <div className="flex items-center gap-3 mb-2">
          <Siren className="h-8 w-8 text-red-400 glow-red rounded-full p-0.5" aria-hidden />
          <h1 className="text-xl sm:text-2xl font-bold text-white">{t('post_title')}</h1>
        </div>
        <p className="text-gray-400 text-sm mb-4 sm:mb-6">
          {t('post_subtitle')}
        </p>

        {isAnonymous && (
          <div className="bg-blue-950/60 border border-blue-800 text-blue-200 text-xs rounded-lg px-3 py-2.5 mb-4 flex items-start gap-2">
            <UserRoundX className="h-4 w-4 shrink-0 mt-px" aria-hidden />
            <span>
              Posting anonymously — no account needed. Volunteers nearby are
              alerted immediately, but they won&apos;t be able to call you back
              for details.{' '}
              <Link to="/login" className="underline hover:text-white">
                Sign in
              </Link>{' '}
              to track and update your alert.
            </span>
          </div>
        )}

        {!online && (
          <div className="bg-amber-950/70 border border-amber-700 text-amber-300 text-xs rounded-lg px-3 py-2 mb-4 flex items-center gap-2 pop-in">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            <span>Offline — your alert will be queued and sent automatically.</span>
          </div>
        )}
        {pendingCount > 0 && (
          <div className="bg-blue-950/70 border border-blue-700 text-blue-300 text-xs rounded-lg px-3 py-2 mb-4 tabular-nums">
            {pendingCount} queued alert{pendingCount !== 1 ? 's' : ''} awaiting connectivity.
          </div>
        )}

        {error && (
          <div className="bg-red-950/70 border border-red-700 text-red-300 text-sm rounded-lg px-4 py-3 mb-6 flex items-start gap-2 pop-in">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={submit} className="space-y-5 sm:space-y-6">
          <div>
            <label className="block text-sm text-gray-400 mb-2">{t('post_category')}</label>
            <div className="grid grid-cols-3 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setForm({ ...form, category: cat })}
                  className={`py-2.5 rounded-lg border capitalize text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 ${
                    form.category === cat
                      ? 'border-orange-500 bg-gradient-to-b from-orange-500/25 to-orange-500/10 text-orange-300 shadow-sm shadow-orange-500/15'
                      : 'border-gray-700 text-gray-400 hover:border-orange-500/40 hover:text-gray-200 hover:bg-gray-800/40'
                  }`}
                >
                  {t(`cat_${cat}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
              <label className="block text-sm text-gray-400">
                {t('post_description')}{' '}
                <span className="text-gray-600 hidden sm:inline">{t('post_description_hint')}</span>
              </label>
              {voice.supported && (
                <button
                  type="button"
                  onClick={voice.listening ? voice.stop : voice.start}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                    voice.listening
                      ? 'border-red-500 bg-red-500/20 text-red-300 animate-pulse'
                      : 'border-gray-700 text-gray-400 hover:border-gray-500'
                  }`}
                  title={voice.listening ? t('post_voice_tip_stop') : t('post_voice_tip_start')}
                >
                  {voice.listening ? (
                    <MicOff className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" aria-hidden />
                  ) : (
                    <Mic className="h-3.5 w-3.5 inline-block mr-1 -mt-0.5" aria-hidden />
                  )}
                  {voice.listening ? t('post_voice_recording') : t('post_voice_speak')}
                </button>
              )}
            </div>
            <textarea
              required
              rows={4}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-gray-800/80 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 focus:bg-gray-800 transition-all duration-200 resize-none text-base placeholder:text-gray-600"
              placeholder={t('post_description_placeholder')}
            />
            {voice.error && (
              <p className="text-xs text-red-400 mt-1 inline-flex items-center gap-1">
                <MicOff className="h-3.5 w-3.5" aria-hidden />
                {voice.error}
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">
              Photos (optional) <span className="text-gray-600">· boosts AI confidence</span>
            </label>
            <div className="grid grid-cols-3 gap-2 mb-2">
              {photos.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-lg overflow-hidden border border-gray-700 bg-gray-800">
                  <img src={src} alt={`upload ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="absolute top-1 right-1 bg-black/70 hover:bg-black text-white w-6 h-6 rounded-full text-xs leading-none flex items-center justify-center"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                  <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded">
                    {approxKb(src)} KB
                  </span>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <label
                  className={`aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center text-xs cursor-pointer transition-colors ${
                    photoProcessing
                      ? 'border-gray-700 text-gray-500'
                      : 'border-gray-700 text-gray-400 hover:border-orange-500 hover:text-orange-400'
                  }`}
                >
                  <Camera className="h-6 w-6 mb-1" aria-hidden />
                  {photoProcessing ? 'Processing…' : 'Add photo'}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onChange={onPhotoPick}
                    className="hidden"
                    disabled={photoProcessing}
                  />
                </label>
              )}
            </div>
            <p className="text-[11px] text-gray-500">
              Up to {MAX_PHOTOS} photos · auto-compressed · AI scans them for visual evidence.
            </p>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1.5">{t('post_location')}</label>
            <div className="flex gap-2">
              <input
                readOnly
                value={
                  locationSet
                    ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
                    : locLoading
                      ? t('post_locating')
                      : t('post_location_placeholder')
                }
                className={`flex-1 min-w-0 bg-gray-800/80 border rounded-lg px-3 sm:px-4 py-2.5 text-sm transition-colors ${
                  locationSet
                    ? 'border-emerald-700/70 ring-1 ring-emerald-700/30 text-gray-300 tabular-nums'
                    : 'border-amber-700/70 text-amber-300/90'
                }`}
              />
              <button
                type="button"
                onClick={detectLocation}
                disabled={locLoading}
                className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2.5 rounded-lg text-sm transition-all duration-200 disabled:opacity-50 whitespace-nowrap hover:-translate-y-0.5 active:translate-y-0 active:scale-95 shadow-sm shadow-black/40"
              >
                {locLoading ? (
                  <svg className="animate-spin h-4 w-4 inline" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                ) : (
                  <>
                    <MapPin className="h-4 w-4 inline-block mr-1 -mt-0.5" aria-hidden />
                    {t('post_use_gps')}
                  </>
                )}
              </button>
            </div>
            {locationSet ? (
              <p className="text-[11px] text-emerald-400 mt-1 pop-in inline-flex items-center gap-1">
                <Check className="h-3.5 w-3.5" aria-hidden />
                GPS location captured
              </p>
            ) : (
              <p className="text-[11px] text-amber-400/90 mt-1">
                {t('post_location_required')}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting || !locationSet}
            className="group relative w-full bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl shadow-lg shadow-red-500/20 hover:shadow-red-500/40 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] overflow-hidden"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent skew-x-12 -translate-x-full group-hover:translate-x-[400%] transition-transform duration-700 ease-out"
            />
            <span className="relative inline-flex items-center justify-center gap-2">
              {submitting && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                  <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
              )}
              {submitting ? t('post_submitting') : t('post_submit')}
            </span>
          </button>
        </form>
      </div>
    </div>
  )
}
