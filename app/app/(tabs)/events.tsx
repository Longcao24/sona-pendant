import React, { useMemo, useCallback } from 'react';
import { StyleSheet, View, Text, SectionList, Pressable, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

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

function startOfDay(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ── Summary + charts (Apple Health style, plain Views — no chart lib) ────────

function TodayCard({ events }: { events: ActivityEvent[] }) {
  const t0 = startOfDay(Date.now());
  const today = events.filter((e) => e.end >= t0);
  const eatMs = today.reduce((s, e) => s + (e.eating ? e.end - e.start : 0), 0);
  const eatN = today.filter((e) => e.eating).length;
  const talkMs = today.filter((e) => e.label === 'Talking').reduce((s, e) => s + e.end - e.start, 0);
  const drinkN = today.filter((e) => e.label === 'Drinking').length;

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Today</Text>
      <View style={s.bigRow}>
        <Text style={s.bigNum}>{eatMs ? fmtDur(eatMs) : '0m'}</Text>
        <Text style={s.bigUnit}>eating</Text>
      </View>
      <View style={s.statRow}>
        <View style={s.stat}>
          <MaterialCommunityIcons name="silverware-fork-knife" size={16} color={A.green} />
          <Text style={s.statText}>{eatN} {eatN === 1 ? 'snack' : 'snacks'}</Text>
        </View>
        <View style={s.stat}>
          <MaterialCommunityIcons name="account-voice" size={16} color={A.blue} />
          <Text style={s.statText}>{talkMs ? fmtDur(talkMs) : '0m'} talking</Text>
        </View>
        <View style={s.stat}>
          <MaterialCommunityIcons name="cup-water" size={16} color={A.orange} />
          <Text style={s.statText}>{drinkN} {drinkN === 1 ? 'drink' : 'drinks'}</Text>
        </View>
      </View>
    </View>
  );
}

function WeekChart({ events }: { events: ActivityEvent[] }) {
  const days: { key: string; label: string; ms: number; isToday: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d0 = startOfDay(Date.now()) - i * 86_400_000;
    const d1 = d0 + 86_400_000;
    const ms = events.reduce((sum, e) =>
      sum + (e.eating && e.start < d1 && e.end >= d0
        ? Math.min(e.end, d1) - Math.max(e.start, d0) : 0), 0);
    days.push({
      key: String(d0),
      label: new Date(d0).toLocaleDateString(undefined, { weekday: 'narrow' }),
      ms,
      isToday: i === 0,
    });
  }
  const max = Math.max(...days.map((d) => d.ms), 60_000); // ≥1m so bars scale sanely

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Eating · last 7 days</Text>
      <View style={s.chart}>
        {days.map((d) => (
          <View key={d.key} style={s.chartCol}>
            <Text style={s.chartVal}>{d.ms ? fmtDur(d.ms).replace(/\s.*$/, '') : ''}</Text>
            <View style={s.chartTrack}>
              <View style={[s.chartBar, {
                height: `${Math.max(d.ms / max, 0.02) * 100}%` as any,
                backgroundColor: d.isToday ? A.green : '#B9E8C5',
              }]} />
            </View>
            <Text style={[s.chartDay, d.isToday && { color: A.green, fontWeight: '700' }]}>{d.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FoodBreakdown({ events }: { events: ActivityEvent[] }) {
  const t0 = startOfDay(Date.now()) - 6 * 86_400_000; // this week
  const byLabel = new Map<string, number>();
  for (const e of events) {
    if (!e.eating || e.end < t0) continue;
    byLabel.set(e.label, (byLabel.get(e.label) ?? 0) + (e.end - e.start));
  }
  const rows = [...byLabel.entries()].sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return null;
  const max = rows[0][1];

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Foods · last 7 days</Text>
      {rows.map(([label, ms]) => (
        <View key={label} style={s.foodRow}>
          <MaterialCommunityIcons name={(LABEL_ICON[label] ?? 'help') as any} size={17} color={A.green} />
          <Text style={s.foodLabel} numberOfLines={1}>{label}</Text>
          <View style={s.foodTrack}>
            <View style={[s.foodBar, { width: `${Math.max(ms / max, 0.04) * 100}%` as any }]} />
          </View>
          <Text style={s.foodVal}>{fmtDur(ms)}</Text>
        </View>
      ))}
    </View>
  );
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
    return [...byDay.entries()].map(([title, data]) => {
      const eatingMs = data.reduce((sum, ev) => sum + (ev.eating ? ev.end - ev.start : 0), 0);
      return { title, data, eatingMs };
    });
  }, [events]);

  const confirmClear = () =>
    Alert.alert('Clear history?', 'This removes all logged activities.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clear },
    ]);

  // Export the full log as CSV (share sheet -> save/mail/drive).
  const exportCsv = useCallback(async () => {
    try {
      const rows = ['start_iso,end_iso,label,eating,duration_s'];
      for (const e of events) {
        rows.push(`${new Date(e.start).toISOString()},${new Date(e.end).toISOString()},"${e.label}",${e.eating},${Math.round((e.end - e.start) / 1000)}`);
      }
      const f = new File(Paths.cache, `sona_events_${new Date().toISOString().slice(0, 10)}.csv`);
      f.create({ overwrite: true });
      f.write(rows.join('\n'));
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(f.uri, { mimeType: 'text/csv' });
    } catch (e: any) {
      Alert.alert('Export failed', e.message ?? 'unknown error');
    }
  }, [events]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Events</Text>
        {events.length > 0 && (
          <View style={s.headerBtns}>
            <Pressable onPress={exportCsv} hitSlop={8}>
              <MaterialCommunityIcons name="export-variant" size={22} color={A.blue} />
            </Pressable>
            <Pressable onPress={confirmClear} hitSlop={8}>
              <Text style={s.clear}>Clear</Text>
            </Pressable>
          </View>
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
          ListHeaderComponent={
            <>
              <TodayCard events={events} />
              <WeekChart events={events} />
              <FoodBreakdown events={events} />
            </>
          }
          renderSectionHeader={({ section }) => (
            <View style={s.sectionRow}>
              <Text style={s.section}>{section.title}</Text>
              {section.eatingMs > 0 && (
                <Text style={s.sectionSum}>ate {fmtDur(section.eatingMs)}</Text>
              )}
            </View>
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
  headerBtns:{ flexDirection: 'row', alignItems: 'center', gap: 18 },
  clear:     { fontSize: 17, color: A.blue },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  // summary cards + charts
  card:      { backgroundColor: A.card, borderRadius: 16, padding: 16, marginTop: 12 },
  cardTitle: { fontSize: 13, color: A.secondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 10 },
  bigRow:    { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  bigNum:    { fontSize: 36, fontWeight: '700', color: A.label, fontVariant: ['tabular-nums'] },
  bigUnit:   { fontSize: 15, color: A.secondary, fontWeight: '500' },
  statRow:   { flexDirection: 'row', gap: 18, marginTop: 12 },
  stat:      { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statText:  { fontSize: 13, color: A.label },
  chart:     { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  chartCol:  { alignItems: 'center', flex: 1, gap: 4 },
  chartVal:  { fontSize: 10, color: A.secondary, height: 13, fontVariant: ['tabular-nums'] },
  chartTrack:{ height: 96, width: 22, borderRadius: 7, backgroundColor: A.bg, justifyContent: 'flex-end', overflow: 'hidden' },
  chartBar:  { width: '100%', borderRadius: 7 },
  chartDay:  { fontSize: 12, color: A.secondary },
  foodRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  foodLabel: { width: 90, fontSize: 14, color: A.label },
  foodTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: A.bg, overflow: 'hidden' },
  foodBar:   { height: '100%', borderRadius: 4, backgroundColor: A.green },
  foodVal:   { width: 52, fontSize: 12, color: A.secondary, textAlign: 'right', fontVariant: ['tabular-nums'] },
  sectionRow:{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
               marginTop: 20, marginBottom: 8, marginHorizontal: 16 },
  section:   { fontSize: 13, color: A.secondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  sectionSum:{ fontSize: 13, color: A.green, fontWeight: '600' },
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
