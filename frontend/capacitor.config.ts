import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.neighbouraid.app',
  appName: 'NeighbourAid',
  webDir: 'dist',
  bundledWebRuntime: false,
  plugins: {
    // Included in Capacitor 8; no extra plugin or hand-edited Android shell.
    SystemBars: { style: 'DARK', insetsHandling: 'css' },
  },
}

export default config
