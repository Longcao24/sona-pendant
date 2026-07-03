#!/bin/bash
# Nuna server launcher. Sets up a venv (once), unpacks the model, runs uvicorn.
set -e
cd "$(dirname "$0")"

# torch has no wheels for Python 3.14 yet — pick a 3.10/3.11 if available.
PY=python3
for c in python3.11 python3.10 python3.12; do command -v $c >/dev/null 2>&1 && { PY=$c; break; }; done
echo "[nuna] using $($PY --version)"

if [ ! -d .venv ]; then
  echo "[nuna] creating venv…"
  $PY -m venv .venv
  ./.venv/bin/pip install --upgrade pip
  ./.venv/bin/pip install -r requirements.txt
fi

# Unpack the model next to the repo if not already extracted.
MODEL_DIR="${NUNA_MODEL_DIR:-../nuna_production_model}"
if [ ! -f "$MODEL_DIR/model.safetensors" ]; then
  echo "[nuna] extracting model…"
  unzip -o -q ../nuna_production_model.zip -d ..
  rm -rf ../__MACOSX
fi

HOST="${HOST:-0.0.0.0}"; PORT="${PORT:-8000}"
echo "[nuna] serving on http://$HOST:$PORT  (phone must reach this LAN IP)"
exec ./.venv/bin/uvicorn app:app --host "$HOST" --port "$PORT"
