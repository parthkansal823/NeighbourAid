import { describe, expect, it } from 'vitest'
import { filterVolunteerAlerts, isMyAcceptedAlert } from './volunteerFilters'
import { createDemoAdapter } from '../demo/mockApi'

const userId = 'volunteer-1'
const open = {
  id: 'open', category: 'power', urgency: 'LOW', status: 'open',
  headline: 'Street lights out', description: 'Bring a torch', address: 'Park gate',
  reporter_id: 'private-reporter', reporter_phone: 'private-phone',
}
const mine = {
  id: 'mine', category: 'flood', urgency: 'HIGH', status: 'accepted',
  accepted_by: userId, description: 'Water entering kitchen', address: 'River road',
}
const other = { ...mine, id: 'other', accepted_by: 'volunteer-2' }
const criticalOpen = { ...open, id: 'critical-open', urgency: 'CRITICAL' }
const criticalMine = { ...mine, id: 'critical-mine', urgency: 'CRITICAL' }
const criticalOther = { ...other, id: 'critical-other', urgency: 'CRITICAL' }
const criticalUnassigned = { ...criticalMine, id: 'critical-unassigned', accepted_by: null }
const critical = [criticalOpen, criticalMine, criticalOther, criticalUnassigned]
const alerts = [open, mine, other, ...critical,
  { ...criticalOpen, id: 'resolved', status: 'resolved' },
  { ...criticalMine, id: 'cancelled', status: 'cancelled' },
]
const ids = (items) => items.map((item) => item.id)

