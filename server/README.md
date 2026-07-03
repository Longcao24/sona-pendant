# Nuna food-intake server

FastAPI wrapper around the AST (Audio Spectrogram Transformer) classifier in
`nuna_production_model/`. The mobile app streams mic audio from the necklace
over BLE, forwards ~3 s windows here, and gets back a food-intake label.

## Model

- `ASTForAudioClassification`, 6 classes, 16 kHz mono input, 128-mel spectrogram.
- The checkpoint only stores `LABEL_0..LABEL_5` — the human meaning of each class
  is **not** in the model. Put the real names in `labels.json` (see below).

## Run

```bash
cd server
./run.sh                 # creates .venv, installs deps, unpacks model, serves :8000
```

`run.sh` prefers `python3.11`/`3.10` — **torch has no Python 3.14 wheels yet**, so
a 3.14-only machine will fail to install torch. Install 3.11 (`brew install python@3.11`)
if `run.sh` can't find an older interpreter.

Manual:

```bash
python3.11 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
unzip -o ../nuna_production_model.zip -d ..        # -> ../nuna_production_model/
./.venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
```

The phone must reach the server over the LAN, so bind `0.0.0.0` and point the app's
`app/constants/config.ts` `SERVER_URL` at your machine's IP (`ipconfig getifaddr en0`).

## Endpoints

| Method | Path            | Body                                   | Purpose |
|--------|-----------------|----------------------------------------|---------|
| GET    | `/health`       | —                                      | liveness + label map + device |
| GET    | `/labels`       | —                                      | current class names / eating flags |
| POST   | `/classify`     | multipart field `audio` = WAV          | classify a WAV file |
| POST   | `/classify_pcm` | raw int16 LE 16 kHz mono PCM bytes     | classify the raw BLE stream |
| POST   | `/classify_b64` | JSON `{"pcm_b64": "<base64 PCM16>"}`   | same, base64 — **the app uses this** (RN can't send a raw binary fetch body) |

Response:

```json
{
  "top":   { "index": 0, "label": "Chewing", "prob": 0.97 },
  "probs": { "Chewing": 0.97, "Drinking": 0.01, "...": 0.0 },
  "eating": true,
  "n_samples": 48000,
  "seconds": 3.0,
  "ms": 41.2
}
```

## Real-time / long windows

The checkpoint caps at `max_length 1024` frames ≈ **10.24 s**. The app streams a
rolling **15 s** window and classifies ~once/sec. To use the whole 15 s (not just
the oldest 10 s that the extractor would keep), `classify()` splits audio > 10 s
into overlapping 10 s windows (5 s hop) and **mean-pools the softmax** — the
response's `n_windows` shows how many were fused. Tune `WIN_SEC`/`HOP_SEC` in
`app.py`; window length + refresh rate live in `app/app/(tabs)/detect.tsx`.

## labels.json

```json
{ "classes": { "0": { "name": "Chewing", "eating": true }, ... } }
```

Ships with **placeholder** names. Replace each `name` with the model's real class,
and set `eating: true` for food-intake classes (drives the app's "eating" indicator).
Only affects display/labels — never the model's math.

Env overrides: `NUNA_MODEL_DIR`, `NUNA_LABELS`, `PORT`, `HOST`.

## Test

```bash
python test_client.py http://localhost:8000 rec.wav   # or no file -> synthetic tone
```

`audio_utils.py` (WAV/PCM decode, resample) is torch-free and unit-testable on its own.
