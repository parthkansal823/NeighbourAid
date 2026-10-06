import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

// Follow side-effect style imports only, without mounting React or requiring
// the DOM. Demo and real builds must include the same Leaflet positioning CSS.
function importedStyles(file, seen = new Set()) {
  if (seen.has(file.href)) return []
  seen.add(file.href)
  const source = readFileSync(file, 'utf8')
  const imports = [...source.matchAll(/^import\s+['"]([^'"]+)['"]/gm)]
  return imports.flatMap(([, specifier]) => {
    if (specifier.endsWith('.css')) return [specifier]
    if (specifier.startsWith('.')) {
      return importedStyles(new URL(specifier, file), seen)
    }
    return []
  })
}

for (const entry of ['main.jsx', 'demo-main.jsx']) {
  test(`${entry} includes Leaflet positioning and shared app styles`, () => {
    assert.deepEqual(
      importedStyles(new URL(`../src/${entry}`, import.meta.url)),
      ['leaflet/dist/leaflet.css', './index.css'],
    )
  })
}
