import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { File, Paths } from 'expo-file-system';

import { SERVER_URL as DEFAULT_URL } from '@/constants/config';

// Server URL is user-editable in Settings and persisted to a small JSON file in
// the app's document dir, so it survives restarts. detect.tsx reads it via useServerUrl().
const STORE = 'server.json';

type Ctx = { url: string; setUrl: (u: string) => void; ready: boolean };
const ServerUrlCtx = createContext<Ctx | null>(null);

export const useServerUrl = () => {
  const c = useContext(ServerUrlCtx);
  if (!c) throw new Error('useServerUrl must be used inside <ServerUrlProvider>');
  return c;
};

// Normalize: trim, strip trailing slash, prepend http:// if scheme missing.
export function normalizeUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, '');
  if (u && !/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

export function ServerUrlProvider({ children }: { children: React.ReactNode }) {
  const [url, setUrlState] = useState(DEFAULT_URL);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const f = new File(Paths.document, STORE);
        if (f.exists) {
          const saved = JSON.parse(await f.text())?.url;
          if (typeof saved === 'string' && saved) setUrlState(saved);
        }
      } catch {}
      setReady(true);
    })();
  }, []);

  const setUrl = useCallback((u: string) => {
    const norm = normalizeUrl(u);
    setUrlState(norm);
    try {
      const f = new File(Paths.document, STORE);
      f.create({ overwrite: true });
      f.write(JSON.stringify({ url: norm }));
    } catch {}
  }, []);

  return (
    <ServerUrlCtx.Provider value={{ url, setUrl, ready }}>
      {children}
    </ServerUrlCtx.Provider>
  );
}
