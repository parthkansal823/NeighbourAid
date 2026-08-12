import { describe, expect, it } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { I18nProvider, useI18n } from './i18n'

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

  it('switches to Hindi when setLang("hi") is invoked', () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>
    )
    act(() => {
      screen.getByText('go-hi').click()
    })
    expect(screen.getByTestId('lang')).toHaveTextContent('hi')
    expect(screen.getByTestId('msg')).toHaveTextContent(/लाइव/)
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
