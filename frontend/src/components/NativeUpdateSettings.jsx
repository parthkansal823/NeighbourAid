import { Link } from 'react-router-dom'
import { useI18n } from '../utils/i18n'
import { androidUpdateCopy } from '../utils/androidUpdate'
import { ArrowRight, RefreshCw } from './icons'
import { isNativeApp } from '../utils/runtime'

export default function NativeUpdateSettings() {
  const { lang } = useI18n()
  const copy = androidUpdateCopy(lang)
  if (!isNativeApp()) return null
  return <section className="mt-3 border-t border-line pt-3">
    <Link to="/app-updates" className="native-menu-update flex min-h-14 items-center gap-3 rounded-xl px-3 text-sm text-gray-200">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-300"><RefreshCw className="h-4 w-4" aria-hidden /></span>
      <span className="min-w-0 flex-1"><span className="block font-medium text-white">App updates</span><span className="mt-0.5 block truncate text-xs text-gray-500">{copy.installed}: {__APP_BUILD__.versionName}</span></span>
      <ArrowRight className="h-4 w-4 shrink-0 text-gray-500" aria-hidden />
    </Link>
  </section>
}
