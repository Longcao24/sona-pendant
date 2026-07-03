import React from 'react';
import { StyleSheet, View, Text, Pressable } from 'react-native';

import { useBle, type Role, type Found } from '@/components/ble-provider';

// Scan + pick UI for one role. Shown by a tab while its board isn't connected.
export function DevicePicker({ role, title }: { role: Role; title: string }) {
  const { noBle, devices, scan, stateOf, statusOf, connectTo } = useBle();
  const st = stateOf(role);

  if (noBle) return <Text style={s.status}>{statusOf(role)}</Text>;

  return (
    <View style={s.wrap}>
      <Text style={s.lead}>{title}</Text>
      <Text style={s.status}>{statusOf(role)}</Text>

      {devices.length > 0 && (
        <View style={s.list}>
          {devices.map((d: Found) => (
            <Pressable key={d.id} style={s.devRow} onPress={() => connectTo(role, d.id)}>
              <View style={s.devDot} />
              <View style={{ flex: 1 }}>
                <Text style={s.devName}>{d.name}</Text>
                <Text style={s.devId}>{d.id.slice(-8).toUpperCase()}</Text>
              </View>
              <Text style={s.devRssi}>{d.rssi} dBm</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Pressable style={s.btn} onPress={scan}>
        <Text style={s.btnText}>{devices.length ? 'Rescan' : 'Scan'}{st === 'connecting' ? ' · connecting…' : ''}</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap:    { width: '100%', alignItems: 'center', paddingHorizontal: 20 },
  lead:    { fontSize: 15, color: '#aaa', marginBottom: 8, textAlign: 'center' },
  status:  { fontSize: 13, color: '#666', marginBottom: 16, textAlign: 'center' },
  list:    { width: '100%', marginBottom: 16, gap: 10 },
  devRow:  { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1a1a1c', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  devDot:  { width: 10, height: 10, borderRadius: 5, backgroundColor: '#34c759' },
  devName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  devId:   { color: '#666', fontSize: 12, marginTop: 2, fontVariant: ['tabular-nums'] },
  devRssi: { color: '#888', fontSize: 12, fontVariant: ['tabular-nums'] },
  btn:     { backgroundColor: '#1a73e8', paddingVertical: 16, paddingHorizontal: 32, borderRadius: 14, minWidth: 96, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
