import { useEffect, useRef } from 'react'
import { useI18n } from '../utils/i18n'
import { Ambulance, Baby, Siren, ShieldUser, Truck, VenusAndMars, X } from './icons'
import NativeOverlay from './NativeOverlay'

// India national emergency numbers (verified across MHA, NDMA, state police).
// 112 is the unified India-wide emergency number (ERSS — launched 2019).
const NUMBERS = [
  { num: '112', labelKey: 'dialer_all_in_one', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
  { num: '100', labelKey: 'dialer_police', Icon: ShieldUser, tone: 'bg-surface-2 hover:bg-black border border-line hover:border-orange-500' },
  { num: '108', labelKey: 'dialer_ambulance', Icon: Ambulance, tone: 'bg-surface-2 hover:bg-black border border-line hover:border-orange-500' },
  { num: '101', labelKey: 'dialer_fire', Icon: Truck, tone: 'bg-surface-2 hover:bg-black border border-line hover:border-orange-500' },
  { num: '1091', labelKey: 'dialer_women', Icon: VenusAndMars, tone: 'bg-surface-2 hover:bg-black border border-line hover:border-orange-500' },
  { num: '1098', labelKey: 'dialer_child', Icon: Baby, tone: 'bg-surface-2 hover:bg-black border border-line hover:border-orange-500' },
]

export default function EmergencyDialer({ native = false, open, onOpen, onClose }) {
  const { t } = useI18n()
  const dialog = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const controls = () => Array.from(dialog.current?.querySelectorAll('button, a[href]') || [])
    controls()[0]?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab') return
      const items = controls()
      const first = items[0], last = items.at(-1)
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      if (previousFocus?.isConnected) previousFocus.focus()
    }
  }, [open, onClose])

  return (
    <>
      {!native && <button
        onClick={onOpen}
        className="fixed bottom-[calc(5.75rem+env(safe-area-inset-bottom))] left-4 z-900 flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/80 bg-red-600 text-white shadow-lg shadow-black/40 transition-colors hover:bg-red-700 focus:outline-hidden focus:ring-4 focus:ring-red-400 lg:bottom-5"
        aria-label={t('dialer_open')}
        title={t('dialer_tooltip')}
      >
        <Siren className="h-7 w-7" aria-hidden />
      </button>}

      {open && (<NativeOverlay>
        <div
          className={`${native ? 'z-[1400] pb-[max(1rem,env(safe-area-inset-bottom))]' : 'z-950'} fixed inset-0 bg-black/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-3 sm:p-4`}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={t('dialer_tooltip')}
        >
          <div
            ref={dialog}
            className={`surface-float w-full sm:max-w-md p-5 sm:p-6 ${native ? 'max-h-[90dvh]' : 'max-h-[90vh]'} overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base sm:text-lg font-bold text-white">{t('dialer_title')}</h2>
              <button
                onClick={onClose}
                className={`${native ? 'tap ' : ''}text-gray-500 hover:text-gray-200 px-2 -mr-2`}
                aria-label="Close"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              {t('dialer_subtitle')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {NUMBERS.map(({ num, labelKey, Icon, tone }) => (
                <a
                  key={num}
                  href={`tel:${num}`}
                  className={`${tone} text-white rounded-xl px-3 py-3 transition-colors flex flex-col items-start gap-0.5`}
                >
                  <span className="inline-flex items-center gap-1.5 text-[11px] opacity-80">
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {t(labelKey)}
                  </span>
                  <span className="text-xl sm:text-2xl font-black tracking-wide">{num}</span>
                </a>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-gray-500 leading-relaxed">
              <strong className="text-gray-300">112</strong> {t('dialer_note')}
            </p>
          </div>
        </div>
      </NativeOverlay>)}
    </>
  )
}
