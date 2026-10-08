import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import AutoDispatch from './AutoDispatch'

describe('<AutoDispatch />', () => {
  it('renders ambulance number for medical alerts', () => {
    render(<AutoDispatch category="medical" />)
    expect(screen.getByText(/108/)).toBeInTheDocument()
  })

  it('keeps emergency call text high contrast in both system themes', () => {
    render(<AutoDispatch category="medical" />)
    const link = screen.getByRole('link', { name: 'Call Ambulance, 108' })
    expect(link).toHaveClass('text-[#fff]', 'bg-emerald-700')
    expect(link).not.toHaveClass('text-white')
    expect(screen.getByRole('link', { name: 'Call Medical helpline, 102' })).toHaveClass('text-[#fff]')
  })

  it('renders fire brigade number for fire alerts', () => {
    render(<AutoDispatch category="fire" />)
    expect(screen.getByText(/101/)).toBeInTheDocument()
  })

  it('renders the unified 112 fallback for unknown categories', () => {
    render(<AutoDispatch category="unknown-thing" />)
    expect(screen.getByText(/112/)).toBeInTheDocument()
  })

  it('uses tel: links so a tap dials immediately', () => {
    render(<AutoDispatch category="flood" />)
    const link = screen.getByTitle(/Call NDRF/i).closest('a')
    expect(link).toHaveAttribute('href', 'tel:1078')
  })
})
