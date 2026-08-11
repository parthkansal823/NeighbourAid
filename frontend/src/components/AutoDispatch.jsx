/**
 * Category-based auto-dispatch suggestion strip.
 *
 * When an alert is viewed, we surface the *right* emergency number(s) for
 * that category so a witness or nearby volunteer can one-tap call the
 * correct service — ambulance for medical, 101 for fire, NDRF for floods,
 * etc. All phone numbers are India-specific and sourced from the MHA/NDMA
 * public directory (same list as EmergencyDialer).
 *
 * We intentionally don't auto-initiate the call; the Web environment can't
 * place calls silently, and even if it could, a false positive dialling 108
 * during normal use would be harmful. One tap to dial is the safest pattern.
 */

import { Ambulance, Hospital, Siren, Truck, Waves, ShieldUser, Baby, VenusAndMars, Zap } from './icons'

const CATEGORY_SERVICES = {
  medical: [
    { num: '108', label: 'Ambulance', Icon: Ambulance, tone: 'bg-emerald-600 hover:bg-emerald-700' },
    { num: '102', label: 'Medical helpline', Icon: Hospital, tone: 'bg-emerald-700 hover:bg-emerald-800' },
    { num: '112', label: 'All-in-one emergency', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
  ],
  fire: [
    { num: '101', label: 'Fire brigade', Icon: Truck, tone: 'bg-orange-600 hover:bg-orange-700' },
    { num: '112', label: 'All-in-one emergency', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
  ],
  flood: [
    { num: '1078', label: 'NDRF / disaster', Icon: Waves, tone: 'bg-blue-700 hover:bg-blue-800' },
    { num: '112', label: 'All-in-one emergency', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
  ],
  missing: [
    { num: '100', label: 'Police', Icon: ShieldUser, tone: 'bg-blue-600 hover:bg-blue-700' },
    { num: '1098', label: 'Child helpline', Icon: Baby, tone: 'bg-purple-600 hover:bg-purple-700' },
    { num: '1091', label: 'Women helpline', Icon: VenusAndMars, tone: 'bg-pink-600 hover:bg-pink-700' },
  ],
  power: [
    { num: '1912', label: 'Electricity complaints', Icon: Zap, tone: 'bg-yellow-700 hover:bg-yellow-800' },
    { num: '112', label: 'All-in-one emergency', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
  ],
  other: [
    { num: '112', label: 'All-in-one emergency', Icon: Siren, tone: 'bg-red-600 hover:bg-red-700' },
    { num: '100', label: 'Police', Icon: ShieldUser, tone: 'bg-blue-600 hover:bg-blue-700' },
  ],
}

export default function AutoDispatch({ category, compact = false }) {
  const services = CATEGORY_SERVICES[category] || CATEGORY_SERVICES.other
  return (
    <div
      className={`bg-gray-900/70 border border-gray-800 rounded-lg ${
        compact ? 'p-2' : 'p-3'
      } mb-3`}
    >
      <div className="text-[11px] uppercase tracking-widest text-gray-400 mb-2">
        Recommended services · one tap to call
      </div>
      <div className="flex flex-wrap gap-1.5">
        {services.map(({ num, label, Icon, tone }) => (
          <a
            key={num}
            href={`tel:${num}`}
            className={`${tone} text-white rounded-lg px-2.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors`}
            title={`Call ${label} — ${num}`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            <span className="font-black">{num}</span>
            <span className="opacity-80 hidden sm:inline">· {label}</span>
          </a>
        ))}
      </div>
    </div>
  )
}
