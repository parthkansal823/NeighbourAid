/**
 * Accessibility regression guard for the forms.
 *
 * Why this file exists: every `<label>` in the app was visual only. They sat
 * next to their input with no htmlFor/id pairing and no wrapping, so a screen
 * reader announced each field as an unlabelled edit box — you could hear
 * "blank, edit text" twice on the login form with nothing to say which one
 * was the password — and tapping a label did not focus its input either.
 *
 * That is a bad failure for this app in particular. The people most likely to
 * be filing a report one-handed, in the dark, or with a screen reader are the
 * people already in the emergency.
 *
 * It was also invisible to every check the project had: eslint does not know
 * about it, the unit tests query by role and passed regardless, and a human
 * reviewer sees a label rendered on screen and moves on. axe is what actually
 * catches it, which is why the guard is automated rather than a one-off audit.
 *
 * These assertions are deliberately narrow — the specific rules that broke,
 * not a blanket "no violations". A blanket assertion over a page this size
 * fails on unrelated colour-contrast findings and gets skipped within a week.
 */

import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'vitest-axe'

import { I18nProvider } from '../utils/i18n'
import { AuthProvider } from '../context/AuthContext'
import { ToastProvider } from '../components/Toast'
import Login from '../pages/Login'
import Register from '../pages/Register'

// The rules that were actually broken. `label` covers a control with no
// accessible name at all; `form-field-multiple-labels` and
// `label-title-only` cover the ways a "fix" can look right and still leave
// the control unnamed.
const RULES = {
  label: { enabled: true },
  'label-title-only': { enabled: true },
  'form-field-multiple-labels': { enabled: true },
  'aria-valid-attr-value': { enabled: true },
  'aria-allowed-attr': { enabled: true },
}

function renderPage(ui) {
  return render(
    <MemoryRouter>
      <I18nProvider>
        <AuthProvider>
          <ToastProvider>{ui}</ToastProvider>
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  )
}

async function auditFormRules(ui) {
  const { container } = renderPage(ui)
  return axe(container, { rules: RULES })
}

describe('form accessibility', () => {
  it('every Login control has an accessible name', async () => {
    const results = await auditFormRules(<Login />)
    expect(results.violations).toEqual([])
  })

  it('every Register control has an accessible name', async () => {
    const results = await auditFormRules(<Register />)
    expect(results.violations).toEqual([])
  })

  // The axe rules above are necessary but NOT sufficient, and it is worth
  // saying why: axe accepts a `placeholder` as an accessible name. Every
  // input on these forms has one, so axe stayed green even with the
  // htmlFor/id pairing stripped back out — a guard that cannot fail on the
  // bug it was written for. Verified by deleting a fix and watching it pass.
  //
  // A placeholder is not a label. It disappears the moment you type, it is
  // not announced by every screen reader, and it cannot be tapped to focus
  // the field. So this walks every control and demands a real label:
  // wrapping (implicit) or htmlFor/id (explicit). Nothing else counts.
  function assertEveryControlIsLabelled(container) {
    const controls = [
      ...container.querySelectorAll('input, textarea, select'),
    ].filter((el) => el.type !== 'hidden')
    expect(controls.length).toBeGreaterThan(0)

    for (const el of controls) {
      const wrapped = el.closest('label') !== null
      const explicit =
        el.id !== '' &&
        container.querySelector(`label[for="${CSS.escape(el.id)}"]`) !== null
      const described = el.getAttribute('aria-label') !== null

      expect(
        wrapped || explicit || described,
        `control <${el.tagName.toLowerCase()}${el.type ? ` type="${el.type}"` : ''}` +
          `${el.id ? ` id="${el.id}"` : ' (no id)'}> has no label — ` +
          `a placeholder does not count`
      ).toBe(true)
    }
  }

  it('every Login control has a real label, not just a placeholder', () => {
    const { container } = renderPage(<Login />)
    assertEveryControlIsLabelled(container)
  })

  it('every Register control has a real label, not just a placeholder', () => {
    const { container } = renderPage(<Register />)
    assertEveryControlIsLabelled(container)
  })

  it('grouped controls are named by aria-labelledby, not a stray label', () => {
    // The role picker and skills picker are groups of buttons, not single
    // controls. htmlFor cannot name them; a label element pointing at
    // nothing is worse than none, so they use role=group + aria-labelledby.
    const { container } = renderPage(<Register />)
    const groups = [...container.querySelectorAll('[role="group"]')]
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) {
      const id = group.getAttribute('aria-labelledby')
      expect(id, 'every group carries aria-labelledby').toBeTruthy()
      expect(container.querySelector(`#${CSS.escape(id)}`)).not.toBeNull()
    }
  })
})