describe('volunteer feed filtering', () => {
  it('keeps open alerts, own accepted tasks and every active critical alert in All', () => {
    const before = JSON.stringify(alerts)
    const filtered = filterVolunteerAlerts({ alerts, userId })
    expect(filtered).toEqual([open, mine, ...critical])
    expect(filtered[0]).toBe(open)
    expect(filtered[1]).toBe(mine)
    expect(JSON.stringify(alerts)).toBe(before)
  })

  it('restricts Open and My accepted by status and ownership, with the critical exception', () => {
    expect(filterVolunteerAlerts({ alerts, userId, scope: 'open' })).toEqual([open, ...critical])
    expect(filterVolunteerAlerts({ alerts, userId, scope: 'mine' })).toEqual([mine, ...critical])
    expect(filterVolunteerAlerts({ alerts, userId: 'volunteer-2', scope: 'mine' })).toEqual([other, ...critical])
  })

  it.each(['all', 'open', 'mine'])('never hides active critical alerts in %s, even for a search with no matches', (scope) => {
    expect(filterVolunteerAlerts({ alerts, userId, scope, query: 'unrelated [.*]' })).toEqual(critical)
    expect(filterVolunteerAlerts({ alerts, scope, query: 'unrelated' })).toEqual(critical)
  })

  it.each(['resolved', 'cancelled', 'expired', undefined, null])('never resurrects a critical alert with status %s', (status) => {
    expect(filterVolunteerAlerts({ alerts: [{ ...criticalOpen, status }], query: 'no match' })).toEqual([])
  })

  it.each([undefined, null, '', ' ', 0, false])('does not claim unassigned tasks for missing or invalid account ID %s', (missingId) => {
    const unassigned = [
      { ...mine, accepted_by: undefined }, { ...mine, accepted_by: null },
      { ...mine, accepted_by: '' }, { ...mine, accepted_by: ' ' },
    ]
    expect(filterVolunteerAlerts({ alerts: unassigned, userId: missingId, scope: 'mine' })).toEqual([])
    expect(isMyAcceptedAlert({ ...mine, accepted_by: missingId }, missingId)).toBe(false)
  })

  it('requires a strict account match and accepted status, ignoring stale accepted_by fields', () => {
    expect(isMyAcceptedAlert(mine, userId)).toBe(true)
    expect(isMyAcceptedAlert(mine, 'volunteer-2')).toBe(false)
    expect(isMyAcceptedAlert({ ...mine, accepted_by: 1 }, '1')).toBe(false)
    expect(isMyAcceptedAlert({ ...mine, status: 'open' }, userId)).toBe(false)
    expect(isMyAcceptedAlert({ ...mine, status: 'resolved' }, userId)).toBe(false)
    expect(filterVolunteerAlerts({ alerts: [{ ...open, accepted_by: userId }], userId, scope: 'mine' })).toEqual([])
  })

  it('searches category, headline, details and address, requiring all literal terms', () => {
    for (const query of ['POWER', 'street lights', 'torch', 'park gate', 'power torch park']) {
      expect(filterVolunteerAlerts({ alerts: [open, mine], userId, query })).toEqual([open])
    }
    expect(filterVolunteerAlerts({ alerts: [open, mine], userId, query: '  FLOOD \n kitchen  ' })).toEqual([mine])
    expect(filterVolunteerAlerts({ alerts: [open, mine], userId, query: 'torch kitchen' })).toEqual([])
    expect(filterVolunteerAlerts({ alerts: [open], query: '[.*]' })).toEqual([])
  })

  it('combines search and view without showing another account’s noncritical task', () => {
    expect(filterVolunteerAlerts({ alerts: [open, mine, other], userId, scope: 'mine', query: 'water' })).toEqual([mine])
    expect(filterVolunteerAlerts({ alerts: [open, mine, other], userId, scope: 'open', query: 'water' })).toEqual([])
    expect(filterVolunteerAlerts({ alerts: [other], userId, query: 'water' })).toEqual([])
  })

  it('supports non-Latin text, localized category labels and equivalent Unicode', () => {
    const rows = [
      { ...open, id: 'hindi', category: 'medical', description: 'तुरंत मदद चाहिए' },
      { ...open, id: 'unicode', headline: 'Café' },
    ]
    expect(ids(filterVolunteerAlerts({ alerts: rows, query: 'मदद' }))).toEqual(['hindi'])
    expect(ids(filterVolunteerAlerts({ alerts: rows, query: 'चिकित्सा', categoryLabels: { medical: 'चिकित्सा' } }))).toEqual(['hindi'])
    expect(ids(filterVolunteerAlerts({ alerts: rows, query: 'Cafe\u0301' }))).toEqual(['unicode'])
    expect(filterVolunteerAlerts({ alerts: [open], query: 'ＰＯＷＥＲ' })).toEqual([open])
  })

  it('does not search private contacts or identifiers', () => {
    for (const query of ['private-phone', 'private-reporter', 'volunteer-1']) {
      expect(filterVolunteerAlerts({ alerts: [open, mine], userId, query })).toEqual([])
    }
  })

  it('handles empty input, missing optional fields and whitespace-only search', () => {
    expect(filterVolunteerAlerts()).toEqual([])
    expect(filterVolunteerAlerts({ alerts, userId, query: ' \t\n ' })).toEqual([open, mine, ...critical])
    const minimal = { id: 'minimal', urgency: 'LOW', status: 'open' }
    expect(filterVolunteerAlerts({ alerts: [minimal] })).toEqual([minimal])
    expect(filterVolunteerAlerts({ alerts: [minimal], query: 'something' })).toEqual([])
  })
})

describe('shared filtering with the demo API', () => {
  it('keeps the same search, acceptance and resolution rules for demo data', async () => {
    const adapter = createDemoAdapter({ alerts: [{ ...open }, { ...criticalOpen }], updates: {} })
    const load = async (scope, query = '') => {
      const { data } = await adapter({ url: '/api/alerts/nearby' })
      return filterVolunteerAlerts({ alerts: data, userId: 'demo-volunteer-1', scope, query })
    }
    expect(ids(await load('mine', 'unrelated'))).toEqual(['critical-open'])
    await adapter({ url: '/api/alerts/open/accept', method: 'patch' })
    expect(ids(await load('mine', 'torch'))).toEqual(['open', 'critical-open'])
    expect(ids(await load('open'))).toEqual(['critical-open'])
    await adapter({ url: '/api/alerts/critical-open/resolve', method: 'patch' })
    expect(await load('mine', 'unrelated')).toEqual([])
  })
})
