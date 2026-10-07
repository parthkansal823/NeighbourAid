import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axe } from 'vitest-axe'
import { I18nProvider } from '../utils/i18n'
import News from './News'
import Resources from './Resources'
import Safety from './Safety'

const mocks = vi.hoisted(() => ({ user: null, get: vi.fn(), post: vi.fn(), delete: vi.fn() }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: mocks.user }) }))
vi.mock('../utils/api', () => ({ default: { get: mocks.get, post: mocks.post, delete: mocks.delete } }))
vi.mock('../utils/geo', () => ({ getBrowseLocation: async () => ({ coords: [77.2, 28.6], isFallback: false }) }))
vi.mock('../components/OfficialAdvisories', () => ({ default: () => null }))
vi.mock('../components/DoctorReviewPanel', () => ({ default: () => null }))
vi.mock('../components/FirstAidGuide', () => ({ default: () => <button type="button">First aid</button> }))

const pins = [
  { id: 'shelter', kind: 'shelter', name: 'West shelter', owner_name: 'Synthetic tester', owner_id: 'tester', location: { coordinates: [77.2, 28.6] } },
  { id: 'food', kind: 'food', name: 'Community kitchen', owner_name: 'Test neighbour', owner_id: 'other', location: { coordinates: [77.2, 28.6] } },
]
const checkins = [
  { status: 'safe', user_name: 'Test neighbour', created_at: '2026-10-07T00:00:00Z', location: { coordinates: [77.2, 28.6] } },
  { status: 'need_help', user_name: 'Synthetic tester', created_at: '2026-10-07T00:00:00Z', note: 'Need transport', location: { coordinates: [77.2, 28.6] } },
]

function mount(page) {
  return render(<MemoryRouter><I18nProvider>{page}</I18nProvider></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = null
  mocks.get.mockImplementation(async (url) => {
    if (url === '/api/resources/near') return { data: pins }
    if (url === '/api/safety/near') return { data: checkins }
    if (url === '/api/safety/me') return { data: null }
    if (url === '/api/news/recent') return { data: { items: [
      { title: 'Local road update', source: 'Publisher A', link: 'https://example.invalid/a', topic: 'other' },
      { title: 'Water service update', source: 'Publisher B', link: 'https://example.invalid/b', topic: 'other' },
    ] } }
    return { data: [] }
  })
})

describe('informational screen controls', () => {
  it('gives each resource form control a visible associated label', async () => {
    mocks.user = { id: 'tester', name: 'Synthetic tester' }
    const { container } = mount(<Resources />)
    await screen.findByRole('heading', { name: 'West shelter' })
    for (const input of container.querySelectorAll('input:not([type="checkbox"]), textarea')) {
      expect(input.id).toBeTruthy()
      expect(container.querySelector(`label[for="${input.id}"]`)).toBeInTheDocument()
    }
    const kinds = screen.getByRole('group', { name: 'Resource type' })
    expect(within(kinds).getByRole('button', { name: 'Shelter' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(kinds).getByRole('button', { name: 'Food' }))
    expect(within(kinds).getByRole('button', { name: 'Food' })).toHaveAttribute('aria-pressed', 'true')
    expect(mocks.post).not.toHaveBeenCalled()
    expect((await axe(container, { runOnly: ['label', 'aria-valid-attr-value'] })).violations).toEqual([])
  })

  it('retains searchable resource filters and announces selection', async () => {
    mount(<Resources />)
    await screen.findByRole('heading', { name: 'West shelter' })
    fireEvent.click(screen.getByRole('button', { name: 'Food' }))
    expect(screen.getByRole('button', { name: 'Food' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('heading', { name: 'West shelter' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Community kitchen' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search resources' }), { target: { value: 'none matching' } })
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Community kitchen' })).not.toBeInTheDocument())
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('labels the safety note/search and keeps status filters read-only until a check-in is chosen', async () => {
    mocks.user = { id: 'tester' }
    mount(<Safety />)
    await screen.findByText('Need transport')
    expect(screen.getByLabelText('Short note (optional)')).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search check-ins' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Safe', exact: true }))
    expect(screen.getByRole('button', { name: 'Safe', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Need transport')).not.toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('keeps source filtering and publisher links available on the news list', async () => {
    mount(<News />)
    await screen.findByRole('heading', { name: 'Local road update' })
    fireEvent.change(screen.getByLabelText('News source'), { target: { value: 'Publisher B' } })
    expect(screen.queryByRole('heading', { name: 'Local road update' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Water service update' })).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('rel', 'noreferrer')
  })
})
