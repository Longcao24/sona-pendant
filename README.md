# Sona — Food-Intake Sensing Pendant

Necklace pendant (XIAO nRF52840 Sense) streams mic audio over BLE to the phone app,
which sends it to an AI server (AST model, 8 classes) that detects what you're doing:
**Silence · Apple · Carrot · Cookie · Potato chips · Peanut · Talking · Drinking**.

```
[Pendant mic] --BLE 16kHz PCM--> [Android app] --HTTP--> [FastAPI + AST model] --> label
```

| Part | Where |
|---|---|
| Firmware | `firmware/xiao_audio_ble/` (flashed via double-tap bootloader) |
| Android app | `app/` (Expo RN; release APK: `app/android/app/build/outputs/apk/release/`) |
| Server | `server/app.py` (FastAPI + torch) |
| Model | `nuna_production_model_with_weighted_loss_16_20/` (8-class AST) |

---

## Demo — quick start

### Option A: local server (real-time, ~0.4 s — RECOMMENDED for demo)

Phone and laptop **must be on the same Wi-Fi**.

1. **Start the server + get the URL** — one command (on this Mac):
   ```bash
   ./server/demo.sh
   ```
   It prints the exact URL to put in the app (e.g. `http://192.168.0.138:8000`),
   then starts the server. ⚠️ The IP changes when you switch Wi-Fi networks —
   just re-run the script at every new venue.

2. **Point the app at it**: app → **Settings → Detection Server** → enter the
   printed URL → **Test** (must say Connected) → **Save**.

3. **Demo**: power the pendant (blue LED blinks) → app auto-finds it → **Connect**
   → Detect tab → **Start** → eat/talk/drink. Label updates every ~1–3 s.
   Activities log into the **Events** tab.

### Option B: cloud server (works anywhere, slower ~12 s/update)

No laptop needed. Free Hugging Face Space, already deployed:

- URL for the app: **`https://hoanglong2003-nuna-food-intake.hf.space`**
- Space page/logs: https://huggingface.co/spaces/Hoanglong2003/nuna-food-intake

Put that URL in **Settings → Detection Server → Test → Save**. Notes:
- Free CPU tier → ~10–12 s per prediction (fine for showing it works, not real-time).
- Space **sleeps after ~48 h idle**: first request takes ~1 min to wake. Before a demo,
  open the `/health` URL in a browser once to warm it up:
  `https://hoanglong2003-nuna-food-intake.hf.space/health`

Redeploy after server/model changes:
```bash
cd server
HF_TOKEN=hf_xxx .venv/bin/python deploy_hf/deploy.py   # write-scope token from hf.co/settings/tokens
```

---

## Demo checklist (print this)

- [ ] Pendant charged, powers on (blue LED blinking)
- [ ] Phone Bluetooth ON, Location ON (Android needs it for BLE scan)
- [ ] Local demo: laptop + phone on same Wi-Fi, `./server/demo.sh` running (prints the URL)
- [ ] Cloud demo: Space warmed up (`/health` opened once)
- [ ] App Settings → Test says **Connected**
- [ ] Props: apple / carrot / cookie / chips / peanuts / a drink

## Troubleshooting

| Symptom | Fix |
|---|---|
| App: "Network request failed" | Wrong IP or different Wi-Fi. Re-run `./server/demo.sh`, update Settings with the new URL. |
| Test times out on cloud URL | Space asleep — open `/health` in browser, wait ~1 min, retry. |
| Pendant not found | Power-cycle pendant; check Bluetooth + Location on phone; "Scan again". |
| Everything reads "Quiet" | Pendant mic too far from mouth/food — wear at chest height. |
| Label flickers/wrong | Sounds must be ≥3 s; label needs 2 agreeing ticks to switch (by design). |
| Server won't start | `cd server && .venv/bin/python app.py` — venv has torch; plain `python3` does not. |

## Endpoints (server)

- `GET /health` — status + labels
- `POST /classify_b64` — `{"pcm_b64": "<base64 int16 LE 16 kHz mono>"}` (what the app uses)
- `POST /classify` — multipart WAV upload
- `POST /classify_pcm` — raw int16 PCM body
