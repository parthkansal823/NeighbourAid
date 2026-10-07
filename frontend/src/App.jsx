import { Fragment, useCallback, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './components/Toast'
import { I18nProvider } from './utils/i18n'
import ErrorBoundary from './components/ErrorBoundary'
import EmergencyDialer from './components/EmergencyDialer'
import MobileNav from './components/MobileNav'
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
import News from './pages/News'
import Help from './pages/Help'
import AlertShare from './pages/AlertShare'
import ServerOfflineBanner from './components/ServerOfflineBanner'
import OfflineQueueStatus from './components/OfflineQueueStatus'
import AppUpdateNotice from './components/AppUpdateNotice'
import NativeHeader from './components/NativeHeader'
import useCompactAppShell from './hooks/useCompactAppShell'
import useSystemAppearance from './hooks/useSystemAppearance'
import AppUpdates from './pages/AppUpdates'
import LaunchScreen from './components/LaunchScreen'

function PrivateRoute({ children, role }) {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  if (role && user.role !== role) return <Navigate to="/" replace />
  return children
}

function DemoModeBanner() {
  if (import.meta.env.MODE !== 'demo') return null
  return (
    <div className="sticky top-0 z-[1200] border-b border-orange-400/50 bg-orange-500 px-4 py-2 text-center text-xs font-semibold text-black sm:text-sm">
      Fictional demo data only — no real users, alerts, payments, locations, or emergency calls are connected here.
    </div>
  )
}

function NativeFrame({ children }) {
  const { pathname } = useLocation()
  return <div className={`native-app${pathname === '/map' ? ' native-map-app' : ''}`}>{children}</div>
}

export default function App() {
  useSystemAppearance()
  const compactShell = useCompactAppShell()
  const Shell = compactShell ? NativeFrame : Fragment
  const [dialerOpen, setDialerOpen] = useState(false)
  const openDialer = useCallback(() => setDialerOpen(true), [])
  const closeDialer = useCallback(() => setDialerOpen(false), [])
  const statuses = <><ServerOfflineBanner native={compactShell} /><OfflineQueueStatus /><DemoModeBanner /></>
  return (
    <ErrorBoundary>
    <I18nProvider>
    <AuthProvider>
      <ToastProvider>
        <LaunchScreen />
        <BrowserRouter
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <Shell>
          {!compactShell && statuses}
          {compactShell ? <NativeHeader onOpenEmergency={openDialer} /> : <Navbar />}
          <AppUpdateNotice />
          <main id="main-content" className={compactShell ? 'app-content' : 'web-content pb-[5.5rem] lg:pb-0'}>
            {/* Status strips stay in flow, below the persistent app header. */}
            {compactShell && statuses}
            <Routes>
              <Route path="/" element={<Home compactShell={compactShell} />} />
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
              <Route path="/news" element={<News />} />
              <Route path="/help" element={<Help />} />
              <Route path="/app-updates" element={<AppUpdates />} />
              <Route path="/alert/:id" element={<AlertShare />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <MobileNav native={compactShell} />
          <EmergencyDialer native={compactShell} open={dialerOpen} onOpen={openDialer} onClose={closeDialer} />
          </Shell>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
    </I18nProvider>
    </ErrorBoundary>
  )
}
