import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

const EDITABLE = 'textarea:not([readonly]):not(:disabled), input:not([readonly]):not(:disabled):is([type="text"],[type="email"],[type="password"],[type="number"],[type="tel"],[type="search"],[type="url"],:not([type])), [contenteditable="true"]'
const DISMISS_EVENT = 'neighbouraid:keyboard-dismiss'
const finite = value => Number.isFinite(value) && value > 0 ? value : 0
const initialState = () => ({ keyboardOpen: false, keyboardHeight: 0, bottomInset: 0, viewportHeight: typeof window === 'undefined' ? 0 : finite(window.visualViewport?.height) || finite(window.innerHeight) })

function removeListener(handle) {
  try { void Promise.resolve(handle?.remove()).catch(() => {}) } catch { /* Optional bridge. */ }
}

/** Mount once at the persistent navigation. Browser and native events feed
 * the same usable-viewport state; an already resized WebView is not padded
 * by the keyboard height a second time. No keyboard is opened automatically. */
export default function useKeyboardInsets() {
  const [state, setState] = useState(initialState)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return undefined
    const viewport = window.visualViewport
    const root = document.documentElement
    const properties = ['--app-keyboard-height', '--app-keyboard-inset', '--app-viewport-height']
    const previous = properties.map(property => root.style.getPropertyValue(property))
    const previousOpen = root.getAttribute('data-keyboard-open')
    const handles = []
    let alive = true
    let restingHeight = Math.max(finite(viewport?.height), finite(window.innerHeight))
    let restingWidth = window.innerWidth
    let nativeVisible = null
    let nativeHeight = 0
    let layoutResizedForKeyboard = false
    let current = initialState()
    let nativeKeyboard = false
    try { nativeKeyboard = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Keyboard') } catch { /* Old shell. */ }

    const editable = () => Boolean(document.activeElement?.matches?.(EDITABLE))
    const publish = next => {
      if (!alive) return
      current = next
      root.setAttribute('data-keyboard-open', String(next.keyboardOpen))
      root.style.setProperty('--app-keyboard-height', `${next.keyboardHeight}px`)
      root.style.setProperty('--app-keyboard-inset', `${next.bottomInset}px`)
      root.style.setProperty('--app-viewport-height', `${next.viewportHeight}px`)
      setState(old => Object.keys(next).every(key => old[key] === next[key]) ? old : next)
    }
    const update = (reveal = false, forceClosed = false) => {
      if (!alive) return
      const layoutHeight = finite(window.innerHeight)
      const height = finite(viewport?.height) || layoutHeight
      const offset = Math.max(0, Number(viewport?.offsetTop) || 0)
      if (window.innerWidth !== restingWidth) {
        restingWidth = window.innerWidth
        restingHeight = Math.max(layoutHeight + (nativeVisible === true && layoutResizedForKeyboard ? nativeHeight : 0), height)
      } else if (nativeVisible === true && layoutHeight < restingHeight - Math.max(80, nativeHeight / 2)) {
        layoutResizedForKeyboard = true
      }
      if (nativeVisible === false) {
        restingHeight = Math.max(height, layoutHeight)
        layoutResizedForKeyboard = false
      } else if (nativeVisible === true && layoutResizedForKeyboard) {
        restingHeight = Math.max(height, layoutHeight + nativeHeight)
      } else if (!editable() && nativeVisible !== true) {
        restingHeight = Math.max(restingHeight, height, layoutHeight)
      }
      const zoomed = viewport?.scale > 1.05
      const inferred = Math.max(0, restingHeight - height - offset)
      const keyboardOpen = !forceClosed && (nativeVisible === true || (nativeVisible === null && !zoomed && editable() && inferred > 140))
      const keyboardHeight = keyboardOpen ? (nativeVisible === true ? nativeHeight : inferred) : 0
      const visibleHeight = keyboardOpen && nativeVisible === true && !zoomed
        ? Math.min(height, Math.max(1, restingHeight - keyboardHeight))
        : height
      // Zoom changes CSS-pixel geometry, not the physical native height.
      // Do not pad by a mixed-unit subtraction during pinch zoom.
      const bottomInset = keyboardOpen && !zoomed ? Math.max(0, layoutHeight - visibleHeight - offset) : 0
      publish({ keyboardOpen, keyboardHeight, bottomInset, viewportHeight: visibleHeight })
      if (reveal && keyboardOpen && editable()) {
        const field = document.activeElement
        const box = field.getBoundingClientRect()
        const top = Math.max(offset + 12, (document.querySelector('.app-header')?.getBoundingClientRect().bottom || 0) + 12)
        if (box.bottom > offset + visibleHeight - 16 || box.top < top) {
          field.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' })
        }
      }
    }
    const onResize = () => update(true)
    const onScroll = () => update()
    const onFocus = () => update(true)
    const onBlur = () => update(false, nativeVisible !== true)
    const onOrientation = () => {
      restingWidth = window.innerWidth
      restingHeight = Math.max(finite(viewport?.height), finite(window.innerHeight) + (nativeVisible === true && layoutResizedForKeyboard ? nativeHeight : 0))
      update()
    }
    const dismiss = event => {
      if (!current.keyboardOpen) return
      event.preventDefault()
      if (nativeKeyboard) {
        try { void Promise.resolve(Keyboard.hide()).catch(() => {}) } catch { /* Blur is the fallback. */ }
      }
      if (editable()) document.activeElement.blur()
      nativeVisible = null
      nativeHeight = 0
      update(false, true)
    }
    viewport?.addEventListener?.('resize', onResize)
    viewport?.addEventListener?.('scroll', onScroll)
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrientation)
    window.addEventListener(DISMISS_EVENT, dismiss)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', onBlur)

    if (nativeKeyboard) {
      const listen = (name, callback) => {
        try {
          void Promise.resolve(Keyboard.addListener(name, callback)).then(handle => {
            if (alive) handles.push(handle)
            else removeListener(handle)
          }).catch(() => {})
        } catch { /* Browser viewport fallback stays active. */ }
      }
      listen('keyboardDidShow', info => {
        if (!alive) return
        nativeVisible = true
        nativeHeight = finite(info?.keyboardHeight)
        update(true)
      })
      listen('keyboardDidHide', () => {
        if (!alive) return
        nativeVisible = false
        nativeHeight = 0
        layoutResizedForKeyboard = false
        update()
      })
    }
    update()
    return () => {
      alive = false
      viewport?.removeEventListener?.('resize', onResize)
      viewport?.removeEventListener?.('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientation)
      window.removeEventListener(DISMISS_EVENT, dismiss)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', onBlur)
      handles.forEach(removeListener)
      properties.forEach((property, index) => previous[index] ? root.style.setProperty(property, previous[index]) : root.style.removeProperty(property))
      if (previousOpen === null) root.removeAttribute('data-keyboard-open')
      else root.setAttribute('data-keyboard-open', previousOpen)
    }
  }, [])

  return state
}
