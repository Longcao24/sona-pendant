/**
 * Sona Pendant — XIAO nRF52840 Sense Plus — BLE Audio Streamer (food-intake)
 *
 * Streams the onboard PDM mic over BLE as raw 16-bit PCM @ 16 kHz mono.
 * The phone app forwards these windows to the inference server (AST model)
 * to detect food-intake events. IMU is intentionally NOT used — audio only.
 *
 * Build: Seeed nRF52 Boards core, board = "Seeed XIAO nRF52840 Sense Plus"
 *        (FQBN Seeeduino:nrf52:xiaonRF52840SensePlus)
 *
 * BLE protocol:
 *   Service   19B10000-E8F2-537E-4F6C-D104768A1214
 *   Audio     19B10001  NOTIFY  244 bytes = 122 int16 samples (16 kHz mono)
 *   Control   19B10002  WRITE   1 byte  0x01=start stream  0x00=stop
 *                                       0x02=find-me (LED flash ~5 s)
 *   Adv name  "Nuna-Necklace"  (also advertises the service UUID)
 *
 * Throughput notes (16 kHz*16bit = 256 kbps, tight for BLE):
 *   - configPrphBandwidth(BANDWIDTH_MAX): MTU 247 + big notify queue
 *   - 2M PHY requested on connect: doubles raw BLE rate
 *   - notify() is retried (data kept in ring buffer) so nothing drops
 *
 * Power management (battery: hours -> days):
 *   - NAP MODE: while streaming, if audio stays quiet for SLEEP_AFTER_MS the
 *     pendant naps — PDM off, no BLE notifies (radio idle). Every NAP_CHECK_MS
 *     it listens for NAP_LISTEN_MS; sound above WAKE_MEANABS resumes streaming
 *     instantly. The app keeps working: no packets while quiet, stream resumes
 *     on the next bite/word.
 *   - TX power 0 dBm (pendant is <2 m from the phone; +4 wastes radio power)
 *   - conn LED handled manually + dim duty cycles; idle loop sleeps via delay()
 *     (FreeRTOS tickless idle -> SoC sleep between events)
 */

#include <bluefruit.h>
#include <PDM.h>

#define SAMPLE_RATE   16000
#define MIC_GAIN      64           // PDM analog gain 0..80 (default 20). 64 = a bit louder than stock, still clean.
                                   // 70+ and/or digital gain clipped loud samples -> harsh "rè" buzz. Keep ≤~66.
#define DIGITAL_GAIN  1.0f         // software gain AFTER PDM (hard-clipped to int16). 1.0 = OFF (no clipping).
#define PKT_SAMPLES   122          // 244 bytes = max notify @ MTU 247

// ── Power / nap tuning ───────────────────────────────────────────────────────
#define SLEEP_AFTER_MS  30000      // this long below LOUD_MEANABS -> nap
#define NAP_CHECK_MS     2000      // while napping, listen this often
#define NAP_LISTEN_MS     180      // listen window per check (incl. ~60 ms mic settle)
#define NAP_SETTLE_MS      60      // discard mic settling at each nap check
#define WAKE_MEANABS      240      // mean |sample| (int16) that counts as sound
#define LOUD_MEANABS      240      // same threshold used while streaming

// Ring buffer between PDM ISR (producer) and BLE loop (consumer).
#define RING_SIZE     8192         // power of 2; ~0.5 s cushion @ 16 kHz
#define RING_MASK     (RING_SIZE - 1)
static int16_t ring[RING_SIZE];
static volatile uint32_t ringHead = 0;   // written by PDM callback
static volatile uint32_t ringTail = 0;   // read by loop
static short pdmTemp[512];                // PDM.read scratch
static volatile int32_t warmup = 0;       // samples to drop after PDM.begin (mic settling "pop")

// ── Status LED (XIAO RGB, active-LOW: clear pin = ON) ────────────────────────
#define LED_RED   26   // P0.26 — streaming
#define LED_BLUE   6   // P0.06 — BLE: blink=advertising, solid(dim duty)=connected
static inline void redOn()   { NRF_P0->OUTCLR = (1UL << LED_RED); }
static inline void redOff()  { NRF_P0->OUTSET = (1UL << LED_RED); }
static inline void blueOn()  { NRF_P0->OUTCLR = (1UL << LED_BLUE); }
static inline void blueOff() { NRF_P0->OUTSET = (1UL << LED_BLUE); }

BLEService        audioSvc("19B10000-E8F2-537E-4F6C-D104768A1214");
BLECharacteristic audioChr("19B10001-E8F2-537E-4F6C-D104768A1214");
BLECharacteristic ctrlChr ("19B10002-E8F2-537E-4F6C-D104768A1214");
BLEBas            batSvc;   // standard Battery Service 0x180F / 0x2A19 (%)

