import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { jwtDecode } from 'jwt-decode'
import api from '../utils/api'

const AuthContext = createContext(null)

function parseToken(token) {
  try {
    const { sub, role, exp } = jwtDecode(token)
    if (exp && exp * 1000 < Date.now()) return null
    return { id: sub, role, exp }
  } catch {
    return null
  }
}

function readInitialUser() {
  const token = localStorage.getItem('token')
  if (!token) return null
  const parsed = parseToken(token)
  if (!parsed) {
    localStorage.removeItem('token')
    localStorage.removeItem('name')
    return null
  }
  return { ...parsed, name: localStorage.getItem('name') || '' }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => {
    const t = localStorage.getItem('token')
    return t && parseToken(t) ? t : null
  })
  const [user, setUser] = useState(readInitialUser)

  const persist = useCallback((t, name) => {
    localStorage.setItem('token', t)
    localStorage.setItem('name', name)
    setToken(t)
    setUser({ ...parseToken(t), name })
  }, [])

  const login = useCallback(
    async (email, password) => {
      const { data } = await api.post('/api/auth/login', { email, password })
      persist(data.token, data.name)
      return data
    },
    [persist]
  )

  const register = useCallback(
    async (payload) => {
      const { data } = await api.post('/api/auth/register', payload)
      persist(data.token, data.name)
      return data
    },
    [persist]
  )

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    localStorage.removeItem('name')
    setToken(null)
    setUser(null)
  }, [])

  // Auto-logout if the token expires while the tab is open.
  //
  // setTimeout stores its delay in a signed 32-bit int: anything over
  // ~24.8 days overflows and fires *immediately*, which would log the user
  // out on page load rather than in a month. Cap the wait and re-arm.
  useEffect(() => {
    if (!user?.exp) return undefined
    const MAX_DELAY = 2 ** 31 - 1
    const ms = user.exp * 1000 - Date.now()
    // Clamp to [0, MAX_DELAY] rather than branching to an immediate logout():
    // a 0 ms timer still fires right away, but the state change now happens
    // from a timer callback instead of synchronously inside the effect body.
    // (An already-expired token is filtered out by parseToken before it ever
    // reaches state, so this floor is belt-and-braces for clock skew.)
    const id = setTimeout(logout, Math.min(Math.max(ms, 0), MAX_DELAY))
    return () => clearTimeout(id)
  }, [user, logout])

  // Axios interceptor dispatches this on 401 so we can clear state here.
  useEffect(() => {
    const handler = () => logout()
    window.addEventListener('auth:logout', handler)
    return () => window.removeEventListener('auth:logout', handler)
  }, [logout])

  return (
    <AuthContext.Provider value={{ token, user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
