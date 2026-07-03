import React, { useEffect, useRef, useState, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { useBle, AUDIO_SVC, AUDIO_CHR, CTRL_CHR } from '@/components/ble-provider';
import { DevicePicker } from '@/components/device-picker';
import { useServerUrl } from '@/components/server-url-provider';
import { useEvents } from '@/components/events-provider';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { A, LABEL_ICON } from '@/constants/apple';

const SAMPLE_RATE  = 16000; // firmware streams mic at native 16 kHz
// 6s window = 3 model chunks (model is trained on 3s @ 1.5s step). Short window
// keeps latency low: majority vote flips ~3s after a new sound starts, and
// inference is ~400ms — fits the 1s refresh. 15s made labels lag ~8s.
const WINDOW_SEC   = 6;
const MIN_SEC      = 2;     // start classifying once this much audio has buffered (fast first result)
const REFRESH_MS   = 1000;  // real-time cadence; a slow inference just skips ticks (inFlight guard)
const WINDOW_BYTES = WINDOW_SEC * SAMPLE_RATE * 2;   // int16 LE PCM
const MIN_BYTES    = MIN_SEC * SAMPLE_RATE * 2;

type Top = { index: number; label: string; prob: number };
type Result = {
  top: Top;
  probs: Record<string, number>;
  eating: boolean;
  confident: boolean;
  quiet: boolean;
  rms: number;
  seconds: number;
  ms: number;
};

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// Bytes -> base64. Chunked so String.fromCharCode doesn't overflow the arg stack.
// RN fetch can't reliably send a raw binary body, so we send base64 JSON.
function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Append `chunk` to `buf`, keeping only the most recent `maxLen` bytes.
function appendCapped(buf: Uint8Array, chunk: Uint8Array, maxLen: number): Uint8Array {
  const total = buf.byteLength + chunk.byteLength;
  if (total <= maxLen) {
    const out = new Uint8Array(total);
    out.set(buf, 0);
    out.set(chunk, buf.byteLength);
    return out;
  }
  const out = new Uint8Array(maxLen);
  const keepFromChunk = Math.min(chunk.byteLength, maxLen);
  const keepFromBuf = maxLen - keepFromChunk;
  if (keepFromBuf > 0) out.set(buf.subarray(buf.byteLength - keepFromBuf), 0);
  out.set(chunk.subarray(chunk.byteLength - keepFromChunk), keepFromBuf);
  return out;
}

// Animated probability bar — width eases to the new value each result.
function ProbBar({ label, p }: { label: string; p: number }) {
  const w = useRef(new Animated.Value(p)).current;
  useEffect(() => {
    Animated.timing(w, { toValue: p, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [p, w]);
  return (
    <View style={s.probRow}>
      <Text style={s.probLabel} numberOfLines={1}>{label}</Text>
      <View style={s.barTrack}>
        <Animated.View
          style={[s.barFill, { width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]}
        />
      </View>
      <Text style={s.probPct}>{(p * 100).toFixed(0)}%</Text>
    </View>
  );
}

export default function DetectScreen() {
  const { deviceFor, stateOf } = useBle();
  const device = deviceFor('audio');
  const connected = stateOf('audio') === 'connected';
  const { url } = useServerUrl();
  const { report, flush } = useEvents();

  const [streaming, setStreaming] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [status, setStatus] = useState('');

  // Stabilized hero display: a new label must win 2 consecutive ticks before
  // it replaces the shown one, and brief quiet/unsure blips hold the last good
  // label for 3 ticks — kills tick-to-tick flicker from the sliding window.
  type Display =
    | { kind: 'none' }
    | { kind: 'quiet' }
    | { kind: 'unsure'; label: string }
    | { kind: 'ok'; label: string; eating: boolean };
  const [display, setDisplay] = useState<Display>({ kind: 'none' });
  const candRef = useRef<{ label: string; n: number }>({ label: '', n: 0 });
  const offRef  = useRef(0); // consecutive quiet/unsure ticks

  const bufRef      = useRef<Uint8Array>(new Uint8Array(0));
  const subscRef     = useRef<any>(null);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef  = useRef(false);
  const urlRef       = useRef(url);
  useEffect(() => { urlRef.current = url; }, [url]);
  const reportRef = useRef(report);
  useEffect(() => { reportRef.current = report; }, [report]);
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  // ── Animations ─────────────────────────────────────────────────────────────
  // Breathing ring while listening (Apple "listening" feel).
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!streaming) { ring.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(ring, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(ring, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [streaming, ring]);

  // Label crossfade: when the shown label changes, fade+scale the hero text in.
  const labelAnim = useRef(new Animated.Value(1)).current;
  const prevLabel = useRef('');

  const classify = useCallback(async () => {
    if (inFlightRef.current) return;
    const buf = bufRef.current;
    if (buf.byteLength < MIN_BYTES) return;
    const window = buf.slice(0);
    inFlightRef.current = true;
    // Abort slow requests (cloud CPU can take ~12s; a hung one must not freeze
    // detection forever — inFlight would never clear without this).
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 25_000);
    try {
      const res = await fetch(`${urlRef.current}/classify_b64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pcm_b64: bytesToB64(window) }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`Server ${res.status}`);
      const json: Result = await res.json();
      setResult(json);
      setStatus('');
      // Feed the Events log: only confident, non-quiet detections count.
      const ok = !json.quiet && json.confident;
      reportRef.current(ok ? json.top.label : null, ok ? json.eating : false);
      // Stabilize the hero label.
      if (ok) {
        offRef.current = 0;
        const L = json.top.label;
        setDisplay((prev) => {
          if (prev.kind === 'ok' && prev.label === L) {
            candRef.current = { label: L, n: 0 };
            return prev.eating === json.eating ? prev : { ...prev, eating: json.eating };
          }
          const n = candRef.current.label === L ? candRef.current.n + 1 : 1;
          candRef.current = { label: L, n };
          // Unanimous vote (all chunks agree) = already ~4.5s of consistent
          // audio — switch immediately. Split votes still need 2 ticks.
          const unanimous = json.top.prob >= 0.99;
          return n >= 2 || unanimous || prev.kind !== 'ok'
            ? { kind: 'ok', label: L, eating: json.eating }
            : prev; // one-off split-vote label: keep showing the current one
        });
      } else {
        candRef.current = { label: '', n: 0 };
        offRef.current += 1;
        if (offRef.current >= 2) {
          setDisplay(json.quiet ? { kind: 'quiet' } : { kind: 'unsure', label: json.top.label });
        }
      }
    } catch (e: any) {
      setStatus(e.name === 'AbortError' ? 'Server timeout' : (e.message ?? 'Classify failed'));
    } finally {
      clearTimeout(timeout);
      inFlightRef.current = false;
    }
  }, []);

  const start = useCallback(() => {
    if (!device || subscRef.current) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    bufRef.current = new Uint8Array(0);
    setResult(null);
    setStatus('');
    setDisplay({ kind: 'none' });
    candRef.current = { label: '', n: 0 };
    offRef.current = 0;

    subscRef.current = device.monitorCharacteristicForService(
      AUDIO_SVC, AUDIO_CHR,
      (_err: any, chr: any) => {
        if (_err || !chr?.value) return;
        bufRef.current = appendCapped(bufRef.current, b64ToBytes(chr.value), WINDOW_BYTES);
      },
      'detect-stream',
    );

    device.writeCharacteristicWithResponseForService(
      AUDIO_SVC, CTRL_CHR, btoa(String.fromCharCode(0x01)),
    ).catch((e: any) => setStatus(e.message ?? 'Start failed'));

    intervalRef.current = setInterval(classify, REFRESH_MS);
    setStreaming(true);
  }, [device, classify]);

  const stop = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    subscRef.current?.remove();
    subscRef.current = null;
    if (device) {
      device.writeCharacteristicWithResponseForService(
        AUDIO_SVC, CTRL_CHR, btoa(String.fromCharCode(0x00)),
      ).catch(() => {});
    }
    flushRef.current(); // commit the open event now — don't lose it on Stop
    setStreaming(false);
  }, [device]);

  // Auto-stop if the device drops; clean up on unmount.
  useEffect(() => {
    if (!connected && subscRef.current) stop();
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      subscRef.current?.remove();
      subscRef.current = null;
    };
  }, [connected, stop]);

  // Render from the STABILIZED display, not the raw per-tick result.
  const heroLabel =
    display.kind === 'ok' || display.kind === 'unsure' ? display.label :
    display.kind === 'quiet' ? 'Quiet' :
    streaming ? 'Listening' : 'Ready';
  const heroIcon =
    display.kind === 'ok' || display.kind === 'unsure' ? (LABEL_ICON[display.label] ?? 'help') :
    display.kind === 'quiet' ? 'volume-off' :
    streaming ? 'ear-hearing' : 'headphones';
  const eatingNow = display.kind === 'ok' && display.eating;
  const tint =
    display.kind === 'ok' ? (eatingNow ? A.green : A.secondary) :
    A.tertiary;

  // Crossfade when the visible label changes.
  useEffect(() => {
    if (heroLabel === prevLabel.current) return;
    prevLabel.current = heroLabel;
    labelAnim.setValue(0);
    Animated.spring(labelAnim, { toValue: 1, useNativeDriver: true, damping: 16, stiffness: 180 }).start();
  }, [heroLabel, labelAnim]);

  const sortedProbs = result
    ? Object.entries(result.probs).sort((a, b) => b[1] - a[1]).slice(0, 5)
    : [];

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.08] });

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <Text style={s.title}>Detect</Text>

      {!connected && <DevicePicker role="audio" title="Pick the pendant" />}

      {connected && (
        <View style={s.body}>
          {/* Hero circle */}
          <View style={s.heroWrap}>
            <Animated.View
              style={[s.heroRing, { borderColor: tint, transform: [{ scale: ringScale }], opacity: streaming ? ringOpacity : 0 }]}
            />
            <View style={[s.hero, { borderColor: tint }]}>
              <Animated.View style={{ alignItems: 'center', opacity: labelAnim, transform: [{ scale: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }}>
                <MaterialCommunityIcons
                  name={heroIcon as any}
                  size={52}
                  color={display.kind === 'ok' ? (eatingNow ? A.green : A.label) : A.secondary}
                />
                <Text style={[s.heroLabel, { color: display.kind === 'ok' ? A.label : A.secondary }]}>{heroLabel}</Text>
                {display.kind === 'ok' ? (
                  <View style={[s.capsule, { backgroundColor: eatingNow ? '#E8F8EC' : A.fillBtn }]}>
                    <Text style={[s.capsuleText, { color: eatingNow ? A.green : A.secondary }]}>
                      {eatingNow ? 'Eating' : 'Not eating'}
                    </Text>
                  </View>
                ) : (
                  <Text style={s.heroSub}>
                    {display.kind === 'none'
                      ? (streaming ? 'listening…' : 'tap Start')
                      : display.kind === 'quiet' ? 'no sound'
                      : 'low confidence'}
                  </Text>
                )}
              </Animated.View>
            </View>
          </View>

          {/* Probabilities */}
          {sortedProbs.length > 0 && (
            <View style={s.probCard}>
              {sortedProbs.map(([label, p]) => <ProbBar key={label} label={label} p={p} />)}
            </View>
          )}

          {status ? <Text style={s.status}>{status}</Text> : null}

          {/* Start / Stop */}
          <Pressable
            style={({ pressed }) => [s.btn, streaming && s.btnStop, pressed && { opacity: 0.75, transform: [{ scale: 0.985 }] }]}
            onPress={streaming ? stop : start}
          >
            <Text style={[s.btnText, streaming && { color: A.red }]}>{streaming ? 'Stop' : 'Start'}</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const CIRCLE = 210;

const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: A.bg },
  title:  { fontSize: 34, fontWeight: '700', color: A.label, letterSpacing: 0.3, paddingHorizontal: 20, paddingTop: 12 },
  body:   { flex: 1, alignItems: 'center', paddingHorizontal: 20, paddingTop: 16 },
  heroWrap:  { width: CIRCLE + 40, height: CIRCLE + 40, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  heroRing:  { position: 'absolute', width: CIRCLE + 24, height: CIRCLE + 24, borderRadius: (CIRCLE + 24) / 2, borderWidth: 10 },
  hero:      { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, borderWidth: 2, backgroundColor: A.card,
               alignItems: 'center', justifyContent: 'center' },
  heroLabel: { fontSize: 26, fontWeight: '700', marginTop: 8, textTransform: 'capitalize', letterSpacing: 0.2 },
  heroSub:   { fontSize: 14, color: A.secondary, marginTop: 6, fontWeight: '500' },
  capsule:   { marginTop: 8, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  capsuleText: { fontSize: 13, fontWeight: '600' },
  probCard:  { width: '100%', backgroundColor: A.card, borderRadius: 16, padding: 16, marginTop: 20, gap: 10 },
  probRow:   { flexDirection: 'row', alignItems: 'center', gap: 10 },
  probLabel: { width: 86, fontSize: 13, color: A.label },
  barTrack:  { flex: 1, height: 7, borderRadius: 4, backgroundColor: A.bg, overflow: 'hidden' },
  barFill:   { height: '100%', borderRadius: 4, backgroundColor: A.blue },
  probPct:   { width: 38, fontSize: 12, color: A.secondary, textAlign: 'right', fontVariant: ['tabular-nums'] },
  status:    { fontSize: 13, color: A.red, marginTop: 12, textAlign: 'center' },
  btn:       { marginTop: 'auto', marginBottom: 16, backgroundColor: A.blue, paddingVertical: 16, borderRadius: 26,
               width: '100%', alignItems: 'center' },
  btnStop:   { backgroundColor: A.card },
  btnText:   { color: '#fff', fontSize: 17, fontWeight: '600' },
});
