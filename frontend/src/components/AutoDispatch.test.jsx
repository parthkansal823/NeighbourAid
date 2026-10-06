import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import AutoDispatch from './AutoDispatch'

describe('<AutoDispatch />', () => {
  it('renders ambulance number for medical alerts', () => {
    render(<AutoDispatch category="medical" />)
    expect(screen.getByText(/108/)).toBeInTheDocument()
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
