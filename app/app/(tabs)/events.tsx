import React, { useMemo } from 'react';
import { StyleSheet, View, Text, SectionList, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { useEvents, ActivityEvent } from '@/components/events-provider';
import { A, LABEL_ICON } from '@/constants/apple';

// Events tab: timeline of detected activities (eating, talking, drinking),
// grouped by day, newest first — iOS grouped-list style.

function fmtTime(ms: number) {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function fmtDur(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
}

function dayTitle(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Today';
  if (same(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

export default function EventsScreen() {
  const { events, clear } = useEvents();

  const sections = useMemo(() => {
    const byDay = new Map<string, ActivityEvent[]>();
    for (const ev of [...events].reverse()) {           // newest first
      const key = dayTitle(ev.start);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(ev);
    }
    return [...byDay.entries()].map(([title, data]) => ({ title, data }));
  }, [events]);

  const confirmClear = () =>
    Alert.alert('Clear history?', 'This removes all logged activities.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clear },
    ]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Events</Text>
        {events.length > 0 && (
          <Pressable onPress={confirmClear} hitSlop={8}>
            <Text style={s.clear}>Clear</Text>
          </Pressable>
        )}
      </View>

      {events.length === 0 ? (
        <View style={s.empty}>
          <MaterialCommunityIcons name="silverware-fork-knife" size={56} color={A.tertiary} style={{ marginBottom: 16 }} />
          <Text style={s.emptyTitle}>No activity yet</Text>
          <Text style={s.emptyText}>
            Start detection on the Detect tab.{'\n'}Eating, talking and drinking will be logged here.
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(ev) => ev.id}
          contentContainerStyle={s.listContent}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={s.section}>{section.title}</Text>
          )}
          renderItem={({ item, index, section }) => {
            const first = index === 0;
            const last = index === section.data.length - 1;
            return (
              <View style={[s.row, first && s.rowFirst, last && s.rowLast]}>
                <View style={s.iconWrap}>
                  <MaterialCommunityIcons
                    name={(LABEL_ICON[item.label] ?? 'help') as any}
                    size={19}
                    color={item.eating ? A.green : A.blue}
                  />
                </View>
                <View style={s.rowBody}>
                  <Text style={s.rowLabel}>{item.label}</Text>
                  <Text style={s.rowSub}>
                    {fmtTime(item.start)} – {fmtTime(item.end)} · {fmtDur(item.end - item.start)}
                  </Text>
                </View>
                {item.eating && (
                  <View style={s.badge}>
                    <Text style={s.badgeText}>Eating</Text>
                  </View>
                )}
                {!last && <View style={s.sep} />}
              </View>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: A.bg },
  header:    { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
               paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title:     { fontSize: 34, fontWeight: '700', color: A.label, letterSpacing: 0.3 },
  clear:     { fontSize: 17, color: A.blue },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  section:   { fontSize: 13, color: A.secondary, textTransform: 'uppercase', letterSpacing: 0.4,
               marginTop: 20, marginBottom: 8, marginLeft: 16 },
  row:       { flexDirection: 'row', alignItems: 'center', backgroundColor: A.card,
               paddingHorizontal: 16, paddingVertical: 12 },
  rowFirst:  { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
  rowLast:   { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  sep:       { position: 'absolute', left: 62, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: A.separator },
  iconWrap:  { width: 34, height: 34, borderRadius: 17, backgroundColor: A.bg,
               alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowBody:   { flex: 1 },
  rowLabel:  { fontSize: 17, color: A.label, fontWeight: '500' },
  rowSub:    { fontSize: 13, color: A.secondary, marginTop: 2 },
  badge:     { backgroundColor: '#E8F8EC', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  badgeText: { fontSize: 12, fontWeight: '600', color: A.green },
  empty:     { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingBottom: 60 },
  emptyTitle:{ fontSize: 20, fontWeight: '600', color: A.label },
  emptyText: { fontSize: 15, color: A.secondary, textAlign: 'center', marginTop: 8, lineHeight: 21 },
});
