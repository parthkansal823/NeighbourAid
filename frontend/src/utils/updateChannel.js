/** Local Android Studio builds are not part of the signed release sequence.
 * Their default version code (1) says nothing about source-code freshness.
 * This is a UI policy, not signer attestation; native APK validation remains
 * responsible for checking package identity, version and signing key.
 */
export function hasReleaseUpdateChannel(build = __APP_BUILD__) {
  return build?.channel === 'release'
}
