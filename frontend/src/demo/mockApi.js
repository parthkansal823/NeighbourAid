import axios from 'axios'
import api from '../utils/api'

const DEMO_USER_ID = 'demo-volunteer-1'
const DEMO_COORDS = [77.209, 28.6139] // [lng, lat] — central Delhi
const now = () => new Date().toISOString()
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString()
const hoursFromNow = (hours) => new Date(Date.now() + hours * 3_600_000).toISOString()

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function fakeToken() {
  const encode = (value) => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: DEMO_USER_ID, role: 'volunteer', exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 })}.demo`
}

function location(lng, lat) {
  return { type: 'Point', coordinates: [lng, lat] }
}

function alert(id, category, urgency, description, address, lng, lat, minutes, extra = {}) {
  return {
    id,
    reporter_id: `demo-reporter-${id}`,
    category,
    urgency,
    description,
    headline: description.slice(0, 90),
    address,
    location: location(lng, lat),
    status: 'open',
    accepted_by: null,
    created_at: minutesAgo(minutes),
    resolved_at: null,
    eta_minutes: null,
    eta_set_at: null,
    verified_score: 38 + (Number(id.replace(/\D/g, '')) % 6) * 10,
    witnesses: 1 + (Number(id.replace(/\D/g, '')) % 3),
    corroborating_ids: [],
    urgency_confidence: 0.73,
    vulnerability: null,
    time_sensitivity: urgency === 'CRITICAL' ? 'immediate' : 'hours',
    language: 'en',
    triggers: [category],
    priority_score: 65,
    flags: 0,
    photo_count: 0,
    photos: [],
    photo_evidence_score: 0,
    photo_confidence: 0,
    photo_findings: '',
    weather_match: false,
    is_anonymous: false,
    is_drill: false,
    your_distance_km: 0.4 + (Number(id.replace(/\D/g, '')) % 9) * 0.7,
    your_eta_minutes: 3 + (Number(id.replace(/\D/g, '')) % 9) * 4,
    is_skill_match: ['medical', 'power'].includes(category),
    ...extra,
  }
}

function seedState() {
  const alerts = [
    alert('demo-alert-01', 'medical', 'CRITICAL', 'Demo: elderly neighbour needs assistance after a fall. Conscious and with family.', 'Fictional example · Lodhi Road, New Delhi', 77.2241, 28.5922, 4, { verified_score: 86, witnesses: 3, vulnerability: 'elderly', time_sensitivity: 'immediate' }),
    alert('demo-alert-02', 'fire', 'HIGH', 'Demo: smoke reported from a ground-floor electrical panel. Building security is checking the area.', 'Fictional example · Karol Bagh, New Delhi', 77.1905, 28.649, 11, { verified_score: 71, witnesses: 2, weather_match: true }),
    alert('demo-alert-03', 'accident', 'HIGH', 'Demo: scooter collision near the market crossing; traffic is slowing down.', 'Fictional example · Lajpat Nagar, New Delhi', 77.241, 28.566, 18, { verified_score: 63, witnesses: 2 }),
    alert('demo-alert-04', 'power', 'MEDIUM', 'Demo: apartment block lift and corridor lights are off after a local power outage.', 'Fictional example · Mayur Vihar, Delhi', 77.292, 28.608, 26, { verified_score: 48, triggers: ['power', 'lift'], is_skill_match: true }),
    alert('demo-alert-05', 'water', 'MEDIUM', 'Demo: water pipe leak is flooding the footpath outside the community gate.', 'Fictional example · Saket, New Delhi', 77.215, 28.525, 31, { verified_score: 55, witnesses: 3 }),
    alert('demo-alert-06', 'missing', 'HIGH', 'Demo: family is asking neighbours to help locate a child separated from them at the fair.', 'Fictional example · India Gate area, New Delhi', 77.2295, 28.6129, 35, { verified_score: 72, vulnerability: 'child', time_sensitivity: 'immediate' }),
    alert('demo-alert-07', 'gas', 'CRITICAL', 'Demo: possible cooking-gas smell reported in a residential kitchen. Residents have stepped outside.', 'Fictional example · Rajouri Garden, New Delhi', 77.121, 28.641, 42, { verified_score: 77, witnesses: 2, time_sensitivity: 'immediate' }),
    alert('demo-alert-08', 'animal', 'LOW', 'Demo: injured stray dog near the service lane needs a local animal-rescue contact.', 'Fictional example · Hauz Khas, New Delhi', 77.205, 28.549, 55, { verified_score: 35 }),
    alert('demo-alert-09', 'flood', 'MEDIUM', 'Demo: waterlogging is blocking a lane after heavy rain; two-wheelers are turning back.', 'Fictional example · Mandi House, New Delhi', 77.225, 28.627, 63, { verified_score: 59, weather_match: true }),
    alert('demo-alert-10', 'structure', 'HIGH', 'Demo: loose balcony plaster has fallen into an empty parking bay. Area is cordoned off.', 'Fictional example · Patel Nagar, New Delhi', 77.171, 28.647, 72, { verified_score: 69, witnesses: 2 }),
    alert('demo-alert-11', 'other', 'LOW', 'Demo: senior resident requests a neighbour to collect essential medicines before evening.', 'Fictional example · Defence Colony, New Delhi', 77.231, 28.572, 80, { verified_score: 42, vulnerability: 'elderly' }),
    alert('demo-alert-12', 'violence', 'HIGH', 'Demo: disturbance reported outside a closed shop. People nearby are keeping distance and calling authorities.', 'Fictional example · Paharganj, New Delhi', 77.219, 28.644, 96, { verified_score: 51, is_anonymous: true }),
    alert('demo-alert-13', 'medical', 'MEDIUM', 'Demo: person needs a volunteer to accompany them to a nearby clinic, not an ambulance.', 'Fictional example · Green Park, New Delhi', 77.208, 28.558, 110, { verified_score: 67, witnesses: 2 }),
    alert('demo-alert-14', 'fire', 'LOW', 'Demo: residents are requesting an extinguisher check after a small cooking incident was put out.', 'Fictional example · Ashram, New Delhi', 77.257, 28.57, 128, { verified_score: 46, status: 'resolved', resolved_at: minutesAgo(60) }),
  ]

  const resources = [
    ['demo-resource-01', 'water', 'Demo Water Point · Connaught Place', 'Fictional listing · bottled water at the community desk', 77.22, 28.632],
    ['demo-resource-02', 'food', 'Demo Community Kitchen · Nizamuddin', 'Fictional listing · hot meals until 8 pm', 77.245, 28.592],
    ['demo-resource-03', 'medical', 'Demo First-aid Desk · Khan Market', 'Fictional listing · trained volunteer with first-aid kit', 77.227, 28.6],
    ['demo-resource-04', 'shelter', 'Demo Night Shelter · Paharganj', 'Fictional listing · temporary indoor seating', 77.218, 28.642],
    ['demo-resource-05', 'blood', 'Demo Blood-donor Network · South Delhi', 'Fictional listing · donor coordination only', 77.206, 28.552],
    ['demo-resource-06', 'oxygen', 'Demo Oxygen Support Desk · Patel Nagar', 'Fictional listing · equipment availability check', 77.171, 28.648],
    ['demo-resource-07', 'clothes', 'Demo Relief Supplies · Mayur Vihar', 'Fictional listing · blankets and dry clothes', 77.292, 28.608],
    ['demo-resource-08', 'other', 'Demo Charging Point · Lodhi Colony', 'Fictional listing · device charging during a local outage', 77.224, 28.59],
  ].map(([id, kind, name, notes, lng, lat], index) => ({
    id, kind, name, notes, contact: '', capacity: index % 2 ? 'Available' : 'Limited', location: location(lng, lat), owner_id: `demo-owner-${index}`, owner_name: 'Demo community member', created_at: minutesAgo(90 + index * 8), expires_at: hoursFromNow(12 + index),
  }))

  const helpKinds = ['electrician', 'plumber', 'carpenter', 'mechanic', 'appliance', 'tech', 'tutor', 'cleaning', 'moving', 'other']
  const help = helpKinds.map((kind, index) => ({
    id: `demo-help-${String(index + 1).padStart(2, '0')}`,
    kind,
    title: [
      'MCB trips when the geyser starts', 'Kitchen tap is leaking', 'Wardrobe hinge needs repair', 'Scooter will not start',
      'Washing machine draining slowly', 'Laptop cannot join Wi-Fi', 'Maths revision for Class 10', 'Need help after moving furniture',
      'Two boxes need carrying upstairs', 'Neighbourhood errand support needed',
    ][index],
    description: `Fictional demo request for a nearby ${kind}. Budget and availability are only sample data.`,
    budget_min: 250 + index * 50,
    budget_max: 500 + index * 80,
    location: location(77.18 + index * 0.012, 28.55 + index * 0.012),
    requester_id: index === 0 ? DEMO_USER_ID : `demo-requester-${index}`,
    requester_name: index === 0 ? 'Aarav Mehta' : `Demo neighbour ${index + 1}`,
    contact: index === 0 ? '' : null,
    status: index === 7 ? 'done' : 'open',
    offer_count: index % 3,
    offers: index === 0 ? [{ worker_id: 'demo-worker-2', worker_name: 'Kavya Rao', price: 550, note: 'Can visit after 6 pm.' }] : [],
    created_at: minutesAgo(30 + index * 14),
    expires_at: hoursFromNow(48),
  }))

  return {
    user: {
      id: DEMO_USER_ID,
      name: 'Aarav Mehta',
      email: 'aarav.demo@example.invalid',
      role: 'volunteer',
      location: location(...DEMO_COORDS),
      skills: ['medical', 'driver', 'electrician'],
      has_vehicle: true,
      phone: '',
      emergency_contacts: [{ name: 'Demo contact', phone: '', email: 'contact@example.invalid' }],
      availability: { timezone: 'Asia/Kolkata', from_hour: 0, to_hour: 24, critical_always: true, busy_until: null },
      created_at: minutesAgo(20 * 24 * 60),
    },
    alerts,
    resources,
    help,
    safety: [
      ['Demo neighbour A', 'safe', 'Reached home safely.', 77.21, 28.615],
      ['Demo neighbour B', 'need_help', 'Needs assistance carrying supplies.', 77.22, 28.618],
      ['Demo neighbour C', 'safe', 'Family is together.', 77.205, 28.61],
      ['Demo neighbour D', 'safe', 'Power is back in our block.', 77.195, 28.625],
      ['Demo neighbour E', 'need_help', 'Needs water delivery for an elderly resident.', 77.23, 28.603],
      ['Demo neighbour F', 'safe', 'Checked in from the community hall.', 77.215, 28.595],
    ].map(([user_name, status, note, lng, lat], index) => ({
      id: `demo-safety-${index}`, user_name, status, note, location: location(lng, lat), created_at: minutesAgo(12 + index * 7), expires_at: hoursFromNow(24),
    })),
    news: [
      ['Community drill scheduled for Sunday', 'Fictional demo bulletin explaining a neighbourhood readiness drill.', 'readiness'],
      ['Rain advisory: keep drains clear', 'Fictional demo bulletin with a simple monsoon-preparedness reminder.', 'flood'],
      ['Volunteer orientation sign-ups open', 'Fictional demo bulletin about first-aid and response orientation.', 'medical'],
      ['Resident welfare group shares power-outage checklist', 'Fictional demo bulletin with torch, water and contact-list reminders.', 'power'],
      ['Road-safety volunteers mark a busy crossing', 'Fictional demo bulletin about pedestrian visibility near a market.', 'accident'],
      ['Pet-rescue desk coordinates foster homes', 'Fictional demo bulletin describing animal-rescue coordination.', 'rescue'],
      ['Community kitchen lists evening meal slots', 'Fictional demo bulletin explaining how neighbours can contribute meals.', 'other'],
      ['Local safety board receives check-ins', 'Fictional demo bulletin showing the check-in flow.', 'other'],
    ].map(([title, summary, topic], index) => ({
      title, summary, topic, source: 'NeighbourAid fictional demo', trust: index % 3 === 0 ? 'verified' : 'reputable', authenticity_score: 86 - index * 3, domain_match: true, domain: 'example.invalid', link: `https://example.invalid/neighbouraid-demo/news-${index + 1}`,
    })),
    updates: {
      'demo-alert-01': [
        { id: 'demo-update-01', author_name: 'Demo neighbour A', author_role: 'reporter', body: 'Fictional update: family is with the resident while help is arranged.', created_at: minutesAgo(3) },
        { id: 'demo-update-02', author_name: 'Aarav Mehta', author_role: 'volunteer', body: 'Fictional update: volunteer is reviewing nearby support options.', created_at: minutesAgo(1) },
      ],
    },
  }
}

