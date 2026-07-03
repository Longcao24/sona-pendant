"""Audio decoding helpers — no torch/transformers, so unit-testable standalone."""
import io
import wave
from functools import lru_cache

import numpy as np
from scipy.signal import butter, lfilter

TARGET_SR = 16000


@lru_cache(maxsize=4)
def _bandpass_coeffs(sr: int):
    nyq = 0.5 * sr
    return butter(5, [100.0 / nyq, 7500.0 / nyq], btype="band")


def apply_light_conditioning(y: np.ndarray, sr: int = TARGET_SR) -> np.ndarray:
    """EXACT copy of the training/inference conditioning in app1.py — must match
    or the model sees a different distribution. Bandpass 100–7500 Hz, then
    z-score, then peak-normalize to [-1, 1]."""
    b, a = _bandpass_coeffs(sr)
    y_filtered = lfilter(b, a, y)
    std = np.std(y_filtered)
    y_norm = (y_filtered - np.mean(y_filtered)) / std if std > 0 else y_filtered
    max_val = np.max(np.abs(y_norm))
    return (y_norm / max_val if max_val > 0 else y_norm).astype(np.float32)


def resample_linear(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    """Cheap linear resample. The necklace already streams 16k, so this only
    fires for oddball uploads."""
    if sr_in == sr_out:
        return x
    n_out = int(round(len(x) * sr_out / sr_in))
    if n_out <= 1:
        return x
    xp = np.linspace(0.0, 1.0, num=len(x), endpoint=False)
    fp = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    return np.interp(fp, xp, x).astype(np.float32)


def decode_wav(data: bytes, target_sr: int = TARGET_SR) -> np.ndarray:
    """WAV bytes -> mono float32 [-1,1] at target_sr. Handles 8/16/32-bit PCM."""
    with wave.open(io.BytesIO(data), "rb") as w:
        n_ch = w.getnchannels()
        width = w.getsampwidth()
        sr = w.getframerate()
        frames = w.readframes(w.getnframes())
    if width == 2:
        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 1:
        samples = (np.frombuffer(frames, dtype="u1").astype(np.float32) - 128.0) / 128.0
    elif width == 4:
        samples = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"unsupported sample width {width}")
    if n_ch > 1:
        samples = samples.reshape(-1, n_ch).mean(axis=1)
    return resample_linear(samples, sr, target_sr)


def decode_pcm16(data: bytes) -> np.ndarray:
    """Raw int16 LE 16 kHz mono -> float32 [-1,1]. The BLE stream as-is."""
    n = len(data) - (len(data) % 2)
    return np.frombuffer(data[:n], dtype="<i2").astype(np.float32) / 32768.0
