import { useI18n } from '../utils/i18n'

export function evidenceFor(alert) {
  const raw = alert.evidence_summary || {}
  const witnesses = Number(raw.independent_witnesses ?? Math.max(0, (alert.witnesses ?? 1) - 1))
  return {
    witnesses: Number.isFinite(witnesses) ? Math.max(0, Math.floor(witnesses)) : 0,
    photoReview: ['yes', 'no', 'unclear'].includes(raw.photo_review || alert.photo_verdict)
      ? (raw.photo_review || alert.photo_verdict) : 'not_checked',
  }
}

export default function EvidenceSummary({ alert }) {
  const { t } = useI18n()
  const evidence = evidenceFor(alert)
  return (
    <details className="mt-2 min-w-0 text-xs leading-relaxed text-app-muted">
      <summary className="min-h-12 cursor-pointer rounded-lg py-3 text-sm font-medium text-app-ink wrap-break-word focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">{t('evidence_explain')}</summary>
      <p>{t('evidence_note')}</p>
      <p className="mt-1">{t(`evidence_photo_${evidence.photoReview}`)}</p>
      <p className="mt-1">{t('evidence_attachment')}</p>
    </details>
  )
}
