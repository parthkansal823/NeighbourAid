/**
 * Lightweight i18n for the eleven languages below. No runtime dependency,
 * no build-time tooling — just a dictionary + a tiny context. Every string
 * accessed via `t('key')` falls back to English if a translation is missing.
 *
 * A language belongs in three places at once: here, in SPEECH_LOCALES below,
 * and in backend/app/services/vocab.py. The first two are covered by tests.
 * The third is not enforceable from this side but matters most — an alert
 * written in a language the triage vocabulary does not know comes back
 * MEDIUM by default, however urgent it actually was.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import en from '../i18n/en'

// English is bundled eagerly because it is needed on every render regardless
// of preference: it is the default language and the per-key fallback. The
// other ten are ~22 KB of source each and only one can ever be active, so
// they load as separate chunks. Someone opening this on a low-end phone mid
// crisis should not wait to parse ten dictionaries they cannot read.
const LOADERS = {
  bn: () => import('../i18n/bn'),
  gu: () => import('../i18n/gu'),
  hi: () => import('../i18n/hi'),
  kn: () => import('../i18n/kn'),
  ml: () => import('../i18n/ml'),
  mr: () => import('../i18n/mr'),
  or: () => import('../i18n/or'),
  pa: () => import('../i18n/pa'),
  ta: () => import('../i18n/ta'),
  te: () => import('../i18n/te'),
}

// Labelled in the language itself, never in English — someone who needs this
// menu is by definition someone who may not read the English name for it.
export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'hi', label: 'हिन्दी', short: 'हिं' },
  { code: 'bn', label: 'বাংলা', short: 'বাং' },
  { code: 'mr', label: 'मराठी', short: 'मरा' },
  { code: 'te', label: 'తెలుగు', short: 'తెలు' },
  { code: 'ta', label: 'தமிழ்', short: 'தமி' },
  { code: 'gu', label: 'ગુજરાતી', short: 'ગુજ' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ', short: 'ਪੰ' },
  { code: 'kn', label: 'ಕನ್ನಡ', short: 'ಕನ್ನ' },
  { code: 'ml', label: 'മലയാളം', short: 'മല' },
  { code: 'or', label: 'ଓଡ଼ିଆ', short: 'ଓଡ଼' },
]

export function isSupportedLang(code) {
  return code === 'en' || Object.hasOwn(LOADERS, code)
}

// BCP-47 locales for the Web Speech APIs — speech recognition (the mic on
// the report form) and speech synthesis (spoken alerts in the volunteer
// feed). Both need a locale, not the bare language code.
//
// This lives here, beside LANGUAGES, because it was previously duplicated in
// two places and both had drifted: each handled only hi and pa and silently
// fell back to en-IN. A Tamil speaker pressing the mic got English
// recognition, which does not fail — it transcribes confident nonsense. For
// a user who chose voice because typing is hard, that is the worst outcome.
//
// Adding a language to LANGUAGES without adding it here is a silent
// regression, so a test asserts the two stay in step.
const SPEECH_LOCALES = {
  en: 'en-IN',
  hi: 'hi-IN',
  bn: 'bn-IN',
  mr: 'mr-IN',
  te: 'te-IN',
  ta: 'ta-IN',
  gu: 'gu-IN',
  pa: 'pa-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  // Odia recognition is not offered by every engine. The locale is still the
  // honest request to make — a browser that cannot serve it declines, which
  // shows as the mic not starting rather than as confident mistranscription
  // into another language.
  or: 'or-IN',
}

export function speechLocaleFor(code) {
  return SPEECH_LOCALES[code] ?? SPEECH_LOCALES.en
}

// Module-level cache, deliberately outside React: a dictionary fetched once
// stays available for the rest of the session, so toggling back to a language
// is instant and re-mounting the provider costs nothing.
const loaded = { en }
const inflight = new Map()

/**
 * Fetch a language chunk at most once. Resolves to the dictionary, or to null
 * if it cannot be fetched — offline, or a stale chunk hash after a redeploy.
 * Never rejects: a language that fails to load degrades to English, which is
 * a worse UI but a working one.
 */
function loadDict(code) {
  if (loaded[code]) return Promise.resolve(loaded[code])
  if (!LOADERS[code]) return Promise.resolve(null)
  if (!inflight.has(code)) {
    const p = LOADERS[code]()
      .then((mod) => {
        loaded[code] = mod.default
        return mod.default
      })
      .catch(() => null)
      .finally(() => inflight.delete(code))
    inflight.set(code, p)
  }
  return inflight.get(code)
}

function preferredLang() {
  try {
    const saved = localStorage.getItem('lang')
    if (saved && isSupportedLang(saved)) return saved
  } catch {
    /* localStorage blocked (private mode) — fall through to the browser hint */
  }
  // First-run: infer from browser locale, but only if we have a translation
  const browser = (navigator.language || 'en').slice(0, 2)
  return isSupportedLang(browser) ? browser : 'en'
}

// Start the fetch during module evaluation, before React mounts. Without this
// the import would not begin until the first effect runs, and a returning
// Tamil user would watch the whole UI paint in English and then swap.
loadDict(preferredLang())

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(preferredLang)

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

  // Bumped when a chunk finishes loading. The dictionary itself lives in the
  // module cache, so the counter is write-only: it exists purely to tell React
  // the cache changed and the render below should re-read it.
  const [, setLoadTick] = useState(0)

  useEffect(() => {
    localStorage.setItem('lang', lang)
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    if (loaded[lang]) return undefined
    let cancelled = false
    loadDict(lang).then(() => {
      if (!cancelled) setLoadTick((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [lang])

  useEffect(() => {
    localStorage.setItem('autoTranslate', autoTranslate ? '1' : '0')
  }, [autoTranslate])

  // Read during render, not held in state, so a cache hit needs no extra
  // render pass. While a chunk is still in flight this is the previously
  // active dictionary (or English on first load) — the UI stays readable
  // instead of blanking, and swaps once the strings arrive.
  const dict = loaded[lang] ?? en
  const t = useCallback((key) => dict[key] ?? en[key] ?? key, [dict])

  const value = useMemo(
    () => ({
      lang,
      t,
      setLang: (next) => {
        if (isSupportedLang(next)) setLang(next)
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
