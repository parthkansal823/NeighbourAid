package com.neighbouraid.speech;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Locale;

/** User-triggered system speech dialog. No audio is stored or sent to our API. */
@CapacitorPlugin(name = "NeighbourAidSpeech")
public class NeighbourAidSpeechPlugin extends Plugin {
    private boolean busy;
    private TextToSpeech speaker;
    private PluginCall promptCall;

    @PluginMethod public void speakPrompt(PluginCall call) {
        String text = call.getString("text", "").trim();
        String language = call.getString("language", "en-IN");
        if (text.isEmpty() || text.length() > 500 || !SpeechPolicy.supportedLocale(language)) {
            call.reject("Invalid spoken prompt", "invalid-prompt"); return;
        }
        getActivity().runOnUiThread(() -> {
            stopPromptInternal();
            promptCall = call;
            try {
                speaker = new TextToSpeech(getContext(), status -> getActivity().runOnUiThread(() -> {
                    if (promptCall != call || speaker == null) return;
                    if (status != TextToSpeech.SUCCESS || speaker.setLanguage(Locale.forLanguageTag(language)) < 0) {
                        finishPrompt(call, false); return;
                    }
                    speaker.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String id) {}
                        @Override public void onDone(String id) { getActivity().runOnUiThread(() -> finishPrompt(call, true)); }
                        @Override public void onError(String id) { getActivity().runOnUiThread(() -> finishPrompt(call, false)); }
                    });
                    if (speaker.speak(text, TextToSpeech.QUEUE_FLUSH, null, "prompt") != TextToSpeech.SUCCESS) finishPrompt(call, false);
                }));
            } catch (RuntimeException ex) { finishPrompt(call, false); }
        });
    }

    @PluginMethod public void stopPrompt(PluginCall call) {
        getActivity().runOnUiThread(() -> { stopPromptInternal(); call.resolve(); });
    }

    private void finishPrompt(PluginCall call, boolean spoken) {
        if (promptCall != call) return;
        promptCall = null;
        TextToSpeech old = speaker;
        speaker = null;
        if (old != null) { old.stop(); old.shutdown(); }
        JSObject result = new JSObject(); result.put("spoken", spoken); call.resolve(result);
    }

    private void stopPromptInternal() {
        if (promptCall != null) finishPrompt(promptCall, false);
    }

    @Override protected void handleOnDestroy() {
        getActivity().runOnUiThread(this::stopPromptInternal);
        super.handleOnDestroy();
    }

    @PluginMethod public void isAvailable(PluginCall call) {
        JSObject answer = new JSObject();
        answer.put("available", new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .resolveActivity(getContext().getPackageManager()) != null);
        call.resolve(answer);
    }

    @PluginMethod public void recognize(PluginCall call) {
        String language = call.getString("language", "en-IN");
        if (!SpeechPolicy.supportedLocale(language)) {
            call.reject("Unsupported recognition locale", "language-not-supported"); return;
        }
        getActivity().runOnUiThread(() -> {
            if (busy) { call.reject("Speech dialog is already open", "busy"); return; }
            busy = true;
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            // No report text, location or account data is passed to the provider.
            try { startActivityForResult(call, intent, "speechResult"); }
            catch (ActivityNotFoundException ex) { busy = false; call.reject("No speech service installed", "speech-service-unavailable"); }
            catch (SecurityException ex) { busy = false; call.reject("Speech service permission denied", "not-allowed"); }
            catch (RuntimeException ex) { busy = false; call.reject("Cannot open speech dialog", "failed"); }
        });
    }

    @ActivityCallback private void speechResult(PluginCall call, ActivityResult result) {
        busy = false;
        if (call == null) return;
        JSObject answer = new JSObject();
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            answer.put("cancelled", true); call.resolve(answer); return;
        }
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Speech service returned no result", "no-speech"); return;
        }
        ArrayList<String> matches = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        String text = SpeechPolicy.transcript(matches == null || matches.isEmpty() ? null : matches.get(0));
        if (text.isEmpty()) { call.reject("No usable speech result", "no-speech"); return; }
        answer.put("text", text);
        call.resolve(answer);
    }
}
