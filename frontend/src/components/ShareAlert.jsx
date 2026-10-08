import { useMemo, useState } from 'react'
import { MessageCircle, Share2, X } from './icons'
import { useToast } from './Toast'
import NativeOverlay from './NativeOverlay'
import { useDialog } from '../hooks/useDialog'
import { nativeShareAlert, publicAlertUrl } from '../utils/nativeShare'

/** Review the public link before opening another app. No private report text. */
export default function ShareAlert({ alert }) {
  const [open, setOpen] = useState(false)
  return <><button type="button" onClick={() => setOpen(true)} className="tap app-secondary-button" title="Share this alert"><Share2 className="h-4 w-4" aria-hidden />Share</button>{open && <ShareDialog alert={alert} onClose={() => setOpen(false)} />}</>
}

function ShareDialog({ alert, onClose }) {
  const { push: toast } = useToast()
  const dialog = useDialog(onClose)
  const [qr, setQr] = useState(false)
  const [qrFailed, setQrFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const shareUrl = useMemo(() => publicAlertUrl(alert?.id), [alert?.id])
  const share = async () => {
    setBusy(true)
    try {
      if (await nativeShareAlert(alert?.id)) return
      if (typeof navigator.share === 'function') await navigator.share({ title: 'NeighbourAid alert', url: shareUrl })
      else toast({ variant: 'info', title: 'Use Copy link or WhatsApp below' })
    } catch (err) {
      if (err?.name !== 'AbortError' && !/cancel/i.test(err?.message || '')) toast({ variant: 'warning', title: 'Could not open sharing', body: 'Copy the link instead.' })
    } finally { setBusy(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); toast({ variant: 'success', title: 'Link copied' }) }
    catch { toast({ variant: 'warning', title: 'Copy failed', body: 'Long-press the link to copy manually.' }) }
  }
  const waUrl = `https://wa.me/?text=${encodeURIComponent(shareUrl)}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=0&data=${encodeURIComponent(shareUrl)}`
  return <NativeOverlay><div className="flex h-full items-end justify-center bg-black/60 p-3 sm:items-center" onClick={onClose}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="share-alert-title" tabIndex={-1} className="surface-float max-h-full w-full max-w-md overflow-y-auto p-4 sm:p-6" onClick={event => event.stopPropagation()}>
      <header className="mb-3 flex items-center justify-between gap-2"><h2 id="share-alert-title" className="text-lg font-semibold text-app-ink">Share public alert link</h2><button type="button" className="tap app-secondary-button h-12 w-12 shrink-0" aria-label="Close" onClick={onClose}><X className="h-5 w-5" aria-hidden /></button></header>
      <p className="text-sm leading-relaxed text-app-muted">Anyone with this link can see the public report and its reported location. The shared message contains only this link, not phone numbers, live responder positions or your account details.</p>
      <label htmlFor="share-alert-url" className="app-form-label mt-4">Public link</label>
      <input id="share-alert-url" readOnly value={shareUrl} onFocus={event => event.target.select()} className="app-field mt-2 w-full text-sm" />
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => { void share() }} className="tap app-primary-button w-full sm:w-auto"><Share2 className="h-4 w-4" aria-hidden />{busy ? 'Opening…' : 'Choose an app'}</button><button type="button" onClick={() => { void copy() }} className="tap app-secondary-button w-full sm:w-auto">Copy link</button><a href={waUrl} target="_blank" rel="noopener noreferrer" className="tap app-secondary-button w-full sm:w-auto"><MessageCircle className="h-4 w-4" aria-hidden />WhatsApp</a></div>
      <div className="mt-4 border-t border-line pt-4"><p className="mb-3 text-xs leading-relaxed text-app-muted">QR generation sends this public link to an external QR service. It is optional; copying the link needs no QR service.</p><button type="button" className="tap app-secondary-button w-full" onClick={() => { setQr(true); setQrFailed(false) }}>{qr ? 'Regenerate QR code' : 'Generate QR code'}</button>{qr && !qrFailed && <img src={qrUrl} alt="QR code for the public alert link" width={220} height={220} className="mx-auto mt-3 max-w-full rounded-xl bg-white p-2" onError={() => setQrFailed(true)} />}{qrFailed && <p role="status" className="mt-3 text-sm text-app-muted">QR service unavailable. Copy the link instead.</p>}</div>
    </section>
  </div></NativeOverlay>
}
