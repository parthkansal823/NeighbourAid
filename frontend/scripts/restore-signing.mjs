import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { FRONTEND_DIR } from './server-tools.mjs'

// Java Properties.load(InputStream) expects ISO-8859-1 plus \uXXXX escapes.
// Plain shell echo would corrupt passwords containing backslashes/spaces.
export function propertyValue(value) {
  return value.split('').map((character) => {
    const code = character.charCodeAt(0)
    if (code < 32 || code > 126) return `\\u${code.toString(16).padStart(4, '0')}`
    return '\\ :=#!'.includes(character) ? `\\${character}` : character
  }).join('')
}

export function signingFiles(env) {
  const required = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']
  if (required.some((key) => typeof env[key] !== 'string' || !env[key])) throw new Error('All four Android signing secrets are required')
  const encoded = env.ANDROID_KEYSTORE_BASE64.replace(/\s/g, '')
  const key = Buffer.from(encoded, 'base64')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || !key.length || key.length > 16 * 1024 * 1024 ||
      key.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw new Error('Android keystore encoding is invalid; no secret values were printed')
  }
  const properties = [
    'storeFile=app/upload-keystore.jks',
    `storePassword=${propertyValue(env.ANDROID_KEYSTORE_PASSWORD)}`,
    `keyAlias=${propertyValue(env.ANDROID_KEY_ALIAS)}`,
    `keyPassword=${propertyValue(env.ANDROID_KEY_PASSWORD)}`,
    '',
  ].join('\n')
  return { key, properties }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { key, properties } = signingFiles(process.env)
  await writeFile(resolve(FRONTEND_DIR, 'android/app/upload-keystore.jks'), key, { flag: 'wx', mode: 0o600 })
  await writeFile(resolve(FRONTEND_DIR, 'android/keystore.properties'), properties, { flag: 'wx', mode: 0o600 })
  console.log('Signing files restored privately; credentials were not printed.')
}
