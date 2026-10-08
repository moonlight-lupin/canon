// A stand-in for Google (sign-in and Drive) for tests, keeping its "Drive" in a folder on disk, so that two Canons
// in separate processes — the office computer and a new one after it was lost — share the same Drive. Only what
// Canon uses (server/lib/gdrive.ts): the device sign-in, the token, the folder, resumable uploads, listing,
// downloading and deleting. No internet; nothing real.
import fs from 'node:fs';
import path from 'node:path';

interface StoredFile { id: string; name: string; size: string; createdTime: string; parents: string[] }

export function fakeGoogle(store: string): typeof fetch {
  fs.mkdirSync(store, { recursive: true });
  const index = path.join(store, 'files.json');
  const load = (): StoredFile[] => (fs.existsSync(index) ? JSON.parse(fs.readFileSync(index, 'utf8')) as StoredFile[] : []);
  const save = (files: StoredFile[]) => fs.writeFileSync(index, JSON.stringify(files));
  const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  let pendingUpload: { name: string; parents: string[] } | null = null;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body;
    if (url.endsWith('/device/code')) return json({ device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 });
    if (url.endsWith('/token')) return json({ access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 3600 }); // the sign-in is approved at once
    if (url.endsWith('/revoke')) return json({});
    if (url.includes('/about?')) return json({ user: { emailAddress: 'office@example.org' } });
    if (url.includes('/drive/v3/files?fields=id') && method === 'POST') return json({ id: 'folder-1' });
    if (url.includes('/upload/drive/v3/files?uploadType=resumable')) {
      pendingUpload = JSON.parse(String(body)) as { name: string; parents: string[] };
      return new Response(null, { status: 200, headers: { Location: 'https://upload.example/session' } });
    }
    if (url === 'https://upload.example/session' && method === 'PUT') {
      const data = Buffer.from(body as Uint8Array);
      const files = load();
      const f: StoredFile = { id: `f${files.length + 1}-${Date.now()}`, name: pendingUpload!.name, size: String(data.length), createdTime: new Date().toISOString(), parents: pendingUpload!.parents };
      fs.writeFileSync(path.join(store, f.id), data);
      save([...files, f]);
      return json(f);
    }
    if (url.includes('/drive/v3/files?q=')) return json({ files: load().sort((a, b) => (a.createdTime < b.createdTime ? 1 : -1)) });
    const one = url.match(/\/drive\/v3\/files\/([\w-]+)(\?.*)?$/);
    if (one) {
      if (one[1] === 'folder-1') return json({ id: 'folder-1', trashed: false });
      const files = load();
      const f = files.find((x) => x.id === one[1]);
      if (!f) return json({ error: { message: 'File not found' } }, 404);
      if (method === 'DELETE') {
        save(files.filter((x) => x !== f));
        fs.rmSync(path.join(store, f.id), { force: true });
        return new Response(null, { status: 204 });
      }
      if (one[2]?.includes('alt=media')) return new Response(new Uint8Array(fs.readFileSync(path.join(store, f.id))));
      return json({ name: f.name, parents: f.parents });
    }
    return json({ error: { message: `unexpected ${method} ${url}` } }, 500);
  }) as typeof fetch;
}
