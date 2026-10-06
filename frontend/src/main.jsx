import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Import this from JavaScript rather than through CSS `@import layer(...)`.
// Vite then fingerprints Leaflet's PNG controls into dist instead of leaving
// unresolved `images/...` URLs that break in an Android WebView.
import 'leaflet/dist/leaflet.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
