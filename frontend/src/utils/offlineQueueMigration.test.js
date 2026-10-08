import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { enqueueAlert, flushQueue, listPending, listReceipts } from './offlineQueue'

describe('version 1 offline queue migration', () => {
  it('upgrades pending reports without dropping them or persisting credentials', async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('neighbouraid-offline', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('pending-alerts', { keyPath: 'id', autoIncrement: true })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise((resolve, reject) => {
      const tx = db.transaction('pending-alerts', 'readwrite')
      tx.objectStore('pending-alerts').add({ payload: { description: 'legacy anonymous report' }, anonymous: true, accountId: null, created_at: Date.now(), attempts: 0 })
      tx.oncomplete = resolve
      tx.onerror = reject
    })
    db.close()
    expect(await listPending()).toHaveLength(1)
    const payloads = []
    await flushQueue(async (payload, identity) => {
      payloads.push({ payload, identity })
      return { id: 'migrated-alert' }
    })
    expect(payloads[0]).toMatchObject({ payload: { client_submission_id: expect.any(String) }, identity: { anonymousClientId: expect.any(String) } })
    expect(await listPending()).toHaveLength(0)
    expect(await listReceipts()).toEqual([expect.objectContaining({ alertId: 'migrated-alert' })])
    await enqueueAlert({ description: 'new anonymous report' }, { anonymous: true })
    expect(await listPending()).toHaveLength(1)
  })
})
