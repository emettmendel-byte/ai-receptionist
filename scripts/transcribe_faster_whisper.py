#!/usr/bin/env python3
"""
Transcribe an audio file with faster-whisper; print transcript only to stdout.
Args: <audio_path> [model_name]
Default model: small
"""
from __future__ import annotations

import sys


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: transcribe_faster_whisper.py <audio_path> [model]", file=sys.stderr)
        sys.exit(2)

    audio_path = sys.argv[1]
    model_size = sys.argv[2] if len(sys.argv) > 2 else "small"

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        print(f"faster_whisper import failed: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        model = WhisperModel(model_size, device="cpu", compute_type="int8")
        segments, _info = model.transcribe(audio_path)
        parts = [s.text for s in segments]
        text = "".join(parts).strip()
    except Exception as e:
        print(f"transcription error: {e}", file=sys.stderr)
        sys.exit(1)

    if not text:
        print("empty transcript", file=sys.stderr)
        sys.exit(1)

    print(text, end="")


if __name__ == "__main__":
    main()
