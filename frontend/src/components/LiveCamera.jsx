import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, X } from './icons'

/**
 * In-app camera capture. Opens the device camera, shows a live preview, and
 * returns a frame grabbed from that stream.
 *
 * WHY NOT A FILE INPUT
 *
 * `<input type="file" accept="image/*" capture="environment">` is only a
 * HINT. Browsers are free to ignore it, and most still offer the gallery
 * alongside the camera; on desktop it is ignored entirely. So the previous
 * flow let anyone attach any image they liked — including one saved from the
 * internet, or a photo of a different incident from last year.
 *
 * That matters here more than in a normal app. Photos on an alert are
 * evidence: volunteers decide whether to travel based on them, and
 * `photo_checks` feeds the verification score other people see. A stock
 * photo of a fire is a very cheap way to send strangers to an address.
 *
 * Grabbing the frame from a live MediaStream means the image cannot come
 * from storage. Honest limit: it cannot prove the scene is real either — a
 * virtual camera, or simply pointing the phone at a screen, still works. It
 * raises the effort from "attach any file" to "deliberately fake a camera",
 * which is the realistic bar for a free app.
 *
 * Cleanup is not optional: every path that leaves this component must stop
 * the stream, or the camera light stays on after the user is done, which
 * users reasonably read as spyware.
 */
export default function LiveCamera({ onCapture, onClose, busy = false }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => {
    let cancelled = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError('unsupported')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // Rear camera where there is one. `ideal` rather than `exact` so a
          // laptop with only a front camera still works instead of throwing.
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setReady(true)
      } catch (err) {
        // NotAllowedError is a deliberate refusal; anything else is the
        // camera being missing or held by another app. Both end the same way
        // for the user, but only the first is worth apologising for.
        setError(err?.name === 'NotAllowedError' ? 'denied' : 'unavailable')
      }
    }

    start()
    return () => {
      cancelled = true
      stop()
    }
  }, [stop])

  const shoot = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    // Cap the long edge: a modern phone sensor produces something far larger
    // than anyone needs to recognise a scene, and the payload is base64 in a
    // JSON body. compressImage() shrinks it further downstream.
    const maxEdge = 1280
    const scale = Math.min(1, maxEdge / Math.max(video.videoWidth, video.videoHeight))
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
    onCapture(canvas.toDataURL('image/jpeg', 0.75))
  }

  const close = () => {
    stop()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col" role="dialog" aria-modal="true">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm font-medium">Take a photo</span>
        <button
          type="button"
          onClick={close}
          className="p-2 -mr-2 text-gray-300 hover:text-white"
          aria-label="Close camera"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div className="flex-1 relative flex items-center justify-center overflow-hidden">
        {error ? (
          <p className="text-center text-sm text-amber-300 px-8">
            {error === 'denied'
              ? 'Camera permission was refused. Allow camera access in your browser settings to attach a photo.'
              : error === 'unsupported'
                ? 'This browser cannot open the camera.'
                : 'No camera available, or it is in use by another app.'}
          </p>
        ) : (
          <video
            ref={videoRef}
            playsInline
            muted
            className="max-h-full max-w-full object-contain"
          />
        )}
      </div>

      <div className="px-4 py-6 flex items-center justify-center">
        <button
          type="button"
          onClick={shoot}
          disabled={!ready || !!error || busy}
          // Large and centred: this is pressed one-handed, in a hurry,
          // possibly by someone whose other hand is holding a torch.
          className="h-16 w-16 rounded-full bg-white disabled:opacity-40 ring-4 ring-white/30 active:scale-95 transition-transform flex items-center justify-center"
          aria-label="Capture photo"
        >
          <Camera className="h-7 w-7 text-black" aria-hidden />
        </button>
      </div>
    </div>
  )
}
