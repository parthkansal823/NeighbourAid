import { useState } from 'react'
import { useI18n } from '../utils/i18n'
import { clearTranslationCache } from '../utils/translate'
import useTextFirst, { setTextFirst } from '../hooks/useTextFirst'

export default function DevicePreferences() {
  const { lang, autoTranslate, setAutoTranslate } = useI18n()
  const textFirst = useTextFirst()
  const [message, setMessage] = useState('')
  const hindi = lang === 'hi'
  const clear = () => {
    clearTranslationCache()
    setMessage(hindi ? 'इस डिवाइस से सेव किए गए अनुवाद हटा दिए गए।' : 'Saved translations were cleared from this device.')
  }
  return <section id="device-preferences" className="min-w-0 rounded-2xl border border-line bg-surface-1 p-4 sm:p-5 lg:col-span-2" aria-labelledby="device-preferences-title">
    <h2 id="device-preferences-title" className="text-base font-semibold text-app-ink">{hindi ? 'इस डिवाइस की सेटिंग्स' : 'This device'}</h2>
    <p className="mt-2 text-sm leading-relaxed text-app-muted">{hindi ? 'थीम आपके फोन या ब्राउज़र की लाइट/डार्क सेटिंग के अनुसार बदलती है।' : 'Appearance follows your phone or browser light/dark setting.'}</p>
    <label className="mt-3 flex min-h-12 cursor-pointer items-start gap-3 py-2 text-sm text-app-ink">
      <input type="checkbox" checked={textFirst} onChange={event => setTextFirst(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-accent" />
      <span>{hindi ? 'पहले टेक्स्ट दिखाएँ' : 'Text-first mode'}<span className="mt-1 block text-xs leading-relaxed text-app-muted">{hindi ? 'फोटो और ट्रैकर मैप केवल आपके चुनने पर लोड होंगे। अपने-आप अनुवाद नहीं होगा।' : 'Load photos and tracker maps only when you choose. Automatic translations pause to save data.'}</span></span>
    </label>
    <label className="flex min-h-12 cursor-pointer items-start gap-3 py-2 text-sm text-app-ink">
      <input type="checkbox" checked={autoTranslate} onChange={event => setAutoTranslate(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-accent" />
      <span>{hindi ? 'रिपोर्ट का अपने-आप अनुवाद' : 'Automatically translate reports'}<span className="mt-1 block text-xs leading-relaxed text-app-muted">{hindi ? 'डिवाइस पर अनुवाद उपलब्ध न हो तो रिपोर्ट का टेक्स्ट Google को जाता है। अनुवाद में गलतियाँ हो सकती हैं; मेडिकल निर्देशों के लिए इसका उपयोग न करें।' : 'If on-device translation is unavailable, report text is sent to Google. Translations can be wrong; do not use them to translate medical instructions.'}</span></span>
    </label>
    <div className="mt-3 border-t border-line pt-4">
      <p className="mb-3 text-xs leading-relaxed text-app-muted">{hindi ? 'अनुवाद में संवेदनशील रिपोर्ट टेक्स्ट हो सकता है और वह इस डिवाइस पर सेव रहता है। यह बटन मूल रिपोर्ट या ऑफलाइन भेजने की कतार नहीं हटाता।' : 'Saved translations may contain sensitive report text. Clearing them does not delete original reports or alerts waiting to send offline.'}</p>
      <button type="button" onClick={clear} className="tap app-secondary-button w-full sm:w-auto">{hindi ? 'सेव किए गए अनुवाद हटाएँ' : 'Clear saved translations'}</button>
      {message && <p role="status" className="mt-3 text-sm text-app-muted">{message}</p>}
    </div>
  </section>
}
