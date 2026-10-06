import { Capacitor } from '@capacitor/core'
import { NeighbourAidUpdater } from '@neighbouraid/app-updater'
import { trustedUpdateDownload } from './appUpdate'

export const UPDATE_CHECK_EVENT = 'neighbouraid:check-update'
export const UPDATE_RESULT_EVENT = 'neighbouraid:update-result'

function bridge() {
  if (Capacitor.getPlatform() !== 'android' || import.meta.env.MODE === 'demo' || !Capacitor.isPluginAvailable('NeighbourAidUpdater')) {
    const error = new Error('Install the new updater-enabled APK once')
    error.code = 'UPDATER_MISSING'
    throw error
  }
  return NeighbourAidUpdater
}

export async function startDirectUpdate(update) {
  if (!trustedUpdateDownload(update?.downloadUrl) || !Number.isSafeInteger(update.versionCode) || update.versionCode <= __APP_BUILD__.versionCode) {
    throw new Error('Invalid update')
  }
  return bridge().startDownload({ url: update.downloadUrl, versionCode: update.versionCode })
}
export function directUpdateStatus() { return bridge().getDownloadStatus() }
export function installDirectUpdate() { return bridge().installUpdate() }
export function cancelDirectUpdate() { return bridge().cancelDownload() }

const en = {
  update: 'Update now', install: 'Install update', cancel: 'Cancel download', retry: 'Retry download',
  downloading: 'Downloading update…', paused: 'Download paused. Android will retry when the connection is available.',
  ready: 'Download complete. Tap Install update.', permission: 'Allow installs from NeighbourAid in Android settings, then return and tap Install update.',
  installer: 'Confirm the update in the Android installer. If you cancelled, tap Install update again.',
  failed: 'Update download failed. Check your connection and free storage, then retry.',
  signature: 'This APK uses a different signing key. Your installed app and saved data have not been changed.',
  invalid: 'The downloaded APK failed the package or version check. Nothing was installed.',
  missing: 'This installed APK does not contain the direct updater. Install the new APK once to enable future in-app updates.',
  opening: 'Checking the APK and opening Android’s installer…',
  installed: 'Installed version', check: 'Check for updates', checking: 'Checking for updates…',
  found: 'A new version is available. Use Update now at the top of the app.',
  none: 'No newer signed APK was found.', unavailable: 'Could not check updates. Check your connection and try again.',
  confirmation: 'Downloads inside the app. Android still asks you to approve installation.',
}
export function androidUpdateCopy(lang) {
  return lang === 'hi' ? { ...en,
    update: 'अभी अपडेट करें', install: 'अपडेट इंस्टॉल करें', cancel: 'डाउनलोड रोकें', retry: 'फिर डाउनलोड करें',
    downloading: 'अपडेट डाउनलोड हो रहा है…', paused: 'डाउनलोड रुका है। इंटरनेट मिलने पर Android फिर कोशिश करेगा।',
    ready: 'डाउनलोड पूरा हुआ। अपडेट इंस्टॉल करें दबाएँ।',
    permission: 'Android सेटिंग्स में NeighbourAid से इंस्टॉल करने की अनुमति दें, फिर वापस आकर अपडेट इंस्टॉल करें दबाएँ।',
    installer: 'Android में इंस्टॉल की पुष्टि करें। रद्द किया हो तो फिर अपडेट इंस्टॉल करें दबाएँ।',
    failed: 'डाउनलोड नहीं हुआ। इंटरनेट और खाली स्टोरेज जाँचकर फिर कोशिश करें।',
    signature: 'इस APK की signing key अलग है। आपका ऐप और सहेजा गया डेटा नहीं बदला गया है।',
    invalid: 'APK का पैकेज या संस्करण सही नहीं है। कुछ इंस्टॉल नहीं किया गया।',
    missing: 'पुराने APK में direct updater नहीं है। आगे ऐप के अंदर अपडेट के लिए नया APK एक बार इंस्टॉल करें।',
    opening: 'APK की जाँच और Android installer खुल रहा है…',
    installed: 'इंस्टॉल किया गया संस्करण', check: 'अपडेट जाँचें', checking: 'अपडेट की जाँच हो रही है…',
    found: 'नया संस्करण है। ऐप के ऊपर अभी अपडेट करें दबाएँ।', none: 'कोई नया signed APK नहीं मिला।',
    unavailable: 'अपडेट की जाँच नहीं हुई। इंटरनेट जाँचकर फिर कोशिश करें।',
    confirmation: 'डाउनलोड ऐप में ही होगा। इंस्टॉल के लिए Android में पुष्टि करनी होगी।',
  } : en
}
