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
    <Link to="/app-updates" className="native-menu-update flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 text-sm text-app-ink">
      <RefreshCw className="h-5 w-5 shrink-0 text-app-muted" aria-hidden />
      <span className="min-w-0 flex-1"><span className="block font-medium">{lang === 'hi' ? 'ऐप अपडेट' : 'App updates'}</span><span className="mt-0.5 block break-words text-xs text-app-muted">{copy.installed}: {__APP_BUILD__.versionName}</span></span>
      <ArrowRight className="h-4 w-4 shrink-0 text-app-muted" aria-hidden />
    </Link>
  </section>
}
