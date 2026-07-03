import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useBle } from '@/components/ble-provider';
import { A } from '@/constants/apple';

const BRAND = 'Sona';   // product name shown in UI (BLE device still advertises as before)

// Real-app entry flow: until the necklace is connected, this full-screen gate
// covers the app. It auto-scans (provider), shows the found device with a
// Connect button, and lifts once connected — revealing the Detect main page.
export function ConnectGate({ children }: { children: React.ReactNode }) {
  const { devices, stateOf, statusOf, connectTo, scan, noBle } = useBle();
  const state = stateOf('audio');
  const connected = state === 'connected';
  const connecting = state === 'connecting';

  const cand = devices[0] ?? null;

  // fade the gate out when connected
  const fade = useRef(new Animated.Value(1)).current;
  const [mounted, setMounted] = useState(true);
  useEffect(() => {
    if (connected) {
      Animated.timing(fade, { toValue: 0, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true })
        .start(() => setMounted(false));
    } else {
      setMounted(true);
      fade.setValue(1);
    }
  }, [connected, fade]);

  // pulse the scanning dot
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  // gentle float on the pendant while waiting
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [float]);
  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });

  return (
    <View style={{ flex: 1 }}>
      {children}
      {mounted && (
        <Animated.View style={[StyleSheet.absoluteFill, s.gate, { opacity: fade }]} pointerEvents={connected ? 'none' : 'auto'}>
          <SafeAreaView style={s.safe}>
            <View style={s.top}>
              <Text style={s.brand}>{BRAND}</Text>
              <Text style={s.tag}>Food-intake sensing pendant</Text>
            </View>

            {/* pendant pod */}
            <Animated.View style={[s.device, { transform: [{ translateY: floatY }] }]}>
              <View style={s.pendant}>
                <View style={s.pendantHole} />
                <Text style={s.deviceBrand}>{BRAND.toUpperCase()}</Text>
              </View>
            </Animated.View>

            {noBle ? (
              <Text style={s.status}>{statusOf('audio')}</Text>
            ) : cand ? (
              <>
                <Text style={s.found}>Device found</Text>
                <Text style={s.name}>{BRAND} Pendant</Text>
                <Text style={s.sn}>SN: {cand.id.replace(/[^A-Za-z0-9]/g, '').slice(-16).toUpperCase() || cand.id}</Text>
                <Pressable
                  style={({ pressed }) => [s.connect, connecting && s.connectBusy, pressed && { opacity: 0.8 }]}
                  disabled={connecting}
                  onPress={() => connectTo('audio', cand.id)}
                >
                  {connecting ? <ActivityIndicator color="#fff" /> : <Text style={s.connectText}>Connect</Text>}
                </Pressable>
              </>
            ) : (
              <>
                <View style={s.scanRow}>
                  <Animated.View style={[s.scanDot, { opacity: pulse }]} />
                  <Text style={s.scanText}>Looking for your pendant…</Text>
                </View>
                <Text style={s.hint}>Power on the pendant (blue LED blinking). Bluetooth + Location must be on.</Text>
                <Pressable style={({ pressed }) => [s.rescan, pressed && { opacity: 0.6 }]} onPress={() => scan()}>
                  <Text style={s.rescanText}>Scan again</Text>
                </Pressable>
              </>
            )}
          </SafeAreaView>
        </Animated.View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  gate:       { backgroundColor: A.bg },
  safe:       { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  top:        { alignItems: 'center', marginBottom: 40 },
  brand:      { fontSize: 44, fontWeight: '800', color: A.label, letterSpacing: 1 },
  tag:        { fontSize: 14, color: A.secondary, marginTop: 6 },
  device:     { alignItems: 'center', marginVertical: 40 },
  pendant:    { width: 96, height: 128, borderRadius: 40, backgroundColor: '#D8DadF', borderWidth: 1, borderColor: '#C4C6CC',
                alignItems: 'center', justifyContent: 'center' },
  pendantHole:{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#9A9DA5', marginBottom: 12 },
  deviceBrand:{ fontSize: 11, letterSpacing: 3, color: '#6E7178', fontWeight: '700' },
  found:      { fontSize: 13, color: A.green, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  name:       { fontSize: 22, fontWeight: '700', color: A.label, marginTop: 8 },
  sn:         { fontSize: 14, color: A.secondary, marginTop: 6 },
  connect:    { backgroundColor: A.blue, borderRadius: 26, paddingVertical: 17, paddingHorizontal: 72, alignItems: 'center', marginTop: 32 },
  connectBusy:{ backgroundColor: '#7EB6FF' },
  connectText:{ color: '#fff', fontSize: 18, fontWeight: '700' },
  scanRow:    { flexDirection: 'row', alignItems: 'center', gap: 10 },
  scanDot:    { width: 12, height: 12, borderRadius: 6, backgroundColor: A.blue },
  scanText:   { fontSize: 17, color: A.label, fontWeight: '600' },
  hint:       { fontSize: 13, color: A.secondary, textAlign: 'center', marginTop: 16, lineHeight: 19 },
  rescan:     { marginTop: 28, paddingVertical: 12, paddingHorizontal: 28, borderRadius: 14, backgroundColor: A.card },
  rescanText: { color: A.blue, fontSize: 15, fontWeight: '600' },
  status:     { fontSize: 15, color: A.orange, textAlign: 'center', lineHeight: 22 },
});
