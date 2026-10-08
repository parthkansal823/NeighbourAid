import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useVoice } from '../hooks/useVoice'
import { voiceCopy, voiceErrorMessage } from '../utils/voiceCopy'
import LiveCamera from '../components/LiveCamera'
import VoiceReportAssistant from '../components/VoiceReportAssistant'
import FirstAidButton from '../components/FirstAidGuide'
import { assistantCopy } from '../utils/assistantCopy'
import { useI18n, speechLocaleFor } from '../utils/i18n'
import { approxKb, compressImage } from '../utils/photo'
import { cameraPhotoBlob } from '../utils/nativeCamera'
import { clearCameraRecovery, completeCameraRecovery, prepareCameraRecovery, readCameraRecovery } from '../utils/cameraRecovery'
import useCameraRecovery from '../hooks/useCameraRecovery'
import {
  OFFLINE_QUEUE_EVENT,
  enqueueAlert,
  completeDelivery,
  cancelPending,
  markPendingForReview,
  needsDeliveryReview,
  requestBackgroundFlush,
  getCurrentAccountId,
  listPending,
} from '../utils/offlineQueue'
import { getAnonymousClientId, newSubmissionId } from '../utils/submissionIdentity'
import { useToast } from '../components/Toast'
import { useAuth } from '../context/AuthContext'
import { useLatest } from '../hooks/useLatest'
import { registerScreenNavigationGuard } from '../utils/androidBack'
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

// Order is deliberate: life-threatening categories come first in the native
// picker, so the common emergency choices do not require a long scroll.
// Must stay in step with AlertCategory in backend/app/models/alert.py.
const CATEGORIES = [
  'medical',
  'fire',
  'flood',
  'accident',
  'missing',
  'violence',
  'animal',
  'gas',
  'power',
  'water',
  'structure',
  'other',
]
const MAX_PHOTOS = 3
const LEAVE_REPORT_COPY = {
  en: 'This report has not been sent. Leave this screen and discard your changes?',
  hi: 'यह रिपोर्ट अभी भेजी नहीं गई है। इस स्क्रीन से बाहर जाकर अपने बदलाव हटाएँ?',
  pa: 'ਇਹ ਰਿਪੋਰਟ ਹਾਲੇ ਭੇਜੀ ਨਹੀਂ ਗਈ। ਕੀ ਇਸ ਸਕ੍ਰੀਨ ਤੋਂ ਬਾਹਰ ਜਾ ਕੇ ਆਪਣੀਆਂ ਤਬਦੀਲੀਆਂ ਮਿਟਾਉਣੀਆਂ ਹਨ?',
  gu: 'આ રિપોર્ટ હજુ મોકલાયો નથી. આ સ્ક્રીન છોડીને તમારા ફેરફારો કાઢી નાખવા છે?',
  bn: 'এই রিপোর্ট এখনও পাঠানো হয়নি। এই স্ক্রিন ছেড়ে আপনার পরিবর্তনগুলি মুছে ফেলবেন?',
  ta: 'இந்த அறிக்கை இன்னும் அனுப்பப்படவில்லை. இந்தத் திரையை விட்டு வெளியேறி உங்கள் மாற்றங்களை நீக்கவா?',
  te: 'ఈ నివేదిక ఇంకా పంపబడలేదు. ఈ స్క్రీన్‌ను వదిలి మీ మార్పులను తొలగించాలా?',
  kn: 'ಈ ವರದಿಯನ್ನು ಇನ್ನೂ ಕಳುಹಿಸಿಲ್ಲ. ಈ ಪರದೆಯಿಂದ ಹೊರಹೋಗಿ ನಿಮ್ಮ ಬದಲಾವಣೆಗಳನ್ನು ಅಳಿಸಬೇಕೇ?',
  ml: 'ഈ റിപ്പോർട്ട് ഇതുവരെ അയച്ചിട്ടില്ല. ഈ സ്ക്രീനിൽ നിന്ന് പുറത്തുകടന്ന് നിങ്ങളുടെ മാറ്റങ്ങൾ ഒഴിവാക്കണോ?',
  mr: 'हा अहवाल अजून पाठवलेला नाही. या स्क्रीनमधून बाहेर पडून तुमचे बदल काढून टाकायचे?',
  or: 'ଏହି ରିପୋର୍ଟ ଏପର୍ଯ୍ୟନ୍ତ ପଠାଯାଇନାହିଁ। ଏହି ସ୍କ୍ରିନ୍ ଛାଡ଼ି ଆପଣଙ୍କ ପରିବର୍ତ୍ତନଗୁଡ଼ିକ ହଟାଇବେ?',
}

