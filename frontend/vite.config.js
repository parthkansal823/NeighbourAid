/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
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
})
