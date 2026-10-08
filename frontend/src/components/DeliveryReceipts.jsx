import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useDialog } from '../hooks/useDialog'
import { canReadQueuedAlert, cancelPending, listPending, listReceipts, OFFLINE_QUEUE_EVENT } from '../utils/offlineQueue'
import NativeOverlay from './NativeOverlay'

function ReceiptDialog({ pending, receipts, refresh, onClose }) {
  const ref = useDialog(onClose)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const cancel = async row => {
    if (!window.confirm('Cancel this saved report? It will no longer be sent from this device. A report already received by the server is not withdrawn.')) return
    setBusy(true)
    try {
      const cancelled = await cancelPending(row.id)
      setMessage(cancelled ? 'Saved report cancelled on this device.' : 'This report was already delivered or requires its original account.')
      await refresh()
    } catch { setMessage('Could not cancel. The saved report remains on this device.') }
    finally { setBusy(false) }
  }
  return <NativeOverlay><div className="flex h-full items-center justify-center bg-black/60 p-3">
    <section ref={ref} role="dialog" aria-modal="true" aria-labelledby="delivery-receipts-title" tabIndex={-1} className="flex max-h-full w-full max-w-lg flex-col rounded-2xl border border-line bg-surface text-app-ink">
      <header className="flex items-center justify-between gap-2 border-b border-line p-4"><h2 id="delivery-receipts-title" className="text-lg font-semibold">Delivery receipts</h2><button type="button" className="tap rounded-lg px-3" onClick={onClose} aria-label="Close">Close</button></header>
      <div className="min-h-0 space-y-4 overflow-y-auto p-4">
        <p className="text-sm leading-relaxed text-app-muted">Saved on device → Server received → Volunteer accepts. A receipt is not confirmation that help has arrived. Received receipts are kept on this device for up to 30 days.</p>
        {message && <p role="status" className="text-sm text-app-muted">{message}</p>}
        {pending.map(row => <article key={`pending-${row.id}`} className="rounded-xl border border-line p-3">
          <h3 className="font-semibold">Saved on device · Delivery unconfirmed</h3>
          {row.deliveryState === 'needs_review' && <p className="mt-1 text-sm text-app-muted">The server rejected this report. Automatic retries are paused. Review it before cancelling and submitting a corrected report.</p>}
          <p className="mt-1 break-words text-sm text-app-muted">{row.payload.description?.slice(0, 160)}</p>
          <p className="mt-1 text-xs text-app-muted">Saved {new Date(row.created_at).toLocaleString()} · {row.attempts || 0} retry attempts</p>
          <button type="button" disabled={busy} onClick={() => cancel(row)} className="tap mt-2 rounded-lg border border-line px-3 text-sm disabled:opacity-50">Cancel saved report</button>
        </article>)}
        {receipts.map(row => <article key={row.id} className="rounded-xl border border-line p-3">
          <h3 className="font-semibold">Server received</h3>
          <p className="mt-1 text-xs text-app-muted">Acknowledged {new Date(row.received_at).toLocaleString()}</p>
          <Link onClick={onClose} to={`/alert/${encodeURIComponent(row.alertId)}`} className="tap mt-2 inline-flex items-center rounded-lg border border-line px-3 text-sm">Check current volunteer status</Link>
        </article>)}
        {!pending.length && !receipts.length && <p className="text-sm text-app-muted">No receipts for this account on this device.</p>}
      </div>
    </section>
  </div></NativeOverlay>
}

export default function DeliveryReceipts() {
  const { user } = useAuth()
  const accountId = user?.id || null
  const [state, setState] = useState({ accountId, pending: [], receipts: [] })
  const [open, setOpen] = useState(false)
  const refresh = useCallback(async () => {
    const [pending, receipts] = await Promise.all([listPending(), listReceipts(accountId)])
    setState({ accountId, pending: pending.filter(row => canReadQueuedAlert(row, accountId)), receipts })
  }, [accountId])
  useEffect(() => {
    let alive = true
    const update = async () => {
      try {
        const [pending, receipts] = await Promise.all([listPending(), listReceipts(accountId)])
        if (alive) setState({ accountId, pending: pending.filter(row => canReadQueuedAlert(row, accountId)), receipts })
      } catch { /* Queue strip separately reports device-storage failures. */ }
    }
    void update()
    window.addEventListener(OFFLINE_QUEUE_EVENT, update)
    window.addEventListener('auth:logout', update)
    return () => { alive = false; window.removeEventListener(OFFLINE_QUEUE_EVENT, update); window.removeEventListener('auth:logout', update) }
  }, [accountId])
  // Account switches hide old data immediately, before IndexedDB finishes.
  const visible = state.accountId === accountId ? state : { pending: [], receipts: [] }
  if (!visible.pending.length && !visible.receipts.length && !open) return null
  return <>
    <div className="border-b border-line bg-surface px-4 text-app-muted"><button type="button" className="tap flex w-full items-center justify-between gap-2 text-left text-sm" onClick={() => setOpen(true)}><span>Delivery receipts</span><span>{visible.pending.length} waiting · {visible.receipts.length} received</span></button></div>
    {open && <ReceiptDialog key={accountId || 'anonymous'} {...visible} refresh={refresh} onClose={() => setOpen(false)} />}
  </>
}
