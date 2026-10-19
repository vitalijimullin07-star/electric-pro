package ru.pylesos.app;

import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import java.util.ArrayDeque;
import java.util.Locale;

/**
 * Голос: фраза пылесоса — тот же mp3, что на карте его плеера (assets/voice/00NN.mp3); если фразы нет —
 * текст читает синтезатор речи Android. Фразы по очереди, не перебивая друг друга; аварии — громкостью будильника.
 */
final class Voice {
    private static Voice inst;
    private final Context c;
    private final Handler h = new Handler(Looper.getMainLooper());
    private final ArrayDeque<Object[]> queue = new ArrayDeque<>();
    private boolean busy;
    private TextToSpeech tts;
    private boolean ttsReady;
    private final AudioManager am;
    private AudioFocusRequest focus;

    private Voice(Context c) {
        this.c = c.getApplicationContext();
        am = (AudioManager) this.c.getSystemService(Context.AUDIO_SERVICE);
    }

    static synchronized Voice get(Context c) {
        if (inst == null) inst = new Voice(c);
        return inst;
    }

    /** Сказать фразу (номер или null) или текст; alarm — громкостью будильника (слышно и в беззвучном). */
    void say(Integer phrase, String text, boolean alarm) {
        h.post(() -> {
            if (queue.size() > 6) return; // лавина сообщений — не копим
            queue.add(new Object[] {phrase, text, alarm});
            if (!busy) next();
        });
    }

    private AudioAttributes attrs(boolean alarm) {
        return new AudioAttributes.Builder()
                .setUsage(alarm ? AudioAttributes.USAGE_ALARM : AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
    }

    private void next() {
        Object[] it = queue.poll();
        if (it == null) {
            busy = false;
            release();
            return;
        }
        busy = true;
        Integer phrase = (Integer) it[0];
        String text = (String) it[1];
        boolean alarm = (Boolean) it[2];
        grab(alarm);
        if (phrase != null && phrase > 0 && play(phrase, alarm)) return;
        if (text != null && !text.isEmpty()) speak(text, alarm);
        else next();
    }

    private boolean play(int n, boolean alarm) {
        try {
            AssetFileDescriptor fd = c.getAssets().openFd(String.format(Locale.ROOT, "voice/%04d.mp3", n));
            MediaPlayer mp = new MediaPlayer();
            mp.setAudioAttributes(attrs(alarm));
            mp.setDataSource(fd.getFileDescriptor(), fd.getStartOffset(), fd.getLength());
            fd.close();
            mp.setOnCompletionListener((p) -> {
                p.release();
                h.postDelayed(this::next, 250);
            });
            mp.setOnErrorListener((p, w, e) -> {
                p.release();
                h.post(this::next);
                return true;
            });
            mp.prepare();
            mp.start();
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void speak(String text, boolean alarm) {
        if (tts == null) {
            tts = new TextToSpeech(c, (st) -> h.post(() -> {
                ttsReady = st == TextToSpeech.SUCCESS;
                if (ttsReady) tts.setLanguage(new Locale("ru", "RU"));
                speakNow(text, alarm);
            }));
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override
                public void onStart(String id) {}

                @Override
                public void onDone(String id) {
                    h.postDelayed(Voice.this::next, 250);
                }

                @Override
                public void onError(String id) {
                    h.post(Voice.this::next);
                }
            });
            return;
        }
        speakNow(text, alarm);
    }

    private void speakNow(String text, boolean alarm) {
        if (!ttsReady) {
            next();
            return;
        }
        tts.setAudioAttributes(attrs(alarm));
        if (tts.speak(text, TextToSpeech.QUEUE_ADD, new Bundle(), "v" + System.nanoTime()) != TextToSpeech.SUCCESS) next();
    }

    /** Приглушить музыку на время фразы. */
    @SuppressWarnings("deprecation")
    private void grab(boolean alarm) {
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focus == null)
                focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs(alarm)).build();
            am.requestAudioFocus(focus);
        } else am.requestAudioFocus(null, AudioManager.STREAM_NOTIFICATION, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
    }

    @SuppressWarnings("deprecation")
    private void release() {
        if (am == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            if (focus != null) am.abandonAudioFocusRequest(focus);
        } else am.abandonAudioFocus(null);
    }
}
