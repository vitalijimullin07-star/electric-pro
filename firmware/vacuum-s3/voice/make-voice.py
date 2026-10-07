#!/usr/bin/env python3
"""
Голосовые сообщения пылесоса «S3» для карты плеера DFPlayer Mini: phrases.txt → mp3/0001.mp3…
Синтез — Piper (pip install piper-tts lameenc), голос — модель ru_RU-*-medium.onnx
(https://huggingface.co/rhasspy/piper-voices, папка ru/ru_RU). Строка N файла phrases.txt
(с 1) — фраза N = enum V_… в vac_core.h. Запуск:
  python3 make-voice.py путь/к/ru_RU-irina-medium.onnx [папка-вывода]
На карту microSD (FAT32) — папку mp3 целиком в корень.
"""
import io
import os
import sys
import wave

import lameenc
from piper import PiperVoice
from piper.config import SynthesisConfig

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    model = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'mp3')
    os.makedirs(out, exist_ok=True)
    voice = PiperVoice.load(model)
    cfg = SynthesisConfig(length_scale=0.95, noise_scale=0.5, noise_w_scale=0.6)
    lines = open(os.path.join(HERE, 'phrases.txt'), encoding='utf-8').read().splitlines()
    for n, text in enumerate(lines, 1):
        if not text.strip():
            continue
        buf = io.BytesIO()
        with wave.open(buf, 'wb') as w:
            voice.synthesize_wav(text, w, syn_config=cfg)
        buf.seek(0)
        with wave.open(buf, 'rb') as r:
            rate, ch, pcm = r.getframerate(), r.getnchannels(), r.readframes(r.getnframes())
        enc = lameenc.Encoder()
        enc.set_bit_rate(64)
        enc.set_in_sample_rate(rate)
        enc.set_channels(ch)
        enc.set_quality(2)
        mp3 = enc.encode(pcm) + enc.flush()
        # Тишина 0,15 с в начале у DFPlayer не нужна: Piper её уже даёт.
        with open(os.path.join(out, '%04d.mp3' % n), 'wb') as f:
            f.write(mp3)
        print('%04d.mp3  %5.1f с  %s' % (n, len(pcm) / 2 / rate / ch, text))


main()
