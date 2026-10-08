import { useEffect, useMemo } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from './AuthContext'

function createSessionClient(owner) {
  return new QueryClient({ defaultOptions: {
    queries: { staleTime: 0, gcTime: 60000, retry: 1, refetchOnWindowFocus: true, meta: { owner } },
    mutations: { retry: false },
  } })
}

/** Private server state stays in memory in its submitting account's client.
 * No cache persistence, bearer tokens, or old-account placeholder data. */
export default function AppQueryProvider({ children }) {
  const { user } = useAuth()
  const owner = user?.id || null
  const client = useMemo(() => createSessionClient(owner), [owner])
  useEffect(() => () => { void client.cancelQueries(); client.clear() }, [client])
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
