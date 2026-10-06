import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../utils/i18n'
import { FIRST_AID_SOURCES, firstAidCopy, firstAidPath } from '../utils/firstAid'
import { speakPrompt, stopSpeechPrompt } from '../utils/speechPrompt'
import { useDialog } from '../hooks/useDialog'
import NativeOverlay from './NativeOverlay'
import { HeartPulse, Droplet, Flame, PhoneCall, Volume2, X } from './icons'

function AidChoice({ children, onClick }) {
  return <button type="button" className="tap w-full rounded-xl border border-line px-4 py-3 text-left text-base font-semibold hover:border-orange-500" onClick={onClick}>{children}</button>
}

export function FirstAidGuide({ onClose }) {
  const { lang } = useI18n()
  const [language, setLanguage] = useState(lang === 'hi' ? 'hi' : 'en')
  const [stage, setStage] = useState('safety')
  const [topic, setTopic] = useState('')
  const [path, setPath] = useState('')
  const [step, setStep] = useState(0)
  const [reading, setReading] = useState(false)
  const [silent, setSilent] = useState(false)
  const generation = useRef(0)
  const dialog = useDialog(onClose)
  const copy = firstAidCopy(language)
  const demo = import.meta.env.MODE === 'demo'
  const steps = copy[`${path}Steps`]
  const invalidateRead = useCallback(() => { generation.current++; stopSpeechPrompt() }, [])
  useEffect(() => invalidateRead, [invalidateRead])
  const stopRead = () => { invalidateRead(); setReading(false); setSilent(false) }
  const go = (next, result = '') => {
    stopRead(); setStage(next); setPath(result); setStep(0)
  }
  const choose = selected => {
    setTopic(selected)
    if (selected === 'collapse') go('adult')
    else if (selected === 'burn') go('burn')
    else go('result', firstAidPath({ safe: true, topic: selected }))
  }
  const read = async () => {
    if (reading) { stopRead(); return }
    const run = ++generation.current
    setReading(true)
    const spoken = await speakPrompt(steps ? steps[step].join('. ') : copy[path], language === 'hi' ? 'hi-IN' : 'en-IN')
    if (run !== generation.current) return
    setReading(false); setSilent(!spoken)
  }
  return <NativeOverlay><div className="flex h-full items-center justify-center bg-black/80 p-3">
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="first-aid-title" tabIndex={-1} className="flex max-h-full w-full max-w-2xl flex-col rounded-2xl border border-line bg-surface">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line p-4"><h2 id="first-aid-title" className="text-lg font-bold">{copy.title}</h2><button type="button" aria-label={copy.close} className="tap shrink-0 px-3" onClick={onClose}><X className="h-5 w-5" aria-hidden /></button></header>
      <div className="min-h-0 space-y-4 overflow-y-auto p-4">
        <p className="text-sm leading-relaxed text-red-200">{copy.notice}</p>
        <div className="flex items-center gap-2"><label htmlFor="first-aid-language" className="text-sm">Guide language / भाषा</label><select id="first-aid-language" className="tap rounded-xl border border-line bg-surface-2 px-3" value={language} onChange={e => { stopRead(); setLanguage(e.target.value) }}><option value="en">English</option><option value="hi">हिन्दी</option></select></div>
        {!['en', 'hi'].includes(lang) && <p className="text-xs text-gray-400">Medical steps are available in English and Hindi only. They are not automatically translated.</p>}
        {stage === 'safety' && <><h3 className="text-xl font-bold">{copy.safety}</h3><AidChoice onClick={() => go('choose')}>{copy.yes}</AidChoice><AidChoice onClick={() => go('result', 'unsafe')}>{copy.no}</AidChoice></>}
        {stage === 'choose' && <><h3 className="text-xl font-bold">{copy.choose}</h3>{['collapse', 'bleeding', 'burn', 'other'].map(item => <AidChoice key={item} onClick={() => choose(item)}>{copy[item]}</AidChoice>)}</>}
        {stage === 'adult' && <><h3 className="text-xl font-bold">{copy.adult}</h3><AidChoice onClick={() => go('breathing')}>{copy.adultYes}</AidChoice><AidChoice onClick={() => go('result', 'childHelp')}>{copy.child}</AidChoice></>}
        {stage === 'breathing' && <><h3 className="text-xl font-bold">{copy.breathing}</h3><p className="text-sm text-gray-300">{copy.breathingCheck}</p><AidChoice onClick={() => go('result', firstAidPath({ safe: true, topic, adult: true, breathing: 'normal' }))}>{copy.normal}</AidChoice><AidChoice onClick={() => go('result', firstAidPath({ safe: true, topic, adult: true, breathing: 'not-normal' }))}>{copy.notNormal}</AidChoice><AidChoice onClick={() => go('result', 'uncertain')}>{copy.unsure}</AidChoice></>}
        {stage === 'burn' && <><h3 className="text-xl font-bold">{copy.burnCheck}</h3><AidChoice onClick={() => go('result', 'burn')}>{copy.small}</AidChoice><AidChoice onClick={() => go('result', 'severeBurn')}>{copy.severe}</AidChoice></>}
        {stage === 'result' && <>
          {steps ? <>
            <h3 className="text-lg font-bold">{copy[`${path}Title`]}</h3>
            {/* All instructions remain visible: paging must not delay CPR. */}
            <ol className="space-y-3">{steps.map(([title, text], index) => <li key={title} className={`flex gap-3 rounded-xl border p-4 ${index === step ? 'border-orange-500' : 'border-line'}`} aria-current={index === step ? 'step' : undefined}>
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 font-bold text-orange-300">{index + 1}</span><div className="min-w-0"><div className="flex items-center gap-2"><span className="font-bold">{title}</span>{index === 0 && (path === 'burn' ? <Flame className="h-5 w-5 shrink-0" aria-hidden /> : path === 'bleeding' ? <Droplet className="h-5 w-5 shrink-0" aria-hidden /> : <HeartPulse className="h-5 w-5 shrink-0" aria-hidden />)}</div><p className="mt-1 text-sm leading-relaxed text-gray-300">{text}</p></div>
            </li>)}</ol>
            <div className="flex flex-wrap gap-2"><button type="button" className="tap rounded-xl border border-line px-4 disabled:opacity-40" disabled={step === 0} onClick={() => { stopRead(); setStep(step - 1) }}>{copy.back}</button><button type="button" className="tap rounded-xl border border-line px-4 disabled:opacity-40" disabled={step === steps.length - 1} onClick={() => { stopRead(); setStep(step + 1) }}>{copy.next}</button></div>
            <details className="text-sm text-gray-400"><summary className="tap cursor-pointer">{copy.sources}</summary>{FIRST_AID_SOURCES[path].map(source => <a className="tap block underline" key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>)}</details>
          </> : <p className="rounded-xl border border-orange-500/30 p-4 text-lg leading-relaxed">{copy[path]}</p>}
          <button type="button" className="tap flex items-center gap-2 rounded-xl border border-line px-4" onClick={read}><Volume2 className="h-4 w-4" aria-hidden />{copy.read}</button>
          {silent && <p role="status" className="text-sm text-gray-400">{copy.silent}</p>}
          <button type="button" className="tap block text-sm text-orange-300 underline" onClick={() => go('safety')}>{copy.restart}</button>
        </>}
        <p className="text-xs leading-relaxed text-gray-400">{copy.review}</p>
      </div>
      <footer className="shrink-0 border-t border-line p-4">{demo ? <p className="text-center text-sm text-orange-300">{copy.demo}</p> : <a href="tel:112" className="tap flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2 font-bold text-white"><PhoneCall className="h-5 w-5" aria-hidden />{copy.call}</a>}</footer>
    </section>
  </div></NativeOverlay>
}

export default function FirstAidButton() {
  const { lang } = useI18n()
  const [open, setOpen] = useState(false)
  return <><button type="button" className="tap flex items-center justify-center gap-2 rounded-xl border border-line px-4 py-2 text-sm font-semibold text-orange-300" onClick={() => setOpen(true)}><HeartPulse className="h-5 w-5" aria-hidden />{firstAidCopy(lang).open}</button>{open && <FirstAidGuide onClose={() => setOpen(false)} />}</>
}
