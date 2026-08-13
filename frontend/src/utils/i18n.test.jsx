import { describe, expect, it } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { I18nProvider, LANGUAGES, isSupportedLang, speechLocaleFor, useI18n } from './i18n'

import bn from '../i18n/bn'
import en from '../i18n/en'
import gu from '../i18n/gu'
import hi from '../i18n/hi'
import mr from '../i18n/mr'
import pa from '../i18n/pa'
import ta from '../i18n/ta'
import te from '../i18n/te'

const DICTS = { en, hi, bn, mr, te, ta, gu, pa }

function Probe() {
  const { t, lang, setLang } = useI18n()
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="msg">{t('nav_map')}</span>
      <button onClick={() => setLang('hi')} type="button">go-hi</button>
      <button onClick={() => setLang('xx')} type="button">go-bad</button>
    </div>
  )
}

describe('I18nProvider', () => {
  it('renders the English string by default', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    )
    expect(screen.getByTestId('lang')).toHaveTextContent('en')
    expect(screen.getByTestId('msg')).toHaveTextContent(/Live Map/i)
  })

  it('switches to Hindi when setLang("hi") is invoked', async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    )
    await act(async () => {
      screen.getByText('go-hi').click()
    })
    // `lang` flips synchronously; the strings follow once the chunk resolves.
    expect(screen.getByTestId('lang')).toHaveTextContent('hi')
    await waitFor(() => expect(screen.getByTestId('msg')).toHaveTextContent(/लाइव/))
  })

  it('ignores unknown language codes', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    )
    act(() => {
      screen.getByText('go-bad').click()
    })
    // Stays on the previous lang (en)
    expect(screen.getByTestId('lang')).toHaveTextContent('en')
  })

  it('turns auto-translate on by default', () => {
    // On by default is the product decision: a volunteer who can't read the
    // report can't act on it.
    localStorage.removeItem('autoTranslate')
    function Probe2() {
      const { autoTranslate } = useI18n()
      return <span data-testid="auto">{String(autoTranslate)}</span>
    }
    render(
      <I18nProvider>
        <Probe2 />
      </I18nProvider>
    )
    expect(screen.getByTestId('auto')).toHaveTextContent('true')
  })

  it('honours an explicit opt-out and does not silently re-enable', () => {
    // The counterweight to defaulting on: alert bodies go to a third-party
    // translation endpoint, so a user who turned it off must stay off across
    // reloads. A regression here would resume transmitting after they
    // declined, which is worse than never offering the toggle.
    localStorage.setItem('autoTranslate', '0')
    function Probe3() {
      const { autoTranslate } = useI18n()
      return <span data-testid="auto">{String(autoTranslate)}</span>
    }
    render(
      <I18nProvider>
        <Probe3 />
      </I18nProvider>
    )
    expect(screen.getByTestId('auto')).toHaveTextContent('false')
    localStorage.removeItem('autoTranslate')
  })

  it('falls back to English when a key is missing in the active language', () => {
    function MissingKey() {
      const { t } = useI18n()
      return <span data-testid="x">{t('this_key_does_not_exist')}</span>
    }
    render(
      <I18nProvider>
        <MissingKey />
      </I18nProvider>
    )
    // No translation found anywhere → returns the key itself as a last resort
    expect(screen.getByTestId('x')).toHaveTextContent('this_key_does_not_exist')
  })
})

describe('translation catalogues', () => {
  // The English file is the source of truth for the key set. A missing key
  // silently falls back to English at runtime, so a half-finished language
  // renders a bilingual UI instead of failing — good for users, invisible to
  // us. These tests make the gap visible at build time instead.
  const enKeys = Object.keys(en).sort()

  it('exposes a dictionary for every language offered in the menu', () => {
    for (const { code } of LANGUAGES) {
      expect(DICTS[code], `no dictionary for '${code}'`).toBeTruthy()
      expect(isSupportedLang(code), `'${code}' is in the menu but not loadable`).toBe(true)
    }
    // And nothing unreachable: a dictionary not in LANGUAGES is dead weight
    // in the bundle that no user can ever select.
    expect(Object.keys(DICTS).sort()).toEqual(LANGUAGES.map((l) => l.code).sort())
  })

  it.each(LANGUAGES.map((l) => [l.code, DICTS[l.code].nav_map]))(
    'lazily loads the %s chunk and renders its strings',
    async (code, expected) => {
      // The dictionaries are dynamic imports now, so a language can be listed
      // in the menu, have a complete file, and still never reach the screen if
      // the loader map misses it. Drive it through the provider to prove the
      // whole path works, not just that the file exists.
      function Switcher() {
        const { t, setLang } = useI18n()
        return (
          <div>
            <span data-testid="msg">{t('nav_map')}</span>
            <button onClick={() => setLang(code)} type="button">go</button>
          </div>
        )
      }
      render(
        <I18nProvider>
          <Switcher />
        </I18nProvider>
      )
      await act(async () => {
        screen.getByText('go').click()
      })
      await waitFor(() => expect(screen.getByTestId('msg')).toHaveTextContent(expected))
    }
  )

  it.each(LANGUAGES.map((l) => l.code))('%s covers exactly the English key set', (code) => {
    expect(Object.keys(DICTS[code]).sort()).toEqual(enKeys)
  })

  it.each(LANGUAGES.filter((l) => l.code !== 'en').map((l) => l.code))(
    '%s has no untranslated copy-paste left over',
    (code) => {
      // A value byte-identical to English usually means the key was pasted in
      // and never translated. `register_detecting` is a bare ellipsis, which
      // is genuinely the same in every language.
      const copied = enKeys.filter(
        (k) => k !== 'register_detecting' && DICTS[code][k] === en[k]
      )
      expect(copied).toEqual([])
    }
  )
})

describe('speech locales', () => {
  // Voice is the accessibility path: someone chooses the mic because typing
  // is hard, or because they cannot type their script at all. Falling back to
  // en-IN does not fail loudly — the browser confidently transcribes their
  // Tamil as English nonsense, which is worse than refusing.
  it('maps every offered language to its own speech locale', () => {
    const seen = new Map()
    for (const { code } of LANGUAGES) {
      const locale = speechLocaleFor(code)
      expect(locale, `${code} has no speech locale`).toBeTruthy()
      expect(locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
      if (code !== 'en') {
        expect(
          locale.startsWith(`${code}-`),
          `${code} falls back to '${locale}' — speech input would be transcribed as the wrong language`
        ).toBe(true)
      }
      seen.set(code, locale)
    }
    // No two languages may share a locale, which is what a silent fallback
    // to en-IN looks like from the outside.
    expect(new Set(seen.values()).size).toBe(LANGUAGES.length)
  })

  it('falls back to en-IN for an unknown code rather than returning undefined', () => {
    expect(speechLocaleFor('xx')).toBe('en-IN')
    expect(speechLocaleFor(undefined)).toBe('en-IN')
  })
})
