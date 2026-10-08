import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Camera, X } from './icons'
import NativeOverlay from './NativeOverlay'
import { useDialog } from '../hooks/useDialog'
import { cameraPhotoBlob, hasNativeCamera, isCameraCancelled, takeNativePhoto } from '../utils/nativeCamera'

const ERRORS = {
  denied: 'Camera access was refused. Allow camera access in your browser or device settings, then retry.',
  missing: 'No camera was found. Connect or enable a camera, then retry.',
  inuse: 'The camera could not start. Close other apps using it, then retry.',
  unsupported: 'Live camera capture is not available here. You can continue your report without a photo.',
  paused: 'Camera paused while the app was hidden. Resume when you are ready.',
  capture: 'The photo could not be captured. Try taking it again.',
  controls: 'This camera setting could not be changed. Other capture controls still work.',
  native: 'The device photo could not be prepared. Retry, or use the in-app live camera.',
  recovery: 'The draft or capture result could not be saved safely. Retry before opening the device camera.',
  attach: 'The photo could not be attached. Your preview is still here; try Use photo again.',
}
function cameraError(error) {
  const name = String(error?.name || error?.code || '')
  const message = String(error?.message || '')
  if (/NotAllowed|Security|permission|denied/i.test(name + ' ' + message)) return 'denied'
  if (/NotFound|DevicesNotFound/i.test(name)) return 'missing'
  if (/NotReadable|TrackStart|in use|busy/i.test(name + ' ' + message)) return 'inuse'
  return 'inuse'
}
function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' && reader.result.startsWith('data:image/')
      ? resolve(reader.result) : reject(new Error('Invalid camera image'))
    reader.onerror = () => reject(new Error('Camera image could not be read'))
    reader.readAsDataURL(blob)
  })
}

