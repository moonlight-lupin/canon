// Backups to Google Drive (0.16.1). Each church uses its own Google sign-in client ("TV and Limited Input devices",
// made in its own Google Cloud project — see the user guide, "Backups to Google Drive"), so nothing depends on the
// Canon project. Sign-in is Google's device flow: Canon shows a short code, an administrator enters it at
// google.com/device in any browser — no return address, so it works the same on an office PC and in Docker.
// The scope is drive.file: Canon sees and deletes only the files it put there, never the rest of the Drive.
// Only encrypted backups (.db.enc, with the church's backup password) are ever sent.
import fs from 'node:fs';
import path from 'node:path';
import { deleteMeta, getMeta, setMeta } from '../repo/settings.ts';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const OAUTH = 'https://oauth2.googleapis.com';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_NAME = 'Canon backups';
const META = 'gdrive';

export interface DriveConfig {
  client_id: string;
  client_secret: string;
  refresh_token?: string;
  folder_id?: string;
  email?: string;
  connected_at?: string;
  /** how many backups to keep in Drive */
  keep: number;
  /** the newest local backup sent, so one is not sent twice */
  uploaded?: string;
  last?: { at: string; ok: boolean; file?: string; error?: string };
}

/** For tests: answer Google's requests without the internet. */
let http: typeof fetch = (input, init) => fetch(input, init);
export const setDriveFetch = (f: typeof fetch | null) => {
  http = f ?? ((input, init) => fetch(input, init));
  access = null;
};

export class DriveError extends Error {
  status = 400;
}

export function driveConfig(): DriveConfig | null {
  try {
    return JSON.parse(getMeta(META) ?? 'null') as DriveConfig | null;
  } catch {
    return null;
  }
}
const save = (c: DriveConfig) => setMeta(META, JSON.stringify(c));
export const forgetDrive = () => deleteMeta(META);
/** For restoring a backup: the connection belongs to this computer, not to the data. */
export const driveMeta = () => getMeta(META) ?? null;
export const putDriveMeta = (v: string | null) => (v ? setMeta(META, v) : deleteMeta(META));

/** What Settings → Backups shows (no secrets). */
export function driveStatus() {
  const c = driveConfig();
  return {
    configured: !!c?.client_id,
    client_id: c?.client_id ?? '',
    connected: !!c?.refresh_token,
    email: c?.email ?? null,
    connected_at: c?.connected_at ?? null,
    keep: c?.keep ?? 8,
    last: c?.last ?? null,
  };
}

/** Save the church's Google client (from its Google Cloud project). A different client needs connecting again. */
export function setDriveClient(clientId: string, clientSecret: string) {
  const id = clientId.trim();
  const secret = clientSecret.trim();
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) throw new DriveError('The Client ID looks wrong: it ends with .apps.googleusercontent.com. Copy it again from Google Cloud Console → Credentials.');
  if (!/^[\w-]{10,}$/.test(secret)) throw new DriveError('The Client secret looks wrong. Copy it again from Google Cloud Console → Credentials (it often starts with GOCSPX-).');
  const cur = driveConfig();
  const same = cur?.client_id === id;
  save({ client_id: id, client_secret: secret, keep: cur?.keep ?? 8, ...(same ? { refresh_token: cur?.refresh_token, folder_id: cur?.folder_id, email: cur?.email, connected_at: cur?.connected_at, uploaded: cur?.uploaded, last: cur?.last } : {}) });
}

export function setDriveKeep(keep: number) {
  const c = driveConfig();
  if (!c) throw new DriveError('Add the Google client first.');
  save({ ...c, keep });
}

async function form(url: string, body: Record<string, string>) {
  const r = await http(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, j };
}

// ---------------------------------------------------------------- connecting (device flow)

let pending: { device_code: string; expires: number; interval: number } | null = null;

/** Ask Google for a code to enter at google.com/device. */
export async function startDriveConnect() {
  const c = driveConfig();
  if (!c?.client_id) throw new DriveError('Add the Google client first.');
  const r = await form(`${OAUTH}/device/code`, { client_id: c.client_id, scope: DRIVE_SCOPE });
  if (!r.ok) throw new DriveError(googleProblem(r.j, 'Google did not give a sign-in code'));
  pending = { device_code: String(r.j.device_code), expires: Date.now() + Number(r.j.expires_in ?? 1800) * 1000, interval: Number(r.j.interval ?? 5) };
  return {
    user_code: String(r.j.user_code),
    verification_url: String(r.j.verification_url ?? r.j.verification_uri ?? 'https://www.google.com/device'),
    expires_in: Number(r.j.expires_in ?? 1800),
    interval: pending.interval,
  };
}

