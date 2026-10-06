// Public page of a sheet-music upload link (0.15.5): add photos, scans or PDFs of one song's music from a phone,
// without signing in, until the link expires. Each file is sent on its own, in the order chosen.
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, Loading } from '../components/ui.tsx';
import { Icon, ReedMark } from '../components/icons.tsx';
import type { L10n } from '../types-client.ts';
import './outputs.css';

interface Info { title: L10n; numbers: string[]; pages: number; expires_at: string; left: number }
type Done = { name: string; ok: boolean; error?: string };

export default function UploadPage() {
  const { token } = useParams();
  const { t } = useI18n();
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done[]>([]);
  const pick = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const load = () => api.get<Info>(`/upload/${encodeURIComponent(token ?? '')}`).then(setInfo).catch((e: Error) => setErr(e instanceof ApiError ? e.message : t('This link does not work.')));
  useEffect(() => {
    void load();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      try {
        await api.upload(`/upload/${encodeURIComponent(token ?? '')}?name=${encodeURIComponent(f.name || 'photo.jpg')}`, f);
        setDone((d) => [...d, { name: f.name || 'photo', ok: true }]);
      } catch (e) {
        setDone((d) => [...d, { name: f.name || 'photo', ok: false, error: (e as Error).message }]);
      }
    }
    setBusy(false);
    void load();
  };

  if (err) {
    return (
      <div className="sh-root up-root">
        <div className="sh-error"><ReedMark className="sh-mark" /><h1>{t('This upload link does not work any more')}</h1><p>{err}</p></div>
      </div>
    );
  }
  if (!info) return <Loading />;
  return (
    <div className="sh-root up-root">
      <div className="sh-church">{t('Sheet music')}</div>
      <h1 className="sh-title"><Bi v={info.title} /></h1>
      {info.numbers.length > 0 && <div className="sh-date">{info.numbers.join(' · ')}</div>}
      <p className="small muted">{t('{n} page(s) so far. Add the pages in order; each file becomes the next page.').replace('{n}', String(info.pages))}</p>
      <div className="up-buttons">
        <button type="button" className="btn primary" disabled={busy || info.left <= 0} onClick={() => camera.current?.click()}><Icon name="upload" />{t('Take a photo')}</button>
        <button type="button" className="btn" disabled={busy || info.left <= 0} onClick={() => pick.current?.click()}><Icon name="file" />{t('Choose files')}</button>
        <input ref={camera} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { void send(e.target.files); e.target.value = ''; }} />
        <input ref={pick} type="file" hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => { void send(e.target.files); e.target.value = ''; }} />
      </div>
      {busy && <p className="small">{t('Sending…')}</p>}
      {done.length > 0 && (
        <ul className="up-done">
          {done.map((d, i) => <li key={i} className={d.ok ? 'ok' : 'bad'}><Icon name={d.ok ? 'check' : 'alert'} /> {d.name}{d.error ? ` — ${d.error}` : ''}</li>)}
        </ul>
      )}
      <p className="small muted">{t('PNG, JPEG, WebP or PDF, up to 10 MB each. The link works until {when}.').replace('{when}', new Date(info.expires_at).toLocaleString())}</p>
    </div>
  );
}
