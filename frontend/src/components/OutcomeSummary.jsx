import { useI18n } from '../utils/i18n'

const COPY = {
  reporter_confirmed_safe: ['Reporter confirmed safe', 'रिपोर्टर ने सुरक्षित होने की पुष्टि की'],
  volunteer_reported_resolved: ['Volunteer reported resolved', 'स्वयंसेवक ने समस्या हल होने की सूचना दी'],
  expired_unconfirmed: ['Closed after expiry; safety not confirmed', 'समय सीमा के बाद बंद; सुरक्षा की पुष्टि नहीं हुई'],
  practice_ended: ['Practice drill ended', 'अभ्यास समाप्त हुआ'],
  resolution_unconfirmed: ['Closed; safety not confirmed', 'बंद; सुरक्षा की पुष्टि नहीं हुई'],
}

export function outcomeLabel(alert, hindi = false) {
  const outcome = alert.outcome || (alert.status === 'resolved' ? 'resolution_unconfirmed' : null)
  if (COPY[outcome]) return COPY[outcome][hindi ? 1 : 0]
  if (alert.status === 'accepted') return hindi ? 'स्वयंसेवक ने ज़िम्मेदारी ली' : 'Volunteer assigned'
  return hindi ? 'मदद का इंतज़ार' : 'Waiting for a volunteer'
}

export default function OutcomeSummary({ alert }) {
  const { lang } = useI18n()
  const hindi = lang === 'hi'
  const at = alert.outcome_at && Number.isFinite(Date.parse(alert.outcome_at)) ? alert.outcome_at : null
  const progress = { on_the_way: hindi ? 'स्वयंसेवक रास्ते में है' : 'Volunteer reports: on the way', arrived: hindi ? 'स्वयंसेवक ने पहुँचने की सूचना दी' : 'Volunteer reports: arrived' }[alert.response_progress]
  return <div className="my-3 text-sm leading-relaxed text-app-ink">
    <p className="font-medium">{outcomeLabel(alert, hindi)}</p>
    {progress && alert.status === 'accepted' && <p className="mt-1 text-xs text-app-muted">{progress}</p>}
    {at && <time dateTime={at} className="mt-1 block text-xs text-app-muted">{new Date(at).toLocaleString(lang)}</time>}
    {alert.status === 'resolved' && alert.outcome !== 'reporter_confirmed_safe' && <p className="mt-1 text-xs text-app-muted">{hindi ? 'रिपोर्ट बंद होना मेडिकल पुष्टि या सुरक्षा की गारंटी नहीं है।' : 'Closing a report is not a medical assessment or a guarantee of safety.'}</p>}
  </div>
}
