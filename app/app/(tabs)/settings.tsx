import React, { useState, useCallback } from 'react';
import { StyleSheet, View, Text, TextInput, Pressable, ActivityIndicator, Keyboard, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { useServerUrl, normalizeUrl } from '@/components/server-url-provider';
import { useBle } from '@/components/ble-provider';
import { A } from '@/constants/apple';
import { SERVER_URL as CLOUD_URL } from '@/constants/config';

type Test = { state: 'idle' | 'testing' | 'ok' | 'fail'; msg: string };

export default function SettingsScreen() {
  const { url, setUrl } = useServerUrl();
  const { stateOf, disconnect, battery } = useBle();
  const router = useRouter();
  const [draft, setDraft] = useState(url);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<Test>({ state: 'idle', msg: '' });

  const connected = stateOf('audio') === 'connected';

  const save = useCallback(() => {
    Keyboard.dismiss();
    setUrl(draft);
    setDraft(normalizeUrl(draft));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [draft, setUrl]);

  const testConn = useCallback(async () => {
    Keyboard.dismiss();
    const target = normalizeUrl(draft);
    setTest({ state: 'testing', msg: '' });
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${target}/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const labels = j?.labels ? Object.values(j.labels).join(', ') : '';
      setTest({ state: 'ok', msg: `Connected · ${j.device ?? '?'}\n${labels}` });
    } catch (e: any) {
      setTest({ state: 'fail', msg: e.name === 'AbortError' ? 'Timed out (5s)' : (e.message ?? 'Failed') });
    }
  }, [draft]);

  const testTint = test.state === 'ok' ? A.green : test.state === 'fail' ? A.red : A.secondary;
  const onCloud = normalizeUrl(url) === CLOUD_URL;

  // Quick reset back to the free HF cloud server (the app default).
  const useCloud = useCallback(() => {
    Keyboard.dismiss();
    setDraft(CLOUD_URL);
    setUrl(CLOUD_URL);
    setTest({ state: 'idle', msg: '' });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [setUrl]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <Text style={s.title}>Settings</Text>

        {/* ── Server ── */}
        <Text style={s.section}>Detection Server</Text>
        <View style={s.card}>
          <TextInput
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="http://192.168.1.100:8000"
            placeholderTextColor={A.tertiary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
          />
          <View style={s.sep} />
          <View style={s.btnRow}>
            <Pressable style={({ pressed }) => [s.cardBtn, pressed && s.pressed]} onPress={testConn} hitSlop={6}>
              <Text style={s.cardBtnText}>Test</Text>
            </Pressable>
            <View style={s.vSep} />
            <Pressable style={({ pressed }) => [s.cardBtn, pressed && s.pressed]} onPress={save} hitSlop={6}>
              <Text style={[s.cardBtnText, saved && { color: A.green }]}>{saved ? 'Saved ✓' : 'Save'}</Text>
            </Pressable>
          </View>
          <View style={s.sep} />
          <Pressable style={({ pressed }) => [s.row, pressed && s.pressed]} onPress={useCloud} disabled={onCloud}>
            <Text style={[s.rowLabel, { color: onCloud ? A.tertiary : A.blue }]}>
              {onCloud ? 'Using Cloud Server ✓' : 'Use Cloud Server (default)'}
            </Text>
          </Pressable>
        </View>
        <Text style={s.footer}>
          Machine running the detection server, reachable from this phone on the same Wi-Fi. Not localhost.
        </Text>
        {test.state === 'testing' && <ActivityIndicator color={A.blue} style={{ marginTop: 8 }} />}
        {test.msg ? <Text style={[s.testMsg, { color: testTint }]}>{test.msg}</Text> : null}

        {/* ── Device ── */}
        <Text style={s.section}>Device</Text>
        <View style={s.card}>
          <View style={s.row}>
            <Text style={s.rowLabel}>Pendant</Text>
            <Text style={[s.rowValue, { color: connected ? A.green : A.secondary }]}>
              {connected ? 'Connected' : 'Not connected'}
            </Text>
          </View>
          {connected && battery != null && (
            <>
              <View style={s.sep} />
              <View style={s.row}>
                <Text style={s.rowLabel}>Battery</Text>
                <Text style={[s.rowValue, { color: battery <= 20 ? A.red : A.secondary }]}>{battery}%</Text>
              </View>
            </>
          )}
          {connected && (
            <>
              <View style={s.sep} />
              <Pressable style={({ pressed }) => [s.row, pressed && s.pressed]} onPress={() => disconnect('audio')}>
                <Text style={[s.rowLabel, { color: A.red }]}>Disconnect</Text>
              </Pressable>
            </>
          )}
        </View>

        {/* ── Debug ── */}
        <Text style={s.section}>Debug</Text>
        <View style={s.card}>
          {/* cast: expo-router typed routes regenerate on next `expo start`; /record exists */}
          <Pressable style={({ pressed }) => [s.row, pressed && s.pressed]} onPress={() => router.push('/record' as any)}>
            <Text style={s.rowLabel}>Record raw audio</Text>
            <Text style={s.chevron}>›</Text>
          </Pressable>
        </View>
        <Text style={s.footer}>Capture the pendant mic stream to a WAV file for testing.</Text>

        <Text style={s.active}>Active server: {url}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: A.bg },
  content: { paddingHorizontal: 16, paddingBottom: 40 },
  title:   { fontSize: 34, fontWeight: '700', color: A.label, letterSpacing: 0.3, paddingHorizontal: 4, paddingTop: 12, marginBottom: 8 },
  section: { fontSize: 13, color: A.secondary, textTransform: 'uppercase', letterSpacing: 0.4,
             marginTop: 24, marginBottom: 8, marginLeft: 16 },
  card:    { backgroundColor: A.card, borderRadius: 12, overflow: 'hidden' },
  pressed: { backgroundColor: '#F0F0F2' },
  input:   { paddingHorizontal: 16, paddingVertical: 13, color: A.label, fontSize: 16 },
  sep:     { height: StyleSheet.hairlineWidth, backgroundColor: A.separator, marginLeft: 16 },
  btnRow:  { flexDirection: 'row' },
  vSep:    { width: StyleSheet.hairlineWidth, backgroundColor: A.separator },
  cardBtn: { flex: 1, paddingVertical: 13, alignItems: 'center' },
  cardBtnText: { fontSize: 17, color: A.blue },
  row:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
             paddingHorizontal: 16, paddingVertical: 13 },
  rowLabel:{ fontSize: 17, color: A.label },
  rowValue:{ fontSize: 15 },
  chevron: { fontSize: 22, color: A.tertiary, marginTop: -2 },
  footer:  { fontSize: 13, color: A.secondary, marginTop: 8, marginHorizontal: 16, lineHeight: 18 },
  testMsg: { fontSize: 13, marginTop: 10, marginHorizontal: 16, lineHeight: 19 },
  active:  { fontSize: 12, color: A.tertiary, marginTop: 32, textAlign: 'center' },
});
