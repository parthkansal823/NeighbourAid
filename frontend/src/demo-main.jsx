import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { installDemoApi } from './demo/mockApi'
import './index.css'

// The demo has its own entry point and a memory-only API before React mounts.
// It cannot touch the real backend, sessions, or location of a real user.
installDemoApi()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
