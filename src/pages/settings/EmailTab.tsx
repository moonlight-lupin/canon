// Settings → E-mail: how Canon sends e-mail — the church's SMTP server, or AgentMail with an API key — a test send, and the e-mail log.
// The SMTP password and the AgentMail API key are write-only: the server only reports whether one is saved.
import { dateLocale } from '../../../shared/languages.ts';
import { useEffect, useMemo, useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Field, Loading, Seg, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import type { Lang } from '../../../shared/types.ts';

export interface SmtpSettings {
  provider: 'smtp' | 'agentmail';
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  has_password?: boolean;
  has_api_key?: boolean;
}

export interface EmailLogRow {
  id: number;
  at: string;
  user_name: string | null;
  service_id: number | null;
  person_id: number | null;
  person_name: string | null;
  /** masked, e.g. g•••@example.org */
  to_addr: string;
  subject: string;
  kind: string;
  ok: boolean;
  error: string | null;
}

/** SQLite UTC "YYYY-MM-DD HH:MM:SS" → local date and time. */
export function fmtSent(s: string | null | undefined, lang: Lang) {
  if (!s) return '—';
  const d = new Date(/T/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(dateLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const PRESETS: { key: string; label: string; provider: SmtpSettings['provider']; host: string; port: number; secure: boolean; hint: string }[] = [
  {
    key: 'gmail', label: 'Gmail / Google Workspace', provider: 'smtp', host: 'smtp.gmail.com', port: 587, secure: false,
    hint: 'Turn on 2-Step Verification for the account, then create an app password (Google Account → Security → App passwords) and use it here.',
  },
  {
    key: 'm365', label: 'Microsoft 365', provider: 'smtp', host: 'smtp.office365.com', port: 587, secure: false,
    hint: 'SMTP AUTH must be enabled for the mailbox in the Microsoft 365 admin centre. With multi-factor sign-in, use an app password.',
  },
  {
    key: 'agentmail', label: 'AgentMail', provider: 'agentmail', host: '', port: 587, secure: false,
    hint: 'AgentMail sends through its own service with an API key — no SMTP server or password. In the AgentMail console, make an inbox and an API key, then enter them here.',
  },
  {
    key: 'other', label: 'Other provider', provider: 'smtp', host: '', port: 587, secure: false,
    hint: 'Use the SMTP details from your e-mail provider or web host. Port 587 with STARTTLS is most common; port 465 uses SSL/TLS.',
  },
];

type SecretMode = 'keep' | 'set' | 'clear';

export default function EmailTab() {
  const { t } = useI18n();
  const cfg = useApi<SmtpSettings>('/email/settings');
  const [d, setD] = useState<SmtpSettings | null>(null);
  const [pwMode, setPwMode] = useState<SecretMode>('keep');
  const [pw, setPw] = useState('');
  const [keyMode, setKeyMode] = useState<SecretMode>('keep');
  const [apiKey, setApiKey] = useState('');
  const [preset, setPreset] = useState<string>('');
  const [testTo, setTestTo] = useState(() => {
    try {
      return localStorage.getItem('canon.email.testTo') ?? '';
    } catch {
      return '';
    }
  });
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const { run, busy } = useAction();
  const [testing, setTesting] = useState(false);
  const log = useApi<EmailLogRow[]>('/email/log?limit=100');

  useEffect(() => {
    if (cfg.data) setD(cfg.data);
    if (cfg.data?.provider === 'agentmail') setPreset((p) => p || 'agentmail');
  }, [cfg.data]);

  const dirty = useMemo(() => {
    if (!d || !cfg.data) return false;
    const { has_password: _a, has_api_key: _c, ...x } = d;
    const { has_password: _b, has_api_key: _d, ...y } = cfg.data;
    return JSON.stringify(x) !== JSON.stringify(y) || pwMode !== 'keep' || keyMode !== 'keep';
  }, [d, cfg.data, pwMode, keyMode]);

  if (cfg.error) return <ErrorBox error={cfg.error} />;
  if (!d) return <Loading />;

  const set = <K extends keyof SmtpSettings>(k: K, v: SmtpSettings[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const agent = d.provider === 'agentmail';
  const configured = !!cfg.data?.from_email && (cfg.data.provider === 'agentmail' ? !!cfg.data.has_api_key : !!cfg.data.host);
  const resetSecrets = () => {
    setPwMode('keep');
    setPw('');
    setKeyMode('keep');
    setApiKey('');
  };
  const hint = PRESETS.find((p) => p.key === preset)?.hint;

  const applyPreset = (key: string) => {
    setPreset(key);
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return;
    if (p.provider === 'agentmail') {
      setD((x) => x && { ...x, provider: 'agentmail' });
      return;
    }
    setD((x) => x && {
      ...x,
      provider: 'smtp',
      host: p.host || x.host,
      port: p.port,
      secure: p.secure,
      user: x.user || (p.host ? x.from_email : x.user),
    });
  };

  const save = async () => {
    const body: Record<string, unknown> = {
      provider: d.provider, host: d.host, port: d.port, secure: d.secure, user: d.user, from_name: d.from_name, from_email: d.from_email, reply_to: d.reply_to,
    };
    if (pwMode === 'set') body.password = pw;
    if (pwMode === 'clear') body.password = '';
    if (keyMode === 'set') body.api_key = apiKey.trim();
    if (keyMode === 'clear') body.api_key = '';
    const r = await run(() => api.put<SmtpSettings>('/email/settings', body), t('Saved.'));
    if (r) {
      cfg.setData(r);
      setD(r);
      resetSecrets();
    }
  };

  const sendTest = async () => {
    setTestResult(null);
    setTesting(true);
    try {
      localStorage.setItem('canon.email.testTo', testTo);
    } catch {
      /* ignore */
    }
    try {
      await api.post('/email/test', { to: testTo.trim() });
      setTestResult({ ok: true, msg: t('Test e-mail sent. Check the inbox (and the spam folder).') });
    } catch (e) {
      setTestResult({ ok: false, msg: (e as Error).message });
    } finally {
      setTesting(false);
      log.reload();
    }
  };

  return (
    <div className="stack">
      <div className="callout lapis">
        {t('Canon sends volunteer reminder e-mails through the church’s own e-mail account or AgentMail. Nothing is sent automatically: an editor presses “Send reminders” on a service’s Team tab.')}
      </div>

      <div className="card stack">
        <div className="card-head">
          <h2>{agent ? 'AgentMail' : t('SMTP server')}</h2>
          {configured ? <span className="badge ok">{t('Set up')}</span> : <span className="badge warn">{t('Not set up')}</span>}
        </div>

        <div>
          <h3 className="sect">{t('Provider')}</h3>
          <div className="row">
            {PRESETS.map((p) => (
              <button key={p.key} type="button" className={`btn sm${preset === p.key ? ' primary' : ''}`} onClick={() => applyPreset(p.key)}>{t(p.label)}</button>
            ))}
          </div>
          {hint && <div className="callout small" style={{ marginTop: 8 }}>{t(hint)}</div>}
        </div>

        <div className="form-grid">
          {agent ? (
            <SecretField label={t('API key')} mode={keyMode} setMode={setKeyMode} value={apiKey} setValue={setApiKey} saved={!!d.has_api_key}
              placeholder="am_…" noneLabel={t('No API key')} setLabel={t('Set API key')} />
          ) : (
            <>
              <Field label={t('SMTP host')} className="span-all">
                <input value={d.host} onChange={(e) => set('host', e.target.value)} placeholder="smtp.example.org" autoComplete="off" spellCheck={false} />
              </Field>
              <Field label={t('Port')}>
                <input type="number" min={1} max={65535} value={d.port} onChange={(e) => set('port', Number(e.target.value) || 0)} />
              </Field>
              <Field label={t('Security')}>
                <div>
                  <Seg<'starttls' | 'ssl'> value={d.secure ? 'ssl' : 'starttls'}
                    onChange={(v) => setD((x) => x && { ...x, secure: v === 'ssl', port: v === 'ssl' ? (x.port === 587 ? 465 : x.port) : (x.port === 465 ? 587 : x.port) })}
                    options={[{ value: 'starttls', label: 'STARTTLS (587)' }, { value: 'ssl', label: 'SSL/TLS (465)' }]} />
                </div>
              </Field>
              <Field label={t('User name')} hint={t('Usually the full e-mail address of the sending account.')}>
                <input value={d.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" spellCheck={false} />
              </Field>
              <SecretField label={t('Password')} mode={pwMode} setMode={setPwMode} value={pw} setValue={setPw} saved={!!d.has_password}
                placeholder={t('App password')} noneLabel={t('No password')} setLabel={t('Set password')} />
              <Field label={t('Sender name')} hint={t('e.g. the church name')}>
                <input value={d.from_name} onChange={(e) => set('from_name', e.target.value)} />
              </Field>
            </>
          )}
          <Field label={agent ? t('Inbox address') : t('Sender address')}
            hint={agent ? t('The AgentMail inbox the e-mails are sent from. The sender name is the inbox’s display name in AgentMail.') : undefined}>
            <input type="email" value={d.from_email} onChange={(e) => set('from_email', e.target.value)} placeholder={agent ? 'church@agentmail.to' : 'office@your-church.org'} />
          </Field>
          <Field label={t('Reply-to address')} hint={t('Optional — where volunteers’ replies go.')}>
            <input type="email" value={d.reply_to} onChange={(e) => set('reply_to', e.target.value)} />
          </Field>
        </div>

        <div className="row end">
          {dirty && <span className="muted small">{t('Unsaved changes')}</span>}
          <button className="btn" disabled={!dirty || busy} onClick={() => { if (cfg.data) setD(cfg.data); resetSecrets(); }}>{t('Cancel')}</button>
          <button className="btn primary" disabled={!dirty || busy || (!agent && pwMode === 'set' && !pw) || (agent && keyMode === 'set' && !apiKey.trim())} onClick={save}>{t('Save')}</button>
        </div>
      </div>

      <div className="card stack">
        <h2>{t('Send a test e-mail')}</h2>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label={t('Your e-mail address')} className="grow">
            <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.org" />
          </Field>
          <button className="btn" disabled={!configured || dirty || testing || !/\S+@\S+\.\S+/.test(testTo)} onClick={sendTest}>
            <Icon name="mail" />{testing ? t('Sending…') : t('Send test')}
          </button>
        </div>
        {!configured && <div className="muted small">{t('Save the e-mail settings first.')}</div>}
        {configured && dirty && <div className="muted small">{t('Save your changes before sending a test.')}</div>}
        {testResult && <div className={`callout ${testResult.ok ? 'lapis' : 'warn'} small`}>{testResult.msg}</div>}
      </div>

      <EmailLogCard log={log} />
    </div>
  );
}

/** A write-only secret (SMTP password, AgentMail API key): shows only whether one is saved — Change, Clear, Undo. */
function SecretField(p: {
  label: string;
  mode: SecretMode;
  setMode: (m: SecretMode) => void;
  value: string;
  setValue: (v: string) => void;
  saved: boolean;
  placeholder: string;
  noneLabel: string;
  setLabel: string;
}) {
  const { t } = useI18n();
  return (
    // a div, not a <label>: clicking the caption must not press the Change button
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--ink-2)', fontWeight: 500, minWidth: 0 }}>
      <span>{p.label}</span>
      {p.mode === 'set' ? (
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <input type="password" value={p.value} onChange={(e) => p.setValue(e.target.value)} autoComplete="new-password" autoFocus placeholder={p.placeholder} spellCheck={false} />
          <button type="button" className="btn sm ghost" onClick={() => { p.setMode('keep'); p.setValue(''); }}>{t('Cancel')}</button>
        </div>
      ) : (
        <div className="row">
          {p.mode === 'clear' ? (
            <span className="badge warn">{t('Will be removed when you save')}</span>
          ) : p.saved ? (
            <span className="badge ok"><Icon name="lock" width={12} height={12} /> •••• {t('saved')}</span>
          ) : (
            <span className="badge">{p.noneLabel}</span>
          )}
          <button type="button" className="btn sm" onClick={() => p.setMode('set')}>{p.saved ? t('Change') : p.setLabel}</button>
          {p.saved && p.mode !== 'clear' && <button type="button" className="btn sm danger" onClick={() => p.setMode('clear')}>{t('Clear')}</button>}
          {p.mode === 'clear' && <button type="button" className="btn sm ghost" onClick={() => p.setMode('keep')}>{t('Undo')}</button>}
        </div>
      )}
      <span className="field-hint">{t('Stored only in your Canon database and never shown again.')}</span>
    </div>
  );
}

function EmailLogCard({ log }: { log: ReturnType<typeof useApi<EmailLogRow[]>> }) {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = log;
  return (
    <div className="card flush">
      <div className="card-head" style={{ padding: '14px 16px 0' }}>
        <h2>{t('Recent e-mails')}</h2>
        <button className="btn ghost sm icon" onClick={reload} aria-label={t('Refresh')} title={t('Refresh')}><Icon name="refresh" /></button>
      </div>
      <div className="small muted" style={{ padding: '4px 16px 8px' }}>
        {t('PDPA: the log keeps who was e-mailed, when and the subject — never the message itself.')}
      </div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : !data?.length ? <Empty title={t('No e-mails sent yet.')} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('Time')}</th><th>{t('Type')}</th><th>{t('To')}</th><th>{t('Subject')}</th><th>{t('Sent by')}</th><th>{t('Result')}</th></tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap small">{fmtSent(r.at, lang)}</td>
                  <td className="nowrap small">{r.kind === 'reminder' ? t('Reminder') : r.kind === 'test' ? t('Test') : r.kind}</td>
                  <td className="nowrap">{r.person_name ?? ''} <span className="muted small">{r.to_addr}</span></td>
                  <td className="small">{r.subject}</td>
                  <td className="nowrap small">{r.user_name ?? '—'}</td>
                  <td>
                    {r.ok ? <span className="badge ok">{t('Sent')}</span> : <span className="badge danger" title={r.error ?? ''}>{t('Failed')}</span>}
                    {!r.ok && r.error && <div className="small" style={{ color: 'var(--danger)' }}>{r.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
