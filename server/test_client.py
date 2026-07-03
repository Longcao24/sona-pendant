"""Quick manual test: POST a WAV (or a synthetic tone) to a running server.

  python test_client.py http://localhost:8000 path/to/rec.wav
  python test_client.py http://localhost:8000            # sends a 3s tone
"""
import sys
import urllib.request
import wave
import io
import struct
import math


def tone_wav(seconds=3.0, sr=16000, freq=220.0) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = bytearray()
        for i in range(int(seconds * sr)):
            v = int(0.3 * 32767 * math.sin(2 * math.pi * freq * i / sr))
            frames += struct.pack("<h", v)
        w.writeframes(frames)
    return buf.getvalue()


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
    if len(sys.argv) > 2:
        data = open(sys.argv[2], "rb").read()
    else:
        data = tone_wav()

    boundary = "----nunaboundary"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="audio"; filename="a.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()

    req = urllib.request.Request(
        base.rstrip("/") + "/classify",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    print(urllib.request.urlopen(req).read().decode())


if __name__ == "__main__":
    main()
