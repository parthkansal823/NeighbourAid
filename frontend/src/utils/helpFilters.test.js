import { describe, expect, it } from 'vitest'
import { filterHelpRequests } from './helpFilters'
import { createDemoAdapter } from '../demo/mockApi'

const ownOpen = {
  id: 'own-open', kind: 'electrician', title: 'Geyser trips the fuse',
  description: 'Evening visit please', status: 'open',
  contact: 'private-owner-contact', offers: [{ worker_id: 'worker', worker_name: 'private-worker-name', note: 'private-offer-note' }],
}
const ownDone = { id: 'own-done', kind: 'tech', title: 'Laptop repaired', status: 'done' }
const acceptedOffer = {
  id: 'offered-accepted', kind: 'plumber', title: 'Kitchen tap leaks',
  description: 'Bring a washer', status: 'accepted', contact: 'released-worker-contact',
}
const cancelledOffer = { id: 'offered-cancelled', kind: 'moving', title: 'Carry boxes', status: 'cancelled' }
const nearbyTap = { id: 'nearby-tap', kind: 'plumber', title: 'Bathroom tap replacement', description: 'Second floor', status: 'open' }
const nearbyLaptop = { id: 'nearby-laptop', kind: 'tech', title: 'Laptop will not start', description: null, status: 'open' }

const board = {
  posted: [ownOpen, ownDone],
  offered: [acceptedOffer, cancelledOffer],
  nearby: [{ ...ownOpen, contact: undefined, offers: undefined }, nearbyTap, nearbyLaptop],
}
const ids = (items) => items.map((item) => item.id)

describe('Help board discovery', () => {
  it('merges without duplicates and keeps owner/worker data and nearby order intact', () => {
    const before = JSON.stringify(board)
    const results = filterHelpRequests(board)

    expect(ids(results)).toEqual([
      'own-open', 'own-done', 'offered-accepted', 'offered-cancelled', 'nearby-tap', 'nearby-laptop',
    ])
    expect(results[0]).toBe(ownOpen)
    expect(results[0].offers).toBe(ownOpen.offers)
    expect(results[2].contact).toBe('released-worker-contact')
    expect(JSON.stringify(board)).toBe(before)
  })

  it('searches trades, titles and details without case or whitespace sensitivity', () => {
    expect(ids(filterHelpRequests({ ...board, query: '  PLUMBER  \n tap ' }))).toEqual(['offered-accepted', 'nearby-tap'])
    expect(ids(filterHelpRequests({ ...board, query: 'evening' }))).toEqual(['own-open'])
    expect(ids(filterHelpRequests({ ...board, query: 'second floor' }))).toEqual(['nearby-tap'])
    expect(ids(filterHelpRequests({ ...board, query: ' \t\n ' }))).toEqual(ids(filterHelpRequests(board)))
  })

  it('requires every search term so a matching title alone cannot ignore other words', () => {
    expect(ids(filterHelpRequests({ ...board, query: 'tap washer' }))).toEqual(['offered-accepted'])
    expect(filterHelpRequests({ ...board, query: 'tap laptop' })).toEqual([])
  })

  it('supports non-Latin descriptions and normalizes equivalent Unicode text', () => {
    const nearby = [
      { id: 'hi', kind: 'plumber', title: 'नल की मरम्मत', description: 'शाम को आएँ', status: 'open' },
      { id: 'unicode', kind: 'tech', title: 'Café laptop', status: 'open' },
    ]
    expect(ids(filterHelpRequests({ nearby, query: 'नल शाम' }))).toEqual(['hi'])
    expect(ids(filterHelpRequests({ nearby, query: 'Cafe\u0301' }))).toEqual(['unicode'])
    expect(ids(filterHelpRequests({ nearby, query: 'ＬＡＰＴＯＰ' }))).toEqual(['unicode'])
  })

  it('never searches private contacts, offer notes or worker names', () => {
    for (const query of ['private-owner-contact', 'released-worker-contact', 'private-offer-note', 'private-worker-name']) {
      expect(filterHelpRequests({ ...board, query })).toEqual([])
    }
  })

  it('keeps only open jobs in Open, including the viewer’s own open requests', () => {
    expect(ids(filterHelpRequests({ ...board, scope: 'open' }))).toEqual(['own-open', 'nearby-tap', 'nearby-laptop'])
  })

  it('includes posted requests and offers of every status in Mine', () => {
    expect(ids(filterHelpRequests({ ...board, scope: 'mine' }))).toEqual([
      'own-open', 'own-done', 'offered-accepted', 'offered-cancelled',
    ])
  })

  it('combines kind, scope and search across personal and nearby requests', () => {
    expect(ids(filterHelpRequests({ ...board, kind: 'plumber' }))).toEqual(['offered-accepted', 'nearby-tap'])
    expect(ids(filterHelpRequests({ ...board, scope: 'open', kind: 'plumber', query: 'tap' }))).toEqual(['nearby-tap'])
    expect(filterHelpRequests({ ...board, scope: 'mine', kind: 'tech', query: 'tap' })).toEqual([])
  })

  it('does not resurrect an accepted job from its stale public open copy', () => {
    const nearby = [{ ...acceptedOffer, status: 'open', contact: undefined }]
    expect(filterHelpRequests({ offered: [acceptedOffer], nearby, scope: 'open' })).toEqual([])
    expect(filterHelpRequests({ offered: [acceptedOffer], nearby })).toEqual([acceptedOffer])
  })

  it('handles empty lists, missing descriptions and literal search punctuation', () => {
    expect(filterHelpRequests()).toEqual([])
    expect(filterHelpRequests({ nearby: board.nearby, scope: 'mine' })).toEqual([])
    expect(ids(filterHelpRequests({ ...board, query: 'laptop' }))).toEqual(['own-done', 'nearby-laptop'])
    expect(filterHelpRequests({ ...board, query: '[.*]' })).toEqual([])
  })
})

