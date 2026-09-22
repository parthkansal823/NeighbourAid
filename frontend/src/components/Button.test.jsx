import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Button from './Button'

describe('<Button />', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Go</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('is disabled when loading', () => {
    render(<Button loading>Saving</Button>)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
  })

  it('respects the disabled prop', async () => {
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>
    )
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })

  it('gives variant="danger" a tone of its own', () => {
    // Asserts that the variant changes the tone, not which Tailwind classes
    // express it. The previous version pinned `from-red-500`/`to-red-600`,
    // so flattening the gradients — a pure styling change that broke
    // nothing — failed the suite and told us only that the class names had
    // moved. Comparing against the default catches a variant that silently
    // stops applying, which is the thing worth knowing.
    const { unmount } = render(<Button variant="danger">Cancel alert</Button>)
    const danger = screen.getByRole('button').className
    unmount()

    render(<Button>Cancel alert</Button>)
    const primary = screen.getByRole('button').className

    expect(danger).not.toEqual(primary)
    expect(danger).toMatch(/critical|red/)
  })

  it('every size clears the 44px tap floor', () => {
    // The `tap` utility is where the WCAG 2.5.5 minimum lives. size="sm"
    // used to be py-1.5 — about 28px — and a "small" button is still one
    // someone jabs at one-handed during an emergency.
    for (const size of ['sm', 'md', 'lg']) {
      const { unmount } = render(<Button size={size}>Go</Button>)
      expect(screen.getByRole('button').className).toContain('tap')
      unmount()
    }
  })

  it('applies a full-width class when full=true', () => {
    render(<Button full>Wide</Button>)
    expect(screen.getByRole('button').className).toContain('w-full')
  })
})
