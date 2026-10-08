// Checking for and installing new versions of Canon (0.19.4), for administrators: a card on About Canon, and a note
// in the sidebar when a newer version is out. The server side is server/lib/updates.ts.
import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { confirmAction, fmtDate, useAction } from './ui.tsx';

export interface UpdateStatus {
  current: string;
  kind: 'docker' | 'git' | 'download';
  why_not: 'docker' | 'development' | 'not_launcher' | null;
  auto: boolean;
  installing: boolean;
  checked_at: string | null;
  error: string | null;
  latest: { version: string; name: string; url: string; notes: string; published_at: string | null } | null;
  newer: boolean;
  last: { from: string; to: string; at: string; ok: boolean; error?: string | null } | null;
}

/** The sidebar's note for administrators: a newer version is out (from the last daily check; no request to GitHub). */
export function UpdateNotice() {
  const { t } = useI18n();
  const { data } = useApi<UpdateStatus>('/updates');
  if (!data?.newer || !data.latest) return null;
  return (
    <NavLink to="/about#updates" className="small" style={{ textDecoration: 'none' }}>
      <span className="badge lapis">{t('Canon {v} is available').replace('{v}', data.latest.version)}</span>
    </NavLink>
  );
}

export function UpdatesCard() {
  const { t, lang } = useI18n();
  const { data, reload } = useApi<UpdateStatus>('/updates');
  const [s, setS] = useState<UpdateStatus | undefined>();
  const [phase, setPhase] = useState<'idle' | 'installing' | 'restarting' | 'slow' | 'done'>('idle');
  const [target, setTarget] = useState('');
  const { run, busy } = useAction();
  useEffect(() => setS(data), [data]);

  // after "Update now": wait for the new version to answer, then reload the page
  useEffect(() => {
    if (phase !== 'restarting') return;
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const a = await api.get<{ version: string }>('/about');
        if (a.version === target) {
          clearInterval(timer);
          setPhase('done');
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch { /* still restarting */ }
      if (Date.now() - started > 6 * 60_000) {
        clearInterval(timer);
        setPhase('slow');
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [phase, target]);

  if (!s) return null;
  // in this computer's time
  const when = (iso: string) => {
    const d = new Date(iso);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `${fmtDate(day, lang)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const check = () => run(() => api.post<UpdateStatus>('/updates/check')).then((r) => r && setS(r));
  const auto = (on: boolean) => run(() => api.put<UpdateStatus>('/updates/auto', { auto: on })).then((r) => r && setS(r));
  const install = async () => {
    if (!s.latest) return;
    if (!confirmAction(t('Update Canon to {v}? Canon makes a backup first, then gets the new version and restarts. It is unavailable for a minute or two; people using it reload the page afterwards.').replace('{v}', s.latest.version))) return;
    setPhase('installing');
    const r = await run(() => api.post<{ to: string }>('/updates/install', { version: s.latest!.version }));
    if (!r) {
      setPhase('idle');
      reload();
      return;
    }
    setTarget(r.to);
    setPhase('restarting');
  };

  return (
    <section className="card stack" id="updates">
      <h2>{t('Updates')}</h2>
      {s.last && (
        s.last.ok
          ? <div className="callout small">{t('Canon was updated from {a} to {b} on {date}.').replace('{a}', s.last.from).replace('{b}', s.last.to).replace('{date}', when(s.last.at))}</div>
          : <div className="callout warn small">{t('The update to Canon {b} failed, so Canon {a} was started again: {error}').replace('{b}', s.last.to).replace('{a}', s.last.from).replace('{error}', s.last.error ?? '')}</div>
      )}
      {phase === 'installing' && <div className="callout small">{t('Making a backup and getting the new version…')}</div>}
      {phase === 'restarting' && <div className="callout small">{t('Canon is restarting with the new version: installing what it needs and rebuilding takes a minute or two. This page reloads by itself.')}</div>}
      {phase === 'done' && <div className="callout small">{t('Canon {v} is running. Reloading…').replace('{v}', target)}</div>}
      {phase === 'slow' && <div className="callout warn small">{t('Canon hasn’t come back yet. Look at the Canon window (or data/logs/launcher.log) on the computer it runs on.')}</div>}

      {s.newer && s.latest ? (
        <div className="stack tight">
          <div><strong>{t('Canon {v} is available').replace('{v}', s.latest.version)}</strong>{s.latest.published_at && <span className="small muted"> · {fmtDate(s.latest.published_at.slice(0, 10), lang)}</span>}</div>
          <div className="small">{t('You have {v}.').replace('{v}', s.current)} <a href={s.latest.url} target="_blank" rel="noreferrer">{t('What’s new')}</a></div>
          {s.latest.notes && (
            <details className="small">
              <summary>{t('Release notes')}</summary>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{s.latest.notes}</div>
            </details>
          )}
        </div>
      ) : (
        <div className="small">
          {s.latest ? t('Canon {v} is the latest version.').replace('{v}', s.current) : t('Canon {v}.').replace('{v}', s.current)}
          {s.checked_at && <span className="muted"> {t('Checked {when}.').replace('{when}', when(s.checked_at))}</span>}
        </div>
      )}
      {s.error && <div className="small muted">{t('The last check didn’t reach GitHub: {error}').replace('{error}', s.error)}</div>}

      {s.newer && s.why_not === 'docker' && (
        <div className="small stack tight">
          <span>{t('Canon runs in Docker: update it on the server, in the folder with docker-compose.yml:')}</span>
          <code>docker compose pull &amp;&amp; docker compose up -d</code>
        </div>
      )}
      {s.newer && s.why_not === 'not_launcher' && <div className="small muted">{t('Canon wasn’t started with start-canon.bat (or start-canon.command), so it can’t restart itself: update it by hand, as in docs/UPGRADING.md.')}</div>}
      {s.newer && s.why_not === 'development' && <div className="small muted">{t('Canon is running in development mode: update it with git.')}</div>}

      <div className="row">
        <button className="btn" disabled={busy || phase !== 'idle'} onClick={check}>{t('Check now')}</button>
        {s.newer && !s.why_not && <button className="btn primary" disabled={busy || phase !== 'idle' || s.installing} onClick={install}>{t('Update now…')}</button>}
        <label className="small row" style={{ gap: 6 }}>
          <input type="checkbox" checked={s.auto} disabled={busy} onChange={(e) => auto(e.target.checked)} />
          {t('Check once a day')}
        </label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('Checking asks GitHub for the latest release; nothing about the church is sent.')}</p>
    </section>
  );
}
