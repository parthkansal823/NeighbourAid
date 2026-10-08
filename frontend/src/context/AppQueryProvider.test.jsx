import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useQueryClient } from '@tanstack/react-query'
import AppQueryProvider from './AppQueryProvider'

const auth = vi.hoisted(() => ({ user: { id: 'alice' } }))
vi.mock('./AuthContext', () => ({ useAuth: () => auth }))
const seen = []
function Consumer() {
  const client = useQueryClient()
  seen.push(client)
  return <output>{client.getQueryData(['private-report']) || 'No cached private report'}</output>
}
describe('account-isolated server cache', () => {
  it('never carries private cached data into another account or logout', () => {
    auth.user = { id: 'alice' }
    const { rerender, unmount } = render(<AppQueryProvider><Consumer /></AppQueryProvider>)
    const alice = seen.at(-1)
    act(() => alice.setQueryData(['private-report'], 'Alice private report'))
    expect(alice.getDefaultOptions().mutations.retry).toBe(false)
    auth.user = { id: 'bob' }
    rerender(<AppQueryProvider><Consumer /></AppQueryProvider>)
    const bob = seen.at(-1)
    expect(bob).not.toBe(alice)
    expect(screen.getByRole('status')).toHaveTextContent('No cached private report')
    expect(alice.getQueryCache().getAll()).toHaveLength(0)
    act(() => bob.setQueryData(['private-report'], 'Bob private report'))
    auth.user = null
    rerender(<AppQueryProvider><Consumer /></AppQueryProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('No cached private report')
    expect(bob.getQueryCache().getAll()).toHaveLength(0)
    const anonymous = seen.at(-1)
    unmount()
    expect(anonymous.getQueryCache().getAll()).toHaveLength(0)
  })
})
