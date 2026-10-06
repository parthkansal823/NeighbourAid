/**
 * Shared geolocation helpers.
 *
 * The fallback centre used to be pasted inline in five different files, which
 * made it easy to miss that some screens were silently *fabricating* a user
 * location. The rule this module encodes:
 *
 *   - Screens that create data or filter life-critical alerts (PostAlert,
 *     VolunteerFeed) must NOT fall back. A wrong location there sends
 *     volunteers to the wrong street, or hides the emergency next door.
 *   - Browse-only screens (Safety, Resources, the map) MAY fall back so the
 *     page still renders something — but they must tell the user the view is
 *     a default area, not where they are.
 */

// Chandigarh — the project's reference city, used only as a "show me
// something" centre for browse-only screens.
export const FALLBACK_CENTER_LNGLAT = [76.7794, 30.7333]
export const FALLBACK_CENTER_LATLNG = [30.7333, 76.7794]

/**
 * Whether this browser can do geolocation at all.
 *
 * A constant, not state: the answer is fixed for the lifetime of the page.
 * Several screens used to discover it inside an effect and then `setState`
 * an error message, which forced an extra render before first paint purely
 * to record something already knowable at module load.
 */
export const GEOLOCATION_SUPPORTED =
  typeof navigator !== 'undefined' && 'geolocation' in navigator

/** Copy shown when the browser itself has no geolocation API. */
export const GEO_UNSUPPORTED_MESSAGE =
  'This browser cannot share your location, so nearby alerts cannot be found.'

/**
 * Resolve the browser's position for a browse-only screen.
 *
 * Resolves `{ coords: [lng, lat], isFallback }` — never rejects, so callers
 * always have something to render. `isFallback: true` means "this is the
 * default area, say so in the UI".
 */
export function getBrowseLocation({ timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      resolve({ coords: FALLBACK_CENTER_LNGLAT, isFallback: true })
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ coords: [coords.longitude, coords.latitude], isFallback: false }),
      () => resolve({ coords: FALLBACK_CENTER_LNGLAT, isFallback: true }),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    )
  })
}
