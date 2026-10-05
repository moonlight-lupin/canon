// Settings: pieces shared by several tabs.
import { useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { useAction } from '../../components/ui.tsx';
import type { Lang } from '../../types-client.ts';
import type { EndpointInfo } from './McpTab.tsx';
import '../people.css';

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or ISO → local date-time. */
export function fmtStamp(s: string | null | undefined, lang: Lang) {
  if (!s) return '—';
  const d = new Date(/T/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(lang === 'zh' ? 'zh-CN' : lang === 'zh-Hant' ? 'zh-TW' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Text box for the public https address, so nobody has to edit environment variables. */
export function PublicUrlField({ info, onSaved }: { info: EndpointInfo; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [url, setUrl] = useState(info.public_url);
  const [proxy, setProxy] = useState(info.trust_proxy);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const dirty = url.trim().replace(/\/+$/, '') !== info.public_url || proxy !== info.trust_proxy;
  const save = () => run(async () => {
    await api.put('/mcp/public-url', { public_url: url, trust_proxy: proxy });
    setCheck(null);
    onSaved();
  }, t('Saved.'));
  const test = () => run(async () => setCheck(await api.post<{ ok: boolean; message: string }>('/mcp/check-public-url', { public_url: url })));
  return (
    <div className="stack tight">
      <h3 className="sect">{t('Public address')}</h3>
      <p className="small muted" style={{ margin: 0 }}>
        {t('claude.ai connects over the internet, so Canon needs a public https address. Ask whoever set up the tunnel (e.g. Cloudflare Tunnel) for it and paste it here. Leave it empty if you only use Canon on the office network.')}
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
      {!info.public_url_set && !info.env_override && (
        <div className="small muted">{t('Until a public address is set, the connector URL above only works on the network where Canon runs.')}</div>
      )}
    </div>
  );
}
