"""
Nuna food-intake inference server.

Loads the AST (Audio Spectrogram Transformer) classifier shipped in
`nuna_production_model/` and exposes it over HTTP so the mobile app can send
audio windows captured from the necklace mic and get back a food-intake label.

Model facts (from config.json / preprocessor_config.json):
  - architecture: ASTForAudioClassification, 6 output classes
  - input:        16 kHz mono waveform -> 128-mel log spectrogram
  - normalize:    (x - (-4.2677393)) / 4.5689974   (done by the feature extractor)

Endpoints:
  GET  /health         -> {"ok": true, "model": ..., "labels": [...]}
  GET  /labels         -> label map
  POST /classify       -> multipart file field `audio` (WAV, ideally 16k mono 16-bit)
  POST /classify_pcm   -> raw body = int16 little-endian 16 kHz mono PCM
                          (exactly what the BLE audio characteristic streams;
                          lets the app skip building a WAV header)

Both classify endpoints return:
  {
    "top":   {"index": 0, "label": "Chewing", "prob": 0.97},
    "probs": {"Chewing": 0.97, "Drinking": 0.01, ...},
    "eating": true,          # convenience: top label is a food-intake class
    "n_samples": 48000,
    "seconds": 3.0,
    "ms": 41.2
  }
"""

import base64
import json
import os
import time
from collections import Counter
from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import torch
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from transformers import ASTFeatureExtractor, ASTForAudioClassification

from audio_utils import TARGET_SR, apply_light_conditioning, decode_pcm16, decode_wav

# ── Config ───────────────────────────────────────────────────────────────────
HERE = Path(__file__).resolve().parent
# Default = the real 8-class production model (matches app1.py's FOOD_TO_ID).
MODEL_DIR = Path(os.environ.get("NUNA_MODEL_DIR", HERE.parent / "nuna_production_model_with_weighted_loss_16_20"))
LABELS_PATH = Path(os.environ.get("NUNA_LABELS", HERE / "labels.json"))

DEVICE = (
    "cuda" if torch.cuda.is_available()
    else "mps" if torch.backends.mps.is_available()
    else "cpu"
)

# ── Load labels ──────────────────────────────────────────────────────────────
# labels.json maps class index -> {"name": display, "eating": bool}. It ships
# with PLACEHOLDER food-intake names — replace them with the model's real
# classes (see labels.json comment). Falls back to config.json id2label.
def load_labels() -> Tuple[Dict[int, str], Dict[int, bool]]:
    names: Dict[int, str] = {}
    eating: Dict[int, bool] = {}
    if LABELS_PATH.exists():
        raw = json.loads(LABELS_PATH.read_text())
        for k, v in raw.get("classes", {}).items():
            names[int(k)] = v.get("name", f"LABEL_{k}")
            eating[int(k)] = bool(v.get("eating", False))
    return names, eating


# ── Model load (once, at startup) ────────────────────────────────────────────
print(f"[nuna] loading model from {MODEL_DIR} on {DEVICE} ...")
_extractor = ASTFeatureExtractor.from_pretrained(str(MODEL_DIR))
_model = ASTForAudioClassification.from_pretrained(str(MODEL_DIR)).to(DEVICE).eval()

_cfg_id2label = {int(k): v for k, v in _model.config.id2label.items()}
_names, _eating = load_labels()
# merged view: prefer labels.json name, else config id2label
LABELS: Dict[int, str] = {i: _names.get(i, _cfg_id2label.get(i, f"LABEL_{i}")) for i in range(_model.config.num_labels)}
EATING: Dict[int, bool] = {i: _eating.get(i, False) for i in range(_model.config.num_labels)}
print(f"[nuna] labels: {LABELS}")

# Warmup: the first MPS/CUDA forward pays kernel-compile cost (~1-2s). Eat it
# at boot so the app's first classify isn't the slow one.
with torch.inference_mode():
    _wu = _extractor([np.zeros(int(3 * TARGET_SR), dtype=np.float32)],
                     sampling_rate=TARGET_SR, return_tensors="pt",
                     max_length=int(3 * TARGET_SR), truncation=True, padding="max_length")
    _model(_wu.input_values.to(DEVICE))
print("[nuna] warmup done")


