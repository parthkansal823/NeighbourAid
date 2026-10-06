import { rename } from 'node:fs/promises'
import { resolve } from 'node:path'

// Vite preserves an HTML entry point's file name. The dedicated demo uses
// demo.html so it never accidentally becomes the normal app's entry, while
// a static Worker needs index.html at its root. Vite empties dist-demo before
// every build, so this is a simple, bounded rename inside generated output.
const output = resolve('dist-demo')
await rename(resolve(output, 'demo.html'), resolve(output, 'index.html'))
