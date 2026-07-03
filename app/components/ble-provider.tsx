import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';

// Lazy import — BleManager throws if the native module is absent (Expo Go).
let BleManagerClass: typeof import('react-native-ble-plx').BleManager | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy load so JS bundle survives Expo Go (no native module)
  BleManagerClass = require('react-native-ble-plx').BleManager;
} catch {}

export const AUDIO_SVC = '19b10000-e8f2-537e-4f6c-d104768a1214';
export const AUDIO_CHR = '19b10001-e8f2-537e-4f6c-d104768a1214';
export const CTRL_CHR  = '19b10002-e8f2-537e-4f6c-d104768a1214';
export const DEVICE_NAME = 'Nuna-Necklace';
// Firmware advertises "Nuna-Necklace" (older builds may still say "XIAO-Audio"). Match either.
const isOurDevice = (name?: string | null) => {
  if (!name) return false;
  const n = name.toLowerCase();
  return n.startsWith('nuna') || n.startsWith('xiao');
};

// One role: 'audio' = Record + Detect tabs (necklace, Nuna-Necklace).
export type Role = 'audio';
type ConnState = 'no-ble' | 'idle' | 'scanning' | 'connecting' | 'connected';

export type Found = { id: string; name: string; rssi: number };

type BleCtx = {
  noBle: boolean;
  devices: Found[];                                  // shared scan results
  scan: () => Promise<void>;
  deviceFor: (role: Role) => any | null;             // connected peripheral for role
  stateOf: (role: Role) => ConnState;
  statusOf: (role: Role) => string;
  connectTo: (role: Role, id: string) => Promise<void>;
  disconnect: (role: Role) => Promise<void>;
};

const Ctx = createContext<BleCtx | null>(null);
export const useBle = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useBle must be used inside <BleProvider>');
  return c;
};

const ROLE_LABEL: Record<Role, string> = { audio: 'necklace' };

export function BleProvider({ children }: { children: React.ReactNode }) {
  const [noBle, setNoBle] = useState(false);
  const [devices, setDevices] = useState<Found[]>([]);

  // per-role connection state
  const [devAudio, setDevAudio] = useState<any | null>(null);
  const [stAudio, setStAudio]   = useState<ConnState>('idle');
  const [msgAudio, setMsgAudio] = useState('Tap Scan, then pick the necklace');

  const setDev   = (_r: Role, v: any) => setDevAudio(v);
  const setState = (_r: Role, v: ConnState) => setStAudio(v);
  const setMsg   = (_r: Role, v: string) => setMsgAudio(v);

  const bleRef   = useRef<InstanceType<NonNullable<typeof BleManagerClass>> | null>(null);
  const foundRef = useRef<Map<string, any>>(new Map());   // id -> peripheral handle

  useEffect(() => {
    try {
      if (BleManagerClass) bleRef.current = new BleManagerClass();
    } catch {
      bleRef.current = null;
    }
    if (!bleRef.current) {
      setNoBle(true);
      setMsgAudio('BLE needs a dev build.\nRun: npx expo run:android');
      setStAudio('no-ble');
    }
    return () => { bleRef.current?.destroy(); };
  }, []);

  const requestPerms = async () => {
    if (Platform.OS !== 'android') return true;
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(res).every(r => r === PermissionsAndroid.RESULTS.GRANTED);
  };

  // Shared scan — fills the device list the tab picks from.
  const scan = useCallback(async () => {
    const ble = bleRef.current;
    if (!ble) return;
    if (!(await requestPerms())) return;
    foundRef.current.clear();
    setDevices([]);

    ble.startDeviceScan(null, { allowDuplicates: true }, (err: any, dev: any) => {
      if (err) return;
      if (!isOurDevice(dev?.name ?? dev?.localName)) return;
      foundRef.current.set(dev.id, dev);
      const list: Found[] = Array.from(foundRef.current.values())
        .map((d: any) => ({ id: d.id, name: d.name ?? d.localName ?? DEVICE_NAME, rssi: d.rssi ?? -100 }))
        .sort((a, b) => b.rssi - a.rssi);
      setDevices(list);
    });

    setTimeout(() => ble.stopDeviceScan(), 8000);
  }, []);

  const connectTo = useCallback(async (role: Role, id: string) => {
    const ble = bleRef.current;
    const dev = foundRef.current.get(id);
    if (!ble || !dev) return;
    ble.stopDeviceScan();
    setState(role, 'connecting');
    setMsg(role, 'Connecting…');
    try {
      let d = await dev.connect();
      try { d = await d.requestMTU(247); } catch {}
      await d.discoverAllServicesAndCharacteristics();
      d.onDisconnected(() => {
        setDev(role, null);
        setState(role, 'idle');
        setMsg(role, `${ROLE_LABEL[role]} disconnected. Tap Scan.`);
      });
      setDev(role, d);
      setState(role, 'connected');
      setMsg(role, `Connected · ${d.name ?? dev.name ?? dev.localName ?? DEVICE_NAME}`);
    } catch (e: any) {
      setState(role, 'idle');
      setMsg(role, e.message ?? 'Connection failed');
    }
  }, []);

  const disconnect = useCallback(async (role: Role) => {
    const d = devAudio;
    if (d) { try { await d.cancelConnection(); } catch {} }
    setDev(role, null);
    setState(role, 'idle');
    setMsg(role, 'Tap Scan, then pick the necklace');
  }, [devAudio]);

  const deviceFor = useCallback((_r: Role) => devAudio, [devAudio]);
  const stateOf   = useCallback((_r: Role) => stAudio, [stAudio]);
  const statusOf  = useCallback((_r: Role) => msgAudio, [msgAudio]);

  // Auto-scan: keep looking for the necklace while disconnected so the
  // "Device found" sheet can pop up on its own (no manual Scan tap).
  useEffect(() => {
    if (noBle) return;
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      if (stAudio !== 'connected' && stAudio !== 'connecting') scan();
    };
    tick();
    const id = setInterval(tick, 10000);   // scan window is ~8s; re-arm every 10s
    return () => { stopped = true; clearInterval(id); };
  }, [noBle, stAudio, scan]);

  return (
    <Ctx.Provider value={{ noBle, devices, scan, deviceFor, stateOf, statusOf, connectTo, disconnect }}>
      {children}
    </Ctx.Provider>
  );
}