// ── Battery (XIAO nRF52840: VBAT on P0.31 behind 1M/510k divider, enabled by
//    pulling P0.14 low; LiPo 3.3 V empty .. 4.2 V full) ────────────────────────
#ifndef PIN_VBAT
#define PIN_VBAT        32   // P0.31 / AIN7
#endif
#ifndef VBAT_ENABLE
#define VBAT_ENABLE     14   // P0.14, LOW = divider connected
#endif

static uint8_t readBatteryPct() {
  digitalWrite(VBAT_ENABLE, LOW);
  delayMicroseconds(200);                    // divider settle
  analogReference(AR_INTERNAL_2_4);          // 2.4 V ref
  analogReadResolution(12);
  uint32_t raw = analogRead(PIN_VBAT);
  digitalWrite(VBAT_ENABLE, HIGH);           // disconnect divider (saves ~4 µA)
  float v = raw * (2.4f / 4096.0f) * (1000.0f + 510.0f) / 510.0f;  // ≈ VBAT
  // LiPo discharge curve, piecewise linear (good enough for a UI gauge).
  float pct;
  if      (v >= 4.10f) pct = 100.0f;
  else if (v >= 3.90f) pct = 80.0f + (v - 3.90f) * 100.0f;   // 3.90-4.10 -> 80-100
  else if (v >= 3.70f) pct = 40.0f + (v - 3.70f) * 200.0f;   // 3.70-3.90 -> 40-80
  else if (v >= 3.50f) pct = 10.0f + (v - 3.50f) * 150.0f;   // 3.50-3.70 -> 10-40
  else if (v >= 3.30f) pct = (v - 3.30f) * 50.0f;            // 3.30-3.50 -> 0-10
  else                 pct = 0.0f;
  return (uint8_t)(pct + 0.5f);
}

volatile bool recording = false;   // phone pressed Start (master switch)
static bool napping = false;       // quiet too long -> radio+mic resting
static uint32_t lastLoudMs = 0;
static uint32_t lastNapCheckMs = 0;
static volatile uint32_t findMeUntil = 0;   // millis deadline for find-me LED flash

// ── PDM data callback (called from PDM IRQ) ──────────────────────────────────
void onPDMdata() {
  int bytes = PDM.available();
  if (bytes <= 0) return;
  if (bytes > (int)sizeof(pdmTemp)) bytes = sizeof(pdmTemp);
  PDM.read(pdmTemp, bytes);
  int n = bytes / 2;
  int i = 0;
  // Drop the mic's startup transient (DC settling thump) before storing.
  if (warmup > 0) {
    int drop = (n < warmup) ? n : warmup;
    warmup -= drop;
    i = drop;
  }
  uint32_t h = ringHead;
  for (; i < n; i++) {
    // Software gain with saturation (avoids int16 wrap-around on loud peaks).
    int32_t v = (int32_t)(pdmTemp[i] * DIGITAL_GAIN);
    if (v >  32767) v =  32767;
    else if (v < -32768) v = -32768;
    ring[(h++) & RING_MASK] = (int16_t)v;
  }
  ringHead = h;
}

static void micStart(int32_t settleSamples) {
  ringHead = ringTail = 0;
  warmup = settleSamples;
  PDM.setGain(MIC_GAIN);
  PDM.begin(1, SAMPLE_RATE);       // 1 channel (mono)
}

// ── BLE control: start / stop streaming ──────────────────────────────────────
void onCtrlWrite(uint16_t, BLECharacteristic*, uint8_t* data, uint16_t len) {
  if (len < 1) return;
  if (data[0] == 0x01 && !recording) {
    recording = true;
    napping = false;
    lastLoudMs = millis();
    micStart(SAMPLE_RATE / 7);     // drop ~140 ms of mic-settling samples (kills "bụp" pop)
  } else if (data[0] == 0x00 && recording) {
    recording = false;
    napping = false;
    PDM.end();
  } else if (data[0] == 0x02) {
    findMeUntil = millis() + 5000;   // "find me": flash LEDs for 5 s
  }
}

void onConnect(uint16_t handle) {
  BLEConnection* c = Bluefruit.Connection(handle);
  if (c) {
    c->requestPHY(BLE_GAP_PHY_2MBPS);       // double throughput if phone supports it
    c->requestMtuExchange(247);
    c->requestConnectionParameter(6);       // 7.5 ms interval = max packets/sec
  }
}

void onDisconnect(uint16_t, uint8_t) {
  if (recording) { recording = false; napping = false; PDM.end(); }
}

// Mean |sample| of everything currently in the ring (and drain it).
static uint32_t drainMeanAbs() {
  uint32_t h = ringHead, t = ringTail;
  uint32_t n = h - t;
  if (n == 0) return 0;
  uint64_t acc = 0;
  for (uint32_t i = 0; i < n; i++) {
    int16_t v = ring[(t + i) & RING_MASK];
    acc += (v < 0) ? -v : v;
  }
  ringTail = h;
  return (uint32_t)(acc / n);
}

// ── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  NRF_P0->DIRSET = (1UL << LED_RED) | (1UL << LED_BLUE);
  redOff(); blueOff();

  Bluefruit.configPrphBandwidth(BANDWIDTH_MAX);   // before begin(): MTU 247 + big queue
  Bluefruit.begin();
  Bluefruit.autoConnLed(false);   // we drive LEDs ourselves (saves ~1 mA)
  Bluefruit.setName("Nuna-Necklace");
  Bluefruit.setTxPower(0);        // 0 dBm plenty for on-body -> phone-in-hand
  Bluefruit.Periph.setConnectCallback(onConnect);
  Bluefruit.Periph.setDisconnectCallback(onDisconnect);

  audioSvc.begin();

  audioChr.setProperties(CHR_PROPS_NOTIFY);
  audioChr.setPermission(SECMODE_OPEN, SECMODE_NO_ACCESS);
  audioChr.setFixedLen(PKT_SAMPLES * 2);
  audioChr.begin();

  ctrlChr.setProperties(CHR_PROPS_WRITE);
  ctrlChr.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  ctrlChr.setFixedLen(1);
  ctrlChr.setWriteCallback(onCtrlWrite);
  ctrlChr.begin();

  pinMode(VBAT_ENABLE, OUTPUT);
  digitalWrite(VBAT_ENABLE, HIGH);
  batSvc.begin();
  batSvc.write(readBatteryPct());

  PDM.onReceive(onPDMdata);

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(audioSvc);
  Bluefruit.ScanResponse.addName();
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(32, 244);  // fast 20ms -> slow 152.5ms after 30s
  Bluefruit.Advertising.start(0);
}

// ── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  // Battery: refresh every 60 s (notifies subscribed phones automatically).
  static uint32_t lastBat = 0;
  if (now - lastBat >= 60000) {
    lastBat = now;
    batSvc.write(readBatteryPct());
  }

  // Status LED (duty-cycled — solid LEDs burn ~1 mA each)
  static uint32_t lastBlink = 0;
  static bool blinkState = false;
  if (now < findMeUntil) {
    // find-me: loud alternating flash overrides everything
    bool ph = (now % 250) < 125;
    ph ? redOn() : redOff();
    ph ? blueOff() : blueOn();
  } else if (recording && !napping) {
    blueOff();
    // streaming: red at 10% duty (30 ms on / 270 ms off) instead of solid
    redOn(); if ((now % 300) > 30) redOff();
  } else if (napping) {
    redOff(); blueOff();
    if ((now % 5000) < 40) blueOn();   // alive blip every 5 s
  } else {
    redOff();
    if (Bluefruit.connected()) {
      // connected idle: blue blip every 3 s
      ((now % 3000) < 40) ? blueOn() : blueOff();
    } else if (now - lastBlink > 300) {
      lastBlink = now;
      blinkState = !blinkState;
      blinkState ? blueOn() : blueOff();
    }
  }

  if (!recording) { delay(20); return; }   // idle: FreeRTOS tickless -> SoC sleep

  // ── NAP MODE: quiet too long -> mic+radio rest, periodic listen ───────────
  if (napping) {
    if (now - lastNapCheckMs >= NAP_CHECK_MS) {
      lastNapCheckMs = now;
      micStart((SAMPLE_RATE * NAP_SETTLE_MS) / 1000);
      delay(NAP_LISTEN_MS);
      uint32_t level = drainMeanAbs();
      if (level >= WAKE_MEANABS) {
        // Sound! resume streaming (keep mic running, just clear the ring so
        // the stream starts clean).
        napping = false;
        lastLoudMs = now;
        ringHead = ringTail = 0;
      } else {
        PDM.end();                 // back to rest
      }
    }
    delay(10);
    return;
  }

  // ── Streaming: drain ring in 122-sample packets, track loudness ───────────
  static int16_t pkt[PKT_SAMPLES];
  while ((uint32_t)(ringHead - ringTail) >= PKT_SAMPLES) {
    uint32_t t = ringTail;
    uint32_t acc = 0;
    for (uint16_t i = 0; i < PKT_SAMPLES; i++) {
      int16_t v = ring[(t + i) & RING_MASK];
      pkt[i] = v;
      acc += (v < 0) ? -v : v;
    }
    if (audioChr.notify((uint8_t*)pkt, PKT_SAMPLES * 2)) {
      ringTail = t + PKT_SAMPLES;
      if (acc / PKT_SAMPLES >= LOUD_MEANABS) lastLoudMs = now;
    } else {
      break;                       // BLE queue full; send the rest next loop
    }
  }

  // Quiet for SLEEP_AFTER_MS -> nap (PDM off, no notifies, radio idles).
  if (now - lastLoudMs > SLEEP_AFTER_MS) {
    napping = true;
    lastNapCheckMs = 0;            // check immediately on first nap loop
    PDM.end();
  }
}