# ── Inference (mirrors app1.py) ──────────────────────────────────────────────
# Pipeline copied from the reference app1.py so behavior matches training:
#   condition whole clip -> 3s chunks @ 1.5s step -> per-chunk argmax
#   -> Carrot==Apple merge -> majority vote across chunks.
CHUNK_SEC = float(os.environ.get("NUNA_CHUNK_SEC", 3.0))
STEP_SEC = float(os.environ.get("NUNA_STEP_SEC", 1.5))
CHUNK_SAMPLES = int(CHUNK_SEC * TARGET_SR)
STEP_SAMPLES = int(STEP_SEC * TARGET_SR)

# MIN_RMS: below this the clip is "quiet" (no sound). CONF_THRESHOLD: min vote
# fraction to call the majority "confident". PROB_THRESHOLD: per-chunk merged
# softmax max below this -> chunk votes "Unknown" (light open-set guard on top
# of app1.py's plain argmax; the 8-class model covers Talking/Drinking, so this
# only rejects genuinely ambiguous chunks).
MIN_RMS = float(os.environ.get("NUNA_MIN_RMS", 0.0012))
CONF_THRESHOLD = float(os.environ.get("NUNA_CONF", 0.5))
PROB_THRESHOLD = float(os.environ.get("NUNA_PROB", 0.5))
# A chunk this confident overrides the energy gate — real speech/chewing through
# the pendant is often low-RMS, and silencing it made the UI disagree with the
# probability bars (bars said Talking, circle said Silence).
STRONG_PROB = float(os.environ.get("NUNA_STRONG", 0.85))

# app1.py's eating rule: everything EXCEPT these counts as food intake.
NON_EATING = {"Silence", "Talking", "Drinking"}

# Classes force-zeroed after softmax (model over-predicts them on this mic).
# Comma-separated env override, e.g. NUNA_DISABLE="Peanut,Cookie".
DISABLED = {s.strip() for s in os.environ.get("NUNA_DISABLE", "Peanut,Cookie").split(",") if s.strip()}


def _merge(label: str) -> str:
    # app1.py collapses Carrot into Apple.
    return "Apple" if label in ("Carrot", "Apple") else label


@torch.inference_mode()
def classify(wave_f32: np.ndarray) -> dict:
    t0 = time.time()
    if wave_f32.size == 0:
        raise ValueError("empty audio")

    # Quiet gate on the ORIGINAL audio (before conditioning normalizes level).
    rms = float(np.sqrt(np.mean(wave_f32.astype(np.float64) ** 2)))
    quiet = rms < MIN_RMS

    # Same conditioning as training (bandpass + z-score + peak-normalize).
    y = apply_light_conditioning(wave_f32, TARGET_SR)

    # 3s chunks @ 1.5s step (pad-to-chunk if the clip is shorter).
    if y.shape[0] < CHUNK_SAMPLES:
        starts = [0]
        chunks = [y]
    else:
        starts = list(range(0, y.shape[0] - CHUNK_SAMPLES + 1, STEP_SAMPLES))
        chunks = [y[s : s + CHUNK_SAMPLES] for s in starts]

    # Per-chunk energy on the RAW audio. Conditioning z-scores each clip, so a
    # near-silent chunk gets amplified to full scale and the model classifies
    # loud garbage — gate those chunks to Silence instead.
    chunk_rms = [
        float(np.sqrt(np.mean(wave_f32[s : s + CHUNK_SAMPLES].astype(np.float64) ** 2)))
        for s in starts
    ]

    inputs = _extractor(
        [c for c in chunks], sampling_rate=TARGET_SR, return_tensors="pt",
        max_length=CHUNK_SAMPLES, truncation=True, padding="max_length",
    )
    logits = _model(inputs.input_values.to(DEVICE)).logits      # [n_chunks, C]
    chunk_probs = torch.softmax(logits, dim=1).float().cpu().numpy()
    # Zero disabled classes and renormalize so they can never win a vote.
    for i, name in LABELS.items():
        if name in DISABLED:
            chunk_probs[:, i] = 0.0
    row_sums = chunk_probs.sum(axis=1, keepdims=True)
    chunk_probs = chunk_probs / np.clip(row_sums, 1e-9, None)
    mean_probs = chunk_probs.mean(axis=0)                       # avg distribution

    # Per-chunk winner -> merged label -> majority vote (app1.py logic), with an
    # open-set twist: a chunk whose max softmax is below PROB_THRESHOLD votes
    # "Unknown" — the 6-class model can't say Talking/Drinking, so uncertain
    # chunks must not masquerade as food.
    def _chunk_vote(p: np.ndarray, rms_c: float) -> str:
        # Merge first (Carrot prob folds into Apple), then threshold — a chunk
        # split 0.5 Apple / 0.4 Carrot is really 0.9 "Apple", not two weak votes.
        acc: Dict[str, float] = {}
        for i, pi in enumerate(p):
            m = _merge(LABELS[i])
            acc[m] = acc.get(m, 0.0) + float(pi)
        lab, prob = max(acc.items(), key=lambda kv: kv[1])
        # Energy gate: near-silent chunks vote Silence — UNLESS the model is
        # very sure it heard something (quiet talking/chewing is real).
        if rms_c < MIN_RMS and not (lab != "Silence" and prob >= STRONG_PROB):
            return "Silence"
        return lab if prob >= PROB_THRESHOLD else "Unknown"

    votes = Counter(_chunk_vote(p, r) for p, r in zip(chunk_probs, chunk_rms))
    # Majority vote decides — the votes already encode the energy gate, so the
    # whole-clip quiet flag no longer overrides them (it made the hero circle
    # contradict the probability bars).
    maj_label = votes.most_common(1)[0][0]
    quiet = quiet and maj_label == "Silence"
    n = len(chunks)
    vote_frac = votes.get(maj_label, 0) / n if n else 0.0
    confident = (not quiet) and (maj_label != "Unknown") and (vote_frac >= CONF_THRESHOLD)

    # Representative index for the majority label (first id whose merged name matches).
    top_idx = next((i for i in LABELS if _merge(LABELS[i]) == maj_label), 0)

    # Per-class probs for the UI, merged (Carrot folded into Apple).
    merged: Dict[str, float] = {}
    for i, p in enumerate(mean_probs):
        merged[_merge(LABELS[i])] = merged.get(_merge(LABELS[i]), 0.0) + float(p)

    eating = (maj_label not in NON_EATING) and confident
    return {
        "top": {"index": int(top_idx), "label": maj_label, "prob": round(vote_frac, 4)},
        "probs": {k: round(v, 4) for k, v in sorted(merged.items(), key=lambda x: -x[1])},
        "eating": eating,
        "confident": confident,
        "quiet": quiet,
        "rms": round(rms, 4),
        "n_chunks": n,
        "votes": dict(votes),
        "seconds": round(wave_f32.size / TARGET_SR, 3),
        "ms": round((time.time() - t0) * 1000, 1),
    }