/** Has the code been entered and approved yet? The page asks every few seconds. */
export async function pollDriveConnect(): Promise<{ state: 'pending' | 'connected' | 'denied' | 'expired'; email?: string | null; interval?: number }> {
  const c = driveConfig();
  if (!c || !pending) return { state: 'expired' };
  if (Date.now() > pending.expires) {
    pending = null;
    return { state: 'expired' };
  }
  const r = await form(`${OAUTH}/token`, {
    client_id: c.client_id, client_secret: c.client_secret, device_code: pending.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (!r.ok) {
    const e = String(r.j.error ?? '');
    if (e === 'authorization_pending') return { state: 'pending', interval: pending.interval };
    if (e === 'slow_down') {
      pending.interval += 5;
      return { state: 'pending', interval: pending.interval };
    }
    pending = null;
    if (e === 'access_denied') return { state: 'denied' };
    if (e === 'expired_token') return { state: 'expired' };
    throw new DriveError(googleProblem(r.j, 'Google did not accept the sign-in'));
  }
  pending = null;
  if (!r.j.refresh_token) throw new DriveError('Google did not give Canon a lasting sign-in. Disconnect Canon in your Google account (myaccount.google.com → Security → Third-party connections), then connect again.');
  access = { token: String(r.j.access_token), until: Date.now() + (Number(r.j.expires_in ?? 3600) - 60) * 1000 };
  const next: DriveConfig = { ...c, refresh_token: String(r.j.refresh_token), connected_at: new Date().toISOString(), folder_id: undefined, email: undefined };
  save(next);
  // who it is, and the folder, now (so problems show straight away)
  const email = await accountEmail().catch(() => null);
  save({ ...driveConfig()!, email: email ?? undefined });
  await ensureFolder();
  return { state: 'connected', email };
}

/** Disconnect: Google forgets Canon's access, and Canon its sign-in (the backups in Drive stay). */
export async function disconnectDrive() {
  const c = driveConfig();
  if (c?.refresh_token) await form(`${OAUTH}/revoke`, { token: c.refresh_token }).catch(() => undefined);
  access = null;
  if (c) save({ client_id: c.client_id, client_secret: c.client_secret, keep: c.keep });
}

// ---------------------------------------------------------------- calls to Drive

let access: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (access && access.until > Date.now()) return access.token;
  const c = driveConfig();
  if (!c?.refresh_token) throw new DriveError('Google Drive is not connected.');
  const r = await form(`${OAUTH}/token`, { client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token, grant_type: 'refresh_token' });
  if (!r.ok) {
    if (r.j.error === 'invalid_grant') {
      // the sign-in was withdrawn, expired (a Google app left "In testing" expires them after 7 days) or the password changed
      save({ ...c, refresh_token: undefined });
      throw new DriveError('Google ended Canon’s access (it was disconnected, expired, or the account’s password changed). Connect Google Drive again. If it keeps happening after about a week, set the app to “In production” in Google Cloud Console (see the guide).');
    }
    throw new DriveError(googleProblem(r.j, 'Google did not renew Canon’s access'));
  }
  access = { token: String(r.j.access_token), until: Date.now() + (Number(r.j.expires_in ?? 3600) - 60) * 1000 };
  return access.token;
}

async function api(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken();
  const r = await http(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } });
  if (r.status === 401) access = null;
  return r;
}
async function apiJson<T>(url: string, init: RequestInit = {}, what = 'Google Drive did not answer'): Promise<T> {
  const r = await api(url, init);
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new DriveError(googleProblem(j, what));
  return j as T;
}

async function accountEmail(): Promise<string | null> {
  const j = await apiJson<{ user?: { emailAddress?: string } }>(`${API}/about?fields=user(emailAddress)`);
  return j.user?.emailAddress ?? null;
}

