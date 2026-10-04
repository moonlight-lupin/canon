// Settings → Backups: back up now, automatic schedule, backup folder, list / download / restore / delete.
import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { ErrorBox, Field, Loading, Seg, confirmAction, fmtDate, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';

interface BackupFile { name: string; size: number; created: string }
interface Status {
  dir: string;
  default_dir: string;
  settings: { dir: string; auto: 'off' | 'daily' | 'weekly'; keep: number };
  last: string | null;
  next: string | null;
  folder_problem: string | null;
  items: BackupFile[];
  last_restore: { at: string; from: string; safety: string } | null;
}

const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

export default function BackupsTab() {
  const { t, lang } = useI18n();
  const { run, busy } = useAction();
  const st = useApi<Status>('/backups');
  const [dir, setDir] = useState('');
  const [auto, setAuto] = useState<Status['settings']['auto']>('weekly');
  const [keep, setKeep] = useState(8);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!st.data) return;
    setDir(st.data.settings.dir);
    setAuto(st.data.settings.auto);
    setKeep(st.data.settings.keep);
  }, [st.data]);

  if (st.error) return <ErrorBox error={st.error} />;
  if (!st.data) return <Loading />;
  const s = st.data;
  // the date on this computer's calendar (the ISO string is UTC: early-morning backups showed the day before)
  const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const when = (iso: string | null) =>
    iso ? `${fmtDate(localDay(new Date(iso)), lang, { day: 'numeric', month: 'short', year: 'numeric' })} ${new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '—';
  const dirty = dir.trim() !== s.settings.dir || auto !== s.settings.auto || keep !== s.settings.keep;

  const backupNow = () => run(async () => {
    const r = await api.post<Status & { created: string }>('/backups');
    st.setData(r);
  }, t('Backup saved.'));
  const save = () => run(async () => {
    const r = await api.put<Status>('/backups/settings', { dir: dir.trim(), auto, keep });
    st.setData(r);
    setCheck(null);
  }, t('Saved.'));
  const testFolder = () => run(async () => setCheck(await api.post<{ ok: boolean; message: string }>('/backups/check-folder', { dir: dir.trim() })));
  // Restoring replaces everything; the server saves a copy of the current data first, so it can be undone.
  const restoreWarning = (what: string) =>
    `${t('Replace ALL of Canon’s data with this backup?')}\n\n${what}\n\n${t('Canon first saves a copy of the current data, so you can undo this by restoring that copy. Changes made since the backup are lost. You may need to sign in again.')}`;
  const afterRestore = (r: { safety: string }) => {
    window.alert(`${t('Backup restored.')}\n${t('A copy of the data from before the restore was saved as')} ${r.safety}.`);
    window.location.reload();
  };
  const restore = (b: BackupFile) => {
    if (!confirmAction(restoreWarning(`${when(b.created)} · ${b.name}`))) return;
    run(async () => afterRestore(await api.post<{ safety: string }>(`/backups/${encodeURIComponent(b.name)}/restore`)));
  };
  const restoreFile = (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!confirmAction(restoreWarning(file.name))) return;
    run(async () => afterRestore(await api.post<{ safety: string }>('/backups/restore-upload', file)));
  };
  const remove = (b: BackupFile) => {
    if (!confirmAction(`${t('Delete this backup?')} ${b.name}`)) return;
    run(async () => st.setData(await api.del<Status>(`/backups/${encodeURIComponent(b.name)}`)));
  };

  return (
    <div className="stack">
      <section className="card stack">
        <div className="row between">
          <div>
            <h2>{t('Backups')}</h2>
            <div className="small muted">
              {t('Last backup')}: <strong>{when(s.last)}</strong>
              {s.next && <> · {t('Next automatic backup')}: {when(s.next)}</>}
            </div>
          </div>
          <button className="btn primary" onClick={backupNow} disabled={busy || !!s.folder_problem}><Icon name="download" />{t('Back up now')}</button>
        </div>
        {s.folder_problem && <div className="callout warn small">{s.folder_problem}</div>}
        <p className="small muted" style={{ margin: 0 }}>
          {t('A backup is a complete copy of Canon’s database — members, services, library and settings. It is made safely while Canon is running.')}
        </p>
      </section>

      <section className="card stack">
        <h3>{t('Automatic backups')}</h3>
        <div className="form-grid">
          <Field label={t('How often')}>
            <div><Seg value={auto} onChange={setAuto} options={[{ value: 'off', label: t('Off') }, { value: 'daily', label: t('Daily') }, { value: 'weekly', label: t('Weekly') }]} /></div>
          </Field>
          <Field label={t('Keep the newest')} hint={t('Older backups are deleted automatically.')}>
            <input type="number" min={1} max={365} value={keep} onChange={(e) => setKeep(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} style={{ width: 110 }} />
          </Field>
        </div>
        <Field label={t('Backup folder')} hint={`${t('Leave empty to use')} ${s.default_dir}. ${t('A USB drive or a synced folder (OneDrive, Google Drive, Dropbox) keeps a copy off this machine.')}`}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="grow" style={{ width: 'auto' }} value={dir} onChange={(e) => { setDir(e.target.value); setCheck(null); }} placeholder={s.default_dir} spellCheck={false} />
            <button className="btn" onClick={testFolder} disabled={busy}>{t('Check')}</button>
          </div>
        </Field>
        {check && <div className={`callout small ${check.ok ? 'lapis' : 'warn'}`}>{check.ok ? '✓ ' : ''}{check.message}</div>}
        <div className="row end"><button className="btn primary" onClick={save} disabled={busy || !dirty}>{t('Save')}</button></div>
      </section>

      <section className="card flush">
        <div className="card-head" style={{ padding: '14px 18px 0' }}>
          <h3>{t('Saved backups')} <span className="badge">{s.items.length}</span></h3>
          <span className="small muted code">{s.dir}</span>
        </div>
        {s.items.length ? (
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {s.items.map((b) => (
                  <tr key={b.name}>
                    <td className="nowrap"><strong>{when(b.created)}</strong><div className="small muted">{b.name}</div></td>
                    <td className="right small muted nowrap">{mb(b.size)}</td>
                    <td className="right nowrap">
                      <button className="btn sm" onClick={() => restore(b)} disabled={busy} title={t('Replace all of Canon’s data with this backup')}><Icon name="refresh" />{t('Restore')}</button>{' '}
                      <a className="btn sm" href={`/api/backups/${encodeURIComponent(b.name)}/download`} title={t('Contains personal data — keep the file safe.')}><Icon name="download" />{t('Download')}</a>{' '}
                      <button className="btn sm ghost icon danger" onClick={() => remove(b)} aria-label={t('Delete')} title={t('Delete')}><Icon name="trash" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty small">{t('No backups yet. Press Back up now.')}</div>}
        <div className="small muted" style={{ padding: '0 18px 14px' }}>{t('Backups contain members’ personal data. Store downloaded copies securely (PDPA).')}</div>
      </section>

      <section className="card stack">
        <h3>{t('Restoring a backup')}</h3>
        <p className="small" style={{ margin: 0 }}>
          {t('Press Restore next to a saved backup above, or restore a backup file from this computer (for example from a USB drive or another Canon). Canon saves a copy of the current data first, so a restore can be undone.')}
        </p>
        {s.last_restore && (
          <div className="callout small">
            {t('Last restore')}: <strong>{when(s.last_restore.at)}</strong> · {s.last_restore.from}. {t('The data from before it was saved as')} <span className="code">{s.last_restore.safety}</span>.
          </div>
        )}
        <div className="row">
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" />{t('Restore from a file…')}</button>
          <input ref={fileRef} type="file" accept=".db,application/octet-stream,application/x-sqlite3" hidden onChange={(e) => restoreFile(e.target.files?.[0])} />
        </div>
        <details className="small">
          <summary>{t('If Canon will not start: restore by hand')}</summary>
        <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
          <li>{t('Close the “Canon server” window (or stop the Docker container).')}</li>
          <li>{t('In the Canon folder, open “data”. Delete canon.db-wal and canon.db-shm if they are there.')}</li>
          <li>{t('Copy the backup file into “data” and rename it to canon.db (replace the old one).')}</li>
          <li>{t('Start Canon again (start-canon.bat, or docker compose up -d).')}</li>
        </ol>
        <div className="small muted">{t('Docker: see docs/DOCKER.md → Restoring a backup.')}</div>
        </details>
      </section>
    </div>
  );
}
