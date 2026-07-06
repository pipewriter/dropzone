#!/usr/bin/env python3
"""Transcribe an audio file with faster-whisper. Prints JSON to stdout.

Usage: transcribe.py /path/to/audio
Run with the whisper venv python (~/.local/whisper-env/bin/python).
"""
import json
import os
import sys

from faster_whisper import WhisperModel

MODEL_SIZE = os.environ.get("WHISPER_MODEL", "small")


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: transcribe.py <audio-file>"}))
        sys.exit(2)

    audio_path = sys.argv[1]
    model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
    segments, info = model.transcribe(audio_path)
    text = " ".join(s.text.strip() for s in segments)
    print(json.dumps({
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "text": text,
    }))


if __name__ == "__main__":
    main()
