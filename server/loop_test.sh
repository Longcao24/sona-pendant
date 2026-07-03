#!/bin/bash
# End-to-end loop test: waits for deps+model, boots the server, sends the real
# 15s board capture (/tmp/nuna_capture.pcm) through the exact app contract
# (base64 PCM -> POST /classify_b64), prints the classification.
set -u
cd "$(dirname "$0")"
PY=./.venv/bin/python
LOG=/tmp/nuna_uvicorn.log
PCM=/tmp/nuna_capture.pcm

echo "[test] waiting for deps + model to finish installing…"
for i in $(seq 1 180); do
  if [ -f ../nuna_production_model/model.safetensors ] \
     && $PY -c "import torch, transformers, fastapi" >/dev/null 2>&1; then
    echo "[test] deps ready (after ${i}0s max)"; break
  fi
  sleep 10
done
if ! $PY -c "import torch, transformers, fastapi" >/dev/null 2>&1; then
  echo "[test] FAIL: deps still not importable"; exit 1
fi
if [ ! -f ../nuna_production_model/model.safetensors ]; then
  echo "[test] FAIL: model not unpacked"; exit 1
fi

echo "[test] starting uvicorn (loads model — first boot ~20-40s on CPU)…"
$PY -m uvicorn app:app --host 127.0.0.1 --port 8000 >"$LOG" 2>&1 &
SRV=$!
echo "[test] uvicorn pid=$SRV, log=$LOG"

# wait for /health (only responds once the model is loaded)
UP=0
for i in $(seq 1 60); do
  if curl -s -m 3 http://127.0.0.1:8000/health >/dev/null 2>&1; then UP=1; break; fi
  # bail early if server died
  kill -0 $SRV 2>/dev/null || { echo "[test] server exited early:"; tail -20 "$LOG"; exit 1; }
  sleep 2
done
[ "$UP" = 1 ] || { echo "[test] FAIL: /health never came up"; tail -20 "$LOG"; kill $SRV; exit 1; }

echo "[test] === /health ==="; curl -s http://127.0.0.1:8000/health; echo
echo "[test] === /labels ==="; curl -s http://127.0.0.1:8000/labels; echo

echo "[test] === /classify_b64 (real board audio, app contract) ==="
$PY - "$PCM" <<'PYEOF'
import sys, base64, json, urllib.request
pcm = open(sys.argv[1], "rb").read()
print(f"[test] sending {len(pcm)} bytes = {len(pcm)//2/16000:.1f}s PCM")
body = json.dumps({"pcm_b64": base64.b64encode(pcm).decode()}).encode()
req = urllib.request.Request(
    "http://127.0.0.1:8000/classify_b64", data=body,
    headers={"Content-Type": "application/json"},
)
import time
t0 = time.time()
resp = json.load(urllib.request.urlopen(req, timeout=60))
print(f"[test] round-trip {(time.time()-t0)*1000:.0f} ms")
print(json.dumps(resp, indent=2))
PYEOF

echo "[test] === simulate real-time loop: 4 rolling calls ==="
$PY - "$PCM" <<'PYEOF'
import sys, base64, json, urllib.request, time
pcm = open(sys.argv[1], "rb").read()
SR2 = 16000*2
for k in range(4):
    # take progressively later 8s slices to mimic the sliding window
    start = min(k*2*SR2, max(0, len(pcm)-8*SR2))
    seg = pcm[start:start+8*SR2] or pcm
    body = json.dumps({"pcm_b64": base64.b64encode(seg).decode()}).encode()
    req = urllib.request.Request("http://127.0.0.1:8000/classify_b64", data=body,
                                 headers={"Content-Type": "application/json"})
    t0=time.time(); r=json.load(urllib.request.urlopen(req, timeout=60))
    print(f"  tick {k}: {r['top']['label']:>12}  {r['top']['prob']:.2f}  eating={r['eating']}  {r['ms']}ms server  {(time.time()-t0)*1000:.0f}ms rt")
PYEOF

echo "[test] leaving server running (pid=$SRV) on http://127.0.0.1:8000"
echo "[test] DONE"