/** The "Canon backups" folder Canon made in the Drive (made again if it was deleted). */
async function ensureFolder(): Promise<string> {
  const c = driveConfig()!;
  if (c.folder_id) {
    const r = await api(`${API}/files/${encodeURIComponent(c.folder_id)}?fields=id,trashed`);
    const j = (await r.json().catch(() => ({}))) as { trashed?: boolean };
    if (r.ok && !j.trashed) return c.folder_id;
  }
  const f = await apiJson<{ id: string }>(`${API}/files?fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  }, 'Canon could not make its folder in Google Drive');
  save({ ...driveConfig()!, folder_id: f.id });
  return f.id;
}

export interface DriveFile { id: string; name: string; size: number; created: string }

/** The backups in Canon's Drive folder, newest first. */
export async function listDriveBackups(): Promise<DriveFile[]> {
  const folder = await ensureFolder();
  const q = encodeURIComponent(`'${folder}' in parents and trashed = false`);
  const j = await apiJson<{ files?: { id: string; name: string; size?: string; createdTime: string }[] }>(
    `${API}/files?q=${q}&orderBy=createdTime desc&pageSize=200&fields=files(id,name,size,createdTime)`,
  );
  return (j.files ?? []).filter((f) => /^canon-.*\.db\.enc$/.test(f.name)).map((f) => ({ id: f.id, name: f.name, size: Number(f.size ?? 0), created: f.createdTime }));
}

/** Send one encrypted backup to Drive (a resumable upload: the folder's metadata, then the file). */
export async function uploadToDrive(file: string): Promise<DriveFile> {
  if (!file.endsWith('.db.enc')) throw new DriveError('Canon only sends encrypted backups to Google Drive. Set a backup password in Settings → Backups first.');
  const folder = await ensureFolder();
  const name = path.basename(file);
  const data = fs.readFileSync(file);
  const start = await api(`${UPLOAD}/files?uploadType=resumable&fields=id,name,size,createdTime`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': String(data.length) },
    body: JSON.stringify({ name, parents: [folder], description: 'Canon backup, encrypted with the church’s backup password' }),
  });
  const where = start.headers.get('location');
  if (!start.ok || !where) throw new DriveError(googleProblem(await start.json().catch(() => ({})), 'Google Drive did not accept the upload'));
  const put = await api(where, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) }, body: new Uint8Array(data) });
  const j = (await put.json().catch(() => ({}))) as { id?: string; name?: string; size?: string; createdTime?: string };
  if (!put.ok || !j.id) throw new DriveError(googleProblem(j, 'The upload to Google Drive did not finish'));
  return { id: j.id, name: j.name ?? name, size: Number(j.size ?? data.length), created: j.createdTime ?? new Date().toISOString() };
}

/** Keep the newest `keep` backups in Drive; delete older ones (only Canon's own files). */
export async function pruneDrive(keep: number): Promise<number> {
  if (keep <= 0) return 0;
  const old = (await listDriveBackups()).slice(keep);
  for (const f of old) await api(`${API}/files/${encodeURIComponent(f.id)}`, { method: 'DELETE' });
  return old.length;
}

/** A backup's bytes from Drive (to copy into this computer's backup folder, then restore as usual). */
export async function downloadFromDrive(id: string): Promise<{ name: string; data: Buffer }> {
  const meta = await apiJson<{ name: string; parents?: string[] }>(`${API}/files/${encodeURIComponent(id)}?fields=name,parents`);
  if (!/^canon-.*\.db\.enc$/.test(meta.name)) throw new DriveError('That file is not a Canon backup.');
  const r = await api(`${API}/files/${encodeURIComponent(id)}?alt=media`);
  if (!r.ok) throw new DriveError(googleProblem(await r.json().catch(() => ({})), 'Google Drive did not send the file'));
  return { name: meta.name, data: Buffer.from(await r.arrayBuffer()) };
}

/**
 * After a backup (Settings → Backups, the schedule, or `npm run backup` noticed later): send the newest local
 * encrypted backup if it hasn't been, then keep the newest N in Drive. Never throws: the result is recorded for
 * Settings → Backups and the log.
 */
export async function syncToDrive(newest: { name: string; path: string } | null, log: (s: string) => void = console.log): Promise<void> {
  const c = driveConfig();
  if (!c?.refresh_token || !newest || c.uploaded === newest.name) return;
  try {
    const f = await uploadToDrive(newest.path);
    const removed = await pruneDrive(c.keep);
    save({ ...driveConfig()!, uploaded: newest.name, last: { at: new Date().toISOString(), ok: true, file: f.name } });
    log(`backup: sent ${f.name} to Google Drive${removed ? `, removed ${removed} old there` : ''}`);
  } catch (e) {
    const msg = (e as Error).message;
    save({ ...driveConfig()!, last: { at: new Date().toISOString(), ok: false, file: newest.name, error: msg } });
    log(`backup: could not send ${newest.name} to Google Drive — ${msg}`);
  }
}

function googleProblem(j: Record<string, unknown>, fallback: string): string {
  const e = j?.error as unknown;
  const desc = typeof j?.error_description === 'string' ? j.error_description : typeof e === 'object' && e ? String((e as { message?: string }).message ?? '') : '';
  const code = typeof e === 'string' ? e : '';
  if (code === 'invalid_client') return 'Google does not recognise the Client ID and secret. Check them in Google Cloud Console → Credentials (the client type must be “TV and Limited Input devices”).';
  if (code === 'unauthorized_client') return 'This Google client cannot be used for this sign-in. Make a new one of type “TV and Limited Input devices” (see the guide).';
  if (/has not been used|is disabled|accessNotConfigured/i.test(desc)) return 'The Google Drive API is not switched on in the Google Cloud project. Switch it on (APIs & Services → Library → Google Drive API → Enable), wait a minute, then try again.';
  if (/storageQuotaExceeded|quota/i.test(desc)) return 'The Google Drive is full. Free some space or use another account.';
  return `${fallback}${desc ? `: ${desc}` : code ? ` (${code})` : '.'}`;
}
