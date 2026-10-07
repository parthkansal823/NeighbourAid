const { chromium } = require('C:/Users/parth/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const fs = require('node:fs')
const path = require('node:path')
const output = __dirname
const now = new Date().toISOString()
const alert = {
  id: 'qa-alert', owner_id: 'qa-user', category: 'medical', urgency: 'CRITICAL',
  status: 'open', description: 'A neighbour needs urgent medical help near the community centre. Please bring a first-aid kit.',
  address: 'Community centre, Sector 17, Chandigarh', created_at: now,
  location: { type: 'Point', coordinates: [76.7794, 30.7333] },
  verified_score: 35, witnesses: 2, volunteer_ids: [], volunteers: [], updates: [], photo_count: 0,
}
const profile = role => ({
  id: 'qa-user', name: 'Test neighbour', role, email: 'neighbour@example.test',
  skills: ['first_aid'], has_vehicle: true, emergency_contacts: [], phone: '',
  location: alert.location, availability: { timezone: 'Asia/Kolkata', from_hour: 0, to_hour: 24, critical_always: true },
})
const widths = process.argv.includes('--quick') ? [390] : [320, 360, 390, 768, 1280]
const screens = [
  ['home', '/', null], ['login', '/login', null], ['register', '/register', null],
  ['report', '/post-alert', null], ['map', '/map', null], ['safety', '/safety', null],
  ['resources', '/resources', null], ['news', '/news', null], ['help', '/help', null],
  ['shared-alert', '/alert/qa-alert', null], ['my-alerts', '/my-alerts', 'reporter'],
  ['volunteer', '/volunteer', 'volunteer'], ['profile', '/profile', 'volunteer'],
]
const errors = [], results = []
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/parth/AppData/Local/ms-playwright/chromium_headless_shell-1194/chrome-win/headless_shell.exe' })
  try {
    for (const theme of ['light', 'dark']) for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: width === 768 ? 1024 : width === 1280 ? 900 : 844 }, colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(() => {
        localStorage.setItem('lang', 'en')
        localStorage.setItem('autoTranslate', '0')
        const fix = { coords: { latitude: 30.7333, longitude: 76.7794, accuracy: 20 }, timestamp: Date.now() }
        Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: ok => ok(fix), watchPosition: ok => { ok(fix); return 1 }, clearWatch: () => {} } })
      })
      let role = null
      await context.route('**/*', async route => {
        const url = new URL(route.request().url())
        const key = url.pathname.replace(/\/$/, '')
        if (key === '/health') return route.fulfill({ json: { status: 'ok' } })
        if (key.startsWith('/api/')) {
          if (route.request().method() !== 'GET') { errors.push(`Unexpected write: ${key}`); return route.abort() }
          let data = []
          if (key === '/api/users/me') data = profile(role)
          else if (key === '/api/users/me/stats') data = { posted: 2, open: 1, resolved: 1, accepted: 2, in_progress: 1, completed: 1, trust: { label: 'new' } }
          else if (key === '/api/stats') data = { active_alerts: 7, critical_open: 2 }
          else if (key.includes('leaderboard')) data = { top: [] }
          else if (key.includes('/news/')) data = { items: [], sources: [] }
          else if (key === '/api/advisories') data = { status: 'available', items: [] }
          else if (key === '/api/help/mine') data = { posted: [], offered: [] }
          else if (key === '/api/safety/me') data = null
          else if (key === '/api/alerts/qa-alert') data = alert
          else if (key.startsWith('/api/alerts/')) data = [alert]
          return route.fulfill({ json: data })
        }
        if (['127.0.0.1', 'localhost'].includes(url.hostname)) return route.continue()
        // No requests reach production APIs, translation, releases or account services.
        return route.abort()
      })
      const page = await context.newPage()
      page.on('pageerror', error => errors.push(`${theme}/${width}: ${error.message}`))
      for (const [name, location, testRole] of screens) {
        role = testRole
        await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
        await page.evaluate(role => {
          if (role) {
            const body = btoa(JSON.stringify({ sub: 'qa-user', role, exp: Math.floor(Date.now() / 1000) + 3600 }))
            localStorage.setItem('token', `e30.${body}.fixture`)
            localStorage.setItem('name', 'Test neighbour')
          } else { localStorage.removeItem('token'); localStorage.removeItem('name') }
        }, testRole)
        await page.goto(`http://127.0.0.1:5173${location}`, { waitUntil: 'networkidle' })
        await page.locator('[aria-label="Opening NeighbourAid"]').waitFor({ state: 'detached', timeout: 8000 })
        const metrics = await page.evaluate(() => {
          const doc = document.documentElement
          const overflowing = [...document.querySelectorAll('#main-content *')].filter(el => {
            const r = el.getBoundingClientRect(), style = getComputedStyle(el)
            return r.width && (r.left < -1 || r.right > innerWidth + 1) && style.position !== 'absolute' && style.position !== 'fixed' && !el.closest('.leaflet-container') && !el.closest('.map-filters')
          }).slice(0, 8).map(el => `${el.tagName}.${String(el.className).slice(0, 100)}`)
          return { viewport: innerWidth, scrollWidth: doc.scrollWidth, theme: doc.dataset.theme, h1: document.querySelector('h1')?.textContent, overflowing }
        })
        results.push({ name, width, theme, ...metrics })
        if (metrics.scrollWidth > width + 1) errors.push(`Horizontal overflow ${name}/${theme}/${width}: ${JSON.stringify(metrics)}`)
        if (metrics.theme !== theme) errors.push(`Wrong theme ${name}/${theme}/${width}`)
        if (width === 390 || (width === 320 && ['login', 'register', 'report', 'profile'].includes(name)) || (width === 1280 && ['home', 'profile'].includes(name))) await page.screenshot({ path: path.join(output, `${name}-${theme}-${width}.png`), fullPage: true })
        console.log(`${theme} ${width} ${name}: ${metrics.scrollWidth === width ? 'ok' : metrics.scrollWidth}`)
      }
      await context.close()
    }
    fs.writeFileSync(path.join(output, 'responsive-results.json'), JSON.stringify({ results, errors }, null, 2))
    console.log(JSON.stringify({ checks: results.length, errors }))
    if (errors.length) process.exitCode = 1
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
