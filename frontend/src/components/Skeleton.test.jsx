import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Skeleton, SkeletonAlertList, SkeletonCard } from './Skeleton'

describe('<Skeleton /> primitives', () => {
  it('renders an aria-hidden shimmer block', () => {
    const { container } = render(<Skeleton className="h-4 w-24" />)
    const node = container.firstChild
    expect(node).toHaveClass('skeleton')
    expect(node).toHaveAttribute('aria-hidden')
  })

  it('SkeletonCard renders the requested number of body lines', () => {
    const { container } = render(<SkeletonCard lines={4} />)
    const lines = container.querySelectorAll('.skeleton')
    // 3 header skeletons + 4 body lines + 2 footer chips
    expect(lines.length).toBe(9)
  })

  it('SkeletonAlertList renders count cards with the right ARIA role', () => {
    render(<SkeletonAlertList count={2} />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-label', expect.stringContaining('Loading'))
    // 2 cards × (2 header + 3 body) = 10 shimmer blocks
    expect(status.querySelectorAll('.skeleton').length).toBe(16)
  })
})
