import React, { useRef, useState, useCallback } from 'react';
import { StyleSheet, View, Text, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useAudioPlayer } from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { useBle, AUDIO_SVC, AUDIO_CHR, CTRL_CHR } from '@/components/ble-provider';
import { A } from '@/constants/apple';

// Debug tool (Settings ▸ Debug ▸ Record raw audio): capture the raw BLE mic
// stream to a WAV for listening/sharing. Not part of the normal user flow.

const SAMPLE_RATE = 16000; // firmware streams mic at native 16 kHz

type RecState = 'idle' | 'recording' | 'processing' | 'done';

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function buildWav(chunks: Uint8Array[], sampleRate: number): Uint8Array {
  const dataSize = chunks.reduce((s, c) => s + c.byteLength, 0);
  const wav = new Uint8Array(44 + dataSize);
  const v = new DataView(wav.buffer);
  const w = (str: string, o: number) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
  w('RIFF', 0); v.setUint32(4, 36 + dataSize, true); w('WAVE', 8);
  w('fmt ', 12); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w('data', 36); v.setUint32(40, dataSize, true);
  let off = 44;
  for (const c of chunks) { wav.set(c, off); off += c.byteLength; }
  return wav;
}

export default function RecordScreen() {
  const { deviceFor, stateOf } = useBle();
  const device = deviceFor('audio');
  const connected = stateOf('audio') === 'connected';
  const [recState, setRecState] = useState<RecState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [recStatus, setRecStatus] = useState('');

  const chunksRef  = useRef<Uint8Array[]>([]);
  const subscRef   = useRef<any>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondsRef = useRef(0);
  const wavUriRef  = useRef('');

  const player = useAudioPlayer(wavUriRef.current ? { uri: wavUriRef.current } : null);

  const startRecording = useCallback(async () => {
    if (!device) return;
    chunksRef.current = [];
    secondsRef.current = 0;
    setSeconds(0);
    setRecState('recording');

    timerRef.current = setInterval(() => {
      secondsRef.current++;
      setSeconds(secondsRef.current);
    }, 1000);

    subscRef.current = device.monitorCharacteristicForService(
      AUDIO_SVC, AUDIO_CHR,
      (_err: any, chr: any) => {
        if (_err) return;
        if (chr?.value) chunksRef.current.push(b64ToBytes(chr.value));
      },
      'audio-stream',
    );

    await device.writeCharacteristicWithResponseForService(
      AUDIO_SVC, CTRL_CHR, btoa(String.fromCharCode(0x01)),
    );
  }, [device]);

  const stopRecording = useCallback(async () => {
    if (!device) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    await device.writeCharacteristicWithResponseForService(
      AUDIO_SVC, CTRL_CHR, btoa(String.fromCharCode(0x00)),
    );
    subscRef.current?.remove();

    setRecState('processing');

    setTimeout(() => {
      const wav  = buildWav(chunksRef.current, SAMPLE_RATE);
      const file = new File(Paths.document, `rec_${Date.now()}.wav`);
      file.create({ overwrite: true });
      file.write(wav);
      wavUriRef.current = file.uri;
      setRecStatus(`${secondsRef.current}s · ${(wav.byteLength / 1024).toFixed(1)} KB`);
      setRecState('done');
    }, 80);
  }, [device]);

  const playRecording = useCallback(() => {
    if (!wavUriRef.current) return;
    try { player.replace({ uri: wavUriRef.current }); player.play(); }
    catch (e: any) { Alert.alert('Playback error', e.message); }
  }, [player]);

  const shareRecording = useCallback(async () => {
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(wavUriRef.current);
  }, []);

  const again = useCallback(() => {
    wavUriRef.current = '';
    setSeconds(0);
    setRecStatus('');
    setRecState('idle');
  }, []);

  return (
    <View style={s.root}>
      {!connected && <Text style={s.warn}>Necklace not connected.</Text>}

      {recState === 'processing' && <ActivityIndicator size="large" color={A.blue} style={s.spin} />}

      {recState === 'recording' && (
        <View style={s.timerWrap}>
          <View style={s.dot} />
          <Text style={s.timer}>{seconds}s</Text>
        </View>
      )}

      {recStatus ? <Text style={s.status}>{recStatus}</Text> : null}

      {connected && recState === 'idle' && (
        <Pressable style={[s.btn, s.btnRec]} onPress={startRecording}>
          <Text style={s.btnText}>Record</Text>
        </Pressable>
      )}

      {connected && recState === 'recording' && (
        <Pressable style={[s.btn, s.btnGray]} onPress={stopRecording}>
          <Text style={[s.btnText, { color: A.label }]}>Stop</Text>
        </Pressable>
      )}

      {recState === 'done' && (
        <View style={s.row}>
          <Pressable style={s.btn} onPress={playRecording}>
            <Text style={s.btnText}>Play</Text>
          </Pressable>
          <Pressable style={s.btn} onPress={shareRecording}>
            <Text style={s.btnText}>Share</Text>
          </Pressable>
          <Pressable style={[s.btn, s.btnGray]} onPress={again}>
            <Text style={[s.btnText, { color: A.label }]}>Again</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root:      { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: A.bg, padding: 24 },
  warn:      { fontSize: 15, color: A.orange, marginBottom: 20 },
  spin:      { marginVertical: 24 },
  timerWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  dot:       { width: 10, height: 10, borderRadius: 5, backgroundColor: A.red },
  timer:     { fontSize: 52, fontWeight: '200', color: A.red, fontVariant: ['tabular-nums'] },
  status:    { fontSize: 13, color: A.secondary, marginVertical: 16, textAlign: 'center' },
  row:       { flexDirection: 'row', gap: 12 },
  btn:       { backgroundColor: A.blue, paddingVertical: 15, paddingHorizontal: 30, borderRadius: 14, minWidth: 96, alignItems: 'center' },
  btnRec:    { backgroundColor: A.red, paddingHorizontal: 48 },
  btnGray:   { backgroundColor: A.fillBtn },
  btnText:   { color: '#fff', fontSize: 16, fontWeight: '600' },
});
