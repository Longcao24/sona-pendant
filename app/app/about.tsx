import React from 'react';
import { ScrollView, View, Text, StyleSheet, Linking, Pressable } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { A } from '@/constants/apple';

const VERSION = '1.1.0';
const REPO = 'https://github.com/Longcao24/sona-pendant';

export default function AboutScreen() {
  const Row = ({ icon, color, text }: { icon: string; color: string; text: string }) => (
    <View style={s.ledRow}>
      <MaterialCommunityIcons name={icon as any} size={18} color={color} />
      <Text style={s.ledText}>{text}</Text>
    </View>
  );

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.h}>How to wear</Text>
      <View style={s.card}>
        <Text style={s.p}>
          Wear the pendant at chest height, mic side facing up toward your mouth.
          Chewing, drinking and talking are detected from sound — the closer to
          your mouth, the better the accuracy.
        </Text>
      </View>

      <Text style={s.h}>Pendant LED</Text>
      <View style={s.card}>
        <Row icon="led-on" color={A.blue}   text="Blue blinking — looking for your phone" />
        <Row icon="led-on" color={A.blue}   text="Blue blip every 3s — connected, idle" />
        <Row icon="led-on" color={A.red}    text="Red flicker — streaming (detection running)" />
        <Row icon="led-on" color={A.blue}   text="Blue blip every 5s — napping (quiet), wakes on sound" />
        <Row icon="led-on" color={A.orange} text="Red/blue strobe — Find Me (Settings)" />
      </View>

      <Text style={s.h}>Tips</Text>
      <View style={s.card}>
        <Text style={s.p}>
          • Detection keeps running with the screen off — a small notification shows while listening.{'\n'}
          • The pendant naps when it's quiet to save battery; it wakes itself on the first bite.{'\n'}
          • Cloud server works anywhere (~12 s per update). For real-time, run the local server and set its URL in Settings.
        </Text>
      </View>

      <Pressable style={({ pressed }) => [s.link, pressed && { opacity: 0.6 }]} onPress={() => Linking.openURL(REPO)}>
        <Text style={s.linkText}>GitHub — source & releases</Text>
      </Pressable>

      <Text style={s.version}>Sona v{VERSION}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: A.bg },
  content: { padding: 16, paddingBottom: 40 },
  h:       { fontSize: 13, color: A.secondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 18, marginBottom: 8, marginLeft: 16 },
  card:    { backgroundColor: A.card, borderRadius: 12, padding: 16 },
  p:       { fontSize: 15, color: A.label, lineHeight: 22 },
  ledRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  ledText: { fontSize: 14, color: A.label, flex: 1 },
  link:    { marginTop: 24, alignItems: 'center' },
  linkText:{ fontSize: 15, color: A.blue, fontWeight: '500' },
  version: { fontSize: 12, color: A.tertiary, textAlign: 'center', marginTop: 12 },
});
