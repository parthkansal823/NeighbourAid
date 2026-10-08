import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.neighbouraid.app',
  appName: 'NeighbourAid',
  webDir: 'dist',
  bundledWebRuntime: false,
  plugins: {
    // Included in Capacitor 8; no extra plugin or hand-edited Android shell.
    // DEFAULT follows the device light/dark preference. The React shell also
    // updates it live if that preference changes while the app is open.
    SystemBars: { style: 'DEFAULT', insetsHandling: 'css' },
    // Keep forms inside the usable WebView in fullscreen Android. Do not
    // force a keyboard colour; its appearance follows the device theme.
    Keyboard: { resizeOnFullScreen: true },
  },
}

export default config
