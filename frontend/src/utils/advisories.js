/** Original CAP wording is never automatically translated or rewritten by AI. */
export const SACHET = 'https://sachet.ndma.gov.in/'

export function advisoryLink(raw) {
  try {
    const url = new URL(raw)
    const keys = [...url.searchParams.keys()]
    return url.origin === 'https://sachet.ndma.gov.in' && !url.username && !url.password && !url.hash &&
      url.pathname === '/cap_public_website/FetchXMLFile' && keys.length === 1 && keys[0] === 'identifier' &&
      /^[0-9]{1,24}$/.test(url.searchParams.get('identifier')) ? url.href : null
  } catch { return null }
}

export function activeAdvisories(items, lang, now = Date.now()) {
  const groups = new Map()
  const rank = item => item.language?.split('-')[0] === lang ? 0 : item.language?.startsWith('en') ? 1 : 2
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.cap_identifier || !item.area || !advisoryLink(item.link) || !(Date.parse(item.expires_at) > now)) continue
    const previous = groups.get(item.cap_identifier)
    if (!previous || rank(item) < rank(previous)) groups.set(item.cap_identifier, item)
  }
  return [...groups.values()]
}

// Panel controls are English/Hindi for now; other UI languages use English.
// Authority messages retain the language provided by CAP, with a visible label.
const en = {
  title: 'Official weather & disaster warnings', open: 'Read warnings and safety steps',
  scope: 'India-wide snapshot, not a location match. Check the affected area before acting.',
  unavailable: 'The official feed could not be checked. Visit SACHET or your local authority; this is not an all-clear.',
  checking: 'Checking the official feed…', stale: 'Last-known warnings. The feed could not be refreshed; check the original source.',
  empty: 'No active warnings in this snapshot. This does not mean your area is safe.',
  partial: 'Only part of the feed is shown. Check SACHET for other areas and warnings.',
  demo: 'Official warnings are not connected in this fictional demo.',
  filter: 'Search affected area (district or state)', placeholder: 'For example, Punjab or Chandigarh',
  refresh: 'Refresh warnings', issued: 'Issued', starts: 'Valid from', ends: 'Expires',
  instruction: 'Authority instructions', missing: 'No instructions were included. Check the original warning and local authority.',
  source: 'Original CAP warning', language: 'Message language', checked: 'Last successful check',
  guidance: 'General safety steps', priority: 'These are general precautions, not local evacuation orders. Follow the authority’s instructions first.',
  flood: 'Flood', lightning: 'Lightning', guideSource: 'Safety guide: US National Weather Service',
  floodSteps: ['Follow local evacuation orders and move to higher ground when safe.', 'Do not walk or drive through floodwater or cross a road barricade.', 'Stay away from electrical equipment exposed to water.'],
  lightningSteps: ['Shelter in a substantial building or an enclosed metal-topped vehicle, not under a tree.', 'Avoid plumbing, wired appliances, windows and open porches.', 'Do not unplug equipment during the storm.'],
}
const hi = {
  ...en,
  title: 'सरकारी मौसम और आपदा चेतावनियाँ', open: 'चेतावनियाँ और बचाव के उपाय देखें',
  scope: 'यह पूरे भारत की सीमित सूची है, आपके स्थान से मिलान नहीं। प्रभावित क्षेत्र ज़रूर देखें।',
  unavailable: 'सरकारी फ़ीड की जाँच नहीं हो सकी। SACHET या स्थानीय प्रशासन से जानकारी लें; इसका मतलब सब सुरक्षित होना नहीं है।',
  checking: 'सरकारी फ़ीड की जाँच हो रही है…', stale: 'पिछली जानकारी दिखाई गई है। नई जाँच नहीं हो सकी; मूल स्रोत देखें।',
  empty: 'इस सूची में कोई सक्रिय चेतावनी नहीं है। इसका मतलब आपका क्षेत्र सुरक्षित होना नहीं है।',
  partial: 'फ़ीड का केवल एक हिस्सा दिखाया गया है। बाकी क्षेत्रों के लिए SACHET देखें।',
  demo: 'इस काल्पनिक डेमो में सरकारी चेतावनी फ़ीड जुड़ी नहीं है।',
  filter: 'प्रभावित जिला या राज्य खोजें', placeholder: 'जैसे Punjab या Chandigarh', refresh: 'चेतावनियाँ फिर देखें',
  issued: 'जारी होने का समय', starts: 'लागू होने का समय', ends: 'समाप्ति', instruction: 'प्रशासन के निर्देश',
  missing: 'इस संदेश में निर्देश नहीं दिए गए हैं। मूल चेतावनी और स्थानीय प्रशासन से जानकारी लें।',
  source: 'मूल CAP चेतावनी', language: 'संदेश की भाषा', checked: 'आखिरी सफल जाँच',
  guidance: 'सामान्य बचाव के उपाय', priority: 'ये सामान्य सावधानियाँ हैं, स्थानीय निकासी का आदेश नहीं। प्रशासन के निर्देश पहले मानें।',
  flood: 'बाढ़', lightning: 'बिजली गिरना', guideSource: 'सुरक्षा मार्गदर्शिका: US National Weather Service',
  floodSteps: ['स्थानीय निकासी के आदेश मानें और सुरक्षित होने पर ऊँची जगह जाएँ।', 'बाढ़ के पानी में पैदल या वाहन से न जाएँ और सड़क की रोक को पार न करें।', 'पानी के संपर्क में आए बिजली के उपकरणों से दूर रहें।'],
  lightningSteps: ['पक्की इमारत या बंद धातु की छत वाले वाहन में शरण लें, पेड़ के नीचे नहीं।', 'नल, तार वाले उपकरण, खिड़कियों और खुले बरामदों से दूर रहें।', 'तूफ़ान के दौरान उपकरणों के प्लग न निकालें।'],
}
export function advisoryCopy(lang) { return lang === 'hi' ? hi : en }
