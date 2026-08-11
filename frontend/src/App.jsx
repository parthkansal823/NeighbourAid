import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider, useToast } from './components/Toast'
import { I18nProvider } from './utils/i18n'
import ErrorBoundary from './components/ErrorBoundary'
import EmergencyDialer from './components/EmergencyDialer'
import Navbar from './components/Navbar'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import PostAlert from './pages/PostAlert'
import MapDashboard from './pages/MapDashboard'
import VolunteerFeed from './pages/VolunteerFeed'
import MyAlerts from './pages/MyAlerts'
import Profile from './pages/Profile'
import Safety from './pages/Safety'
import Resources from './pages/Resources'
import AlertShare from './pages/AlertShare'
import api from './utils/api'
import { flushQueue, listPending } from './utils/offlineQueue'

function PrivateRoute({ children, role }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to="/" replace />
  return children
}

// App-wide flusher for the offline alert queue. Fires on mount (so alerts
// queued in a previous session deliver as soon as the tab opens) and on
// every `online` event. Lives up here so the queue works on any page, not
// just PostAlert.
function OfflineQueueFlusher() {
  const { user } = useAuth()
  const { push: toast } = useToast()

  useEffect(() => {
    // Runs for signed-out visitors too: /post-alert is public, so an anonymous
    // reporter can queue an alert while offline. Gating this on `user` left
    // those alerts stranded in IndexedDB forever.
    const endpoint = user ? '/api/alerts/' : '/api/alerts/anonymous'

    const tryFlush = async () => {
      if (!navigator.onLine) return
      try {
        const pending = await listPending()
        if (!pending.length) return
        const { sent } = await flushQueue((payload) =>
          api.post(endpoint, payload)
        )
        if (sent > 0) {
          toast({
            variant: 'success',
            title: 'Queued alerts sent',
            body: `${sent} alert${sent !== 1 ? 's' : ''} delivered after reconnect.`,
          })
        }
      } catch {
        /* silent — individual failures are retried next tick */
      }
    }

    tryFlush()
    window.addEventListener('online', tryFlush)
    return () => window.removeEventListener('online', tryFlush)
  }, [user, toast])

  return null
}

export default function App() {
  return (
    <ErrorBoundary>
    <I18nProvider>
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <OfflineQueueFlusher />
          <Navbar />
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/map" element={<MapDashboard />} />
            {/*
              Deliberately public. Someone standing over a collapsed stranger
              should not have to create an account first — the backend already
              exposes POST /api/alerts/anonymous for exactly this, and
              PostAlert picks that endpoint when there's no session. Logged-in
              reporters still post attributed alerts through the same form.
            */}
            <Route path="/post-alert" element={<PostAlert />} />
            <Route
              path="/my-alerts"
              element={
                <PrivateRoute role="reporter">
                  <MyAlerts />
                </PrivateRoute>
              }
            />
            <Route
              path="/volunteer"
              element={
                <PrivateRoute role="volunteer">
                  <VolunteerFeed />
                </PrivateRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <PrivateRoute>
                  <Profile />
                </PrivateRoute>
              }
            />
            <Route path="/safety" element={<Safety />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/alert/:id" element={<AlertShare />} />
          </Routes>
          <EmergencyDialer />
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
    </I18nProvider>
    </ErrorBoundary>
  )
}
