import React, { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { File, Paths } from 'expo-file-system';

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

// Standard Bluetooth Battery Service — firmware reports pendant charge here.
const BATT_SVC = '0000180f-0000-1000-8000-00805f9b34fb';
const BATT_CHR = '00002a19-0000-1000-8000-00805f9b34fb';

type BleCtx = {
  noBle: boolean;
  devices: Found[];                                  // shared scan results
  scan: () => Promise<void>;
  deviceFor: (role: Role) => any | null;             // connected peripheral for role
  stateOf: (role: Role) => ConnState;
  statusOf: (role: Role) => string;
  connectTo: (role: Role, id: string) => Promise<void>;
  disconnect: (role: Role) => Promise<void>;
  battery: number | null;                            // pendant battery %, null = unknown
  bondedId: string | null;                           // remembered pendant (auto-connect target)
  forget: () => void;                                // unbind: stop auto-connecting to it
};

// Remembered-pendant persistence (same pattern as server-url-provider).
const BOND_FILE = () => new File(Paths.document, 'pendant.json');

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

  // Live connection state for use inside long-lived callbacks (scan handler,
  // auto-connect timer) without stale-closure bugs.
  const stAudioRef = useRef<ConnState>('idle');
  useEffect(() => { stAudioRef.current = stAudio; }, [stAudio]);

  const bleRef   = useRef<InstanceType<NonNullable<typeof BleManagerClass>> | null>(null);
  const foundRef = useRef<Map<string, any>>(new Map());   // id -> peripheral handle

  // Remembered pendant: saved on first successful connect, auto-connected on
  // sight afterwards. forget() unbinds (Settings > Forget This Pendant).
  const [bondedId, setBondedId] = useState<string | null>(null);
  const bondedRef = useRef<string | null>(null);
  useEffect(() => { bondedRef.current = bondedId; }, [bondedId]);
  useEffect(() => {
    (async () => {
      try {
        const f = BOND_FILE();
        if (f.exists) {
          const id = JSON.parse(await f.text())?.id;
          if (typeof id === 'string' && id) setBondedId(id);
        }
      } catch {}
    })();
  }, []);
  const saveBond = useCallback((id: string | null) => {
    setBondedId(id);
    try {
      const f = BOND_FILE();
      if (id) { f.create({ overwrite: true }); f.write(JSON.stringify({ id })); }
      else if (f.exists) f.delete();
    } catch {}
  }, []);

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
  const connectToRef = useRef<((role: Role, id: string) => Promise<void>) | null>(null);

  // Shared post-connect setup: MTU, service discovery, disconnect handler,
  // remember-for-auto-connect. Takes an already-connected Device handle.
  const finishConnect = useCallback(async (role: Role, dRaw: any, id: string) => {
    let d = dRaw;
    try { d = await d.requestMTU(247); } catch {}
    await d.discoverAllServicesAndCharacteristics();
    d.onDisconnected(() => {
      setDev(role, null);
      setState(role, 'idle');
      // "Reconnecting…" — the auto-connect timer picks a bonded pendant back up.
      setMsg(role, bondedRef.current ? `${ROLE_LABEL[role]} disconnected. Reconnecting…`
                                     : `${ROLE_LABEL[role]} disconnected. Tap Scan.`);
    });
    setDev(role, d);
    setState(role, 'connected');
    setMsg(role, `Connected · ${d.name ?? DEVICE_NAME}`);
    saveBond(id);                 // remember: auto-connect to this pendant from now on
  }, [saveBond]);

  // Manual connect from the scan list (falls back to direct-by-id if the
  // peripheral handle isn't cached).
  const connectTo = useCallback(async (role: Role, id: string) => {
    const ble = bleRef.current;
    if (!ble) return;
    ble.stopDeviceScan();
    setState(role, 'connecting');
    setMsg(role, 'Connecting…');
    try {
      const dev = foundRef.current.get(id);
      const dRaw = dev ? await dev.connect() : await ble.connectToDevice(id, { timeout: 12000 });
      await finishConnect(role, dRaw, id);
    } catch (e: any) {
      setState(role, 'idle');
      setMsg(role, e.message ?? 'Connection failed');
    }
  }, [finishConnect]);
  useEffect(() => { connectToRef.current = connectTo; }, [connectTo]);

  // Auto-connect by id: connect straight to a known MAC without waiting to see
  // it advertise (Android caches the address). Used by the auto-connect timer.
  const connectById = useCallback(async (role: Role, id: string) => {
    const ble = bleRef.current;
    if (!ble) return;
    if (stAudioRef.current === 'connected' || stAudioRef.current === 'connecting') return;
    ble.stopDeviceScan();
    setState(role, 'connecting');
    setMsg(role, 'Connecting…');
    try {
      const d = await ble.connectToDevice(id, { timeout: 12000, autoConnect: false });
      await finishConnect(role, d, id);
    } catch {
      // pendant out of range / not ready yet — timer retries.
      setState(role, 'idle');
      setMsg(role, 'Reconnecting…');
    }
  }, [finishConnect]);
  const connectByIdRef = useRef(connectById);
  useEffect(() => { connectByIdRef.current = connectById; }, [connectById]);

  const disconnect = useCallback(async (role: Role) => {
    const d = devAudio;
    if (d) { try { await d.cancelConnection(); } catch {} }
    setDev(role, null);
    setState(role, 'idle');
    setMsg(role, 'Tap Scan, then pick the necklace');
  }, [devAudio]);

  // Unbind: forget the remembered pendant AND drop the current connection —
  // otherwise auto-scan re-pairs it seconds later.
  const forget = useCallback(() => {
    saveBond(null);
    disconnect('audio');
  }, [saveBond, disconnect]);

  const deviceFor = useCallback((_r: Role) => devAudio, [devAudio]);
  const stateOf   = useCallback((_r: Role) => stAudio, [stAudio]);
  const statusOf  = useCallback((_r: Role) => msgAudio, [msgAudio]);

  // Pendant battery: read on connect, then poll every 60s (firmware refreshes
  // its Battery Service at the same rate). Old firmware without the service
  // just leaves this null — UI hides the gauge.
  const [battery, setBattery] = useState<number | null>(null);
  useEffect(() => {
    if (!devAudio) { setBattery(null); return; }
    let dead = false;
    const read = async () => {
      try {
        const chr = await devAudio.readCharacteristicForService(BATT_SVC, BATT_CHR);
        if (!dead && chr?.value) setBattery(atob(chr.value).charCodeAt(0));
      } catch { /* service absent on old firmware */ }
    };
    read();
    const id = setInterval(read, 60000);
    return () => { dead = true; clearInterval(id); };
  }, [devAudio]);

  // Auto-connect to the remembered pendant: as soon as BLE powers on (and on a
  // retry timer) connect straight to its address — no waiting to spot it in a
  // scan. This is what makes reconnection hands-free after the first pairing.
  useEffect(() => {
    const ble = bleRef.current;
    if (!ble || noBle || !bondedId) return;
    let stopped = false;
    const tryConnect = () => {
      if (!stopped && stAudioRef.current === 'idle') connectByIdRef.current?.('audio', bondedId);
    };
    const sub = ble.onStateChange((st) => { if (st === 'PoweredOn') tryConnect(); }, true);
    const iv = setInterval(tryConnect, 6000);   // retry until it comes into range
    return () => { stopped = true; sub.remove(); clearInterval(iv); };
  }, [noBle, bondedId]);

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
    <Ctx.Provider value={{ noBle, devices, scan, deviceFor, stateOf, statusOf, connectTo, disconnect, battery, bondedId, forget }}>
      {children}
    </Ctx.Provider>
  );
}
