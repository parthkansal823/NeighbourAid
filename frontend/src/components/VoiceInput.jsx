import { useState } from 'react'
import { LANGUAGES, speechLocaleFor, useI18n } from '../utils/i18n'
import { assistantCopy } from '../utils/assistantCopy'
import { voiceCopy, voiceErrorMessage } from '../utils/voiceCopy'
import { useVoice } from '../hooks/useVoice'
import { Mic } from './icons'

/** Caller owns the reviewable draft. Never submit on recognition completion. */
export default function VoiceInput({ onText }) {
  const { lang, t } = useI18n()
  const [language, setLanguage] = useState(lang)
  const voice = useVoice({ lang: speechLocaleFor(language), onResult: onText })
  const copy = assistantCopy(language), controls = voiceCopy(language)
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2"><select aria-label={copy.language} className="tap min-w-0 rounded-xl border border-line bg-surface-2 px-2 text-sm" value={language} onChange={e => { voice.cancel(); setLanguage(e.target.value) }}>{LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}</select><button type="button" disabled={!voice.supported || voice.status === 'stopping' || (voice.native && voice.listening)} className="tap flex items-center gap-2 rounded-xl border border-line px-3 text-sm disabled:opacity-50" onClick={() => voice.listening ? voice.stop() : voice.start()} aria-pressed={voice.listening}><Mic className="h-4 w-4" aria-hidden />{voice.listening ? t('post_recording') : copy.start}</button></div>
    <p className="text-xs leading-relaxed text-gray-400">{controls.privacy} {controls.review}</p>
    {voice.interim && <p role="status" className="text-sm text-gray-300">{controls.preview}: {voice.interim}</p>}
    {(voice.error || !voice.supported) && <p role="status" className="text-sm text-orange-300">{voiceErrorMessage(voice.error || voice.unavailableReason, language)}</p>}
  </div>
}
