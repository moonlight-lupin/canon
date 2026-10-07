// Settings → Backups → Google Drive (0.16.1): the church's own Google client, connecting with a code at
// google.com/device, then every encrypted backup is also sent to a "Canon backups" folder in that Drive.
import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, confirmAction, fmtDate, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { GuideLink } from '../template-ui.tsx';

interface DriveStatus {
  configured: boolean;
  client_id: string;
  connected: boolean;
  email: string | null;
  connected_at: string | null;
  keep: number;
  last: { at: string; ok: boolean; file?: string; error?: string } | null;
}
interface DriveFile { id: string; name: string; size: number; created: string }
interface Code { user_code: string; verification_url: string; expires_in: number; interval: number }

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

export function DriveCard({ encrypted, onCopied }: { encrypted: boolean; onCopied: () => void }) {
  const { t, lang } = useI18n();
  const { run, busy } = useAction();
  const st = useApi<DriveStatus>('/backups/drive');
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState<Code | null>(null);
  const [waitMsg, setWaitMsg] = useState<string | null>(null);
  const [keep, setKeep] = useState(8);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const s = st.data;

  useEffect(() => {
    if (s) setKeep(s.keep);
  }, [s?.keep]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!s) return null;
  const when = (iso: string) => `${fmtDate(iso.slice(0, 10), lang, { day: 'numeric', month: 'short', year: 'numeric' })} ${iso.slice(11, 16)}`;

  const saveClient = () => run(async () => {
    await api.put('/backups/drive/client', { client_id: clientId, client_secret: secret });
    setEditing(false);
    setSecret('');
    await st.reload();
  }, t('Google client saved.'));

  const poll = (interval: number) => {
    timer.current = window.setTimeout(async () => {
      try {
        const r = await api.post<{ state: string; email?: string | null; interval?: number }>('/backups/drive/connect/poll', {});
        if (r.state === 'pending') return poll(r.interval ?? interval);
        setCode(null);
        if (r.state === 'connected') {
          setWaitMsg(null);
          await st.reload();
        } else setWaitMsg(r.state === 'denied' ? t('Access was not allowed in Google. Press Connect to try again.') : t('The code expired. Press Connect for a new one.'));
      } catch (e) {
        setCode(null);
        setWaitMsg((e as Error).message);
      }
    }, interval * 1000);
  };
  const connect = () => run(async () => {
    setWaitMsg(null);
    const c = await api.post<Code>('/backups/drive/connect', {});
    setCode(c);
    poll(c.interval);
  });
  const disconnect = () => {
    if (!confirmAction(t('Disconnect Google Drive? Canon stops sending backups there; the backups already in Drive stay.'))) return;
    run(async () => {
      await api.post('/backups/drive/disconnect', {});
      setFiles(null);
      await st.reload();
    }, t('Google Drive disconnected.'));
  };
  const sendNow = () => run(async () => {
    await api.post('/backups/drive/upload', {});
    await st.reload();
    if (files) setFiles((await api.get<{ files: DriveFile[] }>('/backups/drive/files')).files);
  }, t('Sent to Google Drive.'));
  const showFiles = () => run(async () => setFiles((await api.get<{ files: DriveFile[] }>('/backups/drive/files')).files));
  const copy = (f: DriveFile) => run(async () => {
    await api.post(`/backups/drive/files/${encodeURIComponent(f.id)}/copy`, {});
    onCopied();
  }, t('Copied to this computer: it is in Saved backups, to restore from there.'));
  const saveKeep = () => run(async () => {
    await api.put('/backups/drive/settings', { keep });
    await st.reload();
  }, t('Saved.'));

  return (
    <section className="card stack">
      <div className="row between">
        <h3 style={{ margin: 0 }}>{t('Google Drive')}</h3>
        <div className="row">
          {s.connected ? <span className="badge ok"><Icon name="check" />{t('Connected')}</span> : <span className="badge">{t('Not connected')}</span>}
          <GuideLink anchor="google-drive" />
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t('Also send every backup to a “Canon backups” folder in the church’s Google Drive, keeping the newest ones. Canon sees only the files it puts there. It uses your church’s own Google sign-in client — the guide shows how to make one (about 10 minutes, once).')}
      </p>
      {!encrypted && <div className="callout warn small">{t('Set a backup password first (Encryption, above): Canon only sends encrypted backups to Google Drive.')}</div>}

      {(!s.configured || editing) && (
        <>
          <div className="form-grid">
            <Field label={t('Client ID')} hint={t('Ends with .apps.googleusercontent.com')}>
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} autoComplete="off" placeholder="123456789-abc….apps.googleusercontent.com" />
            </Field>
            <Field label={t('Client secret')}>
              <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} spellCheck={false} autoComplete="off" placeholder="GOCSPX-…" />
            </Field>
          </div>
          <div className="row end">
            {editing && <button className="btn" onClick={() => setEditing(false)} disabled={busy}>{t('Cancel')}</button>}
            <button className="btn primary" onClick={saveClient} disabled={busy || !clientId.trim() || !secret.trim()}>{t('Save')}</button>
          </div>
        </>
      )}

      {s.configured && !editing && !s.connected && (
        <div className="stack">
          <div className="small muted">{t('Google client')}: <span className="code">{s.client_id}</span> <button type="button" className="btn sm ghost" onClick={() => { setClientId(s.client_id); setEditing(true); }}>{t('Change')}</button></div>
          {code ? (
            <div className="callout lapis stack" role="status">
              <div>{t('On any computer or phone, open')} <a href={code.verification_url} target="_blank" rel="noreferrer"><strong>{code.verification_url.replace(/^https?:\/\//, '')}</strong></a> {t('and enter this code:')}</div>
              <div style={{ font: '700 28px/1.2 var(--mono)', letterSpacing: '0.12em' }}>{code.user_code}</div>
              <div className="small muted">{t('Sign in with the church’s Google account and allow access. This page notices by itself.')}</div>
            </div>
          ) : (
            <div className="row"><button className="btn primary" onClick={connect} disabled={busy}><Icon name="link" />{t('Connect Google Drive')}</button></div>
          )}
          {waitMsg && <div className="callout warn small">{waitMsg}</div>}
        </div>
      )}

      {s.connected && !editing && (
        <div className="stack">
          <div className="small">
            {t('Connected to')} <strong>{s.email ?? t('a Google account')}</strong>{s.connected_at ? ` · ${when(s.connected_at)}` : ''}
          </div>
          {s.last && (
            <div className={`callout small ${s.last.ok ? 'lapis' : 'warn'}`}>
              {s.last.ok
                ? t('Last sent: {file}, {when}.').replace('{file}', s.last.file ?? '').replace('{when}', when(s.last.at))
                : t('The last upload failed ({when}): {error}').replace('{when}', when(s.last.at)).replace('{error}', s.last.error ?? '')}
            </div>
          )}
          <Field label={t('Keep the newest in Drive')} hint={t('Older backups in Canon’s Drive folder are deleted after each upload.')}>
            <div className="row">
              <input type="number" min={1} max={365} value={keep} onChange={(e) => setKeep(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} style={{ width: 110 }} />
              {keep !== s.keep && <button className="btn" onClick={saveKeep} disabled={busy}>{t('Save')}</button>}
            </div>
          </Field>
          <div className="row">
            <button className="btn" onClick={sendNow} disabled={busy || !encrypted}><Icon name="upload" />{t('Send the newest backup now')}</button>
            <button className="btn" onClick={showFiles} disabled={busy}><Icon name="list" />{t('Backups in Drive')}</button>
            <div className="grow" />
            <button className="btn ghost danger" onClick={disconnect} disabled={busy}>{t('Disconnect')}</button>
          </div>
          {files && (
            files.length ? (
              <div className="table-wrap">
                <table className="t">
                  <tbody>
                    {files.map((f) => (
                      <tr key={f.id}>
                        <td className="nowrap"><strong>{when(f.created)}</strong><div className="small muted">{f.name}</div></td>
                        <td className="right small muted nowrap">{mb(f.size)}</td>
                        <td className="right nowrap">
                          <button className="btn sm" onClick={() => copy(f)} disabled={busy} title={t('Copy it into Saved backups on this computer; restore it from there.')}><Icon name="download" />{t('Copy to this computer')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="empty small">{t('No backups in Drive yet.')}</div>
          )}
        </div>
      )}
    </section>
  );
}
