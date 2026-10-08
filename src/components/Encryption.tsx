// Encryption (0.19.0) on screen: the recovery key shown once (QR code, words to print, confirmed by typing its end),
// the Encryption card for Settings → Security & privacy, Encrypt now for a database made before 0.19.0, and the
// administrators' banner while the data isn't encrypted or has no recovery key.
import { useEffect, useState } from 'react';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Field, Modal, fmtDate, useAction, useSession } from './ui.tsx';
import { Icon } from './icons.tsx';

export interface RecoveryKey { key: string; id: string; made_at: string; qr: string }
export interface EncryptionStatus {
  encrypted: boolean;
  protection: 'dpapi' | 'keychain' | 'secret' | 'file' | null;
  account: string;
  recovery: { id: string; made_at: string } | null;
  backup_dir: string;
  plain_copies: string[];
  others: string[];
}
interface CopiesResult { converted: string[]; failed: { file: string; error: string }[]; others: string[] }
interface EncryptResult extends CopiesResult { recovery: RecoveryKey; safety: string }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Closing the recovery key's window before Done: asked first, since the key is not shown again. */
export const closeUnconfirmed = (t: (s: string) => string, done: () => void) => () => {
  if (window.confirm(t('Close without confirming? Canon will not show this recovery key again. If it isn’t printed or written down, make a new one in Settings → Security & privacy.'))) done();
};

