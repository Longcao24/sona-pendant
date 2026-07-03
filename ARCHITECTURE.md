# Nuna — audio food-intake detection

End-to-end system: a mic necklace streams audio over BLE to the phone, the phone
forwards windows to a server, the server runs an AST classifier and returns the
food-intake activity. **No IMU** — the insole / accelerometer path was removed.

```
┌────────────────────┐   BLE (16 kHz PCM)   ┌──────────────┐   HTTP (raw PCM)   ┌──────────────────┐
│ Nuna Necklace      │  ───────────────────▶│ Mobile app   │ ─────────────────▶ │ FastAPI server   │
│ XIAO nRF52840 Sense│   notify 244 B pkts  │ (Expo/RN)    │  POST /classify_b64│ AST classifier   │
│ PDM mic + Bluefruit│◀──────────────────── │ Detect tab   │ ◀───────────────── │ 6-class softmax   │
└────────────────────┘   0x01/0x00 control  └──────────────┘   {label, eating}  └──────────────────┘
```

## Components

### 1. Firmware — `firmware/xiao_audio_ble/xiao_audio_ble.ino`
- XIAO nRF52840 Sense Plus, Seeed nRF52 core, Bluefruit BLE.
- Onboard PDM mic → 16 kHz mono int16, streamed over BLE with a ring buffer +
  notify-retry so nothing drops. 2M PHY + MTU 247 for throughput.
- **IMU deleted** (`LSM6DS3`, char `19B10003`, accel/gyro loop all gone).
- Advertises as **`Nuna-Necklace`**.
- BLE protocol:
  | | UUID | Props | Payload |
  |-|------|-------|---------|
  | Service | `19B10000-…` | | |
  | Audio   | `19B10001-…` | NOTIFY | 244 B = 122×int16 PCM @16 kHz |
  | Control | `19B10002-…` | WRITE  | 1 B: `0x01` start, `0x00` stop |
- Flash notes in `firmware/HARDWARE.md` (SoftDevice restore, `0x27000`, UF2 write).

### 2. Server — `server/`
- FastAPI + transformers loading `nuna_production_model` (ASTForAudioClassification).
- `POST /classify_pcm` takes the raw BLE int16 stream; `POST /classify` takes WAV.
- Returns top label, per-class probs, and an `eating` bool.
- Class names live in `server/labels.json` (checkpoint only has `LABEL_0..5` — set
  the real names there). See `server/README.md`.

### 3. App — `app/` (Expo / react-native-ble-plx)
- `Record` tab: raw capture + WAV (debug/collection).
- `Detect` tab: live streaming → server → shows current food-intake activity.
- BLE handled by `components/ble-provider.tsx` (audio role only now).
- Server address in `app/constants/config.ts` → set to your machine's LAN IP.
- BLE needs a dev build on a physical phone: `npx expo run:android` (see HARDWARE.md).

## Bring-up order
1. Flash `Nuna-Necklace` firmware (`flash/` UF2 or rebuild recipe in HARDWARE.md).
2. `cd server && ./run.sh` — note the LAN URL it prints.
3. Set `SERVER_URL` in `app/constants/config.ts` to that URL.
4. `cd app && npx expo run:android` on a physical phone; Scan → pick necklace → Detect → Start.
