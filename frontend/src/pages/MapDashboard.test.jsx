import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../utils/i18n'
import MapDashboard from './MapDashboard'

const state = vi.hoisted(() => ({ native: true }))
vi.mock('../utils/runtime', () => ({ isNativeApp: () => state.native }))
vi.mock('../utils/geo', () => ({ GEOLOCATION_SUPPORTED: false }))
vi.mock('../utils/api', () => ({ default: { get: vi.fn(async () => ({ data: [
  { id: 'test-fire', category: 'fire', urgency: 'HIGH' },
  { id: 'test-medical', category: 'medical', urgency: 'CRITICAL' },
] })) } }))
vi.mock('../components/MapView', () => ({ default: ({ alerts, showHeat }) => <div data-testid="map-surface" data-heat={showHeat}>{alerts.map((alert) => <span key={alert.id}>{alert.id}</span>)}</div> }))

beforeEach(() => { state.native = true })
afterEach(() => vi.restoreAllMocks())
const mount = () => render(<MemoryRouter><I18nProvider><MapDashboard /></I18nProvider></MemoryRouter>)

describe('map-first layout', () => {
  it('keeps the phone map visible, reveals filters on demand and applies them', async () => {
    const user = userEvent.setup()
    const { container } = mount()
    expect(container.querySelector('.map-page')).toHaveClass('map-compact')
    expect(screen.queryByRole('group', { name: 'Category' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false')
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    const categories = screen.getByRole('group', { name: 'Category' })
    await user.click(within(categories).getByRole('button', { name: /^fire/ }))
    expect(within(categories).getByRole('button', { name: /fire/ })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(screen.getByTestId('map-surface')).toHaveTextContent('test-fire'))
    expect(screen.getByTestId('map-surface')).not.toHaveTextContent('test-medical')
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    expect(screen.queryByRole('group', { name: 'Category' })).not.toBeInTheDocument()
    expect(screen.getByTestId('map-surface')).toHaveTextContent('test-fire')
  })

  it('expands the map without navigation, exits on Escape, and restores scrolling and focus', async () => {
    const user = userEvent.setup()
    const { container } = mount()
    await user.click(screen.getByRole('button', { name: 'Full-screen map' }))
    expect(container.querySelector('.map-page')).toHaveClass('map-expanded')
    expect(screen.getByRole('button', { name: 'Exit full-screen map' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(container.querySelector('.map-page')).not.toHaveClass('map-expanded')
    expect(document.body.style.overflow).toBe('')
    expect(screen.getByRole('button', { name: 'Full-screen map' })).toHaveFocus()
  })

  it('cleans up the full-screen scroll lock when leaving the page', async () => {
    const user = userEvent.setup()
    const { unmount } = mount()
    await user.click(screen.getByRole('button', { name: 'Full-screen map' }))
    unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('keeps desktop filters visible without a bottom-panel toggle', () => {
    state.native = false
    const { container } = mount()
    expect(container.querySelector('.map-page')).not.toHaveClass('map-compact')
    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Category' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Urgency' })).toBeInTheDocument()
  })

  it('uses compact controls on tablet web widths as well as installed phones', () => {
    state.native = false
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      media: query,
      matches: query === '(max-width: 1023px)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const { container } = mount()
    expect(container.querySelector('.map-page')).toHaveClass('map-compact')
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('group', { name: 'Category' })).not.toBeInTheDocument()
  })

  it('keeps optional heat controls in the filter panel and preserves the overlay when it closes', async () => {
    const user = userEvent.setup()
    mount()
    expect(screen.queryByRole('button', { name: 'Heat' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    const heat = screen.getByRole('button', { name: 'Heat' })
    expect(heat).toHaveClass('app-choice-button')
    expect(heat).toHaveAttribute('aria-pressed', 'false')
    await user.click(heat)
    expect(screen.getByRole('button', { name: 'Heat on' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('map-surface')).toHaveAttribute('data-heat', 'true')
    await user.click(screen.getByRole('button', { name: 'Filters' }))
    expect(screen.queryByRole('button', { name: 'Heat on' })).not.toBeInTheDocument()
    expect(screen.getByTestId('map-surface')).toHaveAttribute('data-heat', 'true')
    expect(screen.getByRole('button', { name: 'Recenter to my location' })).toHaveClass('app-secondary-button')
  })
})
