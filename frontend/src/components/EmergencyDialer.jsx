import { useEffect, useState } from 'react'
import { useI18n } from '../utils/i18n'
import { Ambulance, Baby, Siren, ShieldUser, Truck, VenusAndMars, X } from './icons'

// India national emergency numbers (verified across MHA, NDMA, state police).
// 112 is the unified India-wide emergency number (ERSS — launched 2019).
const NUMBERS = [
  { num: '112', labelKey: 'dialer_all_in_one', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
  { num: '100', labelKey: 'dialer_police', Icon: ShieldUser, tone: 'bg-blue-600 hover:bg-blue-700' },
  { num: '108', labelKey: 'dialer_ambulance', Icon: Ambulance, tone: 'bg-emerald-600 hover:bg-emerald-700' },
  { num: '101', labelKey: 'dialer_fire', Icon: Truck, tone: 'bg-orange-600 hover:bg-orange-700' },
  { num: '1091', labelKey: 'dialer_women', Icon: VenusAndMars, tone: 'bg-pink-600 hover:bg-pink-700' },
  { num: '1098', labelKey: 'dialer_child', Icon: Baby, tone: 'bg-purple-600 hover:bg-purple-700' },
]

export default function EmergencyDialer() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[900] bg-red-600 hover:bg-red-700 text-white font-bold w-14 h-14 rounded-full shadow-xl flex items-center justify-center animate-pulse focus:outline-none focus:ring-4 focus:ring-red-400"
        aria-label={t('dialer_open')}
        title={t('dialer_tooltip')}
      >
        <Siren className="h-7 w-7" aria-hidden />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[950] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label={t('dialer_tooltip')}
        >
          <div
            className="bg-gray-900 border border-gray-800 rounded-2xl w-full sm:max-w-md p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base sm:text-lg font-bold text-white">{t('dialer_title')}</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-500 hover:text-gray-200 px-2 -mr-2"
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
                  <span className="text-[11px] uppercase tracking-wider opacity-80 inline-flex items-center gap-1.5">
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
      )}
    </>
  )
}
