# Live-camera-only evidence

8 October 2026. The report form has no gallery picker, file input, paste or
drop upload. Photos remain optional: nobody should endanger themselves to
capture evidence, and a denied camera permission must not prevent a text report.

## Capture and review

- Android uses the official Capacitor Camera 8.2.5 `takePhoto` method, not
  `getPhoto` with a source prompt or `chooseFromGallery`. Opening the system
  camera requires an explicit tap; no camera permission is requested on launch.
- Website uses `getUserMedia` with video only. A file input with a `capture`
  hint is deliberately not a fallback because browsers may still offer files.
- Capture stops the browser stream. Review offers **Retake** and **Use photo**;
  neither capture nor recovery submits an alert. Close, backgrounding,
  switching cameras and unmount release the browser camera tracks.
- Front/rear switching is best-effort. Torch/zoom controls appear only when
  the active browser track exposes supported capabilities. Android's system
  camera controls its own flash, focus and lens selection.
- Camera chrome uses existing light/dark tokens, a true-black preview and
  48-pixel minimum controls. Preview mirroring must not mirror the attached
  evidence image. Permission refusal, missing/in-use hardware and interrupted
  preview have explicit recovery instructions.

## Image and privacy limits

Native options request JPEG, quality 85, at most 1280-pixel dimensions,
orientation correction, no external editor, no gallery save and no metadata.
Only same-origin Capacitor local-file/content URLs are accepted for recovery;
network URLs, arbitrary file URLs and native low-resolution thumbnails are
not used as the original photo.

Attachment compression accepts a bounded decoded image, preserves aspect
ratio without upscaling and reencodes JPEG, dropping source EXIF. The final
data URL is limited to 280,000 **serialized characters**, below the backend's
300,000-character limit; the form still allows at most three photos. It is
not a 280-KiB raw-image guarantee.

## Android interruption recovery

Android can terminate the app while the camera Activity is open. Before
launch, one account-owned draft is saved in IndexedDB for up to 24 hours.
It contains form fields, existing camera photos and a local result reference,
not authentication tokens. Anonymous drafts belong to this device's anonymous
context; a signed-in account cannot read another account's draft.

The app listens for `appRestoredResult` and accepts only the Camera `takePhoto`
result for the pre-existing unexpired pending camera session frozen at app
startup. A delayed old result cannot fill a newer pending session. It offers explicit
draft review rather than automatic navigation or submission. Restoring does
not overwrite typed changes without confirmation and does not replace a form
with an existing saved delivery retry. A new GPS observation is required before
sending; an old draft's saved fix is not treated as current.

The whole form/review is keyed to its account or anonymous context. Account
change unmounts it immediately; late asynchronous work cannot attach an old
photo or navigate the new account. Restoration cancels dictation and locks
editing until completion. Stored ID and expiry are rechecked after photo decode,
and the visible recovery notice expires even if the app remains foregrounded.

Recovered photos need review before attachment. If Android has removed the
temporary file, text can still be restored and a new live photo taken. A
session-specific clear cannot delete a newer camera session. Clearing a camera
draft does not withdraw a sent or queued report. Local recovery is best-effort,
not an encrypted backup or a guarantee of retention.

SDK source caveat: Camera 8.2.5's new `takePhoto` flow keeps its current call in
memory and launches via its own Android ActivityResultLauncher. It does not
show the legacy flow's Capacitor save/restore bridge. Therefore photo-result
restoration after process death is **not guaranteed** by this implementation:
the durable form can be restored and a fresh live photo retaken even when no
restored-result event arrives. The listener is a best-effort compatible path,
not evidence that the current SDK restores that result on every device.

## Honest evidence boundary

Camera-only UI prevents selecting an old image through the app's normal
attachment flow. It does **not** prove that an incident happened. A virtual
camera, photograph of a screen, compromised device or a direct API client can
still supply misleading images. Capture must never become an automatic
“verified incident” badge. Existing photo checks and human corroboration are
separate signals, not authenticity proof.

Offline reports and recovered camera drafts may be sent later; a photo is not
necessarily current at delivery time. No signed capture attestation or server
anti-replay protocol was introduced. Stronger provenance would require a
separate threat model, privacy choices and an offline-compatible design.

## Physical-device checks still required

- Android camera permission allow/deny/permanent deny and cancellation.
- Rear/front lens, flash, portrait/landscape orientation on real devices.
- Camera return with and without Android destroying the WebView/process.
- Recovery after cancellation, missing temporary file, changed/expired account
  and changed current form, including no duplicate report submission.
- Camera stream stops on website close/background/switch/retake.
- Light/dark, keyboard navigation, TalkBack and narrow screens.

No real camera photo or live emergency report is used by automated tests.
Native iOS camera configuration is outside this Android-specific change.

Local verification: 195 camera/photo/recovery/report tests passed; the full
frontend suite passed 917 tests in 78 files, strict lint passed, and the debug
APK compiled with the official camera plugin using Android Studio's JBR.
Synthetic browser checking passed 128 screen/theme/viewport combinations,
including 16 live/review camera states, with 32 axe checks at 390 px and no
detected violations. npm 10/11 locked-install dry runs and the production
dependency audit passed. These are not physical-device or remote CI results.

API behavior checked against the installed SDK and official
[Capacitor Camera](https://capacitorjs.com/docs/apis/camera) and
[App restored-result](https://capacitorjs.com/docs/apis/app) documentation.
