/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  const isDemo = mode === 'demo'
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
  if (command === 'build' && (mode === 'production' || mode === 'mobile')) {
    const env = loadEnv(mode, process.cwd(), 'VITE_')

    // A Capacitor WebView is served from the phone, not workers.dev. Its
    // relative /api requests would therefore be sent to the phone itself.
    // The native package needs the stable public Worker address, never the
    // ephemeral tunnel URL. It is public configuration, but keeping it in a
    // dedicated mode makes an accidental mobile build without a reachable
    // API fail during CI rather than after it reaches someone's phone.
    if (mode === 'mobile') {
      const origin = env.VITE_MOBILE_EDGE_ORIGIN
      if (!origin) {
        throw new Error(
          'Missing VITE_MOBILE_EDGE_ORIGIN for a Capacitor build. Set it to the HTTPS workers.dev (or custom) URL, never to a tunnel URL.'
        )
      }
      let parsed
      try {
        parsed = new URL(origin)
      } catch {
        throw new Error('VITE_MOBILE_EDGE_ORIGIN must be a complete HTTPS origin.')
      }
      if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error('VITE_MOBILE_EDGE_ORIGIN must be an HTTPS origin with no path, query, or fragment.')
      }
      const leaked = ['VITE_API_URL', 'VITE_WS_URL'].filter((key) => env[key])
      if (leaked.length) {
        throw new Error(
          `Mobile builds route through the Worker, so ${leaked.join(' and ')} must not be set. Do not package a direct API or tunnel hostname.`
        )
      }
    } else {

    // Edge-proxy mode: the Cloudflare Worker in worker/index.js forwards
    // /api, /ws and /health to the backend, so the SPA talks to its own
    // origin and both variables must be ABSENT. The reasoning above is
    // inverted here — the origin does know about /api, because that is the
    // whole point of the Worker.
    //
    // Setting them anyway is the failure worth catching: the bundle would go
    // straight to the tunnel instead, which skips the edge and, worse, ships
    // the tunnel hostname to every visitor. Keeping it server-side is the
    // security property this mode is for, so the build refuses rather than
    // silently giving it away.
    if (env.VITE_EDGE_PROXY === '1') {
      const leaked = ['VITE_API_URL', 'VITE_WS_URL'].filter((k) => env[k])
      if (leaked.length) {
        throw new Error(
          `VITE_EDGE_PROXY=1 means the edge proxies the API, so ${leaked.join(
            ' and '
          )} must not be set - the SPA uses its own origin.
Setting them bypasses the Worker and publishes the backend hostname to every
visitor, which is exactly what routing through the edge avoids.`
        )
      }
    } else {
      const missing = ['VITE_API_URL', 'VITE_WS_URL'].filter((k) => !env[k])
      if (missing.length) {
        throw new Error(
          `Missing ${missing.join(' and ')} for a production build.
Copy frontend/.env.production.example to .env.production and fill it in.
VITE_WS_URL must use wss:// - a browser on an https page blocks ws://.

If the Cloudflare Worker is proxying the API instead, set VITE_EDGE_PROXY=1
and leave both of these unset.`
        )
      }
      if (!env.VITE_WS_URL.startsWith('wss://')) {
        throw new Error(
          `VITE_WS_URL is "${env.VITE_WS_URL}" - it must start with wss:// for an
https site. Insecure WebSockets are blocked by the browser, so the volunteer
feed would silently receive nothing while every REST route kept working.`
        )
      }
    }
    }
  }

  return {
  plugins: [react()],
  server: {
    port: 3000,
    // Gradle writes/locks generated reports while Vite is running on Windows.
    // Watching them caused EBUSY crashes and reloads unrelated to web source.
    watch: { ignored: ['**/android/**', '**/ios/**', '**/dist-demo/**'] },
    proxy: {
      '/api': 'http://localhost:8000',
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
  // These public build values match Gradle's VERSION_CODE/VERSION_NAME.
  // Only metadata is bundled, never signing keys or backend secrets.
  define: {
    __APP_BUILD__: JSON.stringify({
      versionCode: Number(process.env.VERSION_CODE || 1),
      versionName: process.env.VERSION_NAME || '1.0',
      channel: process.env.ANDROID_RELEASE_CHANNEL || 'debug',
    }),
  },
  // Split the bundle by responsibility so the user only downloads the
  // map-related code on first visit to /map, not on /login. Cuts the
  // initial JS payload roughly in half on the auth pages.
  //
  // Written as a function rather than the old object form: Vite 8 bundles
  // with Rolldown, which only accepts the callback signature.
  build: {
    // The shareable demo intentionally has its own Vite entry and output.
    // It contains only fictional UI data, so it can be deployed as a fully
    // separate static Worker with no access to the laptop-backed API.
    outDir: isDemo ? 'dist-demo' : 'dist',
    rollupOptions: {
      input: isDemo ? 'demo.html' : undefined,
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
    include: ['src/**/*.{test,spec}.{js,jsx}', 'worker/**/*.{test,spec}.{js,jsx}'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      exclude: ['src/**/*.test.{js,jsx}', 'src/test/**', 'src/main.jsx'],
    },
  },
  }
})