describe('Help discovery with the fake demo API', () => {
  it('browses only open requests and hides contacts and other people’s offers', async () => {
    const adapter = createDemoAdapter({ help: [ownOpen, ownDone, nearbyTap] })
    const { data } = await adapter({ url: '/api/help/near', params: {} })
    expect(ids(data)).toEqual(['own-open', 'nearby-tap'])
    expect(data[0]).not.toHaveProperty('contact')
    expect(data[0]).not.toHaveProperty('offers')
    const filtered = await adapter({ url: '/api/help/near', params: { kind: 'plumber' } })
    expect(ids(filtered.data)).toEqual(['nearby-tap'])
  })

  it('returns posted and offered jobs with the same private data rules as the real API', async () => {
    const demoOwner = { ...ownOpen, requester_id: 'demo-volunteer-1' }
    const demoOffer = { ...acceptedOffer, requester_id: 'other', accepted_worker_id: 'demo-volunteer-1', offers: [{ worker_id: 'demo-volunteer-1' }] }
    const demoCancelled = { ...cancelledOffer, requester_id: 'other', contact: 'hidden-contact', offers: [{ worker_id: 'demo-volunteer-1' }] }
    const adapter = createDemoAdapter({ help: [demoOwner, demoOffer, demoCancelled, nearbyTap] })
    const { data: mine } = await adapter({ url: '/api/help/mine' })
    expect(mine.posted[0].contact).toBe(ownOpen.contact)
    expect(mine.posted[0].offers).toEqual(ownOpen.offers)
    expect(mine.offered[0].contact).toBe(acceptedOffer.contact)
    expect(mine.offered[0]).not.toHaveProperty('offers')
    expect(mine.offered[1]).not.toHaveProperty('contact')
    expect(ids(filterHelpRequests({ ...mine, nearby: [nearbyTap], scope: 'mine' }))).toEqual(['own-open', 'offered-accepted', 'offered-cancelled'])
  })

  it('keeps an offered demo job in Mine after acceptance removes it from public browse', async () => {
    const job = { ...nearbyTap, requester_id: 'another-requester', offers: [], contact: 'hidden-before-acceptance' }
    const adapter = createDemoAdapter({ user: { name: 'Demo worker' }, help: [job] })
    await adapter({ url: `/api/help/${job.id}/offers`, method: 'post', data: { price: 500, note: 'Evening' } })
    const before = await adapter({ url: '/api/help/mine' })
    expect(before.data.offered[0]).not.toHaveProperty('contact')
    // The requester accepts elsewhere; the worker next fetches the updated
    // state. A worker must not rely on the demo's permissive accept mutation.
    job.status = 'accepted'
    job.accepted_worker_id = 'demo-volunteer-1'
    const nearby = await adapter({ url: '/api/help/near' })
    const mine = await adapter({ url: '/api/help/mine' })
    expect(nearby.data).toEqual([])
    expect(mine.data.offered[0].contact).toBe('hidden-before-acceptance')
    expect(filterHelpRequests({ ...mine.data, nearby: nearby.data, scope: 'mine' })).toHaveLength(1)
    expect(filterHelpRequests({ ...mine.data, nearby: nearby.data, scope: 'open' })).toEqual([])
  })

  it('records the accepted worker when the demo requester accepts an offer', async () => {
    const job = { ...ownOpen, requester_id: 'demo-volunteer-1' }
    const adapter = createDemoAdapter({ help: [job] })
    const accepted = await adapter({ url: `/api/help/${job.id}/accept`, method: 'patch', params: { worker_id: 'worker' } })
    expect(accepted.data.accepted_worker_id).toBe('worker')
    expect(accepted.data.offers).toEqual(ownOpen.offers)
    const nearby = await adapter({ url: '/api/help/near' })
    expect(nearby.data).toEqual([])
  })
})
