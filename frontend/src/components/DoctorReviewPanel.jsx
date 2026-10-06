import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../utils/api'
import { apiError } from '../utils/error'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../utils/i18n'
import VoiceInput from './VoiceInput'
import { joinVoiceDraft } from '../utils/assistantCopy'

const decisions = {
  emergency: ['Call 112 / emergency care', '112 / आपातकालीन देखभाल'],
  in_person: ['In-person medical assessment needed', 'डॉक्टर से आमने-सामने जाँच चाहिए'],
  more_information: ['More information needed', 'अधिक जानकारी चाहिए'],
}
function ReviewSession({ user }) {
  const { lang } = useI18n()
  const hi = lang === 'hi'
  const [ready, setReady] = useState(false)
  const [clinician, setClinician] = useState(false)
  const [mine, setMine] = useState([])
  const [queue, setQueue] = useState({ pending: [], assigned: [] })
  const [question, setQuestion] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      const status = await api.get('/api/medical-review/status')
      setReady(status.data.accepting_requests === true)
      if (!user) return
      const [profile, requests] = await Promise.all([api.get('/api/medical-review/me'), api.get('/api/medical-review/mine')])
      setClinician(profile.data.can_review === true); setMine(requests.data)
      if (profile.data.can_review) setQueue((await api.get('/api/medical-review/queue')).data)
      else setQueue({ pending: [], assigned: [] })
    } catch (err) {
      if (err.response?.status === 403) { setClinician(false); setQueue({ pending: [], assigned: [] }) }
      setReady(false)
      setError(apiError(err, hi ? 'समीक्षा सेवा उपलब्ध नहीं है। चिकित्सकीय मदद के लिए यहाँ इंतज़ार न करें।' : 'Review service unavailable. Do not wait here for medical care.'))
    }
  }, [user, hi])
  useEffect(() => { void load() }, [load])
  const action = async task => {
    if (busy) return
    setBusy(true); setError('')
    try { await task(); await load() } catch (err) { setError(apiError(err, 'Review action failed. Refresh and try again.')) }
    finally { setBusy(false) }
  }
  return <div className="mt-4 space-y-4">
    <p className="text-sm leading-relaxed text-red-200">{hi ? 'साँस की परेशानी, बेहोशी, गंभीर चोट या तुरंत खतरे में 112 पर कॉल करें। यहाँ डॉक्टर की समीक्षा का इंतज़ार न करें।' : 'For breathing difficulty, collapse, serious injury or immediate danger, call 112. Never wait for a doctor review here.'}</p>
    <p className="text-xs leading-relaxed text-gray-400">{hi ? 'यह 24×7 डॉक्टर, निदान या पर्चे की सेवा नहीं है। सवाल सिर्फ आपके और नियुक्त डॉक्टर के लिए निजी है; 72 घंटे बाद समाप्त होता है।' : 'Not a 24/7 doctor, diagnosis or prescription service. Your question is private to you and the assigned clinician, expires after 72 hours and can be deleted earlier. No response time is promised.'}</p>
    {!['en', 'hi'].includes(lang) && <p className="text-xs text-gray-400">Clinician-review instructions are in English. Voice input can use any of the 11 listed languages.</p>}
    <button type="button" className="tap rounded-xl border border-line px-3 text-sm" disabled={busy} onClick={() => void load()}>{hi ? 'स्थिति फिर देखें' : 'Refresh status'}</button>
    {error && <p role="alert" className="text-sm text-orange-300">{error}</p>}
    {!ready && !error && <p className="text-sm text-gray-300">{hi ? 'अभी कोई स्वीकृत डॉक्टर सूची में नहीं है। स्थानीय चिकित्सकीय मदद लें।' : 'No approved clinician is enrolled. Please seek local medical care.'}</p>}
    {!user ? <Link className="tap inline-flex items-center text-orange-300 underline" to="/login">{hi ? 'निजी अनुरोध के लिए लॉगिन करें' : 'Sign in for a private request'}</Link> : <>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); void action(async () => { await api.post('/api/medical-review/requests', { question, consent, adult_self: consent, not_emergency: consent }); setQuestion(''); setConsent(false) }) }}>
        <label className="block text-sm">{hi ? 'आपका गैर-आपातकालीन सवाल (सिर्फ अपना, उम्र 18+)' : 'Your non-emergency question (yourself only, age 18+)'}<textarea className="mt-2 w-full rounded-xl border border-line bg-surface-2 p-3" minLength={10} maxLength={1200} rows={3} required value={question} onChange={e => setQuestion(e.target.value)} /></label>
        <VoiceInput onText={text => setQuestion(old => joinVoiceDraft(old, text))} />
        {question.length > 1200 && <p role="alert" className="text-sm text-orange-300">{hi ? 'सवाल 1,200 अक्षरों तक रखें।' : 'Shorten the question to 1,200 characters.'}</p>}
        <label className="flex min-h-11 items-start gap-3 text-sm text-gray-300"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0 accent-orange-500" checked={consent} onChange={e => setConsent(e.target.checked)} required />{hi ? 'मैं 18+ हूँ, यह मेरा गैर-आपातकालीन सवाल है और मैं नियुक्त स्वीकृत डॉक्टर से साझा करने के लिए सहमत हूँ। अनावश्यक नाम, पता या निजी जानकारी नहीं दूँगा/दूँगी।' : 'I am 18+, this is my own non-emergency question, and I consent to share it with an assigned approved clinician. I will not include names, addresses or unnecessary private details.'}</label>
        <button type="submit" disabled={busy || !ready || !consent || question.trim().length < 10 || question.length > 1200} className="tap w-full rounded-xl bg-orange-500 px-4 py-2 font-semibold text-black disabled:opacity-40">{hi ? 'निजी समीक्षा माँगें' : 'Request private review'}</button>
      </form>
      <ul className="space-y-3">{mine.map(row => <li key={row.id} className="rounded-xl border border-line p-4"><p className="whitespace-pre-wrap break-words text-sm">{row.question}</p><p className="mt-2 text-sm font-semibold text-orange-300">{row.status === 'reviewed' ? (hi ? 'डॉक्टर का जवाब आया है' : 'Clinician response received') : (hi ? 'समीक्षा लंबित — अभी सत्यापित नहीं' : 'Review pending — not verified')}</p>{row.response && <div className="mt-3 space-y-2 text-sm text-gray-300"><p className="font-semibold">{decisions[row.response.disposition]?.[hi ? 1 : 0]}</p><p className="whitespace-pre-wrap break-words">{row.response.note}</p><p className="text-xs text-gray-400">{row.response.clinician_name} · {row.response.council} · {row.response.registration}<br />{new Date(row.response.reviewed_at).toLocaleString()}</p></div>}<button type="button" disabled={busy} className="tap mt-2 text-sm text-gray-400 underline" onClick={() => void action(() => api.delete(`/api/medical-review/requests/${row.id}`))}>{hi ? 'मेरा अनुरोध हटाएँ' : 'Delete my request'}</button></li>)}</ul>
    </>}
    {clinician && <section className="space-y-3 border-t border-line pt-4"><h3 className="font-bold">Clinician review desk</h3><p className="text-xs text-gray-400">Operator-approved access, not automatic licence verification. Claim a request to see its details. Refer emergencies to 112; no prescriptions or diagnosis through this desk.</p>{queue.pending.map(row => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3"><span className="text-sm text-gray-300">Pending since {new Date(row.created_at).toLocaleString()}</span><button className="tap rounded-xl border border-line px-3 text-sm" type="button" disabled={busy} onClick={() => void action(() => api.post(`/api/medical-review/requests/${row.id}/claim`))}>Claim private review</button></div>)}{queue.assigned.map(row => <AssignedReview key={row.id} row={row} busy={busy} action={action} />)}</section>}
  </div>
}
function AssignedReview({ row, busy, action }) {
  const [note, setNote] = useState('')
  const [disposition, setDisposition] = useState('in_person')
  return <article className="space-y-3 rounded-xl border border-line p-4"><p className="whitespace-pre-wrap break-words text-sm">{row.question}</p>{row.status === 'reviewed' ? <p className="whitespace-pre-wrap text-sm text-gray-400">Response recorded: {row.response?.note}</p> : <form className="space-y-3" onSubmit={e => { e.preventDefault(); void action(() => api.post(`/api/medical-review/requests/${row.id}/response`, { disposition, note })) }}><label className="block text-sm">Next step<select className="mt-1 w-full rounded-xl border border-line bg-surface-2 p-3" value={disposition} onChange={e => setDisposition(e.target.value)}>{Object.entries(decisions).map(([value, labels]) => <option key={value} value={value}>{labels[0]}</option>)}</select></label><label className="block text-sm">Clinician note (no prescriptions)<textarea className="mt-1 w-full rounded-xl border border-line bg-surface-2 p-3" rows={3} minLength={10} maxLength={1200} required value={note} onChange={e => setNote(e.target.value)} /></label><button type="submit" className="tap rounded-xl bg-orange-500 px-4 font-semibold text-black disabled:opacity-40" disabled={busy || note.trim().length < 10}>Record review response</button></form>}</article>
}
export default function DoctorReviewPanel() {
  const { user } = useAuth()
  const { lang } = useI18n()
  return <details className="mb-6 rounded-2xl border border-line p-4"><summary className="tap flex cursor-pointer items-center font-semibold">{lang === 'hi' ? 'डॉक्टर की निजी समीक्षा (गैर-आपातकालीन)' : 'Private clinician review (not for emergencies)'}</summary><ReviewSession key={user?.id || 'guest'} user={user} /></details>
}
