import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Siren } from './icons'

const ToastContext = createContext(null)

let nextId = 1

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, leaving: true } : t))
    )
    const h = timers.current.get(id)
    if (h) {
      clearTimeout(h)
      timers.current.delete(id)
    }
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 220)
  }, [])

  const push = useCallback(
    ({ title, body, variant = 'info', ttl = 6000 }) => {
      const id = nextId++
      setToasts((prev) => [...prev, { id, title, body, variant, ttl, leaving: false }])
      if (ttl > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), ttl)
        )
      }
      return id
    },
    [dismiss]
  )

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  return (
    <ToastContext.Provider value={{ push, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[1000] flex flex-col gap-2 w-[340px] max-w-[calc(100vw-2rem)]">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const VARIANT_STYLE = {
  info: 'border-gray-700 bg-gray-900/90',
  success: 'border-emerald-700 bg-emerald-950/80',
  warning: 'border-amber-600 bg-amber-950/80',
  danger: 'border-red-600 bg-red-950/80',
}

const VARIANT_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: Siren,
}

const VARIANT_BAR = {
  info: 'bg-blue-400',
  success: 'bg-emerald-400',
  warning: 'bg-amber-400',
  danger: 'bg-red-400',
}

const VARIANT_GLOW = {
  info: 'shadow-blue-500/10',
  success: 'shadow-emerald-500/15',
  warning: 'shadow-amber-500/15',
  danger: 'shadow-red-500/20',
}

const VARIANT_ICON_COLOR = {
  info: 'text-gray-300',
  success: 'text-emerald-300',
  warning: 'text-amber-300',
  danger: 'text-red-300',
}

function ToastItem({ toast, onClose }) {
  const Icon = VARIANT_ICON[toast.variant] ?? VARIANT_ICON.info
  return (
    <div
      role="status"
      className={`relative border rounded-xl px-4 py-3 pl-5 text-sm text-gray-100 shadow-2xl backdrop-blur-md overflow-hidden ${
        toast.leaving ? 'animate-toast-out' : 'slide-in-right'
      } ${VARIANT_STYLE[toast.variant] ?? VARIANT_STYLE.info} ${
        VARIANT_GLOW[toast.variant] ?? VARIANT_GLOW.info
      }`}
      style={{
        animationFillMode: 'both',
      }}
    >
      {/* Coloured side bar for fast variant identification at a glance */}
      <span
        aria-hidden
        className={`absolute left-0 top-0 bottom-0 w-1 ${VARIANT_BAR[toast.variant] ?? VARIANT_BAR.info}`}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <Icon
            aria-hidden
            className={`h-4 w-4 shrink-0 mt-0.5 ${
              VARIANT_ICON_COLOR[toast.variant] ?? VARIANT_ICON_COLOR.info
            }`}
          />
          <div className="min-w-0">
            {toast.title && <div className="font-semibold mb-0.5 truncate">{toast.title}</div>}
            {toast.body && (
              <div className="text-gray-300 text-xs leading-relaxed break-words">
                {toast.body}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-200 text-lg leading-none shrink-0 -mt-0.5 transition-colors"
          aria-label="Dismiss"
        >
          ×
        </button>
      </div>
      {/* Drain bar — shows TTL countdown so the user knows when it'll vanish. */}
      {toast.ttl > 0 && !toast.leaving && (
        <span
          aria-hidden
          className={`absolute left-1 right-1 bottom-0.5 h-0.5 rounded-full origin-right ${
            VARIANT_BAR[toast.variant] ?? VARIANT_BAR.info
          } opacity-50`}
          style={{
            animation: `toast-drain ${toast.ttl}ms linear forwards`,
          }}
        />
      )}
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
