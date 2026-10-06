import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from './Toast'
import { useI18n } from '../utils/i18n'
import { apiUrl } from '../utils/runtime'
import {
  canDeliverQueuedAlert,
  flushQueue,
  getCurrentAccountId,
  listPending,
  OFFLINE_QUEUE_EVENT,
} from '../utils/offlineQueue'

export async function postQueuedAlert(payload, { anonymous, accountId }) {
  const token = anonymous ? null : localStorage.getItem('token')
  if (!anonymous && (!accountId || !token || getCurrentAccountId(token) !== accountId)) {
    throw new Error('Original reporting account is required')
  }
  try {
    // The shared api interceptor reads localStorage later and could overwrite
    // credentials after an account switch. Pin this request to its checked token.
    return await axios.post(
      apiUrl(anonymous ? '/api/alerts/anonymous' : '/api/alerts/'),
      payload,
      { timeout: 20000, headers: token ? { Authorization: `Bearer ${token}` } : {} },
    )
  } catch (error) {
    // An old request must not log out a newly signed-in account.
    if (token && error?.response?.status === 401 && localStorage.getItem('token') === token) {
      localStorage.removeItem('token')
      localStorage.removeItem('name')
      window.dispatchEvent(new Event('auth:logout'))
    }
    throw error
  }
}

export default function OfflineQueueStatus() {
  const { user } = useAuth()
  const { push: toast } = useToast()
  const { t } = useI18n()
  const [rows, setRows] = useState([])
  const [online, setOnline] = useState(() => navigator.onLine)
  const [sending, setSending] = useState(false)
  const [storageError, setStorageError] = useState(false)

  // The parent can add these keys to all dictionaries without blocking this slice.
  const text = useCallback((key, fallback) => {
    const translated = t(key)
    return translated === key ? fallback : translated
  }, [t])

  useEffect(() => {
    let active = true
    let busy = false
    let retryRequested = false
    const refresh = async () => {
      try {
        const pending = await listPending()
        if (active) {
          setRows(pending)
          setStorageError(false)
        }
        return pending
      } catch {
        if (active) setStorageError(true)
        return []
      }
    }
    const retry = async () => {
      if (busy) {
        retryRequested = true
        return
      }
      busy = true
      try {
        const pending = await refresh()
        if (!active || !navigator.onLine || !pending.some((row) => canDeliverQueuedAlert(row))) return
        setSending(true)
        const { sent } = await flushQueue(postQueuedAlert)
        if (active && sent > 0) {
          toast({
            variant: 'success',
            title: text('queue_sent_title', 'Queued alerts sent'),
            body: text('queue_sent_body', 'Reports delivered: {count}').replace('{count}', String(sent)),
          })
        }
      } catch {
        // Rows remain saved; the status strip offers a manual retry.
      } finally {
        if (active) {
          setSending(false)
          await refresh()
        }
        busy = false
        if (active && retryRequested) {
          retryRequested = false
          void retry()
        }
      }
    }
    const onConnection = () => {
      setOnline(navigator.onLine)
      void retry()
    }
    const onQueueChange = (event) => {
      if (event.detail?.type === 'enqueued') void retry()
      else void refresh()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void retry()
    }
    void retry()
    const timer = setInterval(onVisible, 60000)
    window.addEventListener('online', onConnection)
    window.addEventListener('offline', onConnection)
    window.addEventListener(OFFLINE_QUEUE_EVENT, onQueueChange)
    window.addEventListener('offline-queue:retry', retry)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      clearInterval(timer)
      window.removeEventListener('online', onConnection)
      window.removeEventListener('offline', onConnection)
      window.removeEventListener(OFFLINE_QUEUE_EVENT, onQueueChange)
      window.removeEventListener('offline-queue:retry', retry)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user?.id, toast, text])

  if (!rows.length && !storageError) return null
  const blocked = rows.filter((row) => !canDeliverQueuedAlert(row))
  const unknownOwner = blocked.some((row) => !row.accountId)
  const guidance = storageError
    ? text('queue_storage_error', 'Could not read saved reports. Retry to check their status.')
    : !online
      ? text('queue_offline', 'Saved on this device. Delivery resumes when you reconnect.')
      : unknownOwner
        ? text('queue_unknown_owner', 'Some saved reports have no account recorded. They remain on this device.')
        : blocked.length
          ? text('queue_account_required', 'Some reports need their original account. Sign in to that account to send them.')
          : text('queue_waiting', 'Saved on this device until delivery succeeds.')

  return (
    <div className="border-b border-orange-500/30 bg-black px-4 py-2.5 text-sm text-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="status" aria-live="polite" className="min-w-0 flex-1">
          {rows.length > 0 && (
            <p className="font-medium">
              {text('queue_pending', 'Reports waiting to send: {count}').replace('{count}', String(rows.length))}
            </p>
          )}
          <p className="text-xs text-gray-300">{guidance}</p>
        </div>
        <button
          type="button"
          disabled={!online || sending || (!storageError && blocked.length === rows.length)}
          aria-busy={sending}
          onClick={() => window.dispatchEvent(new Event('offline-queue:retry'))}
          className="tap shrink-0 rounded-lg border border-orange-500 px-3 text-orange-300 hover:bg-orange-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? text('queue_sending', 'Sending…') : text('queue_retry', 'Retry now')}
        </button>
      </div>
    </div>
  )
}
