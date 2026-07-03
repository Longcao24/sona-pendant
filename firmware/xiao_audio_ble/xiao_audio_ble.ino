/**
 * Nuna Necklace — XIAO nRF52840 Sense Plus — BLE Audio Streamer (food-intake)
 *
 * Streams the onboard PDM mic over BLE as raw 16-bit PCM @ 16 kHz mono.
 * The phone app forwards these windows to the Nuna FastAPI server, which runs
 * the AST audio-classification model to detect food-intake events (chewing,
 * drinking, swallowing, …). IMU is intentionally NOT used — audio only.
 *
 * Build: Seeed nRF52 Boards core, board = "Seeed XIAO nRF52840 Sense Plus"
 *        (FQBN Seeeduino:nrf52:xiaonRF52840SensePlus)
 *
 * BLE protocol:
 *   Service   19B10000-E8F2-537E-4F6C-D104768A1214
 *   Audio     19B10001  NOTIFY  244 bytes = 122 int16 samples (16 kHz mono)
 *   Control   19B10002  WRITE   1 byte  0x01=start stream  0x00=stop
 *   Adv name  "Nuna-Necklace"  (also advertises the service UUID)
 *
 * Throughput notes (16 kHz*16bit = 256 kbps, tight for BLE):
 *   - configPrphBandwidth(BANDWIDTH_MAX): MTU 247 + big notify queue
 *   - 2M PHY requested on connect: doubles raw BLE rate
 *   - notify() is retried (data kept in ring buffer) so nothing drops
 */

#include <bluefruit.h>
#include <PDM.h>

#define SAMPLE_RATE   16000
#define MIC_GAIN      64           // PDM analog gain 0..80 (default 20). 64 = a bit louder than stock, still clean.
                                   // 70+ and/or digital gain clipped loud samples -> harsh "rè" buzz. Keep ≤~66.
#define DIGITAL_GAIN  1.0f         // software gain AFTER PDM (hard-clipped to int16). 1.0 = OFF (no clipping).
                                   // >1.0 distorts on anything loud — leave at 1.0 for clean audio.
#define PKT_SAMPLES   122          // 244 bytes = max notify @ MTU 247

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
#define LED_BLUE   6   // P0.06 — BLE: blink=advertising, solid=connected
static inline void redOn()   { NRF_P0->OUTCLR = (1UL << LED_RED); }
static inline void redOff()  { NRF_P0->OUTSET = (1UL << LED_RED); }
static inline void blueOn()  { NRF_P0->OUTCLR = (1UL << LED_BLUE); }
static inline void blueOff() { NRF_P0->OUTSET = (1UL << LED_BLUE); }

BLEService        audioSvc("19B10000-E8F2-537E-4F6C-D104768A1214");
BLECharacteristic audioChr("19B10001-E8F2-537E-4F6C-D104768A1214");
BLECharacteristic ctrlChr ("19B10002-E8F2-537E-4F6C-D104768A1214");

volatile bool recording = false;

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

// ── BLE control: start / stop streaming ──────────────────────────────────────
void onCtrlWrite(uint16_t, BLECharacteristic*, uint8_t* data, uint16_t len) {
  if (len < 1) return;
  if (data[0] == 0x01 && !recording) {
    ringHead = ringTail = 0;
    warmup = SAMPLE_RATE / 7;      // drop ~140 ms of mic-settling samples (kills "bụp" pop)
    recording = true;
    PDM.setGain(MIC_GAIN);
    PDM.begin(1, SAMPLE_RATE);     // 1 channel (mono)
  } else if (data[0] == 0x00 && recording) {
    recording = false;
    PDM.end();
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
  if (recording) { recording = false; PDM.end(); }
}

// ── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  NRF_P0->DIRSET = (1UL << LED_RED) | (1UL << LED_BLUE);
  redOff(); blueOff();

  Bluefruit.configPrphBandwidth(BANDWIDTH_MAX);   // before begin(): MTU 247 + big queue
  Bluefruit.begin();
  Bluefruit.setName("Nuna-Necklace");
  Bluefruit.setTxPower(4);
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

  PDM.onReceive(onPDMdata);

  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(audioSvc);
  Bluefruit.ScanResponse.addName();
  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(32, 244);
  Bluefruit.Advertising.start(0);
}

// ── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
  // Status LED
  static uint32_t lastBlink = 0;
  static bool blinkState = false;
  if (recording) {
    blueOff(); redOn();
  } else {
    redOff();
    if (Bluefruit.connected()) blueOn();
    else if (millis() - lastBlink > 300) {
      lastBlink = millis();
      blinkState = !blinkState;
      blinkState ? blueOn() : blueOff();
    }
  }

  if (!recording) return;

  // Drain ring buffer in 122-sample packets. Retry on notify failure so no audio
  // is lost when BLE is momentarily busy (data stays queued in the ring).
  static int16_t pkt[PKT_SAMPLES];
  while ((uint32_t)(ringHead - ringTail) >= PKT_SAMPLES) {
    uint32_t t = ringTail;
    for (uint16_t i = 0; i < PKT_SAMPLES; i++) pkt[i] = ring[(t + i) & RING_MASK];
    if (audioChr.notify((uint8_t*)pkt, PKT_SAMPLES * 2)) {
      ringTail = t + PKT_SAMPLES;
    } else {
      break;                       // BLE queue full; send the rest next loop
    }
  }
}
