import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, Share2 } from './icons'
import { useToast } from './Toast'

/**
 * Share an alert outside the app — WhatsApp, SMS, anywhere someone has a
 * phone. Uses the Web Share API when available (native sheet on mobile),
 * and falls back to a modal with copy-to-clipboard + QR code on desktop.
 *
 * QR codes are rendered via the free goqr.me endpoint — no npm dep, no
 * build-time asset. If the endpoint is blocked, the link and Copy button
 * still work.
 */
export default function ShareAlert({ alert }) {
  const { push: toast } = useToast()
  const [open, setOpen] = useState(false)
  const firstFocusRef = useRef(null)

  const shareUrl = useMemo(() => {
    if (!alert?.id) return typeof window !== 'undefined' ? window.location.origin : ''
    const base = typeof window !== 'undefined' ? window.location.origin : ''
    return `${base}/alert/${alert.id}`
  }, [alert?.id])

  const shareText = useMemo(() => {
    const urgency = alert?.urgency ? `${alert.urgency} · ` : ''
    const cat = alert?.category ? `${alert.category}` : 'crisis'
    // Plain text, not an emoji pin: this string is handed to WhatsApp/SMS,
    // and some SMS gateways transcode a non-GSM-7 character into a UCS-2
    // message, which halves the per-segment length and can split the alert.
    const where = alert?.address ? `\nLocation: ${alert.address}` : ''
    const desc = alert?.description ? `\n${alert.description}` : ''
    return `${urgency}${cat} on NeighbourAid${desc}${where}\n${shareUrl}`
  }, [alert, shareUrl])

  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  useEffect(() => {
    if (!open) return undefined
    firstFocusRef.current?.focus?.()
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const onClick = async () => {
    if (canNativeShare) {
      try {
        await navigator.share({
          title: `${alert?.urgency || ''} ${alert?.category || 'Crisis'} alert`.trim(),
          text: shareText,
          url: shareUrl,
        })
        return
      } catch {
        // user cancelled or share failed — fall through to modal
      }
    }
    setOpen(true)
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      toast({ variant: 'success', title: 'Link copied', body: shareUrl })
    } catch {
      toast({ variant: 'warning', title: 'Copy failed', body: 'Long-press the link to copy manually.' })
    }
  }

  const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(shareUrl)}`

  return (
    <>
      <button
        onClick={onClick}
        className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded-lg transition-colors inline-flex items-center gap-1"
        title="Share this alert"
      >
        <Share2 className="h-3.5 w-3.5" aria-hidden />
        Share
      </button>
      {open && (
        <div
          className="fixed inset-0 z-950 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Share alert"
        >
          <div
            className="bg-gray-900 border border-gray-800 rounded-2xl w-full sm:max-w-md p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base sm:text-lg font-bold text-white">Share this alert</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-200 text-2xl leading-none px-2 -mr-2"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="flex justify-center mb-4">
              <img
                src={qrUrl}
                alt="QR code for alert link"
                width={220}
                height={220}
                className="rounded-lg border border-gray-800 bg-white p-2"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  ref={firstFocusRef}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-2 text-xs"
                />
                <button
                  onClick={copy}
                  className="bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold px-3 py-2 rounded-lg whitespace-nowrap"
                >
                  Copy
                </button>
              </div>
              <a
                href={waUrl}
                target="_blank"
                rel="noreferrer"
                className="flex w-full items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 rounded-lg text-sm"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                Share via WhatsApp
              </a>
            </div>

            <p className="text-[11px] text-gray-500 leading-relaxed">
              Anyone with this link can view the alert — useful for tagging neighbours who
              aren&apos;t on NeighbourAid yet.
            </p>
          </div>
        </div>
      )}
    </>
  )
}