export default function PostAlert() {
  const { user } = useAuth()
  // A photo review and typed report belong to the session that opened them.
  // Unmount synchronously on logout/account change, not after an async reset.
  return <PostAlertForm key={user?.id ? `account:${user.id}` : 'anonymous'} />
}

function PostAlertForm() {
  const navigate = useNavigate()
  const { t, lang } = useI18n()
  const { user } = useAuth()
  const { push: toast } = useToast()
  // No session → post through the public anonymous endpoint. It's rate-limited
  // per IP server-side and the alert is tagged `is_anonymous` so volunteers
  // know they can't call the reporter back for details.
  const isAnonymous = !user
  const endpoint = isAnonymous ? '/api/alerts/anonymous' : '/api/alerts/'
  const [form, setForm] = useState({
    category: 'medical',
    description: '',
    location: { type: 'Point', coordinates: [76.7794, 30.7333] },
  })
  const [photos, setPhotos] = useState([])
  // Drills run the real pipeline so volunteers learn the real flow, but
  // are excluded from every count and from trust scores. Signed-in only:
  // an anonymous endpoint that can mint uncounted alerts is a way to make
  // the numbers lie for free.
  const [isDrill, setIsDrill] = useState(false)
  const [locLoading, setLocLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [locationSet, setLocationSet] = useState(false)
  // Coordinates are unreadable to a human. A rough address is how a reporter
  // notices the fix landed on the wrong side of the city before sending
  // volunteers there. Never blocks submit — see the catch below.
  const [address, setAddress] = useState('')
  const locationRequest = useRef(0)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [recoveredPhoto, setRecoveredPhoto] = useState(null)
  const cameraSession = useRef(null)
  const accountId = user?.id || null
  const account = useLatest(accountId)
  const recovery = useCameraRecovery(accountId)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [photoProcessing, setPhotoProcessing] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const operations = useRef({ submitting: false, photoProcessing: false, nativeCapture: false, saved: false })
  const active = useRef(false)
  const submission = useRef(null)
  useLayoutEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [])
  const notify = message => { if (active.current) toast(message) }

  // Recognition locale follows the language the reporter actually chose.
  // Hard-coding this to a 3-way check meant Tamil, Telugu, Bengali,
  // Marathi and Gujarati speakers were transcribed as English.
  const voiceLang = speechLocaleFor(lang)
  const voiceText = voiceCopy(lang)
  const voice = useVoice({
    lang: voiceLang,
    onResult: (text, isFinal) => {
      if (isFinal && active.current && !operations.current.submitting && !operations.current.photoProcessing) {
        setForm((f) => ({
          ...f,
          description: f.description ? `${f.description} ${text}` : text,
        }))
      }
    },
  })

  // A hardware/header/tab navigation must not silently erase an emergency
  // draft. An in-flight operation cannot be discarded, even by confirmation.
  // Register once; the callback reads committed state rather than stale input.
  const reportGuard = useLatest(() => {
    if (operations.current.submitting || operations.current.photoProcessing || operations.current.nativeCapture) return false
    if (operations.current.saved) return true
    const dirty = Boolean(form.description.trim() || photos.length || isDrill ||
      form.category !== 'medical' || voice.listening)
    return !dirty || window.confirm(LEAVE_REPORT_COPY[lang] || LEAVE_REPORT_COPY.en)
  })
  useEffect(() => registerScreenNavigationGuard(() => reportGuard.current()), [reportGuard])

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
    const request = ++locationRequest.current
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (request !== locationRequest.current) return
        setForm((f) => ({
          ...f,
          location: { type: 'Point', coordinates: [coords.longitude, coords.latitude] },
        }))
        setLocationSet(true)
        setLocLoading(false)
        // Fire-and-forget. A missing address is cosmetic; the coordinates
        // are what actually dispatch a volunteer and they are already set.
        api
          .get('/api/geo/reverse', {
            params: { lat: coords.latitude, lng: coords.longitude },
          })
          .then((r) => { if (request === locationRequest.current) setAddress(r.data?.address || '') })
          .catch(() => { if (request === locationRequest.current) setAddress('') })
      },
      (err) => {
        if (request !== locationRequest.current) return
        setLocLoading(false)
        setError(err.message || 'Could not read your location.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }, [])

  // Ask for the fix as soon as the page opens. Location is mandatory to
  // submit, and someone reporting an emergency shouldn't have to discover
  // that by being blocked at the end of the form.
  const invalidateLocationRequest = useCallback(() => { locationRequest.current++ }, [])
  useEffect(() => {
    detectLocation()
    return invalidateLocationRequest
  }, [detectLocation, invalidateLocationRequest])

  const onCameraCapture = async (dataUrl) => {
    const captureOwner = account.current
    operations.current.photoProcessing = true
    setPhotoProcessing(true)
    setError('')
    try {
      // compressImage takes a Blob, and the camera hands us a data URL.
      const blob = await (await fetch(dataUrl)).blob()
      const file = new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const compressed = await compressImage(file)
      if (!active.current || account.current !== captureOwner) throw new Error('Your account changed. This photo has not been attached. Return to the original account to recover its camera draft.')
      setPhotos((prev) => [...prev, compressed].slice(0, MAX_PHOTOS))
      setRecoveredPhoto(null)
      setCameraOpen(false)
      if (cameraSession.current) {
        // Clear only this session, never a newer draft from another camera.
        void clearCameraRecovery(cameraSession.current).catch(() => {})
        cameraSession.current = null
      }
    } catch (err) {
      setError(err.message || 'Could not process photo')
      // LiveCamera retains its review image on attachment failure.
      throw err
    } finally {
      operations.current.photoProcessing = false
      setPhotoProcessing(false)
    }
  }

  const beforeNativeCapture = async () => {
    if (operations.current.submitting || operations.current.photoProcessing) throw new Error('Wait for the current report operation to finish.')
    const owner = account.current
    if (owner && getCurrentAccountId(localStorage.getItem('token')) !== owner) {
      throw new Error('Your reporting session changed. Sign in again before opening the device camera.')
    }
    operations.current.nativeCapture = true
    try {
      const id = await prepareCameraRecovery({ form, photos, locationSet, address, isDrill }, owner)
      if (!active.current || account.current !== owner) throw new Error('Your account changed. The saved draft belongs to the original account.')
      cameraSession.current = id
      return id
    } catch (err) {
      operations.current.nativeCapture = false
      throw err
    }
  }

  const onNativeResult = async (id, result) => {
    try {
      const record = await completeCameraRecovery(id, result)
      if (!active.current || !record || record.accountId !== account.current) throw new Error('Your camera session changed. Return to the original account to review its saved draft.')
    }
    finally { operations.current.nativeCapture = false }
  }

  const restoreCameraDraft = async () => {
    if (!recovery || operations.current.submitting || operations.current.photoProcessing) return
    if (submission.current?.queueId != null) {
      setError('An earlier report has a saved retry. Check Delivery receipts before replacing this form with a camera draft.')
      return
    }
    const dirty = Boolean(form.description.trim() || photos.length || isDrill || form.category !== 'medical')
    if (dirty && !window.confirm('Replace the current unsent form with the saved camera draft? Nothing will be sent.')) return
    const selectedId = recovery.id
    const owner = account.current
    operations.current.photoProcessing = true
    setPhotoProcessing(true)
    voice.cancel()
    setError('')
    try {
      const record = await readCameraRecovery(owner)
      if (!active.current || !record || record.id !== selectedId) throw new Error('This saved camera draft has expired or changed. Nothing was restored.')
      let preview = null
      let photoError = ''
      if (record.photo) {
        // Only a local, bounded native camera result can become a review image.
        try { preview = await compressImage(await cameraPhotoBlob(record.photo)) }
        catch { photoError = 'The saved camera photo is no longer available. Your text was restored; take a new live photo.' }
      }
      if (!active.current || account.current !== owner) throw new Error('Your account changed. This draft was not restored.')
      // File read/decode can be slow; expiry or another window can replace the
      // selected session during that wait. Recheck immediately before applying.
      const latest = await readCameraRecovery(owner)
      if (!latest || latest.id !== selectedId || latest.expiresAt <= Date.now()) throw new Error('This saved camera draft has expired or changed. Nothing was restored.')
      if (latest.status === 'pending' && !await completeCameraRecovery(record.id, null)) throw new Error('This saved camera draft has expired or changed. Nothing was restored.')
      if (!active.current || account.current !== owner) throw new Error('Your account changed. This draft was not restored.')
      if (latest.expiresAt <= Date.now()) throw new Error('This saved camera draft has expired. Nothing was restored.')
      setForm(record.draft.form)
      setPhotos(record.draft.photos)
      setIsDrill(Boolean(owner && record.draft.isDrill))
      // A saved GPS fix can be stale. Require a new observed fix before sending.
      setLocationSet(false)
      setAddress('')
      cameraSession.current = record.id
      setRecoveredPhoto(preview)
      setCameraOpen(Boolean(preview))
      detectLocation()
      if (photoError) setError(photoError)
      if (!preview) notify({ title: 'Camera draft restored', body: 'Review your report and take a new photo. Nothing has been sent.' })
    } catch (err) {
      setError(err.message || 'The saved photo could not be recovered. Your saved camera draft is still on this device.')
    } finally {
      operations.current.photoProcessing = false
      setPhotoProcessing(false)
    }
  }

  const discardCameraDraft = async () => {
    if (!recovery || photoProcessing || submitting) return
    if (!window.confirm('Delete the saved camera draft from this device? This does not withdraw any report already sent or queued.')) return
    try {
      await clearCameraRecovery(recovery.id)
      if (cameraSession.current === recovery.id) cameraSession.current = null
    } catch { setError('Could not delete the saved camera draft. Please retry.') }
  }

  const removePhoto = (i) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i))
  }

  const submit = async (e) => {
    e.preventDefault()
    if (operations.current.submitting || operations.current.photoProcessing || operations.current.nativeCapture || cameraOpen) return
    if (form.description.trim().length < 10) {
      setError(t('post_min_chars'))
      return
    }
    if (form.description.length > 2000) { setError(voiceText.tooLong); return }
    // The form seeds `location` with a placeholder so the map/inputs have
    // something to render. Submitting that placeholder would dispatch
    // volunteers to a spot the reporter has never been — the single worst
    // failure mode this app has — so require a real fix first.
    if (!locationSet) {
      setError(t('post_location_required'))
      return
    }
    setError('')
    operations.current.submitting = true
    setSubmitting(true)
    // Preserve ownership from submission time, even if the session changes
    // while the request is in flight. Never save a bearer token in IndexedDB.
    const reportingToken = isAnonymous ? null : localStorage.getItem('token')
    const reportingAccountId = isAnonymous ? null : getCurrentAccountId(reportingToken)
    if (!isAnonymous && (!reportingToken || !reportingAccountId || reportingAccountId !== user.id)) {
      operations.current.submitting = false
      setSubmitting(false)
      setError('Your reporting session changed. Sign in to the original account before sending. Your draft has not been sent.')
      return
    }
    const payload = { ...form, photos }
    if (!isAnonymous && isDrill) payload.is_drill = true
    const fingerprint = JSON.stringify({ payload, accountId: reportingAccountId, anonymous: isAnonymous })
    try {
      if (submission.current?.fingerprint !== fingerprint) {
        if (submission.current?.queueId != null) {
          const confirmed = window.confirm('An earlier copy is saved for retry. Cancel its saved retry and submit these changes? A report already received by the server is not withdrawn.')
          if (!confirmed) {
            operations.current.submitting = false
            setSubmitting(false)
            return
          }
          if (!await cancelPending(submission.current.queueId)) {
            operations.current.submitting = false
            setSubmitting(false)
            setError('The earlier report may already have been received or needs its original account. Check Delivery receipts before posting another report.')
            return
          }
        }
        submission.current = {
          fingerprint,
          id: newSubmissionId(),
          anonymousClientId: isAnonymous ? getAnonymousClientId() : null,
          queueId: null,
        }
      }
    } catch {
      operations.current.submitting = false
      setSubmitting(false)
      setError('Could not prepare a secure report identity. Please retry in a supported browser.')
      return
    }
    const delivery = submission.current
    if (!active.current) return
    payload.client_submission_id = delivery.id
    try {
      // Save before the first request: a lost response/app close can replay
      // this exact report, without creating another emergency alert.
      if (delivery.queueId === null) {
        try {
          delivery.queueId = await enqueueAlert(payload, {
            anonymous: isAnonymous, accountId: reportingAccountId,
            anonymousClientId: delivery.anonymousClientId, requestSync: false,
          })
        } catch {
          notify({ variant: 'warning', title: 'Device storage unavailable', body: 'Sending online. This report cannot be saved for offline retry on this device.' })
        }
      }
      if (!active.current) return
      const { data } = await api.post(endpoint, payload, {
        skipAuth: isAnonymous,
        headers: isAnonymous
          ? { 'X-Anonymous-Client-ID': delivery.anonymousClientId }
          : reportingToken ? { Authorization: `Bearer ${reportingToken}` } : {},
      })
      if (typeof data?.id !== 'string' || !data.id.trim()) {
        throw new Error('The server did not confirm a report ID. Keep this report and retry; receipt is unconfirmed.')
      }
      if (delivery.queueId !== null) {
        try { await completeDelivery(delivery.queueId, data) } catch {
          notify({ variant: 'warning', title: 'Server received your report', body: 'The local receipt could not be saved. A retry will use the same submission identity.' })
        }
      }
      // Anonymous reporters have no /my-alerts to return to — send them to the
      // alert's own page so they can still watch it get picked up and share it.
      operations.current.saved = true
      if (cameraSession.current) void clearCameraRecovery(cameraSession.current).catch(() => {})
      if (!active.current) return
      navigate(isAnonymous ? `/alert/${data.id}` : '/my-alerts')
    } catch (err) {
      // If we're offline or the network is unreachable, queue it for later
      const isNetwork =
        err?.code === 'ERR_NETWORK' ||
        err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' ||
        err?.message === 'Network Error' ||
        !navigator.onLine
      if (isNetwork) {
        try {
          if (delivery.queueId === null) {
            delivery.queueId = await enqueueAlert(payload, { anonymous: isAnonymous, accountId: reportingAccountId, anonymousClientId: delivery.anonymousClientId })
          }
          void requestBackgroundFlush()
          const rows = await listPending()
          setPendingCount(rows.length)
          notify({
            variant: 'warning',
            title: 'Saved offline',
            body: 'Alert queued — it will send automatically when you reconnect.',
          })
          // /my-alerts is reporter-only; sending an anonymous reporter there
          // would bounce them straight back to the login screen.
          operations.current.saved = true
          if (cameraSession.current) void clearCameraRecovery(cameraSession.current).catch(() => {})
          if (!active.current) return
          navigate(isAnonymous ? '/' : '/my-alerts')
          return
        } catch {
          setError('Could not queue alert offline — try again.')
        }
      } else {
        if (delivery.queueId !== null && needsDeliveryReview(err)) await markPendingForReview(delivery.queueId).catch(() => {})
        setError(apiError(err, t('post_failed')))
      }
    } finally {
      operations.current.submitting = false
      setSubmitting(false)
    }
  }

  const [lng, lat] = form.location.coordinates

  return (
    <div className="report-page page-panel mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="report-form-panel">
        <div className="flex items-center gap-2.5 mb-2">
          <Siren className="h-6 w-6 shrink-0 text-[var(--app-danger)]" aria-hidden />
          <h1 className="text-xl sm:text-2xl font-bold text-app-ink">{t('post_title')}</h1>
        </div>
        <p className="text-app-muted text-sm leading-relaxed mb-5">
          {t('post_subtitle')}
        </p>

        {recovery && <section aria-label="Saved camera draft" className="mb-4 rounded-xl border border-line bg-surface-2 p-3 text-sm text-app-ink">
          <p className="font-semibold">Unsent camera draft</p>
          <p className="mt-1 text-app-muted">Saved on this device for up to 24 hours. Restore to review; nothing sends automatically. A fresh location fix is required.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="app-secondary-button" disabled={photoProcessing || submitting || cameraOpen} onClick={restoreCameraDraft}>Restore camera draft</button>
            <button type="button" className="app-secondary-button" disabled={photoProcessing || submitting || cameraOpen} onClick={discardCameraDraft}>Discard saved draft</button>
          </div>
        </section>}

        {isAnonymous && (
          <div className="rounded-xl bg-surface-2 text-app-muted text-sm leading-relaxed px-3 py-3 mb-4 flex items-start gap-2">
            <UserRoundX className="h-4 w-4 shrink-0 mt-px" aria-hidden />
            <span>
              Posting anonymously — no account needed. After the server receives
              your report, nearby volunteers can see it, but they won&apos;t be able to call you back
              for details.{' '}
              <Link to="/login" className="font-medium text-app-ink underline underline-offset-2">
                Sign in
              </Link>{' '}
              to track and update your alert.
            </span>
          </div>
        )}

        {!online && (
          <div role="status" className="rounded-xl bg-surface-2 text-[var(--app-warning)] text-sm leading-relaxed px-3 py-3 mb-4 flex items-start gap-2">
            <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
            <span>Offline — your alert will be queued and sent automatically.</span>
          </div>
        )}
        {pendingCount > 0 && (
          <div role="status" className="rounded-xl bg-surface-2 text-app-muted text-sm px-3 py-3 mb-4 tabular-nums">
            {pendingCount} queued alert{pendingCount !== 1 ? 's' : ''} awaiting connectivity.
          </div>
        )}

        {error && (
          <div role="alert" className="app-feedback-error mb-5 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />
            <span>{error}</span>
          </div>
        )}

        <div className="report-help-actions mb-5">
          <FirstAidButton />
        </div>

        <form onSubmit={submit}>
          <fieldset disabled={submitting || photoProcessing} className="min-w-0 space-y-6 border-0 p-0">
          {assistantOpen && <VoiceReportAssistant categories={CATEGORIES} existingDescription={form.description} isAnonymous={isAnonymous} onClose={() => setAssistantOpen(false)} onApply={draft => { setForm(old => ({ ...old, ...draft })); setAssistantOpen(false) }} />}
          <div>
            <label htmlFor="post-category" className="app-form-label">{t('post_category')}</label>
            <select
              id="post-category"
              value={form.category}
              onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
              className="app-field capitalize"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {t(`cat_${cat}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
              <label htmlFor="post-description" className="app-form-label">
                {t('post_description')}{' '}
                <span className="font-normal text-app-muted hidden sm:inline">{t('post_description_hint')}</span>
              </label>
            </div>
            <textarea
              id="post-description"
              required
              rows={5}
              maxLength={2000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="app-field resize-y"
              placeholder={t('post_description_placeholder')}
            />
            <div className="report-voice-actions mt-3 flex flex-wrap gap-2">
              {/*
                Deliberately large. This is the accessibility path for anyone
                who cannot type quickly or at all, pressed one-handed under
                stress. The old text-xs / py-1 chip was well under the ~44px
                minimum touch target and easy to miss twice before hitting.
              */}
                <button
                  type="button"
                  onClick={voice.listening ? voice.stop : voice.start}
                  disabled={!voice.supported || voice.status === 'stopping' || (voice.native && voice.listening)}
                  aria-pressed={voice.listening}
                  aria-describedby="voice-help"
                  className={`${
                    voice.listening
                      ? 'app-danger-button animate-pulse'
                      : 'app-secondary-button'
                  }`}
                  title={voice.listening ? t('post_voice_tip_stop') : t('post_voice_tip_start')}
                >
                  {voice.listening ? (
                    <MicOff className="h-5 w-5 shrink-0" aria-hidden />
                  ) : (
                    <Mic className="h-5 w-5 shrink-0" aria-hidden />
                  )}
                  {voice.status === 'starting' ? voiceText.starting : voice.status === 'stopping' ? voiceText.stopping : voice.listening ? t('post_voice_recording') : t('post_voice_speak')}
                </button>
                <button type="button" className="app-secondary-button" onClick={() => { voice.cancel(); setAssistantOpen(true) }}>
                  <Mic className="h-5 w-5 shrink-0" aria-hidden />{assistantCopy(lang).title}
                </button>
            </div>

            {/*
              Where the audio goes, stated on screen rather than in a title
              tooltip. This app is used on phones, where a tooltip is not a
              disclosure — it is invisible.

              Chrome's Web Speech API is not on-device: it streams the audio
              to Google for recognition. That is worth saying plainly here,
              and it matters most on the anonymous path, whose whole purpose
              (per the endpoint's own docstring) is domestic abuse and cases
              where the reporter cannot safely identify themselves. A voice
              recording identifies a person more strongly than a name, so
              offering a mic under a promise of anonymity without saying so
              would undercut the guarantee the rest of the app makes.

              An unavailable mic gets a recovery hint rather than disappearing.
            */}
            <p id="voice-help" className="text-xs leading-relaxed text-app-muted mt-2">
              {voice.supported ? voiceText.review : voiceErrorMessage(voice.unavailableReason, lang)}
            </p>
            {voice.supported && (
              <p
                className={`text-xs leading-relaxed mt-1.5 ${
                  isAnonymous ? 'text-[var(--app-warning)]' : 'text-app-muted'
                }`}
              >
                {voice.native ? voiceText.privacy : t('post_voice_privacy')}
                {isAnonymous && <> {t('post_voice_privacy_anon')}</>}
              </p>
            )}
            {voice.interim && <p role="status" className="mt-2 rounded-lg border border-line p-3 text-sm text-app-ink">
              <span className="block text-xs text-app-muted">{voiceText.preview}</span>{voice.interim}
            </p>}
            {voice.error && (
              <p role="alert" className="text-xs text-[var(--app-danger)] mt-2 flex items-start gap-1.5">
                <MicOff className="h-3.5 w-3.5" aria-hidden />
                {voiceErrorMessage(voice.error, lang)}
              </p>
            )}
          </div>

          <div>
            <span id="post-photos-label" className="app-form-label">
              {t('post_photos_label')}
            </span>
            <div role="group" aria-labelledby="post-photos-label" className="grid grid-cols-3 gap-2 mb-2">
              {photos.map((src, i) => (
                <div key={i} className="relative aspect-square rounded-xl overflow-hidden border border-line bg-surface-2">
                  <img src={src} alt={`Camera photo ${i + 1}`} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePhoto(i)}
                    className="photo-remove absolute top-1 right-1 bg-black/70 hover:bg-black text-white h-11 w-11 rounded-full text-lg leading-none flex items-center justify-center"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                  <span className="absolute bottom-1 left-1 bg-black/70 text-white text-[10px] px-1.5 py-0.5 rounded-sm">
                    {approxKb(src)} KB
                  </span>
                </div>
              ))}
              {photos.length < MAX_PHOTOS && (
                <button
                  type="button"
                  onClick={() => { voice.cancel(); setRecoveredPhoto(null); setCameraOpen(true) }}
                  disabled={photoProcessing || submitting}
                  className="aspect-square rounded-xl border border-dashed border-line bg-surface-1 flex flex-col items-center justify-center gap-1 px-2 py-3 text-sm text-app-muted hover:text-app-ink disabled:opacity-55"
                >
                  <Camera className="h-6 w-6 mb-1" aria-hidden />
                  {photoProcessing ? t('post_photo_processing') : t('post_photo_take')}
                </button>
              )}
            </div>
            <p className="text-xs leading-relaxed text-app-muted">{t('post_photos_hint')}</p>
          </div>

          {cameraOpen && (
            <LiveCamera
              busy={photoProcessing}
              initialPhoto={recoveredPhoto}
              onBeforeNativeCapture={beforeNativeCapture}
              onNativeResult={onNativeResult}
              onCapture={onCameraCapture}
              onClose={() => { setCameraOpen(false); setRecoveredPhoto(null) }}
            />
          )}

          <div>
            <label htmlFor="post-location" className="app-form-label">{t('post_location')}</label>
            <div className="flex flex-wrap gap-2">
              <input
                id="post-location"
                readOnly
                value={
                  locationSet
                    ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
                    : locLoading
                      ? t('post_locating')
                      : t('post_location_placeholder')
                }
                className="app-field flex-1 basis-48 tabular-nums"
              />
              {/*
                Only shown once the automatic fix has FAILED. Location is
                requested on mount and is mandatory to submit, so in the
                normal case there is nothing for this button to do — it just
                asked people to press a button for something that had already
                happened. It earns its place only as a retry, which is a real
                need: the first attempt times out indoors often enough.
              */}
              {!locationSet && !locLoading && (
                <button
                  type="button"
                  onClick={detectLocation}
                  className="app-secondary-button flex-1 sm:flex-none"
                >
                  <MapPin className="h-4 w-4 inline-block mr-1 -mt-0.5" aria-hidden />
                  {t('post_retry_location')}
                </button>
              )}
              {locLoading && (
                <span className="min-h-12 px-3 text-sm text-app-muted inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
                    <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                </span>
              )}
            </div>
            {locationSet ? (
              <div className="mt-2">
                <p className="text-xs text-[var(--app-success)] inline-flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  {t('post_location_captured')}
                </p>
                {/*
                  The address is the check a human can actually perform.
                  Coordinates look plausible whatever they say, so a fix that
                  landed in the wrong sector is invisible until volunteers
                  arrive somewhere nobody needs them. Absent while the lookup
                  is in flight, and permanently absent if it fails — it is a
                  reassurance, not a requirement.
                */}
                {address && (
                  <p className="text-sm leading-relaxed text-app-muted mt-1.5 flex items-start gap-1.5">
                    <MapPin className="h-4 w-4 mt-0.5 shrink-0" aria-hidden />
                    <span>{address}</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs leading-relaxed text-[var(--app-warning)] mt-2">
                {locLoading ? t('post_locating') : t('post_location_required')}
              </p>
            )}
          </div>

          {/* Signed-in only. The anonymous endpoint has no drill flag at
              all, so nobody can create uncounted alerts without an account. */}
          {!isAnonymous && (
            <label className="flex items-start gap-3 rounded-xl border border-line bg-surface-1 px-3 py-3 text-sm text-app-ink">
              <input
                type="checkbox"
                checked={isDrill}
                onChange={(e) => setIsDrill(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-orange-500"
              />
              <span>
                {t('drill_label')}
                <span className="mt-1 block text-xs leading-relaxed text-app-muted">
                  {t('drill_hint')}
                </span>
              </span>
            </label>
          )}

          <button
            type="submit"
            disabled={submitting || photoProcessing || cameraOpen || !locationSet}
            className="app-danger-button w-full"
          >
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
          </fieldset>
        </form>
      </div>
    </div>
  )
}
