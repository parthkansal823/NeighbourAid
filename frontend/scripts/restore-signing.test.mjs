import assert from 'node:assert/strict'
import { test } from 'node:test'
import { propertyValue, signingFiles } from './restore-signing.mjs'

test('Java signing properties preserve separators, whitespace, backslashes and Unicode', () => {
  assert.equal(propertyValue(' test\\pass:=#!'), '\\ test\\\\pass\\:\\=\\#\\!')
  assert.equal(propertyValue('\n\té'), '\\u000a\\u0009\\u00e9')
})

test('restores opaque keystore bytes and all property values without shell interpolation', () => {
  const bytes = Buffer.from('test fixture, not a real keystore')
  const { key, properties } = signingFiles({ ANDROID_KEYSTORE_BASE64: bytes.toString('base64'),
    ANDROID_KEYSTORE_PASSWORD: 'password\\x', ANDROID_KEY_ALIAS: 'test', ANDROID_KEY_PASSWORD: 'other=pass' })
  assert.deepEqual(key, bytes)
  assert.ok(properties.includes('storePassword=password\\\\x\n'))
  assert.ok(properties.includes('keyPassword=other\\=pass\n'))
})

test('invalid or missing secret input fails without echoing it', () => {
  assert.throws(() => signingFiles({}), /four Android signing secrets/)
  assert.throws(() => signingFiles({ ANDROID_KEYSTORE_BASE64: 'not-base64!',
    ANDROID_KEYSTORE_PASSWORD: 'secret', ANDROID_KEY_ALIAS: 'test', ANDROID_KEY_PASSWORD: 'secret' }), (error) => {
    assert.ok(!error.message.includes('not-base64'))
    return /encoding is invalid/.test(error.message)
  })
})
