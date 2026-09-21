/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // Fail the production build when the API URL is missing.
  //
  // Without this the build SUCCEEDS and ships a frontend whose requests go
  // to its own origin — Cloudflare — which serves static files and knows
  // nothing about /api. Every call 404s, the app looks broken for reasons
  // that point nowhere near the real cause, and nothing in the build output
  // hints at it. Same class of silent failure as ws:// instead of wss://.
  //
  // Only enforced for `vite build` in production; `npm run dev` proxies to
  // localhost:8000 and needs neither variable.
  if (command === 'build' && mode === 'production') {
    const env = loadEnv(mode, process.cwd(), 'VITE_')
    const missing = ['VITE_API_URL', 'VITE_WS_URL'].filter((k) => !env[k])
    if (missing.length) {
      throw new Error(
        `Missing ${missing.join(' and ')} for a production build.
Copy frontend/.env.production.example to .env.production and fill it in.
VITE_WS_URL must use wss:// - a browser on an https page blocks ws://.`
      )
    }
    if (env.VITE_WS_URL && !env.VITE_WS_URL.startsWith('wss://')) {
      throw new Error(
        `VITE_WS_URL is "${env.VITE_WS_URL}" - it must start with wss:// for an
https site. Insecure WebSockets are blocked by the browser, so the volunteer
feed would silently receive nothing while every REST route kept working.`
      )
    }
  }

  return {
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
  // Split the bundle by responsibility so the user only downloads the
  // map-related code on first visit to /map, not on /login. Cuts the
  // initial JS payload roughly in half on the auth pages.
  //
  // Written as a function rather than the old object form: Vite 8 bundles
  // with Rolldown, which only accepts the callback signature.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react-vendor'
          }
          if (/[\\/]node_modules[\\/](leaflet|react-leaflet|@react-leaflet)[\\/]/.test(id)) {
            return 'leaflet-vendor'
          }
          if (/[\\/]node_modules[\\/](axios|jwt-decode)[\\/]/.test(id)) {
            return 'auth-vendor'
          }
          if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) {
            return 'icons-vendor'
          }
          return undefined
        },
      },
    },
    // Lift the warning ceiling to a sane level after splitting; below
    // this size each chunk loads in ~1 RTT on a 3G connection.
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
    css: false,
    // Don't dive into node_modules / dist — keeps the run fast and avoids
    // accidentally including third-party __tests__ folders.
    include: ['src/**/*.{test,spec}.{js,jsx}'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.{js,jsx}', 'src/test/**', 'src/main.jsx'],
    },
  },
  }
})
