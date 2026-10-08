/** Synchronous, shared navigation guards; no native/browser listeners here. */
export const ANDROID_KEYBOARD_DISMISS_EVENT = 'neighbouraid:keyboard-dismiss'

const dialogs = []
const guards = []
let scrollLocks = 0
let previousOverflow = ''

export function registerScreenNavigationGuard(canLeave) {
  const entry = { canLeave }
  guards.push(entry)
  return () => {
    const index = guards.indexOf(entry)
    if (index !== -1) guards.splice(index, 1)
  }
}

/** A failed guard is conservative: never discard a report on an exception. */
export function allowScreenNavigation() {
  for (const entry of [...guards].reverse()) {
    try {
      if (entry.canLeave() === false) return false
    } catch {
      return false
    }
  }
  return true
}

export function registerDialogDismissal(getElement, close) {
  const entry = { getElement, close }
  dialogs.push(entry)
  return {
    isTop: () => dialogs.at(-1) === entry,
    remove: () => {
      const index = dialogs.indexOf(entry)
      if (index !== -1) dialogs.splice(index, 1)
    },
  }
}

/** Nested dialogs can unmount in any order without leaving scrolling locked. */
export function lockDialogScroll() {
  if (scrollLocks === 0) previousOverflow = document.body.style.overflow
  scrollLocks += 1
  document.body.style.overflow = 'hidden'
  let released = false
  return () => {
    if (released) return
    released = true
    scrollLocks -= 1
    if (scrollLocks === 0) document.body.style.overflow = previousOverflow
  }
}

function visible(element) {
  if (!element?.isConnected || element.closest('[hidden], [aria-hidden="true"]')) return false
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

function layer(element) {
  let highest = 0
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    const value = Number.parseInt(window.getComputedStyle(node).zIndex, 10)
    if (Number.isFinite(value)) highest = Math.max(highest, value)
  }
  return highest
}

/**
 * Dismiss one visible overlay only. Legacy modals have explicit close buttons;
 * clicking those preserves camera cleanup without broadcasting Escape to every
 * open dialog. An unknown modal consumes back rather than navigating below it.
 */
export function dismissTopAndroidOverlay() {
  const modals = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')]
    .filter(visible)
    .map((element, order) => ({ element, order, layer: layer(element) }))
    .sort((a, b) => a.layer - b.layer || a.order - b.order)
  const top = modals.at(-1)?.element
  if (top) {
    try {
      const registered = [...dialogs].reverse().find((entry) => {
        const element = entry.getElement()
        return element && (element === top || top.contains(element))
      })
      if (registered) registered.close()
      else top.querySelector('button[data-dialog-close], button.app-update-prompt-close, button[aria-label="Close"], button[aria-label="Close camera"]')?.click()
    } catch { /* A broken closer must not navigate underneath a modal. */ }
    return true
  }

  // Existing header/language menus expose their owner through aria-controls.
  const menus = [...document.querySelectorAll('button[aria-expanded="true"][aria-controls]')]
    .filter((button) => {
      const menu = document.getElementById(button.getAttribute('aria-controls'))
      return visible(menu) && menu.matches('nav, [role="menu"], [role="listbox"]')
    })
  const menuOwner = menus.at(-1)
  if (menuOwner) {
    menuOwner.click()
    return true
  }
  return false
}