function routePath(url) {
  try {
    return new URL(url || '/', 'https://demo.invalid').pathname
  } catch {
    return url || '/'
  }
}

function bodyOf(config) {
  if (!config.data) return {}
  if (typeof config.data === 'string') {
    try { return JSON.parse(config.data) } catch { return {} }
  }
  return config.data
}

function response(config, data, status = 200) {
  return Promise.resolve({ data: clone(data), status, statusText: status < 300 ? 'OK' : 'Error', headers: {}, config, request: null })
}

function findAlert(state, id) {
  return state.alerts.find((item) => item.id === id)
}

// Match the real Help serializer: public browse rows omit private fields,
// while /mine releases contact only to the owner or the accepted worker.
function helpRequestFor(item, viewerId = null) {
  const row = { ...item }
  const isOwner = viewerId !== null && item.requester_id === viewerId
  const isAcceptedWorker = viewerId !== null && item.accepted_worker_id === viewerId
  if (!isOwner && !isAcceptedWorker) delete row.contact
  if (!isOwner) delete row.offers
  return row
}

/**
 * A browser-only API replacement used exclusively by the separate static demo
 * build. It is intentionally installed by demo-main.jsx, never by main.jsx.
 */
export function createDemoAdapter(state = seedState()) {
  return async (config) => {
    const method = (config.method || 'get').toLowerCase()
    const path = routePath(config.url)
    const body = bodyOf(config)

    if (path === '/health') return response(config, { status: 'demo-online', mode: 'fictional' })
    if (path === '/api/stats/') {
      const active = state.alerts.filter((item) => item.status !== 'resolved')
      return response(config, { active_alerts: active.length, critical_open: active.filter((item) => item.urgency === 'CRITICAL').length, last_24h: state.alerts.length, resolved_24h: state.alerts.filter((item) => item.status === 'resolved').length, top_category: { category: 'medical', count: 3 }, volunteers_online: 6, as_of: now() })
    }
    if (path === '/api/stats/leaderboard') return response(config, { window_days: 30, top: [
      { name: 'Kavya Rao', resolved: 18, trust: { score: 0.89, label: 'trusted', accepted: 20, resolved: 18 } },
      { name: 'Imran Khan', resolved: 14, trust: { score: 0.81, label: 'reliable', accepted: 18, resolved: 14 } },
      { name: 'Meera Iyer', resolved: 11, trust: { score: 0.76, label: 'reliable', accepted: 15, resolved: 11 } },
      { name: 'Rohan Das', resolved: 8, trust: { score: 0.67, label: 'reliable', accepted: 12, resolved: 8 } },
      { name: 'Naina Kapoor', resolved: 5, trust: { score: 0.56, label: 'new', accepted: 8, resolved: 5 } },
    ] })
    if (path === '/api/news/recent') return response(config, { count: state.news.length, items: state.news })
    if (path === '/api/users/me') return response(config, state.user)
    if (path === '/api/users/me/stats') return response(config, { role: 'volunteer', accepted: 12, resolved: 9, in_progress: 3, trust: { score: 0.74, label: 'reliable', accepted: 12, resolved: 9 } })

    if (path === '/api/alerts/nearby') return response(config, state.alerts)
    if (path === '/api/alerts/heatmap') return response(config, { points: state.alerts.filter((item) => item.status !== 'resolved').map((item) => [item.location.coordinates[1], item.location.coordinates[0], item.urgency === 'CRITICAL' ? 1 : 0.55]) })
    if (path === '/api/alerts/mine') return response(config, state.alerts.filter((item) => item.reporter_id === DEMO_USER_ID))

    if (path === '/api/resources/near') return response(config, state.resources)
    if (path === '/api/safety/near') return response(config, state.safety)
    if (path === '/api/safety/me') return response(config, state.safety.find((item) => item.user_name === state.user.name) || null)
    if (path === '/api/help/near') {
      const kind = config.params?.kind
      return response(config, state.help
        .filter((item) => item.status === 'open' && (!kind || item.kind === kind))
        .map((item) => helpRequestFor(item)))
    }
    if (path === '/api/help/mine') {
      return response(config, {
        posted: state.help.filter((item) => item.requester_id === DEMO_USER_ID).map((item) => helpRequestFor(item, DEMO_USER_ID)),
        offered: state.help.filter((item) => (item.offers || []).some((offer) => offer.worker_id === DEMO_USER_ID)).map((item) => helpRequestFor(item, DEMO_USER_ID)),
      })
    }
    if (path === '/api/geo/reverse') return response(config, { address: 'Fictional demo location · New Delhi' })
    if (path === '/api/geo/hospitals') return response(config, { hospitals: [
      { name: 'Demo Community Clinic', lat: 28.607, lng: 77.218, distance_km: 1.2, emergency: true, phone: null },
      { name: 'Demo Medical Support Centre', lat: 28.618, lng: 77.201, distance_km: 2.1, emergency: false, phone: null },
    ] })
    if (path === '/api/push/key') return response(config, { public_key: null })

    const alertMatch = path.match(/^\/api\/alerts\/([^/]+)(?:\/(photos|updates|resources|responder|accept|eta|resolve|witness|flag))?$/)
    if (alertMatch) {
      const [, id, action] = alertMatch
      const item = findAlert(state, id)
      if (!item) return response(config, { detail: 'Demo alert not found' }, 404)
      if (method === 'get' && !action) return response(config, item)
      if (method === 'get' && action === 'photos') return response(config, { photos: item.photos || [] })
      if (method === 'get' && action === 'updates') return response(config, state.updates[id] || [])
      if (method === 'get' && action === 'resources') return response(config, { resources: state.resources.slice(0, 3), radius_km: 3 })
      if (method === 'get' && action === 'responder') return response(config, { responder_id: item.accepted_by, responder_name: item.accepted_by ? state.user.name : null, responder_phone: null, reporter_phone: null, coordinates: item.accepted_by ? DEMO_COORDS : null, live: Boolean(item.accepted_by), eta_minutes: item.eta_minutes, eta_set_at: item.eta_set_at, status: item.status })
      if (method === 'patch' && action === 'accept') { item.status = 'accepted'; item.accepted_by = DEMO_USER_ID; item.eta_minutes = 12; item.eta_set_at = now(); return response(config, item) }
      if (method === 'patch' && action === 'eta') { item.eta_minutes = Number(body.eta_minutes) || 0; item.eta_set_at = now(); return response(config, item) }
      if (method === 'patch' && action === 'resolve') { item.status = 'resolved'; item.resolved_at = now(); return response(config, item) }
      if (method === 'post' && action === 'witness') { item.witnesses += 1; item.verified_score = Math.min(100, item.verified_score + 8); return response(config, item) }
      if (method === 'post' && action === 'flag') { item.flags += 1; return response(config, { flags: item.flags, already: false }) }
      if (method === 'post' && action === 'updates') { const update = { id: `demo-update-${Date.now()}`, author_name: state.user.name, author_role: state.user.role, body: body.body || 'Fictional demo update', created_at: now() }; state.updates[id] = [...(state.updates[id] || []), update]; return response(config, update, 201) }
      if (method === 'delete' && !action) { state.alerts = state.alerts.filter((candidate) => candidate.id !== id); return response(config, null, 204) }
    }

    if ((path === '/api/alerts/' || path === '/api/alerts/anonymous') && method === 'post') {
      const id = `demo-alert-${Date.now()}`
      const item = alert(id, body.category || 'other', 'HIGH', body.description || 'Fictional demo alert', 'Fictional demo location · New Delhi', ...(body.location?.coordinates || DEMO_COORDS), 0, { reporter_id: path.endsWith('anonymous') ? 'demo-anonymous' : DEMO_USER_ID, is_anonymous: path.endsWith('anonymous') })
      state.alerts.unshift(item)
      return response(config, item, 201)
    }

    const helpMatch = path.match(/^\/api\/help\/([^/]+)(?:\/(offers|accept|done))?$/)
    if (helpMatch) {
      const [, id, action] = helpMatch
      const item = state.help.find((candidate) => candidate.id === id)
      if (!item) return response(config, { detail: 'Demo help request not found' }, 404)
      if (method === 'post' && action === 'offers') { const offer = { worker_id: DEMO_USER_ID, worker_name: state.user.name, price: Number(body.price) || 0, note: body.note || '' }; item.offers = [...(item.offers || []), offer]; item.offer_count = item.offers.length; return response(config, offer, 201) }
      if (method === 'patch' && action === 'accept') { item.status = 'accepted'; item.accepted_worker_id = config.params?.worker_id; item.contact = 'Demo contact released for walkthrough'; return response(config, helpRequestFor(item, DEMO_USER_ID)) }
      if (method === 'patch' && action === 'done') { item.status = 'done'; return response(config, item) }
      if (method === 'delete' && !action) { state.help = state.help.filter((candidate) => candidate.id !== id); return response(config, { status: 'deleted' }) }
    }
    if (path === '/api/help/' && method === 'post') {
      const item = { id: `demo-help-${Date.now()}`, ...body, location: body.location || location(...DEMO_COORDS), requester_id: DEMO_USER_ID, requester_name: state.user.name, offer_count: 0, offers: [], status: 'open', created_at: now(), expires_at: hoursFromNow(24 * 14) }
      state.help.unshift(item)
      return response(config, item, 201)
    }

    if (path === '/api/safety/' && method === 'post') {
      const item = { id: DEMO_USER_ID, user_name: state.user.name, status: body.status, note: body.note || '', location: body.location || location(...DEMO_COORDS), created_at: now(), expires_at: hoursFromNow(24) }
      state.safety = [item, ...state.safety.filter((candidate) => candidate.user_name !== state.user.name)]
      return response(config, item, 201)
    }
    if (path === '/api/resources/' && method === 'post') {
      const item = { id: `demo-resource-${Date.now()}`, ...body, owner_id: DEMO_USER_ID, owner_name: state.user.name, created_at: now(), expires_at: hoursFromNow(Number(body.valid_for_hours) || 24) }
      state.resources.unshift(item)
      return response(config, item, 201)
    }
    const resourceMatch = path.match(/^\/api\/resources\/([^/]+)$/)
    if (resourceMatch && method === 'delete') { state.resources = state.resources.filter((item) => item.id !== resourceMatch[1]); return response(config, null, 204) }

    if (path === '/api/users/me/location' && method === 'patch') { state.user.location = body.location || state.user.location; return response(config, state.user) }
    if (path === '/api/users/me/profile' && method === 'patch') { Object.assign(state.user, body); return response(config, state.user) }
    if ((path === '/api/auth/login' || path === '/api/auth/register') && method === 'post') return response(config, { token: fakeToken(), name: state.user.name, role: state.user.role }, 200)

    return response(config, { detail: `Demo route not implemented: ${method.toUpperCase()} ${path}` }, 404)
  }
}

function installDemoLocation() {
  if (typeof navigator === 'undefined') return
  const makePosition = () => ({ coords: { latitude: DEMO_COORDS[1], longitude: DEMO_COORDS[0], accuracy: 18 }, timestamp: Date.now() })
  const geolocation = {
    getCurrentPosition(success) { window.setTimeout(() => success(makePosition()), 20) },
    watchPosition(success) { const id = window.setTimeout(() => success(makePosition()), 20); return id },
    clearWatch(id) { window.clearTimeout(id) },
  }
  try {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: geolocation })
  } catch {
    /* Browsers that protect the property can still use their normal location flow. */
  }
}

/** Install the isolated static-demo environment before React renders. */
export function installDemoApi() {
  localStorage.setItem('token', fakeToken())
  localStorage.setItem('name', 'Aarav Mehta')
  const adapter = createDemoAdapter()
  api.defaults.adapter = adapter
  axios.defaults.adapter = adapter
  installDemoLocation()
  window.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="tel:"]') : null
    if (!link) return
    event.preventDefault()
    window.alert('Calling is disabled in this fictional demo. Use the real app only for a real emergency.')
  }, true)
}