/** Camera only. Neither path opens a file picker or gallery; photos are reviewed before attachment. */
export default function LiveCamera({ onCapture, onClose, busy = false, initialPhoto = null, onBeforeNativeCapture, onNativeResult }) {
  const nativeAvailable = hasNativeCamera()
  const [mode, setMode] = useState(() => nativeAvailable ? 'native' : 'browser')
  const [review, setReview] = useState(() => typeof initialPhoto === 'string' && initialPhoto.startsWith('data:image/') ? initialPhoto : null)
  const [facing, setFacing] = useState('environment')
  const [actualFacing, setActualFacing] = useState('environment')
  const [attempt, setAttempt] = useState(0)
  const [paused, setPaused] = useState(() => document.visibilityState !== 'visible')
  const [ready, setReady] = useState(false)
  const [starting, setStarting] = useState(true)
  const [error, setError] = useState('')
  const [attaching, setAttaching] = useState(false)
  const [nativePending, setNativePending] = useState(false)
  const [controlsBusy, setControlsBusy] = useState(false)
  const [capabilities, setCapabilities] = useState({ torch: false, zoom: null })
  const [torch, setTorch] = useState(false)
  const [zoom, setZoom] = useState(1)
  const titleId = useId(), zoomId = useId()
  const video = useRef(null), stream = useRef(null), request = useRef(0)
  const mounted = useRef(false), operation = useRef(false), setting = useRef(false)
  const stop = useCallback(() => {
    request.current += 1
    stream.current?.getTracks().forEach(track => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }, [])
  const close = useCallback(() => {
    if (busy || operation.current) return
    stop()
    onClose()
  }, [busy, onClose, stop])
  const dialog = useDialog(close)
  const locked = busy || attaching || nativePending

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; stop() }
  }, [stop])
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'visible') return
      stop()
      setReady(false)
      setPaused(true)
      setStarting(false)
    }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [stop])

  useEffect(() => {
    if (mode !== 'browser' || review || paused) return undefined
    let cancelled = false, ownStream, endedTrack
    const ticket = ++request.current
    setReady(false); setStarting(true); setError(''); setTorch(false)
    setCapabilities({ torch: false, zoom: null })
    const ended = () => {
      if (cancelled || request.current !== ticket) return
      stop(); setReady(false); setStarting(false); setError('inuse')
    }
    const start = async () => {
      if (document.visibilityState !== 'visible') return
      if (!navigator.mediaDevices?.getUserMedia) { setError('unsupported'); setStarting(false); return }
      try {
        ownStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
        })
        if (cancelled || !mounted.current || request.current !== ticket || document.visibilityState !== 'visible') {
          ownStream.getTracks().forEach(track => track.stop())
          return
        }
        stream.current = ownStream
        const track = ownStream.getVideoTracks?.()[0] || ownStream.getTracks()[0]
        endedTrack = track
        track?.addEventListener?.('ended', ended)
        let caps = {}, settings = {}
        try { caps = track?.getCapabilities?.() || {}; settings = track?.getSettings?.() || {} } catch { /* Optional hardware features. */ }
        const range = caps.zoom
        const zoomRange = typeof track?.applyConstraints === 'function' && Number.isFinite(range?.min) && Number.isFinite(range?.max) && range.max > range.min
          ? { min: range.min, max: range.max, step: Number.isFinite(range.step) && range.step > 0 ? range.step : .1 } : null
        setCapabilities({ torch: typeof track?.applyConstraints === 'function' && (caps.torch === true || caps.torch?.includes?.(true) === true), zoom: zoomRange })
        setZoom(zoomRange ? Math.max(zoomRange.min, Math.min(zoomRange.max, settings.zoom || zoomRange.min)) : 1)
        setActualFacing(['user', 'environment'].includes(settings.facingMode) ? settings.facingMode : facing)
        if (video.current) {
          video.current.srcObject = ownStream
          await video.current.play()
        }
        // Only loaded metadata with real nonzero dimensions makes capture ready.
      } catch (cause) {
        if (cancelled || !mounted.current || request.current !== ticket) return
        stop(); setReady(false); setStarting(false); setError(cameraError(cause))
      }
    }
    void start()
    return () => {
      cancelled = true
      endedTrack?.removeEventListener?.('ended', ended)
      if (stream.current === ownStream) stop()
      else ownStream?.getTracks().forEach(track => track.stop())
      if (request.current === ticket) request.current += 1
    }
  }, [attempt, facing, mode, paused, review, stop])

  const metadata = event => {
    if (!stream.current || event.currentTarget.srcObject !== stream.current || document.visibilityState !== 'visible') return
    const valid = event.currentTarget.videoWidth > 0 && event.currentTarget.videoHeight > 0
    setReady(valid); setStarting(!valid)
  }
  const resume = () => { if (document.visibilityState !== 'visible') return; setPaused(false); setError(''); setAttempt(value => value + 1) }
  const retake = () => {
    if (locked) return
    stop(); setReview(null); setReady(false); setError(''); setPaused(document.visibilityState !== 'visible'); setAttempt(value => value + 1)
  }
  const shoot = () => {
    if (!ready || locked || controlsBusy || !stream.current || document.visibilityState !== 'visible') return
    const element = video.current
    if (!element?.videoWidth || !element.videoHeight) return
    try {
      const canvas = document.createElement('canvas')
      const scale = Math.min(1, 1280 / Math.max(element.videoWidth, element.videoHeight))
      canvas.width = Math.max(1, Math.round(element.videoWidth * scale))
      canvas.height = Math.max(1, Math.round(element.videoHeight * scale))
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Camera frame unavailable')
      // The front preview is mirrored for framing; the saved pixels are not.
      context.drawImage(element, 0, 0, canvas.width, canvas.height)
      const photo = canvas.toDataURL('image/jpeg', .75)
      if (!photo.startsWith('data:image/jpeg')) throw new Error('Invalid camera frame')
      stop(); setReady(false); setError(''); setReview(photo)
    } catch { setError('capture') }
  }
  const changeSetting = async (name, value) => {
    if (locked || setting.current || !ready) return
    const track = stream.current?.getVideoTracks?.()[0] || stream.current?.getTracks()[0]
    if (typeof track?.applyConstraints !== 'function') return
    setting.current = true; setControlsBusy(true); setError('')
    try {
      await track.applyConstraints({ advanced: [{ [name]: value }] })
      if (!mounted.current || !stream.current?.getTracks().includes(track)) return
      if (name === 'torch') setTorch(value)
      else setZoom(value)
    } catch { if (mounted.current && stream.current?.getTracks().includes(track)) setError('controls') }
    finally { setting.current = false; if (mounted.current) setControlsBusy(false) }
  }
  const launchNative = async () => {
    if (locked || operation.current || !hasNativeCamera()) return
    operation.current = true; setNativePending(true); setError('')
    let sessionId, result = null, stage = 'recovery'
    try {
      if (typeof onBeforeNativeCapture !== 'function' || typeof onNativeResult !== 'function') throw new Error('Capture recovery is not ready')
      sessionId = await onBeforeNativeCapture()
      if (!sessionId) throw new Error('Capture draft was not saved')
      if (!mounted.current) { await onNativeResult(sessionId, null); return }
      stage = 'native'
      let captureError
      try { result = await takeNativePhoto() } catch (cause) { if (!isCameraCancelled(cause)) captureError = cause }
      stage = 'recovery'
      await onNativeResult(sessionId, result)
      if (captureError) { stage = cameraError(captureError); throw captureError }
      if (!result || !mounted.current) return
      stage = 'native'
      const dataUrl = await blobDataUrl(await cameraPhotoBlob(result))
      if (mounted.current) { setReview(dataUrl); setReady(false); setError('') }
    } catch { if (mounted.current) setError(stage) }
    finally { operation.current = false; if (mounted.current) setNativePending(false) }
  }
  const attachPhoto = async () => {
    if (!review || locked || operation.current) return
    operation.current = true; setAttaching(true); setError('')
    try {
      const saved = await onCapture(review)
      if (saved === false) throw new Error('Photo was not attached')
      if (mounted.current) onClose()
    } catch { if (mounted.current) setError('attach') }
    finally { operation.current = false; if (mounted.current) setAttaching(false) }
  }

  return <NativeOverlay><section ref={dialog} role="dialog" aria-modal="true" aria-label="Take a photo" aria-labelledby={titleId} aria-busy={locked} tabIndex={-1} className="camera-dialog flex h-full min-h-0 flex-col bg-surface-1 text-app-ink">
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
      <h2 id={titleId} className="min-w-0 text-base font-semibold">{review ? 'Review photo' : 'Take a photo'}</h2>
      <button type="button" onClick={close} disabled={locked} aria-label="Close camera" className="tap app-secondary-button h-12 w-12 shrink-0 p-0"><X className="h-5 w-5" aria-hidden /></button>
    </header>
    <div className="relative flex min-h-32 flex-1 items-center justify-center overflow-hidden bg-[#000] p-2 text-[#fff]">
      {review ? <img src={review} alt="Photo ready for review" className="max-h-full max-w-full object-contain" />
        : mode === 'native' ? <p className="max-w-sm px-4 text-center text-sm leading-relaxed text-[#fff]">{nativePending ? 'Preparing your camera photo…' : 'Open your device camera to take a new photo. You will review it here before attachment.'}</p>
          : <><video key={facing + ':' + attempt} ref={video} playsInline muted onLoadedMetadata={metadata} aria-label="Live camera preview" className="max-h-full max-w-full object-contain" style={actualFacing === 'user' ? { transform: 'scaleX(-1)' } : undefined} />{(!ready || paused) && <p role="status" className="absolute inset-x-4 bottom-4 rounded-lg bg-[#000]/80 p-3 text-center text-sm text-[#fff]">{paused ? ERRORS.paused : error ? ERRORS[error] : starting ? 'Starting camera…' : 'Waiting for the camera preview…'}</p>}</>}
    </div>
    <footer className="max-h-[45%] shrink-0 overflow-y-auto border-t border-line px-4 py-4">
      {error && <p role="alert" className="mb-3 text-sm leading-relaxed text-app-ink">{ERRORS[error] || ERRORS.native}</p>}
      {review ? <>
        <p className="mb-3 text-sm leading-relaxed text-app-muted">Check the photo before attaching. A camera photo does not prove a report is true.</p>
        <div className="flex flex-wrap gap-3"><button type="button" onClick={retake} disabled={locked} className="tap app-secondary-button flex-1">Retake</button><button type="button" onClick={() => { void attachPhoto() }} disabled={locked} className="tap app-primary-button flex-1">{attaching || busy ? 'Attaching photo…' : 'Use photo'}</button></div>
      </> : mode === 'native' ? <div className="space-y-3">
        <button type="button" onClick={() => { void launchNative() }} disabled={locked} className="tap app-primary-button w-full"><Camera className="h-5 w-5 shrink-0" aria-hidden />{nativePending ? 'Opening camera…' : 'Open device camera'}</button>
        <button type="button" disabled={locked} onClick={() => { stop(); setMode('browser'); setPaused(document.visibilityState !== 'visible'); setError('') }} className="tap app-secondary-button w-full">Use in-app live camera</button>
        <p className="text-xs leading-relaxed text-app-muted">The in-app camera needs its own camera permission. It cannot bypass device restrictions. No gallery or file picker is used.</p>
      </div> : <div className="space-y-3">
        <div className="flex flex-wrap gap-2"><button type="button" onClick={shoot} disabled={!ready || locked || controlsBusy || paused} className="tap app-primary-button flex-1"><Camera className="h-5 w-5 shrink-0" aria-hidden />Capture photo</button><button type="button" disabled={locked || controlsBusy || starting || paused} onClick={() => { stop(); setReady(false); setFacing(actualFacing === 'user' ? 'environment' : 'user'); setAttempt(value => value + 1) }} className="tap app-secondary-button flex-1">Switch camera</button></div>
        {(paused || error) && <button type="button" onClick={resume} disabled={locked} className="tap app-secondary-button w-full">{paused ? 'Resume camera' : 'Retry camera'}</button>}
        {capabilities.torch && <button type="button" disabled={!ready || locked || controlsBusy} onClick={() => { void changeSetting('torch', !torch) }} aria-pressed={torch} className="tap app-secondary-button w-full">{torch ? 'Turn torch off' : 'Turn torch on'}</button>}
        {capabilities.zoom && <div><label htmlFor={zoomId} className="app-form-label">Zoom: {zoom.toFixed(1)}×</label><input id={zoomId} type="range" min={capabilities.zoom.min} max={capabilities.zoom.max} step={capabilities.zoom.step} value={zoom} onChange={event => { void changeSetting('zoom', Number(event.target.value)) }} disabled={!ready || locked || controlsBusy} className="min-h-12 w-full accent-accent" /></div>}
        {nativeAvailable && <button type="button" disabled={locked} onClick={() => { stop(); setMode('native'); setReady(false); setError('') }} className="tap app-secondary-button w-full">Use device camera</button>}
      </div>}
    </footer>
  </section></NativeOverlay>
}