# ── HTTP app ─────────────────────────────────────────────────────────────────
app = FastAPI(title="Nuna food-intake server", version="1.0.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.get("/health")
def health():
    return {"ok": True, "model": str(MODEL_DIR), "device": DEVICE, "labels": LABELS}


@app.get("/labels")
def labels():
    return {"classes": {i: {"name": LABELS[i], "eating": EATING[i]} for i in LABELS}}


@app.post("/reload_labels")
def reload_labels():
    """Re-read labels.json without restarting (calibrate.py calls this)."""
    global LABELS, EATING
    n, e = load_labels()
    LABELS = {i: n.get(i, _cfg_id2label.get(i, f"LABEL_{i}")) for i in range(_model.config.num_labels)}
    EATING = {i: e.get(i, False) for i in range(_model.config.num_labels)}
    return {"labels": LABELS, "eating": EATING}


@app.post("/classify")
async def classify_wav(audio: UploadFile = File(...)):
    data = await audio.read()
    try:
        wav = decode_wav(data)
    except Exception as e:
        return JSONResponse({"error": f"bad wav: {e}"}, status_code=400)
    return classify(wav)


@app.post("/classify_pcm")
async def classify_pcm(request: Request):
    data = await request.body()
    if not data:
        return JSONResponse({"error": "empty body"}, status_code=400)
    return classify(decode_pcm16(data))


@app.post("/classify_b64")
async def classify_b64(payload: dict):
    """JSON { "pcm_b64": "<base64 int16 LE 16k mono>" }. The app uses this because
    React Native's fetch can't reliably send a raw binary body, but it always has
    base64 (btoa/atob polyfilled by Expo)."""
    b64 = payload.get("pcm_b64")
    if not b64:
        return JSONResponse({"error": "missing pcm_b64"}, status_code=400)
    try:
        raw = base64.b64decode(b64, validate=True)   # validate: junk chars -> error, not silently empty
    except Exception as e:
        return JSONResponse({"error": f"bad base64: {e}"}, status_code=400)
    if len(raw) < 2:
        return JSONResponse({"error": "empty audio"}, status_code=400)
    return classify(decode_pcm16(raw))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 8000)))
