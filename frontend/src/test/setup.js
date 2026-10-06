/**
 * Vitest setup — runs before every test file.
 *
 *  - Adds @testing-library/jest-dom matchers (toBeInTheDocument etc).
 *  - Stubs the browser APIs jsdom doesn't ship: matchMedia, IntersectionObserver,
 *    canvas getContext, navigator.geolocation, Notification, Web Speech.
 *  - Resets localStorage / IndexedDB between tests.
 *
 * Keep stubs minimal — pull in faking libraries only when a real test needs
 * them. For now everything we need is a no-op stub.
 */

import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})

// matchMedia — Tailwind hydration, prefers-reduced-motion checks
if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// IntersectionObserver — used by lazy-loading patterns
if (!window.IntersectionObserver) {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  window.IntersectionObserver = IO
}

// canvas.toDataURL / drawImage — used by the photo compressor
HTMLCanvasElement.prototype.getContext = function getContext() {
  return {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
  }
}
HTMLCanvasElement.prototype.toDataURL = function toDataURL() {
  // Returns a tiny payload so length-based budgets in tests pass deterministically
  return 'data:image/jpeg;base64,/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODw'
}

// FileReader.readAsDataURL — synchronous-fake so photo tests don't await
class _FakeFileReader {
  constructor() {
    this.result = null
    this.onload = null
    this.onerror = null
  }
  readAsDataURL(blob) {
    this.result = `data:${blob.type};base64,FAKE`
    queueMicrotask(() => this.onload?.({ target: this }))
  }
}
if (typeof FileReader === 'undefined' || !window.FileReader) {
  window.FileReader = _FakeFileReader
}

// Image element — make any src "load" instantly with default 800x600 dims
Object.defineProperty(window.HTMLImageElement.prototype, 'src', {
  set(value) {
    this._src = value
    queueMicrotask(() => {
      // Set sensible defaults so canvas math doesn't divide by zero
      Object.defineProperty(this, 'naturalWidth', {
        configurable: true,
        value: 800,
      })
      Object.defineProperty(this, 'naturalHeight', {
        configurable: true,
        value: 600,
      })
      this.onload?.()
    })
  },
  get() {
    return this._src
  },
})

// navigator.geolocation — components mount-hooks read this on render
if (!('geolocation' in navigator)) {
  Object.defineProperty(navigator, 'geolocation', {
    value: {
      getCurrentPosition: vi.fn((ok) =>
        ok({ coords: { latitude: 30.7333, longitude: 76.7794, accuracy: 10 }, timestamp: Date.now() })
      ),
      watchPosition: vi.fn(() => 1),
      clearWatch: vi.fn(),
    },
    configurable: true,
  })
}

// Notification API — useNotifications gates on these
if (typeof window.Notification === 'undefined') {
  window.Notification = function Notification() {}
  window.Notification.permission = 'default'
  window.Notification.requestPermission = vi.fn(async () => 'granted')
}

// Web Speech API stubs — useVoice probes for these
window.SpeechRecognition = window.SpeechRecognition || vi.fn()
window.webkitSpeechRecognition = window.webkitSpeechRecognition || vi.fn()
