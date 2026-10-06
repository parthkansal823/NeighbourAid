// Reproducible exports of the approved logo. The source is never overwritten.
// Android resources are generated separately by @capacitor/assets, not edited.
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = path.join(root, 'assets/logo.png')
const publicDir = path.join(root, 'public')
const pptDir = path.resolve(root, '../PPT')
await Promise.all([mkdir(publicDir, { recursive: true }), mkdir(pptDir, { recursive: true })])

const exports = [
  ['brand-logo.png', 192],
  ['favicon-32.png', 32],
  ['favicon-64.png', 64],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]
for (const [name, size] of exports) {
  await sharp(source).resize(size, size, { fit: 'contain' }).png().toFile(path.join(publicDir, name))
}
await sharp(source).resize(256, 256).png().toFile(path.join(pptDir, 'neighbouraid-logo.png'))
await sharp(source).resize(64, 64).png().toFile(path.join(pptDir, 'favicon.png'))

// Android/browser notification badges need a white silhouette with alpha,
// not a coloured square. Derive it from the same source, without redrawing it.
const { data, info } = await sharp(source).resize(72, 72).removeAlpha().raw().toBuffer({ resolveWithObject: true })
const silhouette = Buffer.alloc(72 * 72 * 4)
for (let pixel = 0; pixel < 72 * 72; pixel++) {
  const offset = pixel * info.channels
  silhouette.fill(255, pixel * 4, pixel * 4 + 3)
  silhouette[pixel * 4 + 3] = Math.max(data[offset], data[offset + 1], data[offset + 2]) > 70 ? 255 : 0
}
await sharp(silhouette, { raw: { width: 72, height: 72, channels: 4 } }).png().toFile(path.join(publicDir, 'badge-72.png'))

// A PNG-backed ICO keeps browsers requesting /favicon.ico on the new brand.
const favicon = await sharp(source).resize(32, 32).png().toBuffer()
const icoHeader = Buffer.alloc(22)
icoHeader.writeUInt16LE(1, 2) // icon file
icoHeader.writeUInt16LE(1, 4) // one image
icoHeader[6] = 32
icoHeader[7] = 32
icoHeader.writeUInt16LE(1, 10)
icoHeader.writeUInt16LE(32, 12)
icoHeader.writeUInt32LE(favicon.length, 14)
icoHeader.writeUInt32LE(22, 18)
await writeFile(path.join(publicDir, 'favicon.ico'), Buffer.concat([icoHeader, favicon]))
console.log('Exported approved NeighbourAid branding for web, notifications and PPT.')
