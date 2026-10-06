import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n, LANGUAGES, speechLocaleFor } from '../utils/i18n'
import { assistantCopy, joinVoiceDraft } from '../utils/assistantCopy'
import { voiceCopy, voiceErrorMessage } from '../utils/voiceCopy'
import { speakPrompt, stopSpeechPrompt } from '../utils/speechPrompt'
import { useVoice } from '../hooks/useVoice'
import { useDialog } from '../hooks/useDialog'
import NativeOverlay from './NativeOverlay'
import { Mic, X } from './icons'

export default function VoiceReportAssistant({ categories, existingDescription, isAnonymous, onApply, onClose }) {
  const { lang, t } = useI18n()
  const [spokenLang, setSpokenLang] = useState(lang)
  const [draft, setDraft] = useState('')
  const [category, setCategory] = useState('')
  const [question, setQuestion] = useState('question')
  const [prompting, setPrompting] = useState(false)
  const [silent, setSilent] = useState(false)
  const generation = useRef(0)
  const dialog = useDialog(onClose)
  const copy = assistantCopy(spokenLang), controls = voiceCopy(spokenLang)
  const voice = useVoice({ lang: speechLocaleFor(spokenLang), onResult: text => setDraft(old => joinVoiceDraft(old, text)) })
  const combined = joinVoiceDraft(existingDescription, draft)
  const invalidatePrompt = useCallback(() => { generation.current++; stopSpeechPrompt() }, [])
  useEffect(() => invalidatePrompt, [spokenLang, invalidatePrompt])
  const record = async which => {
    if (prompting || voice.listening) return
    const run = ++generation.current
    setQuestion(which); setPrompting(true); setSilent(false)
    const spoken = await speakPrompt(copy[which], speechLocaleFor(spokenLang))
    if (generation.current !== run) return
    setPrompting(false); setSilent(!spoken); voice.start()
  }
  const changeLanguage = event => {
    generation.current++; stopSpeechPrompt(); voice.cancel()
    setPrompting(false); setSilent(false); setSpokenLang(event.target.value)
  }
  return <NativeOverlay><div className="flex h-full items-center justify-center bg-black/75 p-3">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="voice-assistant-title" tabIndex={-1} className="flex max-h-full w-full max-w-xl flex-col rounded-2xl border border-line bg-surface">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line p-4">
        <h2 id="voice-assistant-title" className="text-lg font-bold">{copy.title}</h2>
        <button type="button" className="tap shrink-0 rounded-xl px-3" aria-label={copy.close} onClick={onClose}><X className="h-5 w-5" aria-hidden /></button>
      </header>
      <div className="min-h-0 space-y-4 overflow-y-auto p-4">
        <p className="text-sm text-gray-300">{copy.intro}</p>
        <label className="block text-sm">{copy.language}<select className="mt-2 w-full rounded-xl border border-line bg-surface-2 p-3" value={spokenLang} onChange={changeLanguage}>{LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select></label>
        <p className="text-xs leading-relaxed text-gray-400">{voice.native ? controls.privacy : t('post_voice_privacy')}{isAnonymous && <> {t('post_voice_privacy_anon')}</>}</p>
        <p className="rounded-xl border border-orange-500/30 p-4 text-lg font-semibold" aria-live="polite">{copy[question]}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tap flex items-center gap-2 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-black disabled:opacity-50" disabled={!voice.supported || prompting || (voice.native && voice.listening) || voice.status === 'stopping'} onClick={() => voice.listening ? voice.stop() : record('question')}><Mic className="h-4 w-4" aria-hidden />{prompting || voice.status === 'starting' ? controls.starting : voice.listening ? t('post_recording') : copy.start}</button>
          <button type="button" className="tap rounded-xl border border-line px-3 text-sm disabled:opacity-50" disabled={!voice.supported || prompting || voice.listening} onClick={() => record('place')}>{copy.more}</button>
        </div>
        {silent && <p role="status" className="text-sm text-gray-400">{copy.silent}</p>}
        {voice.interim && <p role="status" className="text-sm text-gray-300">{controls.preview}: {voice.interim}</p>}
        {(voice.error || !voice.supported) && <p role="alert" className="text-sm text-orange-300">{voiceErrorMessage(voice.error || voice.unavailableReason, spokenLang)}</p>}
        <label className="block text-sm">{copy.draft}<textarea rows={4} maxLength={2000} className="mt-2 w-full resize-y rounded-xl border border-line bg-surface-2 p-3" value={draft} onChange={e => setDraft(e.target.value)} /></label>
        <fieldset><legend className="mb-2 text-sm">{copy.category}</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{categories.map(c => <button key={c} type="button" aria-pressed={category === c} className={`tap break-words rounded-xl border px-2 text-sm ${category === c ? 'border-orange-500 text-orange-300' : 'border-line text-gray-300'}`} onClick={() => setCategory(c)}>{t(`cat_${c}`)}</button>)}</div></fieldset>
        {combined.length > 2000 && <p role="alert" className="text-sm text-red-300">{controls.tooLong}</p>}
      </div>
      <footer className="shrink-0 border-t border-line p-4"><button type="button" className="tap w-full rounded-xl bg-orange-500 px-4 font-semibold text-black disabled:opacity-50" disabled={!draft.trim() || !category || combined.length > 2000 || prompting || voice.listening} onClick={() => onApply({ description: combined, category })}>{copy.apply}</button></footer>
    </section>
  </div></NativeOverlay>
}
