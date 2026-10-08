import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import MapView from './MapView'

// Exercise real Leaflet markers/popups; only external tiles and SVG paths are
// omitted because jsdom has no layout/SVG renderer. No network or API writes.
vi.mock('react-leaflet', async importOriginal => ({
  ...await importOriginal(),
  TileLayer: () => null,
  Circle: () => null,
  Polyline: () => null,
}))
vi.mock('./HeatLayer', () => ({ default: () => null }))

const incident = {
  id: 'synthetic-incident', category: 'fire', urgency: 'HIGH', status: 'open',
  description: 'Smoke near the synthetic community hall',
  location: { coordinates: [76.779, 30.733] },
}
const center = [30.732, 76.777]
const destination = [30.734, 76.781]
let media, motionListeners
beforeEach(() => {
  motionListeners = new Set()
  media = {
    matches: false,
    addEventListener: (_type, listener) => motionListeners.add(listener),
    removeEventListener: (_type, listener) => motionListeners.delete(listener),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => media))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [] }) }))
})
afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.theme })

describe('accessible map markers', () => {
  it.each(['light', 'dark'])('names real divIcon markers and retains keyboard access in %s theme', async theme => {
    document.documentElement.dataset.theme = theme
    const view = render(<MapView alerts={[incident]} center={center} destination={destination} />)
    await screen.findByText('No driving route found.')
    for (const name of ['Your location', 'Destination', `fire incident, HIGH urgency: ${incident.description}`]) {
      const marker = screen.getByRole('button', { name })
      expect(marker).toHaveClass('leaflet-marker-icon')
      expect(marker).toHaveAttribute('title', name)
      expect(marker).toHaveAttribute('aria-label', name)
      expect(marker).toHaveAttribute('tabindex', '0')
    }
    const result = await axe.run(view.container, { runOnly: ['aria-command-name'] })
    expect(result.violations).toEqual([])
  })

  it('refreshes incident names when live data or focused icons change without remounting', () => {
    const view = render(<MapView alerts={[incident]} />)
    const marker = screen.getByRole('button', { name: /fire incident, HIGH urgency/ })
    const updated = { ...incident, urgency: 'MEDIUM', description: 'Synthetic hall evacuated safely' }
    view.rerender(<MapView alerts={[updated]} focusId={incident.id} />)
    expect(screen.queryByRole('button', { name: /HIGH urgency/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'fire incident, MEDIUM urgency: Synthetic hall evacuated safely' })).toBe(marker)
    expect(marker).toHaveAttribute('title', 'fire incident, MEDIUM urgency: Synthetic hall evacuated safely')
  })

  it('opens incident details with Enter using the real Leaflet popup behavior', () => {
    render(<MapView alerts={[incident]} />)
    const marker = screen.getByRole('button', { name: /fire incident, HIGH urgency/ })
    expect(screen.queryByText(incident.description)).not.toBeInTheDocument()
    fireEvent.keyPress(marker, { key: 'Enter', keyCode: 13, charCode: 13, which: 13 })
    expect(screen.getByText(incident.description)).toBeVisible()
    expect(screen.getByText(/HIGH · open/)).toBeVisible()
  })

  it('keeps practice labels explicit and safely bounds untrusted description text', () => {
    const description = '<img src=x onerror=alert(1)>\n' + 'synthetic '.repeat(100)
    const view = render(<MapView alerts={[{ ...incident, is_drill: true, description }]} />)
    const marker = screen.getByRole('button', { name: /^Practice fire incident, HIGH urgency:/ })
    expect(marker.getAttribute('aria-label')).toContain('<img src=x onerror=alert(1)> synthetic')
    expect(marker.getAttribute('aria-label')).toHaveLength('Practice fire incident, HIGH urgency: '.length + 120)
    expect(marker.getAttribute('aria-label')).toMatch(/…$/)
    expect(view.container.querySelector('[onerror]')).toBeNull()
    view.rerender(<MapView alerts={[{ ...incident, category: '', urgency: '', description: '' }]} />)
    expect(screen.getByRole('button', { name: 'other incident, urgency not reported' })).toBeInTheDocument()
  })

  it('removes SMIL pulses on live reduced-motion changes and guards the user halo with a media query', async () => {
    const view = render(<MapView alerts={[incident]} center={center} destination={destination} focusId={incident.id} />)
    await screen.findByText('No driving route found.')
    expect(view.container.querySelectorAll('.leaflet-marker-icon animate')).toHaveLength(4)
    const halo = view.container.querySelector('.na-user-halo')
    expect(halo).not.toBeNull()
    expect(halo.parentNode.parentNode.querySelector('style').textContent).toContain('@media(prefers-reduced-motion:reduce){.na-user-halo{animation:none!important}}')
    act(() => { media.matches = true; motionListeners.forEach(listener => listener()) })
    expect(view.container.querySelectorAll('.leaflet-marker-icon animate')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Destination' }).querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('button', { name: /fire incident/ }).querySelector('svg')).not.toBeNull()
  })
})
