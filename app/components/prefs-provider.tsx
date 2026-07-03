import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { File, Paths } from 'expo-file-system';

// Tiny persisted app preferences (prefs.json in the document dir).
type Prefs = {
  onboarded: boolean;    // intro screen shown + permissions requested
  autoStart: boolean;    // start detection automatically when the pendant connects
};
const DEFAULTS: Prefs = { onboarded: false, autoStart: true };

type Ctx = Prefs & {
  ready: boolean;
  set: (patch: Partial<Prefs>) => void;
};

const PrefsContext = createContext<Ctx>({ ...DEFAULTS, ready: false, set: () => {} });
export const usePrefs = () => useContext(PrefsContext);

const STORE = () => new File(Paths.document, 'prefs.json');

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const f = STORE();
        if (f.exists) setPrefs({ ...DEFAULTS, ...JSON.parse(await f.text()) });
      } catch {}
      setReady(true);
    })();
  }, []);

  const set = useCallback((patch: Partial<Prefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        const f = STORE();
        f.create({ overwrite: true });
        f.write(JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  return (
    <PrefsContext.Provider value={{ ...prefs, ready, set }}>
      {children}
    </PrefsContext.Provider>
  );
}