/** The recovery key, shown this once. Done only once it is printed or written down and its end typed back. */
export function RecoveryKeyOnce({ r, onDone, church: churchName }: { r: RecoveryKey; onDone: () => void; church?: string }) {
  const { t, lt, lang } = useI18n();
  // onboarding runs before the session context exists
  const settings = (useSession() as ReturnType<typeof useSession> | null)?.settings;
  const [saved, setSaved] = useState(false);
  const [typed, setTyped] = useState('');
  const groups = r.key.split('-');
  const ok = saved && typed.replace(/\s/g, '').toUpperCase() === groups[groups.length - 1];
  const made = fmtDate(r.made_at.slice(0, 10), lang, { day: 'numeric', month: 'long', year: 'numeric' });
  const church = churchName ?? (settings ? lt(settings.church_name) : 'Canon');
  // a sheet to print and keep with the church's important papers
  const print = () => {
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) return;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(t('Canon recovery key'))}</title>
<style>body{font:15px/1.5 Georgia,'SimSun',serif;margin:18mm;color:#1e2430}h1{font-size:24px;margin:0 0 4px}.k{font:600 22px Consolas,'Courier New',monospace;letter-spacing:.06em;margin:18px 0;line-height:1.7}.m{color:#555;font-size:13px}img{width:58mm;height:58mm}ol{padding-left:1.2em}</style></head><body>
<h1>${esc(t('Canon recovery key'))}</h1><div class="m">${esc(church)} · ${esc(made)} · ${esc(t('ID'))} ${esc(r.id)}</div>
<div class="k">${groups.slice(0, 4).join(' &nbsp;')}<br>${groups.slice(4).join(' &nbsp;')}</div>
<img src="${r.qr}" alt="">
<ol>
<li>${esc(t('Keep this sheet away from the computer Canon runs on: with the church’s important papers, or in a safe.'))}</li>
<li>${esc(t('It opens Canon’s encrypted data if that computer, or its Windows account, is lost or replaced, and it restores the church’s backups on any computer.'))}</li>
<li>${esc(t('Anyone holding it, with a copy of the data or a backup, can read members’ personal data. Don’t photograph it or send it by e-mail.'))}</li>
<li>${esc(t('If a new recovery key is made, this one no longer opens the database; keep it for the backups made before then.'))}</li>
</ol></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <div className="stack">
      <div className="callout warn">{t('This is the only time Canon shows this key. Print it or write it down, and keep it away from this computer. Without it, the church’s data can’t be recovered if this computer or its Windows account is lost.')}</div>
      <div className="row" style={{ gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
        <img src={r.qr} width={170} height={170} alt={t('QR code of the recovery key')} style={{ background: '#fff', borderRadius: 6 }} />
        <div className="stack tight">
          <div className="recovery-key" aria-label={t('Recovery key')}>{groups.slice(0, 4).join(' ')}<br />{groups.slice(4).join(' ')}</div>
          <div className="small muted">{t('ID')} {r.id} · {made}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={print}><Icon name="print" />{t('Print')}</button>
            <button className="btn ghost" onClick={() => navigator.clipboard?.writeText(r.key)}><Icon name="copy" />{t('Copy')}</button>
          </div>
        </div>
      </div>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        {t('I have printed it or written it down, and put it somewhere safe.')}
      </label>
      <Field label={t('To confirm, type its last five characters')}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={7} autoComplete="off" spellCheck={false} style={{ maxWidth: 120, fontFamily: 'ui-monospace, Consolas, monospace', textTransform: 'uppercase' }} />
      </Field>
      <div className="row end">
        <button className="btn primary" disabled={!ok} onClick={onDone}><Icon name="check" />{t('Done')}</button>
      </div>
    </div>
  );
}


/** Settings → Security & privacy → Encryption. */
export function EncryptionCard() {
  const { t, lang } = useI18n();
  const st = useApi<EncryptionStatus>('/security/encryption');
  const { run, busy } = useAction();
  const [shown, setShown] = useState<RecoveryKey | null>(null);
  const [askPw, setAskPw] = useState(false);
  const [pw, setPw] = useState('');
  const [encrypting, setEncrypting] = useState(false);
  if (!st.data) return null;
  const s = st.data;
  const PROTECTION: Record<string, string> = {
    dpapi: t('the Windows account Canon runs as'),
    keychain: t('the macOS keychain'),
    secret: t('a key file kept outside the data folder (CANON_KEY_FILE)'),
    file: t('the key file’s permissions'),
  };
  const make = () => run(async () => {
    const r = await api.post<RecoveryKey>('/security/recovery-key', s.recovery ? { password: pw } : {});
    setAskPw(false);
    setPw('');
    setShown(r);
  });
  return (
    <section className="card stack">
      <div className="row between">
        <h3>{t('Encryption')}</h3>
        {s.encrypted ? <span className="badge ok"><Icon name="lock" />{t('Encrypted')}</span> : <span className="badge warn">{t('Not encrypted')}</span>}
      </div>
      {s.encrypted ? (
        <>
          <p className="small" style={{ margin: 0 }}>{t('The database, the copies kept before upgrades and the archived years are encrypted on this computer. Backups are encrypted with a key of their own.')}</p>
          <p className="small muted" style={{ margin: 0 }}>{t('The keys open by themselves through {how}: Canon starts with the computer, with nobody there.').replace('{how}', PROTECTION[s.protection ?? 'file'])}{s.protection === 'file' ? ` ${t('Anyone who can read the data folder can read the keys too: protect the computer with disk encryption.')}` : ''}</p>
          {s.recovery
            ? <div className="small">{t('Recovery key')}: {t('ID')} <span className="code">{s.recovery.id}</span> · {t('made on {date}').replace('{date}', fmtDate(s.recovery.made_at.slice(0, 10), lang, { day: 'numeric', month: 'short', year: 'numeric' }))}</div>
            : <div className="callout warn small">{t('There is no recovery key yet. Without one, the data can’t be recovered if this computer or its Windows account is lost.')}</div>}
          {askPw ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('Your password')} autoComplete="current-password" autoFocus style={{ maxWidth: 220 }} onKeyDown={(e) => e.key === 'Enter' && pw && make()} />
              <button className="btn primary sm" onClick={make} disabled={busy || !pw}>{t('Make a new recovery key')}</button>
              <button className="btn sm ghost" onClick={() => setAskPw(false)}>{t('Cancel')}</button>
            </div>
          ) : (
            <div className="row">
              <button className="btn sm" onClick={() => (s.recovery ? setAskPw(true) : make())} disabled={busy}>
                <Icon name="lock" />{s.recovery ? t('Make a new recovery key…') : t('Make the recovery key')}
              </button>
            </div>
          )}
          {s.recovery && <div className="small muted">{t('A new recovery key replaces this one for opening the database. Backups made before keep needing the key that was current when they were made.')}</div>}
          {s.plain_copies.length > 0 && (
            <div className="callout warn small stack tight">
              <strong>{t('Plain copies are still here: they hold members’ data unencrypted.')}</strong>
              <ul style={{ margin: 0 }}>{s.plain_copies.map((f) => <li key={f} className="code">{f}</li>)}</ul>
              <div><button className="btn sm" disabled={busy} onClick={() => run(async () => {
                const r = await api.post<CopiesResult>('/security/encryption/copies');
                st.reload();
                if (r.failed.length) throw new Error(r.failed.map((f) => `${f.file}: ${f.error}`).join('; '));
              }, t('Encrypted.'))}><Icon name="lock" />{t('Encrypt them now')}</button></div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="small" style={{ margin: 0 }}>{t('This database was made before Canon encrypted its data. Anyone with a copy of the data folder or of a plain backup (a synced folder, a USB drive, an old computer) can read members’ personal data.')}</p>
          <div className="row"><button className="btn primary sm" onClick={() => setEncrypting(true)}><Icon name="lock" />{t('Encrypt now…')}</button></div>
        </>
      )}
      {shown && (
        <Modal title={t('Recovery key')} onClose={closeUnconfirmed(t, () => { setShown(null); st.reload(); })}>
          <RecoveryKeyOnce r={shown} onDone={() => { setShown(null); st.reload(); }} />
        </Modal>
      )}
      {encrypting && <EncryptNow status={s} onClose={() => { setEncrypting(false); st.reload(); }} />}
    </section>
  );
}

/** Encrypt a database made before 0.19.0: what will happen, then the recovery key, then what was done. */
export function EncryptNow({ status, onClose }: { status: EncryptionStatus; onClose: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [result, setResult] = useState<EncryptResult | null>(null);
  const [keyDone, setKeyDone] = useState(false);
  const [password, setPassword] = useState('');
  const go = () => run(async () => setResult(await api.post<EncryptResult>('/security/encryption/encrypt', { password })));
  if (result && !keyDone) {
    return (
      <Modal title={t('The data is encrypted: the recovery key')} onClose={closeUnconfirmed(t, () => setKeyDone(true))}>
        <RecoveryKeyOnce r={result.recovery} onDone={() => setKeyDone(true)} />
      </Modal>
    );
  }
  if (result) {
    return (
      <Modal title={t('Encrypted')} onClose={() => { onClose(); window.location.reload(); }} footer={<button className="btn primary" onClick={() => { onClose(); window.location.reload(); }}>{t('Close')}</button>}>
        <div className="stack">
          <p>{t('The database is encrypted. Plain copies encrypted or removed: {n}.').replace('{n}', String(result.converted.length))}</p>
          {result.failed.length > 0 && (
            <div className="callout warn small">
              <strong>{t('These copies could not be encrypted: delete them yourself, or try again.')}</strong>
              <ul>{result.failed.map((f) => <li key={f.file}><span className="code">{f.file}</span> — {f.error}</li>)}</ul>
            </div>
          )}
          {result.others.length > 0 && <OthersList files={result.others} />}
          <p className="small muted">{t('Deleted files can stay readable on the disk until they are overwritten: disk encryption (BitLocker) covers that too.')}</p>
        </div>
      </Modal>
    );
  }
  return (
    <Modal title={t('Encrypt the church’s data')} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" onClick={go} disabled={busy || !password}><Icon name="lock" />{busy ? t('Encrypting…') : t('Encrypt now')}</button>
      </>
    }>
      <div className="stack">
        <p>{t('Canon will:')}</p>
        <ol className="small" style={{ margin: 0 }}>
          <li>{t('make a backup first;')}</li>
          <li>{t('encrypt the database, with a key that opens by itself through the Windows account Canon runs as;')}</li>
          <li>{t('show you the recovery key, once: print it and keep it away from this computer;')}</li>
          <li>{t('encrypt the plain copies it holds — backups, the copies kept before upgrades, archived years — and remove the plain originals.')}</li>
        </ol>
        {status.plain_copies.length > 0 && (
          <details className="small"><summary>{t('Plain copies Canon holds: {n}').replace('{n}', String(status.plain_copies.length))}</summary>
            <ul>{status.plain_copies.map((f) => <li key={f} className="code">{f}</li>)}</ul>
          </details>
        )}
        {status.others.length > 0 && <OthersList files={status.others} />}
        <p className="small">{t('Backups are in')} <span className="code">{status.backup_dir}</span>. {t('If another Canon (a test copy) keeps its backups in the same folder, change that folder first.')}</p>
        <p className="small muted">{t('It takes a few seconds; anyone using Canon just then may need to try again.')}</p>
        <Field label={t('Your password')}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" style={{ maxWidth: 260 }} onKeyDown={(e) => e.key === 'Enter' && password && go()} />
        </Field>
      </div>
    </Modal>
  );
}

function OthersList({ files }: { files: string[] }) {
  const { t } = useI18n();
  return (
    <div className="callout small">
      <strong>{t('Plain database files Canon didn’t make, left as they are:')}</strong>
      <ul>{files.map((f) => <li key={f} className="code">{f}</li>)}</ul>
      {t('Delete them yourself once you no longer need them, or keep them somewhere safe: they are not encrypted.')}
    </div>
  );
}

/** For administrators, on every page: the data isn't encrypted (loud), or there is no recovery key yet. */
export function EncryptionBanner() {
  const { t } = useI18n();
  const { isAdmin } = useSession();
  const st = useApi<EncryptionStatus>(isAdmin ? '/security/encryption' : null);
  const [encrypting, setEncrypting] = useState(false);
  const [shown, setShown] = useState<RecoveryKey | null>(null);
  const { run, busy } = useAction();
  const s = st.data;
  if (!isAdmin || !s) return null;
  if (!s.encrypted) {
    return (
      <>
        <div className="banner-danger no-print" role="alert">
          <Icon name="alert" />
          <div className="grow">
            <strong>{t('The church’s data is not encrypted.')}</strong> {t('Anyone with a copy of the data folder or a plain backup can read members’ personal data.')}
          </div>
          <button className="btn sm" onClick={() => setEncrypting(true)}><Icon name="lock" />{t('Encrypt now…')}</button>
        </div>
        {encrypting && <EncryptNow status={s} onClose={() => { setEncrypting(false); st.reload(); }} />}
      </>
    );
  }
  if (!s.recovery) {
    return (
      <>
        <div className="callout warn no-print row" style={{ gap: 10, marginBottom: 12 }}>
          <div className="grow"><strong>{t('There is no recovery key yet.')}</strong> {t('Without one, the data can’t be recovered if this computer or its Windows account is lost.')}</div>
          <button className="btn sm" disabled={busy} onClick={() => run(async () => setShown(await api.post<RecoveryKey>('/security/recovery-key', {})))}><Icon name="lock" />{t('Make the recovery key')}</button>
        </div>
        {shown && <Modal title={t('Recovery key')} onClose={closeUnconfirmed(t, () => { setShown(null); st.reload(); })}><RecoveryKeyOnce r={shown} onDone={() => { setShown(null); st.reload(); }} /></Modal>}
      </>
    );
  }
  return null;
}

/** Onboarding: make the recovery key and confirm it is kept, before setup can finish (when the data is encrypted). */
export function RecoveryKeyStep({ church, onReady }: { church: string; onReady: (ready: boolean) => void }) {
  const { t } = useI18n();
  const st = useApi<EncryptionStatus>('/security/encryption');
  const { run, busy } = useAction();
  const [shown, setShown] = useState<RecoveryKey | null>(null);
  const s = st.data;
  // ready to finish setup: the recovery key made (or the data kept plain, e.g. a test copy)
  const ready = !s || !s.encrypted || !!s.recovery;
  useEffect(() => onReady(ready), [ready, onReady]);
  if (!s || !s.encrypted) return null;
  return (
    <section className="card stack" style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0 }}>{t('The recovery key')}</h2>
      <p className="small" style={{ margin: 0 }}>{t('Canon encrypts the church’s data on this computer. The key opens by itself through this computer’s Windows account; the recovery key is the way back in if this computer or that account is lost, and it restores the church’s backups on any computer. Canon shows it once.')}</p>
      {s.recovery
        ? <div className="callout small"><Icon name="check" /> {t('The recovery key is made (ID {id}). Keep the printed sheet safe.').replace('{id}', s.recovery.id)}</div>
        : shown
          ? <RecoveryKeyOnce r={shown} church={church} onDone={() => { setShown(null); st.reload(); }} />
          : <div className="row"><button className="btn primary" disabled={busy} onClick={() => run(async () => setShown(await api.post<RecoveryKey>('/security/recovery-key', {})))}><Icon name="lock" />{t('Make the recovery key')}</button></div>}
    </section>
  );
}
