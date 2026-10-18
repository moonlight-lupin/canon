// Settings: pieces shared by several tabs.
import { dateLocale } from '../../../shared/languages.ts';
import { useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { useAction } from '../../components/ui.tsx';
import type { Lang } from '../../types-client.ts';
/** The public address and how it is set (GET /public-address). */
export interface PublicAddressInfo { public_url_set: boolean; public_url: string; trust_proxy: boolean; env_override: boolean }
import '../people.css';

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or ISO → local date-time. */
export function fmtStamp(s: string | null | undefined, lang: Lang) {
  if (!s) return '—';
  const d = new Date(/T/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(dateLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Text box for the public https address, so nobody has to edit environment variables (Settings → Church). */
export function PublicUrlField({ info, onSaved }: { info: PublicAddressInfo; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [url, setUrl] = useState(info.public_url);
  const [proxy, setProxy] = useState(info.trust_proxy);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const dirty = url.trim().replace(/\/+$/, '') !== info.public_url || proxy !== info.trust_proxy;
  const save = () => run(async () => {
    await api.put('/public-address', { public_url: url, trust_proxy: proxy });
    setCheck(null);
    onSaved();
  }, t('Saved.'));
  const test = () => run(async () => setCheck(await api.post<{ ok: boolean; message: string }>('/public-address/check', { public_url: url })));
  return (
    <div className="stack tight">
      <h3 className="sect">{t('Public address')}</h3>
      <p className="small muted" style={{ margin: 0 }}>
        {t('The https address people reach Canon at from the internet: phones opening the visitor form, the bulletin and share links, links in e-mails, claims and the lending library on members’ phones, and AI assistants such as claude.ai. Ask whoever set up the tunnel (e.g. Cloudflare Tunnel) for it and paste it here. Leave it empty if Canon is used only on the church’s own network: links then work only there.')}
      </p>
      {info.env_override ? (
        <div className="callout small">{t('The public address is fixed by your IT administrator (CANON_PUBLIC_URL) and cannot be changed here.')}</div>
      ) : (
        <>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input className="grow" style={{ width: 'auto' }} value={url} onChange={(e) => { setUrl(e.target.value); setCheck(null); }} placeholder="https://canon.your-church.org" inputMode="url" spellCheck={false} />
            <button className="btn" onClick={test} disabled={busy || !url.trim()}>{t('Check')}</button>
            <button className="btn primary" onClick={save} disabled={busy || !dirty}>{t('Save')}</button>
          </div>
          <label className="check small"><input type="checkbox" checked={proxy || !!url.trim()} disabled={!!url.trim()} onChange={(e) => setProxy(e.target.checked)} />
            {t('Canon is reached through a tunnel or proxy')} <span className="muted">({t('automatic when a public address is set')})</span></label>
        </>
      )}
      {check && <div className={`callout small ${check.ok ? 'lapis' : 'warn'}`}>{check.ok ? '✓ ' : ''}{check.message}</div>}
    </div>
  );
}
