package com.neighbouraid.speech;

import org.junit.Test;
import static org.junit.Assert.*;

public class SpeechPolicyTest {
    @Test public void requestsEachUiLanguageWithoutSilentlyChangingIt() {
        for (String locale : new String[] {"en-IN", "hi-IN", "bn-IN", "mr-IN", "te-IN", "ta-IN", "gu-IN", "pa-IN", "kn-IN", "ml-IN", "or-IN"}) {
            assertTrue(locale, SpeechPolicy.supportedLocale(locale));
        }
        assertFalse(SpeechPolicy.supportedLocale(null));
        assertFalse(SpeechPolicy.supportedLocale("en"));
        assertFalse(SpeechPolicy.supportedLocale("xx-IN"));
    }
    @Test public void boundsProviderOutputWithoutLosingPartOfAnEmergencyReport() {
        assertEquals("", SpeechPolicy.transcript(null));
        assertEquals("", SpeechPolicy.transcript(" "));
        assertEquals("आग लगी है", SpeechPolicy.transcript("  आग लगी है  "));
        assertEquals("a b", SpeechPolicy.transcript("a\u0000b"));
        assertEquals(2000, SpeechPolicy.transcript("a".repeat(2000)).length());
        assertEquals("", SpeechPolicy.transcript("a".repeat(2001)));
    }
}
