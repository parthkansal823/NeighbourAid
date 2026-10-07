import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditResult } from './audit-frontend.mjs'

function report(high = 0, critical = 0, moderate = 0) {
  return JSON.stringify({ metadata: { vulnerabilities: { high, critical, total: high + critical + moderate } } })
}

test('runtime high and critical findings are blocked', () => {
  assert.equal(auditResult(report(1), 1).blocked, true)
  assert.equal(auditResult(report(0, 1), 1).blocked, true)
  assert.equal(auditResult(report(0, 0, 2), 0).blocked, false)
  assert.equal(auditResult(report(), 0).blocked, false)
})

test('service failures and malformed reports cannot appear clean', () => {
  for (const [output, status] of [
    ['', 1], ['{}', 0], ['{"error":{"code":"ENOTFOUND"}}', 1],
    [report(), 1], [report(), 2], [report(), null],
    ['{"metadata":{"vulnerabilities":{"high":-1,"critical":0,"total":0}}}', 0],
  ]) {
    assert.throws(() => auditResult(output, status), /npm audit/)
  }
})
