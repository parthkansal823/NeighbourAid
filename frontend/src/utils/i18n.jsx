/**
 * Lightweight i18n for English + Hindi + Punjabi. No runtime dependency,
 * no build-time tooling — just a dictionary + a tiny context. Every string
 * accessed via `t('key')` falls back to English if a translation is missing.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import en from '../i18n/en'
import hi from '../i18n/hi'
import pa from '../i18n/pa'

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'hi', label: 'हिन्दी', short: 'हिं' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ', short: 'ਪੰ' },
]

// Each language is its own module so a translator can own one file, and so
// the bundler can code-split them. Lookup falls back to English per key
// (see `t` below), which keeps a partially-translated language usable.
const DICT = { en, hi, pa }

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem('lang')
    if (saved && DICT[saved]) return saved
    // First-run: infer from browser locale, but only if we have a translation
    const browser = (navigator.language || 'en').slice(0, 2)
    return DICT[browser] ? browser : 'en'
  })

  // Auto-translate user-generated content (alert descriptions, updates) to
  // the active language.
  //
  // Defaults ON: this is a multilingual crisis network, and a volunteer who
  // can't read the report can't act on it. Comprehension is the product.
  //
  // The tradeoff, kept visible rather than silent: translation sends the
  // alert text to Google's public `translate.googleapis.com` endpoint, and
  // that text can be a domestic-abuse report or medical detail. So the
  // toggle in the language menu states plainly where the text goes and can
  // be turned off — for a whole session, or per-alert by simply not tapping
  // "Translate". Anything that weakens that disclosure re-creates the
  // original problem, which was transmission nobody was told about.
  const [autoTranslate, setAutoTranslate] = useState(() => {
    const v = localStorage.getItem('autoTranslate')
    return v == null ? true : v === '1'
  })

  useEffect(() => {
    localStorage.setItem('lang', lang)
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    localStorage.setItem('autoTranslate', autoTranslate ? '1' : '0')
  }, [autoTranslate])

  const t = useCallback(
    (key) => DICT[lang]?.[key] ?? DICT.en[key] ?? key,
    [lang]
  )

  const value = useMemo(
    () => ({
      lang,
      t,
      setLang: (next) => {
        if (DICT[next]) setLang(next)
      },
      languages: LANGUAGES,
      autoTranslate,
      setAutoTranslate,
    }),
    [lang, t, autoTranslate]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
