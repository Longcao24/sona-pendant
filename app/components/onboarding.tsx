import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform, PermissionsAndroid } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as IntentLauncher from 'expo-intent-launcher';

import { usePrefs } from '@/components/prefs-provider';
import { A } from '@/constants/apple';

const APP_PKG = 'com.longcao24.collect';

// First-launch screen: explain WHY each permission is needed, then request them
// all, then offer the battery-optimization exemption (Android kills background
// apps without it — all-day detection needs the exemption).
export function Onboarding({ children }: { children: React.ReactNode }) {
  const { onboarded, ready, set } = usePrefs();
  const [busy, setBusy] = useState(false);

  if (!ready) return null;         // one frame while prefs load
  if (onboarded) return <>{children}</>;

  const proceed = async () => {
    setBusy(true);
    try {
      if (Platform.OS === 'android') {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
          ...(Platform.Version >= 33 ? [PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS] : []),
        ]);
        // Battery-optimization exemption: without it Android pauses the app
        // ~1h after screen-off and all-day detection silently dies.
        try {
          await IntentLauncher.startActivityAsync(
            'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
            { data: `package:${APP_PKG}` },
          );
        } catch {}
      }
    } finally {
      set({ onboarded: true });
      setBusy(false);
    }
  };

  const Row = ({ icon, title, text }: { icon: string; title: string; text: string }) => (
    <View style={s.row}>
      <View style={s.iconWrap}>
        <MaterialCommunityIcons name={icon as any} size={22} color={A.blue} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.rowTitle}>{title}</Text>
        <Text style={s.rowText}>{text}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={s.root}>
      <View style={s.body}>
        <Text style={s.brand}>Sona</Text>
        <Text style={s.tag}>Your pendant listens for eating, drinking and talking — and logs it automatically.</Text>

        <View style={s.card}>
          <Row icon="bluetooth" title="Bluetooth & Location"
               text="To find and stream audio from your pendant. Location is required by Android for Bluetooth scanning — Sona never uses GPS." />
          <View style={s.sep} />
          <Row icon="bell-outline" title="Notifications"
               text="Session summaries and the small “listening” status while detection runs in the background." />
          <View style={s.sep} />
          <Row icon="battery-heart-variant" title="Background use"
               text="Allow Sona to keep running with the screen off so a full day gets logged. You'll be asked to disable battery optimization." />
        </View>

        <Pressable style={({ pressed }) => [s.btn, pressed && { opacity: 0.8 }]} onPress={proceed} disabled={busy}>
          <Text style={s.btnText}>{busy ? 'Requesting…' : 'Continue'}</Text>
        </Pressable>
        <Text style={s.small}>You can change these anytime in system settings.</Text>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:  { flex: 1, backgroundColor: A.bg },
  body:  { flex: 1, paddingHorizontal: 28, justifyContent: 'center' },
  brand: { fontSize: 42, fontWeight: '800', color: A.label, textAlign: 'center', letterSpacing: 1 },
  tag:   { fontSize: 15, color: A.secondary, textAlign: 'center', marginTop: 10, lineHeight: 21, marginBottom: 28 },
  card:  { backgroundColor: A.card, borderRadius: 16, paddingHorizontal: 16 },
  row:   { flexDirection: 'row', gap: 14, paddingVertical: 14, alignItems: 'flex-start' },
  iconWrap: { width: 38, height: 38, borderRadius: 10, backgroundColor: A.bg, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: 15, fontWeight: '600', color: A.label },
  rowText:  { fontSize: 13, color: A.secondary, marginTop: 3, lineHeight: 18 },
  sep:   { height: StyleSheet.hairlineWidth, backgroundColor: A.separator, marginLeft: 52 },
  btn:   { backgroundColor: A.blue, borderRadius: 26, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  small: { fontSize: 12, color: A.tertiary, textAlign: 'center', marginTop: 14 },
});
