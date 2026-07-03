import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { File, Paths } from 'expo-file-system';

// One logged activity: a run of consecutive confident detections of the same
// label. Detect reports every tick; we sessionize here so "Apple Apple Apple"
// over 40s becomes a single event, not 40 rows.
export type ActivityEvent = {
  id: string;
  label: string;      // Apple / Cookie / Talking / Drinking / ...
  eating: boolean;
  start: number;      // epoch ms
  end: number;        // epoch ms (extends while the activity continues)
};

// A new detection of the same label within this gap extends the open event;
// anything longer closes it. Generous because inference ticks ~1-2s apart and
// chewing pauses briefly between bites.
const MERGE_GAP_MS = 12_000;
// Ignore blips: an event must last at least this long to be kept in the log.
const MIN_EVENT_MS = 3_000;
// Labels that are "nothing happening" — never logged.
const SKIP = new Set(['Silence', 'Unknown']);

type Ctx = {
  events: ActivityEvent[];
  report: (label: string | null, eating: boolean) => void;
  flush: () => void;   // force-commit the open event (call when detection stops)
  clear: () => void;
};

const EventsContext = createContext<Ctx>({ events: [], report: () => {}, flush: () => {}, clear: () => {} });
export const useEvents = () => useContext(EventsContext);

const STORE = () => new File(Paths.document, 'events.json');

export function EventsProvider({ children }: { children: React.ReactNode }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const openRef = useRef<ActivityEvent | null>(null);   // event still being extended
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load persisted log once.
  useEffect(() => {
    (async () => {
      try {
        const f = STORE();
        if (f.exists) {
          const parsed = JSON.parse(await f.text());
          if (Array.isArray(parsed)) setEvents(parsed);
        }
      } catch {} // corrupt/missing file -> start fresh
    })();
  }, []);

  // Debounced persist — detection ticks every second; don't write a file each tick.
  const persist = useCallback((list: ActivityEvent[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        const f = STORE();
        f.create({ overwrite: true });
        f.write(JSON.stringify(list.slice(-500))); // cap the log
      } catch {}
    }, 1500);
  }, []);

  const commitOpen = useCallback(() => {
    const ev = openRef.current;
    openRef.current = null;
    if (!ev || ev.end - ev.start < MIN_EVENT_MS) return; // too short, drop
    setEvents((prev) => {
      const next = [...prev, ev];
      persist(next);
      return next;
    });
  }, [persist]);

  // Called by Detect on every classified tick. label=null means quiet/unsure.
  const report = useCallback((label: string | null, eating: boolean) => {
    const now = Date.now();
    const open = openRef.current;

    if (!label || SKIP.has(label)) {
      // Nothing detectable — close the open event once the merge gap passes.
      if (open && now - open.end > MERGE_GAP_MS) commitOpen();
      return;
    }
    if (open && open.label === label && now - open.end <= MERGE_GAP_MS) {
      open.end = now; // same activity continues
      return;
    }
    if (open) commitOpen(); // label changed -> close previous
    openRef.current = { id: `${now}`, label, eating, start: now, end: now };
  }, [commitOpen]);

  const clear = useCallback(() => {
    openRef.current = null;
    setEvents([]);
    persist([]);
  }, [persist]);

  return (
    <EventsContext.Provider value={{ events, report, flush: commitOpen, clear }}>
      {children}
    </EventsContext.Provider>
  );
}
