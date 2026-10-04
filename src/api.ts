// Tiny JSON client for the Canon REST API. Stores the session's CSRF token for writes.
import { useCallback, useEffect, useRef, useState } from 'react';

let csrf: string | null = null;
export const setCsrf = (t: string | null) => {
  csrf = t;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
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

async function request<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const headers: Record<string, string> = {};
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
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, msg);
  }
  if (raw) return res as unknown as T;
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  patch: <T>(p: string, b: unknown) => request<T>('PATCH', p, b),
  put: <T>(p: string, b: unknown) => request<T>('PUT', p, b),
  del: <T = { ok: true }>(p: string) => request<T>('DELETE', p),
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
