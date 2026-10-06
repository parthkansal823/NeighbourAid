import axios from 'axios'
import { apiOrigin } from './runtime'

const api = axios.create({
  baseURL: apiOrigin(),
  timeout: 20000,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (config.skipAuth) config.headers.delete('Authorization')
  else if (token && !config.headers.has('Authorization')) {
    config.headers.set('Authorization', `Bearer ${token}`)
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Auto-logout on any 401 (expired or revoked token). We listen for this
    // event in AuthContext so the user state clears and the router bounces
    // them to /login without individual pages having to care.
    const sentAuthorization = err?.config?.headers?.get?.('Authorization')
    const currentToken = localStorage.getItem('token')
    if (err?.response?.status === 401 && currentToken && sentAuthorization === `Bearer ${currentToken}`) {
      localStorage.removeItem('token')
      localStorage.removeItem('name')
      window.dispatchEvent(new Event('auth:logout'))
    }
    return Promise.reject(err)
  }
)

export default api
