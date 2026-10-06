/** Source-backed, bounded adult first aid. Not an AI-generated treatment plan.
 * No patient answers are stored. Translations require clinical/native review
 * before use as a production medical service. Revision: 2026-10-06. */
export const FIRST_AID_REVISION = '2026-10-06'
export const FIRST_AID_SOURCES = {
  cpr: [{ title: 'St John Ambulance · adult CPR', url: 'https://www.sja.org.uk/first-aid-advice/cpr/' }, { title: 'American Red Cross · CPR', url: 'https://www.redcross.org/take-a-class/cpr/performing-cpr/cpr-steps' }],
  bleeding: [{ title: 'St John Ambulance · severe bleeding', url: 'https://www.sja.org.uk/first-aid-advice/severe-bleeding/' }, { title: 'American Red Cross · severe bleeding', url: 'https://www.redcross.org/take-a-class/resources/learn-first-aid/bleeding-life-threatening-external' }],
  burn: [{ title: 'NHS · burns and scalds', url: 'https://www.nhs.uk/conditions/burns-and-scalds/' }, { title: 'London & South East Burn Network · first aid', url: 'https://www.lsebn.nhs.uk/patient-information-3' }],
}
const en = {
  title: 'Help while you wait', open: 'First-aid guide', close: 'Close guide', call: 'Call 112', demo: 'Demo: emergency calls are disabled.',
  notice: 'Call 112 for serious injury or immediate danger. Do not wait for a volunteer or a doctor review. Follow the emergency dispatcher over this guide.',
  review: 'Reference-based guidance. Not yet clinically reviewed for this app. No diagnosis or medicine advice.',
  safety: 'Is the scene safe, and can you help?', yes: 'Yes, I can safely help', no: 'No / I am not sure',
  unsafe: 'Stay clear of traffic, fire, electricity and other hazards. Call 112 from a safe place and ask for trained help. Do not put yourself at risk.',
  choose: 'Choose what you can see', collapse: 'Person is not responding', bleeding: 'Heavy external bleeding', burn: 'Heat / hot-water burn', other: 'Something else / not sure',
  adult: 'Is the person an adult?', adultYes: 'Yes, an adult', child: 'Child / baby / not sure',
  childHelp: 'Children and babies need different CPR. Call 112 on speaker and follow the dispatcher. This adult guide is not suitable.',
  breathing: 'Are they breathing normally?', breathingCheck: 'Open the airway with a gentle head tilt and chin lift. Check breathing for no more than 10 seconds. Occasional gasps are not normal breathing.',
  normal: 'Yes, breathing normally', notNormal: 'No / only gasping', unsure: 'I cannot tell',
  normalHelp: 'Do not give chest compressions to someone breathing normally. Call 112, keep the airway clear and monitor breathing. Follow the dispatcher about positioning, especially after an injury.',
  uncertain: 'Call 112 on speaker now. Describe exactly what you can see and follow the dispatcher. Do not guess a diagnosis or give medicines.',
  burnCheck: 'Is this a small heat or hot-water burn, away from the face and genitals?', small: 'Yes, small heat burn', severe: 'Face / genitals / large / deep / chemical / electrical / unsure',
  severeBurn: 'Call 112 for urgent help for a large, deep, facial, genital, chemical or electrical burn. Do not touch a person still connected to electricity. Follow the dispatcher; this heat-burn guide is not suitable.',
  back: 'Back', next: 'Next step', restart: 'Choose another situation', read: 'Read this step aloud', silent: 'A voice is unavailable. Read the step on screen.', sources: 'Read the original guidance',
  cprTitle: 'Adult: not responding and not breathing normally',
  cprSteps: [
    ['Call and get help', 'Call 112 on speaker. Ask a helper to fetch an AED; do not leave the person to find one yourself. Start compressions now, following the dispatcher.'],
    ['Position your hands', 'On a firm, flat surface, put the heel of one hand in the centre of the chest and the other hand on top. Keep arms straight, shoulders over your hands.'],
    ['Push and release', 'Press 5–6 cm down, 100–120 times a minute. Let the chest rise fully between pushes. If unable or unwilling to give rescue breaths, keep giving compressions.'],
    ['Keep helping', 'Continue until emergency help takes over, normal breathing returns, you are too exhausted, or an AED is ready. Follow the AED voice instructions. If trained, use your CPR training.'],
  ],
  bleedingTitle: 'Heavy external bleeding',
  bleedingSteps: [
    ['Call for urgent help', 'Call 112 on speaker. Use gloves if available. If safe and able, the injured person can hold pressure while you get help.'],
    ['Hold firm pressure', 'Press firmly on the wound with a clean cloth or dressing. If an object is stuck in it, do not remove it or press on the object; press on either side.'],
    ['Stay with them', 'Keep pressure and watch their breathing and response until help takes over. Do not improvise a tourniquet or pack the wound unless trained or directed by the dispatcher.'],
  ],
  burnTitle: 'Small heat / hot-water burn',
  burnSteps: [
    ['Cool the burn', 'Use cool running water for 20 minutes, as soon as possible. Do not use ice, oil, butter or creams. Keep the rest of the body warm.'],
    ['Remove loose items', 'Remove nearby jewellery or clothing only if it is not stuck to the burn. Do not pull off stuck material or burst blisters.'],
    ['Cover loosely', 'After cooling, lay cling film loosely over the burn; do not wrap it around a limb or put it on the face. Seek medical advice if unsure or the burn is worsening.'],
  ],
}
const hi = {
  title: 'मदद आने तक क्या करें', open: 'प्राथमिक सहायता', close: 'गाइड बंद करें', call: '112 पर कॉल करें', demo: 'डेमो: आपातकालीन कॉल बंद हैं।',
  notice: 'गंभीर चोट या तुरंत खतरे में 112 पर कॉल करें। स्वयंसेवक या डॉक्टर की समीक्षा का इंतज़ार न करें। इस गाइड से पहले आपातकालीन ऑपरेटर की बात मानें।',
  review: 'विश्वसनीय स्रोतों पर आधारित। ऐप के लिए अभी चिकित्सकीय समीक्षा नहीं हुई है। यह निदान या दवा की सलाह नहीं है।',
  safety: 'क्या जगह सुरक्षित है और आप मदद कर सकते हैं?', yes: 'हाँ, सुरक्षित तरीके से मदद कर सकता/सकती हूँ', no: 'नहीं / पता नहीं',
  unsafe: 'ट्रैफिक, आग, बिजली और अन्य खतरों से दूर रहें। सुरक्षित जगह से 112 पर कॉल करें और प्रशिक्षित मदद माँगें। खुद को खतरे में न डालें।',
  choose: 'जो दिखाई दे रहा है, वह चुनें', collapse: 'व्यक्ति जवाब नहीं दे रहा', bleeding: 'बहुत खून बह रहा है', burn: 'गर्मी / गर्म पानी से जलना', other: 'कुछ और / पता नहीं',
  adult: 'क्या व्यक्ति वयस्क है?', adultYes: 'हाँ, वयस्क है', child: 'बच्चा / शिशु / पता नहीं',
  childHelp: 'बच्चों और शिशुओं की CPR अलग है। 112 पर स्पीकर चालू करके कॉल करें और ऑपरेटर की बात मानें। यह वयस्कों वाला गाइड उपयुक्त नहीं है।',
  breathing: 'क्या साँस सामान्य है?', breathingCheck: 'सिर धीरे पीछे करके ठुड्डी उठाएँ और वायुमार्ग खोलें। साँस 10 सेकंड से अधिक न जाँचें। कभी-कभी हाँफना सामान्य साँस नहीं है।',
  normal: 'हाँ, साँस सामान्य है', notNormal: 'नहीं / सिर्फ हाँफ रहे हैं', unsure: 'समझ नहीं आ रहा',
  normalHelp: 'सामान्य साँस लेने वाले व्यक्ति की छाती न दबाएँ। 112 पर कॉल करें, वायुमार्ग खुला रखें और साँस देखते रहें। खासकर चोट के बाद करवट या स्थिति के लिए ऑपरेटर की बात मानें।',
  uncertain: 'अभी 112 पर स्पीकर चालू करके कॉल करें। जो दिखाई दे रहा है वही बताएँ और ऑपरेटर की बात मानें। बीमारी का अनुमान न लगाएँ और दवा न दें।',
  burnCheck: 'क्या यह गर्मी या गर्म पानी से हुआ छोटा जलना है, जो चेहरे और जननांग से दूर है?', small: 'हाँ, छोटा जलना है', severe: 'चेहरा / जननांग / बड़ा / गहरा / रसायन / बिजली / पता नहीं',
  severeBurn: 'बड़े, गहरे, चेहरे या जननांग के, रसायन या बिजली से हुए जलने पर तुरंत 112 से मदद माँगें। बिजली से जुड़े व्यक्ति को न छुएँ। ऑपरेटर की बात मानें; यह छोटा जलना वाला गाइड उपयुक्त नहीं है।',
  back: 'पीछे', next: 'अगला कदम', restart: 'दूसरी स्थिति चुनें', read: 'यह कदम सुनें', silent: 'आवाज़ उपलब्ध नहीं है। स्क्रीन पर कदम पढ़ें।', sources: 'मूल मार्गदर्शन पढ़ें',
  cprTitle: 'वयस्क: जवाब नहीं और सामान्य साँस नहीं',
  cprSteps: [
    ['कॉल करके मदद माँगें', '112 पर स्पीकर चालू करके कॉल करें। दूसरे व्यक्ति से AED लाने को कहें; खुद खोजने के लिए व्यक्ति को न छोड़ें। ऑपरेटर की बात मानते हुए छाती दबाना शुरू करें।'],
    ['हाथ रखें', 'मज़बूत, समतल जगह पर छाती के बीच एक हथेली का निचला हिस्सा रखें और दूसरी हथेली ऊपर। हाथ सीधे और कंधे हाथों के ऊपर रखें।'],
    ['दबाएँ और छोड़ें', '5–6 सेमी गहराई तक, एक मिनट में 100–120 बार दबाएँ। हर बार छाती पूरी वापस उठने दें। बचाव की साँस देने में असमर्थ या अनिच्छुक हों तो लगातार छाती दबाते रहें।'],
    ['मदद जारी रखें', 'आपातकालीन मदद के संभालने, सामान्य साँस लौटने, बहुत थक जाने या AED तैयार होने तक जारी रखें। AED की आवाज़ मानें। प्रशिक्षित हैं तो अपनी CPR ट्रेनिंग का पालन करें।'],
  ],
  bleedingTitle: 'बहुत खून बहना',
  bleedingSteps: [
    ['तुरंत मदद माँगें', '112 पर स्पीकर चालू करके कॉल करें। दस्ताने हों तो पहनें। सुरक्षित और सक्षम होने पर घायल व्यक्ति भी घाव पर दबाव रख सकता है।'],
    ['लगातार मज़बूत दबाव रखें', 'साफ कपड़े या ड्रेसिंग से घाव पर मज़बूत दबाव दें। कोई वस्तु फँसी है तो उसे न निकालें और उसके ऊपर न दबाएँ; उसके दोनों ओर दबाव दें।'],
    ['साथ रहें', 'मदद आने तक दबाव रखें और साँस व प्रतिक्रिया देखते रहें। बिना प्रशिक्षण या ऑपरेटर के निर्देश के टूर्निकेट न बनाएँ और घाव के अंदर कपड़ा न भरें।'],
  ],
  burnTitle: 'गर्मी / गर्म पानी से छोटा जलना',
  burnSteps: [
    ['जलन ठंडी करें', 'जल्दी से जल्दी 20 मिनट तक ठंडे बहते पानी से ठंडा करें। बर्फ, तेल, मक्खन या क्रीम न लगाएँ। शरीर का बाकी हिस्सा गर्म रखें।'],
    ['ढीली चीजें हटाएँ', 'पास के गहने या कपड़े तभी हटाएँ जब वे जले हिस्से से चिपके न हों। चिपका कपड़ा न खींचें और छाले न फोड़ें।'],
    ['ढीला ढकें', 'ठंडा करने के बाद क्लिंग फिल्म ढीली रखें; अंग के चारों ओर न लपेटें और चेहरे पर न रखें। संदेह या जलन बढ़ने पर चिकित्सकीय सलाह लें।'],
  ],
}
export function firstAidCopy(language) { return language === 'hi' ? hi : en }

/** Fail closed: neither symptoms nor AI scores can unlock adult CPR. */
export function firstAidPath({ safe, topic, adult, breathing, smallHeatBurn }) {
  if (safe !== true) return 'unsafe'
  if (topic === 'collapse') {
    if (adult !== true) return 'childHelp'
    if (breathing === 'normal') return 'normalHelp'
    return breathing === 'not-normal' ? 'cpr' : 'uncertain'
  }
  if (topic === 'burn') return smallHeatBurn === true ? 'burn' : 'severeBurn'
  return topic === 'bleeding' ? 'bleeding' : 'uncertain'
}
