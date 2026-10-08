// Tiny JSON client for the Canon REST API. Stores the session's CSRF token for writes.
import { useCallback, useEffect, useRef, useState } from 'react';

let csrf: string | null = null;
export const setCsrf = (t: string | null) => {
  csrf = t;
};

export class ApiError extends Error {
  status: number;
  /** the server asks for a password (an encrypted backup) */
  needsPassword: boolean;
  /** …and it is the recovery key (a backup of an encrypted Canon, from another computer or an earlier key) */
  needsRecovery = false;
  constructor(status: number, message: string, needsPassword = false, needsRecovery = false) {
    super(message);
    this.needsRecovery = needsRecovery;
    this.status = status;
    this.needsPassword = needsPassword;
  }
}

type Listener = () => void;
const unauthorised = new Set<Listener>();
/** Subscribe to "session expired" events (any 401 from an authenticated call). */
export const onUnauthorised = (fn: Listener) => {
  unauthorised.add(fn);
  return () => {
    unauthorised.delete(fn);
  };
};

async function request<T>(method: string, path: string, body?: unknown, raw = false, version?: string | null, extra?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { ...extra };
  // the version this screen started from: the server refuses the save if someone else changed it since (409)
  if (version) headers['X-Base-Version'] = version;
  if (csrf && method !== 'GET') headers['X-CSRF-Token'] = csrf;
  let payload: BodyInit | undefined;
  if (body instanceof Blob) {
    // file upload sent as the raw body (e.g. the church logo)
    headers['Content-Type'] = body.type || 'application/octet-stream';
    payload = body;
  } else if (typeof body === 'string') {
    headers['Content-Type'] = 'text/csv';
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload, credentials: 'same-origin' });
  if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/me')) unauthorised.forEach((f) => f());
  if (!res.ok) {
    let msg = res.statusText;
    let needsPassword = false;
    let needsRecovery = false;
    try {
      const j = await res.json();
      msg = j.error ?? msg;
      needsPassword = !!j.needs_password;
      needsRecovery = !!j.needs_recovery;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg, needsPassword, needsRecovery);
  }
  if (raw) return res as unknown as T;
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T>(p: string, b: unknown, version?: string | null) => request<T>('PATCH', p, b, false, version),
  put: <T>(p: string, b: unknown, version?: string | null) => request<T>('PUT', p, b, false, version),
  del: <T = { ok: true }>(p: string) => request<T>('DELETE', p),
  /** a file as the raw body, with extra headers (e.g. an encrypted backup's password) */
  upload: <T>(p: string, file: Blob, headers?: Record<string, string>) => request<T>('POST', p, file, false, null, headers),
};

/** Build a query string, skipping empty values. */
export const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Fetch on mount / when `path` changes. Returns data, error, loading and a reload function. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api.get<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => {
    load();
  }, [load]);
  return { data, error, loading, reload: load, setData };
}
