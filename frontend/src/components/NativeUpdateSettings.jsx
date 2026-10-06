import { useEffect, useState } from 'react'
import { useI18n } from '../utils/i18n'
import { androidUpdateCopy, UPDATE_CHECK_EVENT, UPDATE_RESULT_EVENT } from '../utils/androidUpdate'

export default function NativeUpdateSettings() {
  const { lang } = useI18n()
  const copy = androidUpdateCopy(lang)
  const [status, setStatus] = useState('')
  useEffect(() => {
    const receive = event => setStatus(['found', 'none', 'unavailable'].includes(event.detail) ? event.detail : 'unavailable')
    window.addEventListener(UPDATE_RESULT_EVENT, receive)
    return () => window.removeEventListener(UPDATE_RESULT_EVENT, receive)
  }, [])
  const check = () => {
    setStatus('checking')
    window.dispatchEvent(new Event(UPDATE_CHECK_EVENT))
  }
  return <section className="mt-3 border-t border-line px-3 pt-3 text-sm text-gray-300">
    <p>{copy.installed}: {__APP_BUILD__.versionName} ({__APP_BUILD__.versionCode})</p>
    <button type="button" onClick={check} disabled={status === 'checking'} className="tap mt-1 text-orange-300 disabled:opacity-50">{copy.check}</button>
    {status && <p role="status" className="mt-1 text-xs leading-relaxed">{copy[status]}</p>}
  </section>
}
