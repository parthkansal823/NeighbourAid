package com.neighbouraid.speech;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

final class SpeechPolicy {
    private static final Set<String> LOCALES = new HashSet<>(Arrays.asList(
        "en-IN", "hi-IN", "bn-IN", "mr-IN", "te-IN", "ta-IN", "gu-IN", "pa-IN", "kn-IN", "ml-IN", "or-IN"
    ));
    static boolean supportedLocale(String locale) { return LOCALES.contains(locale); }
    static String transcript(String text) {
        if (text == null) return "";
        String clean = text.replaceAll("[\\p{Cntrl}]", " ").trim();
        // Never silently cut off the end of an emergency report.
        return clean.length() <= 2000 ? clean : "";
    }
}
