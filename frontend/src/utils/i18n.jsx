/**
 * Lightweight i18n for English + Hindi + Punjabi. No runtime dependency,
 * no build-time tooling — just a dictionary + a tiny context. Every string
 * accessed via `t('key')` falls back to English if a translation is missing.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'hi', label: 'हिन्दी', short: 'हिं' },
  { code: 'pa', label: 'ਪੰਜਾਬੀ', short: 'ਪੰ' },
]

const DICT = {
  en: {
    // Navbar
    nav_map: 'Live Map',
    nav_login: 'Login',
    nav_join: 'Join',
    nav_report: 'Report Crisis',
    nav_volunteer: 'Volunteer Feed',
    nav_my_alerts: 'My Alerts',
    nav_safety: 'Safety',
    nav_resources: 'Resources',
    nav_logout: 'Logout',
    nav_profile: 'Profile',
    nav_language: 'Language',

    // Home
    home_badge: 'Hyperlocal Crisis Network',
    home_title_1: 'Your neighbour needs help.',
    home_title_2: 'Be there in minutes.',
    home_subtitle:
      'NeighbourAid connects people in crisis with nearby volunteers in real time. AI triage, live maps, and instant WebSocket notifications — all free, all local.',
    home_cta_report: 'Report a Crisis',
    home_cta_map: 'View Live Map',
    home_cta_volunteer: 'Open Volunteer Feed',
    home_cta_join: 'Get Started',

    home_stats_active: 'Active alerts',
    home_stats_critical: 'Critical open',
    home_stats_24h: 'Posted (24 h)',
    home_stats_volunteers: 'Volunteers live',

    home_how_title: 'How it works',
    home_how_1_title: 'Post a Crisis',
    home_how_1_desc: 'Fill in the category, description, and your GPS location. Done in 30 seconds.',
    home_how_2_title: 'AI Triage',
    home_how_2_desc: 'Our local Hugging Face model classifies urgency as CRITICAL / HIGH / MEDIUM / LOW instantly.',
    home_how_3_title: 'Volunteers Notified',
    home_how_3_desc: 'Nearby volunteers get a live WebSocket ping and can accept or resolve the alert.',

    home_leaderboard_title: 'Top volunteers',
    home_leaderboard_since: 'last 30 days',
    home_leaderboard_resolved: 'resolved',

    home_news_title: 'Crisis news feed',
    home_news_subtitle:
      'Scraped from Times of India, NDTV, Hindustan Times and The Hindu · filtered for crisis keywords · refreshed every minute',

    home_urgency_title: 'Urgency Levels',
    urgency_example_critical: 'Person unconscious / cardiac arrest',
    urgency_example_high: 'Flood entering home / elderly alone',
    urgency_example_medium: 'Power outage across entire block',
    urgency_example_low: 'Stray dog injured, needs vet contact',

    // SOS
    sos_button: 'SOS · Critical help',
    sos_sub: 'GPS-tagged · instant volunteer broadcast',
    sos_send: 'SEND SOS',
    sos_sending: 'Sending…',
    sos_confirm: 'Post a CRITICAL SOS alert at your current GPS location right now?',
    sos_no_geo: 'Geolocation not available — please use the full form.',
    sos_failed: 'SOS failed — try the full form',
    sos_no_gps: 'Unable to read GPS',

    // Login
    login_title: 'Welcome back',
    login_subtitle: 'Sign in to your NeighbourAid account',
    login_email: 'Email',
    login_password: 'Password',
    login_submit: 'Sign In',
    login_submitting: 'Signing in…',
    login_no_account: 'No account?',
    login_register_here: 'Register here',
    login_failed: 'Login failed',

    // Register
    register_title: 'Create account',
    register_subtitle: 'Join the NeighbourAid network',
    register_name: 'Full Name',
    register_want_to: 'I want to',
    register_role_reporter: 'Report Crisis',
    register_role_volunteer: 'Volunteer',
    register_location: 'Your Location',
    register_detect: 'Detect',
    register_detecting: '…',
    register_location_required:
      'Tap "Detect" to set your home location — it decides which alerts reach you.',
    register_location_placeholder: 'Not set yet — tap "Detect"',
    register_location_saved: 'Home location captured.',
    register_password_hint: 'At least 8 characters, including a letter and a number.',
    register_submit: 'Create Account',
    register_submitting: 'Creating account…',
    register_have_account: 'Already have an account?',
    register_sign_in: 'Sign in',
    register_failed: 'Registration failed',

    // Post alert
    post_title: 'Report a Crisis',
    post_subtitle: 'Our AI will classify urgency and instantly notify nearby volunteers.',
    post_category: 'Category',
    post_description: 'Description',
    post_description_hint: '(AI uses this for triage)',
    post_description_placeholder:
      'e.g. Elderly man collapsed near the park gate, appears unconscious, needs immediate help…',
    post_voice_speak: 'Speak',
    post_voice_recording: 'Recording…',
    post_voice_tip_start: 'Speak instead of typing (en-IN). Works in Chrome/Edge',
    post_voice_tip_stop: 'Tap to stop',
    post_location: 'Location',
    post_use_gps: 'Use GPS',
    post_locating: 'Getting your location…',
    post_location_required:
      'Tap "Use GPS" to set your real location — volunteers are sent to this exact spot.',
    post_location_placeholder: 'Not set yet — tap "Use GPS"',
    post_submit: 'Post Alert Now',
    post_submitting: 'Posting alert…',
    post_min_chars: 'Please provide a more detailed description (min 10 chars)',
    post_failed: 'Failed to post alert',

    // Category labels
    cat_medical: 'medical',
    cat_flood: 'flood',
    cat_fire: 'fire',
    cat_missing: 'missing',
    cat_power: 'power',
    cat_other: 'other',

    // Map dashboard
    map_title: 'Live Crisis Map',
    map_loading: 'Loading…',
    map_all: 'ALL',
    map_active_alerts_one: 'active alert',
    map_active_alerts_many: 'active alerts',
    map_refresh_note: 'refreshes every 15s',
    map_failed: 'Failed to load alerts',
    map_urgency_legend: 'Urgency',

    // Volunteer feed
    vol_title: 'Volunteer Feed',
    vol_subtitle: 'Alerts within 10 km of your location',
    vol_live: 'Live',
    vol_loading: 'Loading nearby alerts…',
    vol_open: 'Open',
    vol_active: 'Your Active Tasks',
    vol_no_open: 'No open alerts nearby. Stay ready.',
    vol_enable_notif:
      'Enable browser notifications so you don’t miss alerts when this tab is in the background.',
    vol_enable: 'Enable',
    vol_notif_on: 'Background notifications on',
    vol_failed: 'Failed to load alerts',

    // My alerts
    mine_title: 'My Alerts',
    mine_summary: 'total',
    mine_open: 'open',
    mine_in_progress: 'in progress',
    mine_new: '+ New',
    mine_loading: 'Loading…',
    mine_empty: 'You haven’t posted any alerts yet.',
    mine_post_first: 'Post your first alert',
    mine_cancel: 'Cancel alert',
    mine_cancelling: 'Cancelling…',
    mine_cancel_failed: 'Failed to cancel alert',
    mine_load_failed: 'Failed to load your alerts',

    // Profile
    profile_title: 'Your profile',
    profile_signed_as: 'Signed in as',
    profile_identity: 'Identity',
    profile_name: 'Name',
    profile_role: 'Role',
    profile_joined: 'Joined',
    profile_home_location: 'Home location',
    profile_update_loc: 'Update to current location',
    profile_detecting: 'Detecting…',
    profile_saving: 'Saving…',
    profile_loc_hint: 'Used to compute alert distance + whether you can witness an alert (within 2 km).',
    profile_loc_saved: 'Home location updated.',
    profile_activity: 'Activity',
    profile_stat_posted: 'Posted',
    profile_stat_open: 'Open',
    profile_stat_resolved: 'Resolved',
    profile_stat_accepted: 'Accepted',
    profile_stat_inprogress: 'In progress',
    profile_loading: 'Loading profile…',
    profile_no_geo: 'Geolocation is not available in this browser',
    profile_load_failed: 'Failed to load profile',
    profile_update_failed: 'Failed to update location',

    // Safety check-ins
    safety_title: 'Safety Check-ins',
    safety_subtitle:
      'During a disaster, mark yourself safe or flag that you need help. Visible to anyone within 10 km for 24 hours.',
    safety_your: 'Your check-in',
    safety_i_am_safe: 'I am safe',
    safety_i_need_help: 'I need help',
    safety_saving: 'Saving…',
    safety_no_active: 'No active check-in.',
    safety_note_ph: 'Short note (optional)',
    safety_expires: 'Expires',
    safety_nearby: 'Nearby',
    safety_checkins: 'check-ins',
    safety_safe: 'safe',
    safety_need_help: 'need help',
    safety_none_yet: 'No one has checked in yet.',
    safety_sign_in: 'Sign in',
    safety_sign_in_to: 'to post your own check-in.',
    safety_load_failed: 'Failed to load safety board',
    safety_post_failed: 'Failed to post check-in',

    // Resources
    res_title: 'Community Resources',
    res_subtitle:
      'Pin shelters, food, blood, oxygen, water, and medical camps near you. Listings expire automatically so stale entries fall off.',
    res_pin_a_resource: 'Pin a resource',
    res_name_ph: 'Name (e.g. Sector 22 community shelter)',
    res_contact_ph: 'Contact (phone / desk)',
    res_capacity_ph: 'Capacity',
    res_notes_ph: 'Short notes (optional)',
    res_valid_for: 'Valid for',
    res_hours: 'hours',
    res_post: 'Pin resource',
    res_posting: 'Pinning…',
    res_nearby: 'Within 25 km',
    res_all: 'All',
    res_none_yet: 'No resources pinned nearby yet.',
    res_none_body:
      'Be the first to pin a shelter, food point, or oxygen source — anyone within 25 km will see it.',
    res_loading: 'Loading…',
    res_sign_in_to: 'to pin a resource of your own.',
    res_load_failed: 'Failed to load resources',
    res_post_failed: 'Failed to pin resource',
    res_delete_failed: 'Failed to remove resource',
    res_name_too_short: 'Resource name must be at least 2 characters',
    res_no_location: 'Location not available — please allow GPS access',

    // Alert card
    card_directions: 'Directions',
    card_updates: 'Updates',
    card_see_too: 'I see this too',
    card_see_too_tip: 'Confirm you also see this incident',
    card_accept: 'Accept',
    card_resolve: 'Mark Resolved',
    card_no_updates: 'No updates yet. Be the first.',
    card_loading_updates: 'Loading updates…',
    card_update_ph: "Post an update — e.g. 'Ambulance en route'",
    card_send: 'Send',
    card_update_too_short: 'Update must be at least 3 characters',
    card_update_failed: 'Failed to post update',
    card_high_conf: 'High confidence',
    card_corroborated: 'Corroborated',
    card_unverified: 'Unverified',
    card_witness_one: 'witness',
    card_witness_many: 'witnesses',
    card_similar_nearby: 'similar nearby',
    card_weather_match: 'weather-match',
    card_ai_confident: 'confident',

    // Emergency dialer
    dialer_title: 'India Emergency Numbers',
    dialer_subtitle: 'Tap any number to call. Works on mobile devices and desktops with a phone handler.',
    dialer_note: 'is India’s unified emergency number — routes to police, fire, medical, women and child services.',
    dialer_open: 'Open emergency numbers',
    dialer_tooltip: 'India emergency numbers',
    dialer_all_in_one: 'Emergency (all-in-one)',
    dialer_police: 'Police',
    dialer_ambulance: 'Ambulance',
    dialer_fire: 'Fire',
    dialer_women: 'Women Helpline',
    dialer_child: 'Child Helpline',

    // Time ago
    t_sec: 's ago',
    t_min: 'm ago',
    t_hr: 'h ago',
    t_day: 'd ago',
  },

  hi: {
    // Navbar
    nav_map: 'लाइव नक्शा',
    nav_login: 'लॉगिन',
    nav_join: 'जुड़ें',
    nav_report: 'संकट दर्ज करें',
    nav_volunteer: 'स्वयंसेवी फ़ीड',
    nav_my_alerts: 'मेरे अलर्ट',
    nav_safety: 'सुरक्षा',
    nav_resources: 'संसाधन',
    nav_logout: 'लॉगआउट',
    nav_profile: 'प्रोफ़ाइल',
    nav_language: 'भाषा',

    // Home
    home_badge: 'हाइपरलोकल संकट नेटवर्क',
    home_title_1: 'आपके पड़ोसी को मदद चाहिए।',
    home_title_2: 'मिनटों में पहुँचें।',
    home_subtitle:
      'NeighbourAid संकट में फँसे लोगों को पास के स्वयंसेवकों से रियल टाइम में जोड़ता है। AI ट्रायाज, लाइव नक्शे और तुरंत सूचनाएँ — सब मुफ़्त, सब स्थानीय।',
    home_cta_report: 'संकट दर्ज करें',
    home_cta_map: 'नक्शा देखें',
    home_cta_volunteer: 'स्वयंसेवी फ़ीड खोलें',
    home_cta_join: 'शुरू करें',

    home_stats_active: 'सक्रिय अलर्ट',
    home_stats_critical: 'गंभीर खुले',
    home_stats_24h: '24 घं में दर्ज',
    home_stats_volunteers: 'स्वयंसेवक लाइव',

    home_how_title: 'यह कैसे काम करता है',
    home_how_1_title: 'संकट दर्ज करें',
    home_how_1_desc: 'श्रेणी, विवरण और अपना GPS स्थान भरें। 30 सेकंड में हो जाएगा।',
    home_how_2_title: 'AI ट्रायाज',
    home_how_2_desc: 'हमारा लोकल Hugging Face मॉडल तुरंत गंभीरता को CRITICAL / HIGH / MEDIUM / LOW के रूप में वर्गीकृत करता है।',
    home_how_3_title: 'स्वयंसेवक सूचित',
    home_how_3_desc: 'पास के स्वयंसेवकों को लाइव सूचना मिलती है और वे अलर्ट स्वीकार या हल कर सकते हैं।',

    home_leaderboard_title: 'शीर्ष स्वयंसेवक',
    home_leaderboard_since: 'पिछले 30 दिन',
    home_leaderboard_resolved: 'हल किए',

    home_news_title: 'संकट समाचार फ़ीड',
    home_news_subtitle:
      'Times of India, NDTV, Hindustan Times और The Hindu से लिया गया · संकट कीवर्ड के लिए फ़िल्टर · हर मिनट ताज़ा',

    home_urgency_title: 'आपातकाल स्तर',
    urgency_example_critical: 'व्यक्ति बेहोश / दिल का दौरा',
    urgency_example_high: 'घर में बाढ़ का पानी / बुज़ुर्ग अकेले',
    urgency_example_medium: 'पूरे ब्लॉक में बिजली गुल',
    urgency_example_low: 'आवारा कुत्ता घायल, पशु-चिकित्सक चाहिए',

    // SOS
    sos_button: 'SOS · तुरंत मदद',
    sos_sub: 'GPS-टैग · तुरंत स्वयंसेवक ब्रॉडकास्ट',
    sos_send: 'SOS भेजें',
    sos_sending: 'भेजा जा रहा है…',
    sos_confirm: 'अभी अपने GPS स्थान से एक CRITICAL SOS अलर्ट भेजें?',
    sos_no_geo: 'Geolocation उपलब्ध नहीं — कृपया पूरा फ़ॉर्म भरें।',
    sos_failed: 'SOS विफल — पूरा फ़ॉर्म आज़माएँ',
    sos_no_gps: 'GPS पढ़ने में असमर्थ',

    // Login
    login_title: 'वापसी पर स्वागत',
    login_subtitle: 'अपने NeighbourAid खाते में साइन इन करें',
    login_email: 'ईमेल',
    login_password: 'पासवर्ड',
    login_submit: 'साइन इन',
    login_submitting: 'साइन इन हो रहा है…',
    login_no_account: 'खाता नहीं है?',
    login_register_here: 'यहाँ पंजीकरण करें',
    login_failed: 'लॉगिन विफल',

    // Register
    register_title: 'खाता बनाएँ',
    register_subtitle: 'NeighbourAid नेटवर्क से जुड़ें',
    register_name: 'पूरा नाम',
    register_want_to: 'मैं चाहता/चाहती हूँ',
    register_role_reporter: 'संकट दर्ज',
    register_role_volunteer: 'स्वयंसेवक',
    register_location: 'आपका स्थान',
    register_detect: 'पता लगाएँ',
    register_detecting: '…',
    register_location_required:
      'अपना घर का स्थान सेट करने के लिए "पता करें" दबाएँ — इसी से तय होता है कौन-से अलर्ट आप तक पहुँचेंगे।',
    register_location_placeholder: 'अभी सेट नहीं — "पता करें" दबाएँ',
    register_location_saved: 'घर का स्थान सहेजा गया।',
    register_password_hint: 'कम से कम 8 अक्षर, जिनमें एक अक्षर और एक अंक हो।',
    register_submit: 'खाता बनाएँ',
    register_submitting: 'खाता बना रहे हैं…',
    register_have_account: 'पहले से खाता है?',
    register_sign_in: 'साइन इन',
    register_failed: 'पंजीकरण विफल',

    // Post alert
    post_title: 'संकट दर्ज करें',
    post_subtitle: 'हमारा AI गंभीरता वर्गीकृत करेगा और पास के स्वयंसेवकों को तुरंत सूचित करेगा।',
    post_category: 'श्रेणी',
    post_description: 'विवरण',
    post_description_hint: '(AI इसका उपयोग ट्रायाज के लिए करता है)',
    post_description_placeholder:
      'जैसे: पार्क के गेट के पास एक बुज़ुर्ग गिर गए हैं, बेहोश लग रहे हैं, तुरंत मदद चाहिए…',
    post_voice_speak: 'बोलें',
    post_voice_recording: 'रिकॉर्ड हो रहा है…',
    post_voice_tip_start: 'टाइप करने की जगह बोलें (en-IN)। Chrome/Edge में काम करता है',
    post_voice_tip_stop: 'रोकने के लिए टैप करें',
    post_location: 'स्थान',
    post_use_gps: 'GPS उपयोग करें',
    post_locating: 'आपका स्थान पता किया जा रहा है…',
    post_location_required:
      'अपना असली स्थान सेट करने के लिए "GPS उपयोग करें" दबाएँ — वॉलंटियर इसी जगह भेजे जाएँगे।',
    post_location_placeholder: 'अभी सेट नहीं — "GPS उपयोग करें" दबाएँ',
    post_submit: 'अलर्ट भेजें',
    post_submitting: 'अलर्ट भेजा जा रहा है…',
    post_min_chars: 'कृपया अधिक विस्तृत विवरण दें (कम से कम 10 अक्षर)',
    post_failed: 'अलर्ट भेजने में विफल',

    // Category labels
    cat_medical: 'चिकित्सा',
    cat_flood: 'बाढ़',
    cat_fire: 'आग',
    cat_missing: 'लापता',
    cat_power: 'बिजली',
    cat_other: 'अन्य',

    // Map dashboard
    map_title: 'लाइव संकट नक्शा',
    map_loading: 'लोड हो रहा है…',
    map_all: 'सभी',
    map_active_alerts_one: 'सक्रिय अलर्ट',
    map_active_alerts_many: 'सक्रिय अलर्ट',
    map_refresh_note: 'हर 15 सेकंड में ताज़ा',
    map_failed: 'अलर्ट लोड करने में विफल',
    map_urgency_legend: 'गंभीरता',

    // Volunteer feed
    vol_title: 'स्वयंसेवी फ़ीड',
    vol_subtitle: 'आपके स्थान से 10 किमी के भीतर अलर्ट',
    vol_live: 'लाइव',
    vol_loading: 'पास के अलर्ट लोड हो रहे हैं…',
    vol_open: 'खुले',
    vol_active: 'आपके सक्रिय कार्य',
    vol_no_open: 'पास में कोई खुला अलर्ट नहीं। तैयार रहें।',
    vol_enable_notif:
      'ब्राउज़र नोटिफ़िकेशन चालू करें ताकि यह टैब बैकग्राउंड में होने पर भी अलर्ट मिलें।',
    vol_enable: 'चालू करें',
    vol_notif_on: 'बैकग्राउंड नोटिफ़िकेशन चालू',
    vol_failed: 'अलर्ट लोड करने में विफल',

    // My alerts
    mine_title: 'मेरे अलर्ट',
    mine_summary: 'कुल',
    mine_open: 'खुले',
    mine_in_progress: 'प्रगति में',
    mine_new: '+ नया',
    mine_loading: 'लोड हो रहा है…',
    mine_empty: 'आपने अभी तक कोई अलर्ट दर्ज नहीं किया है।',
    mine_post_first: 'अपना पहला अलर्ट दर्ज करें',
    mine_cancel: 'अलर्ट रद्द करें',
    mine_cancelling: 'रद्द हो रहा है…',
    mine_cancel_failed: 'अलर्ट रद्द करने में विफल',
    mine_load_failed: 'आपके अलर्ट लोड करने में विफल',

    // Profile
    profile_title: 'आपकी प्रोफ़ाइल',
    profile_signed_as: 'साइन इन के रूप में',
    profile_identity: 'पहचान',
    profile_name: 'नाम',
    profile_role: 'भूमिका',
    profile_joined: 'जुड़े',
    profile_home_location: 'घर का स्थान',
    profile_update_loc: 'वर्तमान स्थान पर अपडेट करें',
    profile_detecting: 'पता लगा रहे हैं…',
    profile_saving: 'सहेज रहे हैं…',
    profile_loc_hint: 'अलर्ट की दूरी और 2 किमी के भीतर गवाह बनने की पात्रता के लिए उपयोग।',
    profile_loc_saved: 'घर का स्थान अपडेट किया गया।',
    profile_activity: 'गतिविधि',
    profile_stat_posted: 'दर्ज',
    profile_stat_open: 'खुले',
    profile_stat_resolved: 'हल',
    profile_stat_accepted: 'स्वीकृत',
    profile_stat_inprogress: 'प्रगति में',
    profile_loading: 'प्रोफ़ाइल लोड हो रही है…',
    profile_no_geo: 'Geolocation इस ब्राउज़र में उपलब्ध नहीं है',
    profile_load_failed: 'प्रोफ़ाइल लोड करने में विफल',
    profile_update_failed: 'स्थान अपडेट करने में विफल',

    // Safety
    safety_title: 'सुरक्षा चेक-इन',
    safety_subtitle:
      'आपदा के दौरान, स्वयं को सुरक्षित चिह्नित करें या मदद का संकेत दें। 10 किमी के भीतर 24 घंटे दिखाई देगा।',
    safety_your: 'आपका चेक-इन',
    safety_i_am_safe: 'मैं सुरक्षित हूँ',
    safety_i_need_help: 'मुझे मदद चाहिए',
    safety_saving: 'सहेज रहे हैं…',
    safety_no_active: 'कोई सक्रिय चेक-इन नहीं।',
    safety_note_ph: 'छोटा नोट (वैकल्पिक)',
    safety_expires: 'समाप्त',
    safety_nearby: 'पास में',
    safety_checkins: 'चेक-इन',
    safety_safe: 'सुरक्षित',
    safety_need_help: 'मदद चाहिए',
    safety_none_yet: 'अभी तक किसी ने चेक-इन नहीं किया।',
    safety_sign_in: 'साइन इन',
    safety_sign_in_to: 'अपना चेक-इन करने के लिए।',
    safety_load_failed: 'सुरक्षा बोर्ड लोड करने में विफल',
    safety_post_failed: 'चेक-इन पोस्ट करने में विफल',

    // Resources
    res_title: 'सामुदायिक संसाधन',
    res_subtitle:
      'अपने पास आश्रय, भोजन, रक्त, ऑक्सीजन, पानी और मेडिकल कैंप पिन करें। सूचियाँ अपने आप समाप्त हो जाती हैं।',
    res_pin_a_resource: 'संसाधन पिन करें',
    res_name_ph: 'नाम (जैसे: सेक्टर 22 सामुदायिक आश्रय)',
    res_contact_ph: 'संपर्क (फ़ोन / डेस्क)',
    res_capacity_ph: 'क्षमता',
    res_notes_ph: 'छोटे नोट (वैकल्पिक)',
    res_valid_for: 'मान्य',
    res_hours: 'घंटे',
    res_post: 'संसाधन पिन करें',
    res_posting: 'पिन हो रहा है…',
    res_nearby: '25 किमी के भीतर',
    res_all: 'सभी',
    res_none_yet: 'अभी पास में कोई संसाधन पिन नहीं है।',
    res_none_body:
      'पहले बनें — आश्रय, भोजन या ऑक्सीजन पिन करें; 25 किमी के भीतर सभी को दिखेगा।',
    res_loading: 'लोड हो रहा है…',
    res_sign_in_to: 'अपना संसाधन पिन करने के लिए।',
    res_load_failed: 'संसाधन लोड करने में विफल',
    res_post_failed: 'संसाधन पिन करने में विफल',
    res_delete_failed: 'संसाधन हटाने में विफल',
    res_name_too_short: 'नाम कम से कम 2 अक्षर का होना चाहिए',
    res_no_location: 'स्थान उपलब्ध नहीं — कृपया GPS की अनुमति दें',

    // Alert card
    card_directions: 'दिशा',
    card_updates: 'अपडेट',
    card_see_too: 'मुझे भी दिख रहा है',
    card_see_too_tip: 'पुष्टि करें कि आप यह घटना देख रहे हैं',
    card_accept: 'स्वीकारें',
    card_resolve: 'हल चिह्नित',
    card_no_updates: 'अभी कोई अपडेट नहीं। पहले आप दें।',
    card_loading_updates: 'अपडेट लोड हो रहे हैं…',
    card_update_ph: "अपडेट पोस्ट करें — जैसे: 'एम्बुलेंस रास्ते में'",
    card_send: 'भेजें',
    card_update_too_short: 'अपडेट कम से कम 3 अक्षर का होना चाहिए',
    card_update_failed: 'अपडेट पोस्ट करने में विफल',
    card_high_conf: 'उच्च विश्वास',
    card_corroborated: 'पुष्ट',
    card_unverified: 'अपुष्ट',
    card_witness_one: 'गवाह',
    card_witness_many: 'गवाह',
    card_similar_nearby: 'समान पास में',
    card_weather_match: 'मौसम-मिलान',
    card_ai_confident: 'विश्वास',

    // Dialer
    dialer_title: 'भारत आपातकालीन नंबर',
    dialer_subtitle: 'कॉल करने के लिए नंबर टैप करें। मोबाइल और फ़ोन हैंडलर वाले डेस्कटॉप पर काम करता है।',
    dialer_note: 'भारत का एकीकृत आपातकालीन नंबर है — पुलिस, अग्निशमन, चिकित्सा, महिला और बाल सेवाओं को रूट करता है।',
    dialer_open: 'आपातकालीन नंबर खोलें',
    dialer_tooltip: 'भारत आपातकालीन नंबर',
    dialer_all_in_one: 'आपातकाल (सभी एक में)',
    dialer_police: 'पुलिस',
    dialer_ambulance: 'एम्बुलेंस',
    dialer_fire: 'अग्निशमन',
    dialer_women: 'महिला हेल्पलाइन',
    dialer_child: 'बाल हेल्पलाइन',

    // Time ago
    t_sec: ' से',
    t_min: ' मि पहले',
    t_hr: ' घं पहले',
    t_day: ' दिन पहले',
  },

  pa: {
    // Navbar
    nav_map: 'ਲਾਈਵ ਨਕਸ਼ਾ',
    nav_login: 'ਲੌਗਇਨ',
    nav_join: 'ਜੁੜੋ',
    nav_report: 'ਸੰਕਟ ਦਰਜ ਕਰੋ',
    nav_volunteer: 'ਵਲੰਟੀਅਰ ਫੀਡ',
    nav_my_alerts: 'ਮੇਰੇ ਅਲਰਟ',
    nav_safety: 'ਸੁਰੱਖਿਆ',
    nav_resources: 'ਸਰੋਤ',
    nav_logout: 'ਲੌਗਆਉਟ',
    nav_profile: 'ਪ੍ਰੋਫਾਈਲ',
    nav_language: 'ਭਾਸ਼ਾ',

    // Home
    home_badge: 'ਹਾਈਪਰਲੋਕਲ ਸੰਕਟ ਨੈੱਟਵਰਕ',
    home_title_1: 'ਤੁਹਾਡੇ ਗੁਆਂਢੀ ਨੂੰ ਮਦਦ ਚਾਹੀਦੀ ਹੈ।',
    home_title_2: 'ਮਿੰਟਾਂ ਵਿੱਚ ਪਹੁੰਚੋ।',
    home_subtitle:
      'NeighbourAid ਸੰਕਟ ਵਿੱਚ ਫਸੇ ਲੋਕਾਂ ਨੂੰ ਨੇੜਲੇ ਵਲੰਟੀਅਰਾਂ ਨਾਲ ਰੀਅਲ ਟਾਈਮ ਵਿੱਚ ਜੋੜਦਾ ਹੈ। AI ਟ੍ਰਾਈਐਜ, ਲਾਈਵ ਨਕਸ਼ੇ ਅਤੇ ਤੁਰੰਤ ਸੂਚਨਾਵਾਂ — ਸਭ ਮੁਫ਼ਤ, ਸਭ ਸਥਾਨਕ।',
    home_cta_report: 'ਸੰਕਟ ਦਰਜ ਕਰੋ',
    home_cta_map: 'ਨਕਸ਼ਾ ਦੇਖੋ',
    home_cta_volunteer: 'ਵਲੰਟੀਅਰ ਫੀਡ ਖੋਲ੍ਹੋ',
    home_cta_join: 'ਸ਼ੁਰੂ ਕਰੋ',

    home_stats_active: 'ਸਰਗਰਮ ਅਲਰਟ',
    home_stats_critical: 'ਗੰਭੀਰ ਖੁੱਲ੍ਹੇ',
    home_stats_24h: '24 ਘੰਟਿਆਂ ਵਿੱਚ',
    home_stats_volunteers: 'ਵਲੰਟੀਅਰ ਲਾਈਵ',

    home_how_title: 'ਇਹ ਕਿਵੇਂ ਕੰਮ ਕਰਦਾ ਹੈ',
    home_how_1_title: 'ਸੰਕਟ ਦਰਜ ਕਰੋ',
    home_how_1_desc: 'ਸ਼੍ਰੇਣੀ, ਵੇਰਵਾ ਅਤੇ ਆਪਣਾ GPS ਟਿਕਾਣਾ ਭਰੋ। 30 ਸਕਿੰਟਾਂ ਵਿੱਚ ਪੂਰਾ।',
    home_how_2_title: 'AI ਟ੍ਰਾਈਐਜ',
    home_how_2_desc: 'ਸਾਡਾ ਲੋਕਲ Hugging Face ਮਾਡਲ ਗੰਭੀਰਤਾ ਨੂੰ CRITICAL / HIGH / MEDIUM / LOW ਵਜੋਂ ਵਰਗੀਕ੍ਰਿਤ ਕਰਦਾ ਹੈ।',
    home_how_3_title: 'ਵਲੰਟੀਅਰ ਸੂਚਿਤ',
    home_how_3_desc: 'ਨੇੜਲੇ ਵਲੰਟੀਅਰਾਂ ਨੂੰ ਲਾਈਵ ਸੂਚਨਾ ਮਿਲਦੀ ਹੈ ਅਤੇ ਉਹ ਅਲਰਟ ਸਵੀਕਾਰ ਜਾਂ ਹੱਲ ਕਰ ਸਕਦੇ ਹਨ।',

    home_leaderboard_title: 'ਚੋਟੀ ਦੇ ਵਲੰਟੀਅਰ',
    home_leaderboard_since: 'ਪਿਛਲੇ 30 ਦਿਨ',
    home_leaderboard_resolved: 'ਹੱਲ ਕੀਤੇ',

    home_news_title: 'ਸੰਕਟ ਖ਼ਬਰ ਫੀਡ',
    home_news_subtitle:
      'Times of India, NDTV, Hindustan Times ਅਤੇ The Hindu ਤੋਂ · ਸੰਕਟ ਸ਼ਬਦਾਂ ਲਈ ਫਿਲਟਰ · ਹਰ ਮਿੰਟ ਤਾਜ਼ਾ',

    home_urgency_title: 'ਜ਼ਰੂਰਤ ਦੇ ਪੱਧਰ',
    urgency_example_critical: 'ਵਿਅਕਤੀ ਬੇਹੋਸ਼ / ਦਿਲ ਦਾ ਦੌਰਾ',
    urgency_example_high: 'ਘਰ ਵਿੱਚ ਪਾਣੀ / ਬਜ਼ੁਰਗ ਇਕੱਲੇ',
    urgency_example_medium: 'ਪੂਰੇ ਬਲਾਕ ਵਿੱਚ ਬਿਜਲੀ ਗੁੱਲ',
    urgency_example_low: 'ਅਵਾਰਾ ਕੁੱਤਾ ਜ਼ਖਮੀ, ਵੈਟ ਸੰਪਰਕ ਚਾਹੀਦਾ',

    // SOS
    sos_button: 'SOS · ਤੁਰੰਤ ਮਦਦ',
    sos_sub: 'GPS-ਟੈਗ · ਤੁਰੰਤ ਵਲੰਟੀਅਰ ਪ੍ਰਸਾਰਣ',
    sos_send: 'SOS ਭੇਜੋ',
    sos_sending: 'ਭੇਜਿਆ ਜਾ ਰਿਹਾ…',
    sos_confirm: 'ਹੁਣੇ ਆਪਣੇ GPS ਟਿਕਾਣੇ ਤੋਂ ਇੱਕ CRITICAL SOS ਅਲਰਟ ਭੇਜੋ?',
    sos_no_geo: 'Geolocation ਉਪਲਬਧ ਨਹੀਂ — ਕਿਰਪਾ ਕਰਕੇ ਪੂਰਾ ਫਾਰਮ ਵਰਤੋ।',
    sos_failed: 'SOS ਫੇਲ — ਪੂਰਾ ਫਾਰਮ ਅਜ਼ਮਾਓ',
    sos_no_gps: 'GPS ਪੜ੍ਹਨ ਵਿੱਚ ਅਸਮਰੱਥ',

    // Login
    login_title: 'ਵਾਪਸੀ ਤੇ ਸਵਾਗਤ',
    login_subtitle: 'ਆਪਣੇ NeighbourAid ਖਾਤੇ ਵਿੱਚ ਸਾਈਨ ਇਨ ਕਰੋ',
    login_email: 'ਈਮੇਲ',
    login_password: 'ਪਾਸਵਰਡ',
    login_submit: 'ਸਾਈਨ ਇਨ',
    login_submitting: 'ਸਾਈਨ ਇਨ ਹੋ ਰਿਹਾ…',
    login_no_account: 'ਖਾਤਾ ਨਹੀਂ?',
    login_register_here: 'ਇੱਥੇ ਰਜਿਸਟਰ ਕਰੋ',
    login_failed: 'ਲੌਗਇਨ ਫੇਲ',

    // Register
    register_title: 'ਖਾਤਾ ਬਣਾਓ',
    register_subtitle: 'NeighbourAid ਨੈੱਟਵਰਕ ਵਿੱਚ ਸ਼ਾਮਲ ਹੋਵੋ',
    register_name: 'ਪੂਰਾ ਨਾਮ',
    register_want_to: 'ਮੈਂ ਚਾਹੁੰਦਾ/ਚਾਹੁੰਦੀ ਹਾਂ',
    register_role_reporter: 'ਸੰਕਟ ਦਰਜ',
    register_role_volunteer: 'ਵਲੰਟੀਅਰ',
    register_location: 'ਤੁਹਾਡਾ ਟਿਕਾਣਾ',
    register_detect: 'ਲੱਭੋ',
    register_detecting: '…',
    register_location_required:
      'ਆਪਣਾ ਘਰ ਦਾ ਟਿਕਾਣਾ ਸੈੱਟ ਕਰਨ ਲਈ "ਪਤਾ ਕਰੋ" ਦਬਾਓ — ਇਸੇ ਨਾਲ ਤੈਅ ਹੁੰਦਾ ਹੈ ਕਿਹੜੇ ਅਲਰਟ ਤੁਹਾਡੇ ਤੱਕ ਪਹੁੰਚਣਗੇ।',
    register_location_placeholder: 'ਹਾਲੇ ਸੈੱਟ ਨਹੀਂ — "ਪਤਾ ਕਰੋ" ਦਬਾਓ',
    register_location_saved: 'ਘਰ ਦਾ ਟਿਕਾਣਾ ਸੰਭਾਲਿਆ ਗਿਆ।',
    register_password_hint: 'ਘੱਟੋ-ਘੱਟ 8 ਅੱਖਰ, ਜਿਸ ਵਿੱਚ ਇੱਕ ਅੱਖਰ ਤੇ ਇੱਕ ਅੰਕ ਹੋਵੇ।',
    register_submit: 'ਖਾਤਾ ਬਣਾਓ',
    register_submitting: 'ਖਾਤਾ ਬਣ ਰਿਹਾ…',
    register_have_account: 'ਪਹਿਲਾਂ ਤੋਂ ਖਾਤਾ ਹੈ?',
    register_sign_in: 'ਸਾਈਨ ਇਨ',
    register_failed: 'ਰਜਿਸਟ੍ਰੇਸ਼ਨ ਫੇਲ',

    // Post alert
    post_title: 'ਸੰਕਟ ਦਰਜ ਕਰੋ',
    post_subtitle: 'ਸਾਡਾ AI ਗੰਭੀਰਤਾ ਵਰਗੀਕ੍ਰਿਤ ਕਰੇਗਾ ਅਤੇ ਨੇੜਲੇ ਵਲੰਟੀਅਰਾਂ ਨੂੰ ਤੁਰੰਤ ਸੂਚਿਤ ਕਰੇਗਾ।',
    post_category: 'ਸ਼੍ਰੇਣੀ',
    post_description: 'ਵੇਰਵਾ',
    post_description_hint: '(AI ਇਸਦੀ ਵਰਤੋਂ ਟ੍ਰਾਈਐਜ ਲਈ ਕਰਦਾ)',
    post_description_placeholder:
      'ਜਿਵੇਂ: ਪਾਰਕ ਦੇ ਗੇਟ ਕੋਲ ਇੱਕ ਬਜ਼ੁਰਗ ਡਿੱਗੇ ਹਨ, ਬੇਹੋਸ਼ ਲੱਗਦੇ ਹਨ, ਤੁਰੰਤ ਮਦਦ ਚਾਹੀਦੀ ਹੈ…',
    post_voice_speak: 'ਬੋਲੋ',
    post_voice_recording: 'ਰਿਕਾਰਡ ਹੋ ਰਿਹਾ…',
    post_voice_tip_start: 'ਟਾਈਪ ਕਰਨ ਦੀ ਬਜਾਏ ਬੋਲੋ (en-IN)। Chrome/Edge ਵਿੱਚ',
    post_voice_tip_stop: 'ਰੋਕਣ ਲਈ ਟੈਪ ਕਰੋ',
    post_location: 'ਟਿਕਾਣਾ',
    post_use_gps: 'GPS ਵਰਤੋ',
    post_locating: 'ਤੁਹਾਡਾ ਟਿਕਾਣਾ ਲੱਭਿਆ ਜਾ ਰਿਹਾ ਹੈ…',
    post_location_required:
      'ਆਪਣਾ ਅਸਲੀ ਟਿਕਾਣਾ ਸੈੱਟ ਕਰਨ ਲਈ "GPS ਵਰਤੋ" ਦਬਾਓ — ਵਲੰਟੀਅਰ ਇਸੇ ਥਾਂ ਭੇਜੇ ਜਾਣਗੇ।',
    post_location_placeholder: 'ਹਾਲੇ ਸੈੱਟ ਨਹੀਂ — "GPS ਵਰਤੋ" ਦਬਾਓ',
    post_submit: 'ਅਲਰਟ ਭੇਜੋ',
    post_submitting: 'ਅਲਰਟ ਭੇਜਿਆ ਜਾ ਰਿਹਾ…',
    post_min_chars: 'ਕਿਰਪਾ ਕਰਕੇ ਵਧੇਰੇ ਵੇਰਵਾ ਦਿਓ (ਘੱਟੋ-ਘੱਟ 10 ਅੱਖਰ)',
    post_failed: 'ਅਲਰਟ ਭੇਜਣ ਵਿੱਚ ਫੇਲ',

    // Category labels
    cat_medical: 'ਮੈਡੀਕਲ',
    cat_flood: 'ਹੜ੍ਹ',
    cat_fire: 'ਅੱਗ',
    cat_missing: 'ਗੁੰਮ',
    cat_power: 'ਬਿਜਲੀ',
    cat_other: 'ਹੋਰ',

    // Map dashboard
    map_title: 'ਲਾਈਵ ਸੰਕਟ ਨਕਸ਼ਾ',
    map_loading: 'ਲੋਡ ਹੋ ਰਿਹਾ…',
    map_all: 'ਸਾਰੇ',
    map_active_alerts_one: 'ਸਰਗਰਮ ਅਲਰਟ',
    map_active_alerts_many: 'ਸਰਗਰਮ ਅਲਰਟ',
    map_refresh_note: 'ਹਰ 15 ਸਕਿੰਟ ਵਿੱਚ ਤਾਜ਼ਾ',
    map_failed: 'ਅਲਰਟ ਲੋਡ ਕਰਨ ਵਿੱਚ ਫੇਲ',
    map_urgency_legend: 'ਗੰਭੀਰਤਾ',

    // Volunteer feed
    vol_title: 'ਵਲੰਟੀਅਰ ਫੀਡ',
    vol_subtitle: 'ਤੁਹਾਡੇ ਟਿਕਾਣੇ ਤੋਂ 10 ਕਿਮੀ ਅੰਦਰ ਅਲਰਟ',
    vol_live: 'ਲਾਈਵ',
    vol_loading: 'ਨੇੜਲੇ ਅਲਰਟ ਲੋਡ ਹੋ ਰਹੇ…',
    vol_open: 'ਖੁੱਲ੍ਹੇ',
    vol_active: 'ਤੁਹਾਡੇ ਸਰਗਰਮ ਕਾਰਜ',
    vol_no_open: 'ਨੇੜੇ ਕੋਈ ਖੁੱਲ੍ਹਾ ਅਲਰਟ ਨਹੀਂ। ਤਿਆਰ ਰਹੋ।',
    vol_enable_notif:
      'ਬ੍ਰਾਊਜ਼ਰ ਸੂਚਨਾਵਾਂ ਚਾਲੂ ਕਰੋ ਤਾਂ ਜੋ ਬੈਕਗ੍ਰਾਊਂਡ ਵਿੱਚ ਵੀ ਅਲਰਟ ਮਿਲਣ।',
    vol_enable: 'ਚਾਲੂ ਕਰੋ',
    vol_notif_on: 'ਬੈਕਗ੍ਰਾਊਂਡ ਸੂਚਨਾਵਾਂ ਚਾਲੂ',
    vol_failed: 'ਅਲਰਟ ਲੋਡ ਕਰਨ ਵਿੱਚ ਫੇਲ',

    // My alerts
    mine_title: 'ਮੇਰੇ ਅਲਰਟ',
    mine_summary: 'ਕੁੱਲ',
    mine_open: 'ਖੁੱਲ੍ਹੇ',
    mine_in_progress: 'ਤਰੱਕੀ ਵਿੱਚ',
    mine_new: '+ ਨਵਾਂ',
    mine_loading: 'ਲੋਡ ਹੋ ਰਿਹਾ…',
    mine_empty: 'ਤੁਸੀਂ ਹਾਲੇ ਕੋਈ ਅਲਰਟ ਦਰਜ ਨਹੀਂ ਕੀਤਾ।',
    mine_post_first: 'ਪਹਿਲਾ ਅਲਰਟ ਦਰਜ ਕਰੋ',
    mine_cancel: 'ਅਲਰਟ ਰੱਦ ਕਰੋ',
    mine_cancelling: 'ਰੱਦ ਹੋ ਰਿਹਾ…',
    mine_cancel_failed: 'ਅਲਰਟ ਰੱਦ ਕਰਨ ਵਿੱਚ ਫੇਲ',
    mine_load_failed: 'ਤੁਹਾਡੇ ਅਲਰਟ ਲੋਡ ਕਰਨ ਵਿੱਚ ਫੇਲ',

    // Profile
    profile_title: 'ਤੁਹਾਡੀ ਪ੍ਰੋਫਾਈਲ',
    profile_signed_as: 'ਵਜੋਂ ਸਾਈਨ ਇਨ',
    profile_identity: 'ਪਛਾਣ',
    profile_name: 'ਨਾਮ',
    profile_role: 'ਭੂਮਿਕਾ',
    profile_joined: 'ਸ਼ਾਮਲ',
    profile_home_location: 'ਘਰ ਦਾ ਟਿਕਾਣਾ',
    profile_update_loc: 'ਮੌਜੂਦਾ ਟਿਕਾਣੇ ਤੇ ਅਪਡੇਟ ਕਰੋ',
    profile_detecting: 'ਲੱਭ ਰਹੇ…',
    profile_saving: 'ਸੰਭਾਲ ਰਹੇ…',
    profile_loc_hint: 'ਅਲਰਟ ਦੂਰੀ ਅਤੇ 2 ਕਿਮੀ ਅੰਦਰ ਗਵਾਹ ਯੋਗਤਾ ਲਈ ਵਰਤਿਆ ਜਾਂਦਾ।',
    profile_loc_saved: 'ਘਰ ਦਾ ਟਿਕਾਣਾ ਅਪਡੇਟ ਹੋ ਗਿਆ।',
    profile_activity: 'ਗਤੀਵਿਧੀ',
    profile_stat_posted: 'ਦਰਜ',
    profile_stat_open: 'ਖੁੱਲ੍ਹੇ',
    profile_stat_resolved: 'ਹੱਲ',
    profile_stat_accepted: 'ਸਵੀਕਾਰੇ',
    profile_stat_inprogress: 'ਤਰੱਕੀ ਵਿੱਚ',
    profile_loading: 'ਪ੍ਰੋਫਾਈਲ ਲੋਡ ਹੋ ਰਹੀ…',
    profile_no_geo: 'Geolocation ਇਸ ਬ੍ਰਾਊਜ਼ਰ ਵਿੱਚ ਉਪਲਬਧ ਨਹੀਂ',
    profile_load_failed: 'ਪ੍ਰੋਫਾਈਲ ਲੋਡ ਕਰਨ ਵਿੱਚ ਫੇਲ',
    profile_update_failed: 'ਟਿਕਾਣਾ ਅਪਡੇਟ ਕਰਨ ਵਿੱਚ ਫੇਲ',

    // Safety
    safety_title: 'ਸੁਰੱਖਿਆ ਚੈੱਕ-ਇਨ',
    safety_subtitle:
      'ਆਫ਼ਤ ਦੌਰਾਨ, ਆਪਣੇ ਆਪ ਨੂੰ ਸੁਰੱਖਿਅਤ ਨਿਸ਼ਾਨ ਲਗਾਓ ਜਾਂ ਮਦਦ ਦੀ ਲੋੜ ਦਰਸਾਓ। 10 ਕਿਮੀ ਅੰਦਰ 24 ਘੰਟੇ ਦਿਖੇਗਾ।',
    safety_your: 'ਤੁਹਾਡਾ ਚੈੱਕ-ਇਨ',
    safety_i_am_safe: 'ਮੈਂ ਸੁਰੱਖਿਅਤ ਹਾਂ',
    safety_i_need_help: 'ਮੈਨੂੰ ਮਦਦ ਚਾਹੀਦੀ',
    safety_saving: 'ਸੰਭਾਲ ਰਹੇ…',
    safety_no_active: 'ਕੋਈ ਸਰਗਰਮ ਚੈੱਕ-ਇਨ ਨਹੀਂ।',
    safety_note_ph: 'ਛੋਟਾ ਨੋਟ (ਵਿਕਲਪਿਕ)',
    safety_expires: 'ਸਮਾਪਤ',
    safety_nearby: 'ਨੇੜੇ',
    safety_checkins: 'ਚੈੱਕ-ਇਨ',
    safety_safe: 'ਸੁਰੱਖਿਅਤ',
    safety_need_help: 'ਮਦਦ ਚਾਹੀਦੀ',
    safety_none_yet: 'ਹਾਲੇ ਕਿਸੇ ਨੇ ਚੈੱਕ-ਇਨ ਨਹੀਂ ਕੀਤਾ।',
    safety_sign_in: 'ਸਾਈਨ ਇਨ',
    safety_sign_in_to: 'ਆਪਣਾ ਚੈੱਕ-ਇਨ ਪੋਸਟ ਕਰਨ ਲਈ।',
    safety_load_failed: 'ਸੁਰੱਖਿਆ ਬੋਰਡ ਲੋਡ ਕਰਨ ਵਿੱਚ ਫੇਲ',
    safety_post_failed: 'ਚੈੱਕ-ਇਨ ਪੋਸਟ ਕਰਨ ਵਿੱਚ ਫੇਲ',

    // Resources
    res_title: 'ਸਮੁਦਾਇਕ ਸਰੋਤ',
    res_subtitle:
      'ਆਪਣੇ ਨੇੜੇ ਆਸਰਾ, ਭੋਜਨ, ਖੂਨ, ਆਕਸੀਜਨ, ਪਾਣੀ ਅਤੇ ਮੈਡੀਕਲ ਕੈਂਪ ਪਿੰਨ ਕਰੋ। ਸੂਚੀਆਂ ਆਪਣੇ ਆਪ ਖਤਮ ਹੋ ਜਾਂਦੀਆਂ ਹਨ।',
    res_pin_a_resource: 'ਸਰੋਤ ਪਿੰਨ ਕਰੋ',
    res_name_ph: 'ਨਾਮ (ਜਿਵੇਂ: ਸੈਕਟਰ 22 ਕਮਿਊਨਟੀ ਆਸਰਾ)',
    res_contact_ph: 'ਸੰਪਰਕ (ਫ਼ੋਨ / ਡੈਸਕ)',
    res_capacity_ph: 'ਸਮਰੱਥਾ',
    res_notes_ph: 'ਛੋਟੇ ਨੋਟ (ਵਿਕਲਪਿਕ)',
    res_valid_for: 'ਮਿਆਦ',
    res_hours: 'ਘੰਟੇ',
    res_post: 'ਸਰੋਤ ਪਿੰਨ ਕਰੋ',
    res_posting: 'ਪਿੰਨ ਹੋ ਰਿਹਾ…',
    res_nearby: '25 ਕਿਮੀ ਅੰਦਰ',
    res_all: 'ਸਾਰੇ',
    res_none_yet: 'ਨੇੜੇ ਅਜੇ ਕੋਈ ਸਰੋਤ ਪਿੰਨ ਨਹੀਂ ਹੈ।',
    res_none_body:
      'ਪਹਿਲੇ ਬਣੋ — ਆਸਰਾ, ਭੋਜਨ ਜਾਂ ਆਕਸੀਜਨ ਪਿੰਨ ਕਰੋ; 25 ਕਿਮੀ ਅੰਦਰ ਸਭ ਨੂੰ ਦਿਖੇਗਾ।',
    res_loading: 'ਲੋਡ ਹੋ ਰਿਹਾ…',
    res_sign_in_to: 'ਆਪਣਾ ਸਰੋਤ ਪਿੰਨ ਕਰਨ ਲਈ।',
    res_load_failed: 'ਸਰੋਤ ਲੋਡ ਕਰਨ ਵਿੱਚ ਫੇਲ',
    res_post_failed: 'ਸਰੋਤ ਪਿੰਨ ਕਰਨ ਵਿੱਚ ਫੇਲ',
    res_delete_failed: 'ਸਰੋਤ ਹਟਾਉਣ ਵਿੱਚ ਫੇਲ',
    res_name_too_short: 'ਨਾਮ ਘੱਟੋ-ਘੱਟ 2 ਅੱਖਰ ਦਾ ਹੋਣਾ ਚਾਹੀਦਾ',
    res_no_location: 'ਟਿਕਾਣਾ ਉਪਲਬਧ ਨਹੀਂ — ਕਿਰਪਾ ਕਰਕੇ GPS ਦੀ ਆਗਿਆ ਦਿਓ',

    // Alert card
    card_directions: 'ਦਿਸ਼ਾ',
    card_updates: 'ਅਪਡੇਟ',
    card_see_too: 'ਮੈਂ ਵੀ ਵੇਖ ਰਿਹਾ ਹਾਂ',
    card_see_too_tip: 'ਪੁਸ਼ਟੀ ਕਰੋ ਕਿ ਤੁਸੀਂ ਵੀ ਇਹ ਦੇਖ ਰਹੇ ਹੋ',
    card_accept: 'ਸਵੀਕਾਰ',
    card_resolve: 'ਹੱਲ ਨਿਸ਼ਾਨ',
    card_no_updates: 'ਹਾਲੇ ਕੋਈ ਅਪਡੇਟ ਨਹੀਂ। ਪਹਿਲਾਂ ਤੁਸੀਂ ਹੋਵੋ।',
    card_loading_updates: 'ਅਪਡੇਟ ਲੋਡ ਹੋ ਰਹੇ…',
    card_update_ph: "ਅਪਡੇਟ ਪੋਸਟ ਕਰੋ — ਜਿਵੇਂ: 'ਐਂਬੂਲੈਂਸ ਰਸਤੇ ਵਿੱਚ'",
    card_send: 'ਭੇਜੋ',
    card_update_too_short: 'ਅਪਡੇਟ ਘੱਟੋ-ਘੱਟ 3 ਅੱਖਰ ਦਾ ਹੋਣਾ ਚਾਹੀਦਾ',
    card_update_failed: 'ਅਪਡੇਟ ਪੋਸਟ ਕਰਨ ਵਿੱਚ ਫੇਲ',
    card_high_conf: 'ਉੱਚ ਭਰੋਸਾ',
    card_corroborated: 'ਪੁਸ਼ਟ',
    card_unverified: 'ਅਪੁਸ਼ਟ',
    card_witness_one: 'ਗਵਾਹ',
    card_witness_many: 'ਗਵਾਹ',
    card_similar_nearby: 'ਸਮਾਨ ਨੇੜੇ',
    card_weather_match: 'ਮੌਸਮ-ਮੇਲ',
    card_ai_confident: 'ਭਰੋਸਾ',

    // Dialer
    dialer_title: 'ਭਾਰਤ ਐਮਰਜੈਂਸੀ ਨੰਬਰ',
    dialer_subtitle: 'ਕਾਲ ਕਰਨ ਲਈ ਨੰਬਰ ਟੈਪ ਕਰੋ। ਮੋਬਾਈਲ ਅਤੇ ਫੋਨ ਹੈਂਡਲਰ ਵਾਲੇ ਡੈਸਕਟਾਪ ਤੇ ਕੰਮ ਕਰਦਾ।',
    dialer_note: 'ਭਾਰਤ ਦਾ ਇਕਸਾਰ ਐਮਰਜੈਂਸੀ ਨੰਬਰ ਹੈ — ਪੁਲਿਸ, ਅੱਗ, ਮੈਡੀਕਲ, ਮਹਿਲਾ ਅਤੇ ਬਾਲ ਸੇਵਾਵਾਂ ਨੂੰ ਰੂਟ ਕਰਦਾ।',
    dialer_open: 'ਐਮਰਜੈਂਸੀ ਨੰਬਰ ਖੋਲ੍ਹੋ',
    dialer_tooltip: 'ਭਾਰਤ ਐਮਰਜੈਂਸੀ ਨੰਬਰ',
    dialer_all_in_one: 'ਐਮਰਜੈਂਸੀ (ਸਭ ਇੱਕ ਵਿੱਚ)',
    dialer_police: 'ਪੁਲਿਸ',
    dialer_ambulance: 'ਐਂਬੂਲੈਂਸ',
    dialer_fire: 'ਫਾਇਰ',
    dialer_women: 'ਮਹਿਲਾ ਹੈਲਪਲਾਈਨ',
    dialer_child: 'ਬਾਲ ਹੈਲਪਲਾਈਨ',

    // Time ago
    t_sec: ' ਸਕਿੰਟ ਪਹਿਲਾਂ',
    t_min: ' ਮਿੰਟ ਪਹਿਲਾਂ',
    t_hr: ' ਘੰਟੇ ਪਹਿਲਾਂ',
    t_day: ' ਦਿਨ ਪਹਿਲਾਂ',
  },
}

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem('lang')
    if (saved && DICT[saved]) return saved
    // First-run: infer from browser locale, but only if we have a translation
    const browser = (navigator.language || 'en').slice(0, 2)
    return DICT[browser] ? browser : 'en'
  })

  // Auto-translate user-generated content (alert descriptions, updates) to
  // the active language. Default on — it's the main reason multilingual
  // support exists in a crisis app. Users can disable it to save data.
  const [autoTranslate, setAutoTranslate] = useState(() => {
    const v = localStorage.getItem('autoTranslate')
    return v == null ? true : v === '1'
  })

  useEffect(() => {
    localStorage.setItem('lang', lang)
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    localStorage.setItem('autoTranslate', autoTranslate ? '1' : '0')
  }, [autoTranslate])

  const t = useCallback(
    (key) => DICT[lang]?.[key] ?? DICT.en[key] ?? key,
    [lang]
  )

  const value = useMemo(
    () => ({
      lang,
      t,
      setLang: (next) => {
        if (DICT[next]) setLang(next)
      },
      languages: LANGUAGES,
      autoTranslate,
      setAutoTranslate,
    }),
    [lang, t, autoTranslate]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>')
  return ctx
}
