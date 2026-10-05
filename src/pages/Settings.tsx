// Settings: my profile (everyone), church settings, users & access, and AI / MCP exposure control (admins).
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, useApi } from '../api.ts';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n.tsx';
import { UI_LANGS, langInfo } from '../../shared/languages.ts';
import { LanguagesPanel } from './Onboarding.tsx';
import EmailTab from './settings/EmailTab.tsx';
import BackupsTab from './settings/BackupsTab.tsx';
import { LogoField } from '../components/LogoField.tsx';
import {
  Empty, ErrorBox, Field, L10nInput, Loading, Modal, PageHead, Seg, confirmAction, useAction, useSession, useToast,
} from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { CongregationsCard } from '../components/Congregations.tsx';
import { ChangeList, FilterBar, Pager, useLogQuery, type ChangeRow, type Paged } from '../components/LogTools.tsx';
import type { Lang, McpConfig, ModuleAccess, ModuleKey, PaperSize, Role, Settings as SettingsT } from '../types-client.ts';
import { MODULES } from '../types-client.ts';
import './people.css';

type Tab = 'church' | 'languages' | 'users' | 'email' | 'backups' | 'mcp' | 'changelog';

export default function Settings() {
  const { t } = useI18n();
  const { isAdmin, settings, reloadSettings } = useSession();
  // ?tab=email etc. opens a specific tab (used by links from other screens)
  const [tab, setTab] = useState<Tab>(() => {
    const q = new URLSearchParams(location.search).get('tab');
    return q && ['church', 'languages', 'users', 'email', 'backups', 'changelog', 'mcp'].includes(q) ? (q as Tab) : 'church';
  });
  return (
    <div className="page people-page">
      <PageHead eyebrow={t('Admin')} title={t('Settings')} />
      <div className="stack">
        <ProfileCard />
        {isAdmin && (
          <div>
            <div className="tabs mt" role="tablist">
              {([['church', 'Church'], ['languages', 'Languages'], ['users', 'Users & access'], ['email', 'E-mail'], ['backups', 'Backups'], ['changelog', 'Change log'], ['mcp', 'AI / MCP']] as [Tab, string][]).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(l)}</button>
              ))}
            </div>
            {tab === 'church' && <ChurchTab />}
            {tab === 'changelog' && <ChangeLogTab />}
            {tab === 'languages' && settings && <LanguagesPanel settings={settings} onSaved={reloadSettings} />}
            {tab === 'users' && <UsersTab />}
            {tab === 'email' && <EmailTab />}
            {tab === 'backups' && <BackupsTab />}
            {tab === 'mcp' && <McpTab />}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- my profile

function ProfileCard() {
  const { t, lang, setLang } = useI18n();
  const { user, refresh } = useSession();
  const { run, busy } = useAction();
  const [name, setName] = useState(user.display_name);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  const changeLang = (l: Lang) => {
    setLang(l);
    api.patch('/me', { lang: l }).catch(() => {});
  };
  const saveName = () =>
    run(async () => {
      if (!name.trim()) throw new Error(t('Name is required.'));
      await api.patch('/me', { display_name: name.trim() });
      await refresh();
      return true;
    }, t('Saved.'));
  const savePw = async () => {
    const ok = await run(async () => {
      if (pw.next.length < 8) throw new Error(t('The new password needs at least 8 characters.'));
      if (pw.next !== pw.confirm) throw new Error(t('The new passwords do not match.'));
      return api.patch('/me', { current_password: pw.current, new_password: pw.next }).catch((e: Error) => {
        throw new Error(t(e.message));
      });
    }, t('Password changed.'));
    if (ok) setPw({ current: '', next: '', confirm: '' });
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>{t('My profile')}</h2>
        <span className="muted small">{user.username} · {t(user.role[0].toUpperCase() + user.role.slice(1))}</span>
      </div>
      <div className="grid cols-2">
        <div className="stack">
          <Field label={t('Display name')}>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn" onClick={saveName} disabled={busy || name === user.display_name}>{t('Save')}</button>
            </div>
          </Field>
          <Field label={t('Language')}>
            <div><Seg<Lang> value={lang} onChange={changeLang} options={UI_LANGS.map((l) => ({ value: l, label: langInfo(l).native }))} /></div>
          </Field>
        </div>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); savePw(); }}>
          <h3 className="sect" style={{ marginBottom: 0 }}>{t('Change password')}</h3>
          <input type="text" name="username" autoComplete="username" value={user.username} readOnly hidden />
          <div className="form-grid">
            <Field label={t('Current password')}><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <Field label={t('New password')}><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
            <Field label={t('Confirm new password')}><input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          </div>
          <div className="row end"><button className="btn" type="submit" disabled={busy || !pw.current || !pw.next}>{t('Change password')}</button></div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- church

type Translation = { code: string; lang: string; name: string; license: string; verses: number };
const COVER_LABEL: Record<SettingsT['bulletin_cover'], string> = { plain: 'Plain', cross: 'Cross', logo: 'Church logo', verse: 'Verse of the week' };
const PAPERS: { value: PaperSize; label: string }[] = [
  { value: 'a4-booklet', label: 'A4 landscape, folded (A5 booklet)' },
  { value: 'a4', label: 'A4 portrait' },
  { value: 'a5', label: 'A5 single pages' },
  { value: 'letter-booklet', label: 'US Letter, folded (booklet)' },
  { value: 'letter', label: 'US Letter portrait' },
];

function ChurchTab() {
  const { t } = useI18n();
  const { reloadSettings } = useSession();
  const settings = useApi<SettingsT>('/settings');
  const tr = useApi<Translation[]>('/bible/translations');
  const [d, setD] = useState<SettingsT | null>(null);
  const { run, busy } = useAction();
  useEffect(() => {
    if (settings.data) setD(settings.data);
  }, [settings.data]);

  if (settings.error) return <ErrorBox error={settings.error} />;
  if (!d) return <Loading />;
  const set = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const imported = (tr.data ?? []).filter((x) => x.verses > 0);
  const bibleOpts = (l: string, current: string) => {
    const list = (tr.data ?? []).filter((x) => x.lang === l);
    if (current && !list.some((x) => x.code === current)) list.push({ code: current, lang: l, name: current, license: '', verses: 0 });
    return list.map((x) => (
      <option key={x.code} value={x.code}>{x.code} — {x.name} ({x.verses ? `${x.verses.toLocaleString()} ${t('verses')}` : t('not imported')})</option>
    ));
  };

  // Only this tab's fields: languages and Bibles are saved by the Languages tab.
  const save = async () => {
    const patch: Partial<SettingsT> = {
      church_name: d.church_name, church_address: d.church_address, church_contact: d.church_contact, ccli_license: d.ccli_license,
      default_start_time: d.default_start_time, bilingual_layout: d.bilingual_layout,
      season_colours: d.season_colours, bulletin_cover: d.bulletin_cover,
    };
    const ok = await run(() => api.patch<SettingsT>('/settings', patch), t('Saved.'));
    if (ok) {
      settings.setData(ok);
      reloadSettings();
    }
  };

  return (
    <div className="stack">
    <div className="card stack">
      <Field label={t('Church name')}><L10nInput value={d.church_name} onChange={(v) => set('church_name', v)} /></Field>
      <Field label={t('Church logo')}><LogoField /></Field>
      <div className="form-grid">
        <Field label={t('Address')} className="span-all"><input value={d.church_address} onChange={(e) => set('church_address', e.target.value)} /></Field>
        <Field label={t('Contact line')} hint={t('Printed on the bulletin, e.g. phone · email · website')} className="span-all">
          <input value={d.church_contact} onChange={(e) => set('church_contact', e.target.value)} />
        </Field>
        <Field label={t('CCLI licence number')}><input value={d.ccli_license} onChange={(e) => set('ccli_license', e.target.value)} /></Field>
        <Field label={t('Default start time')}><input type="time" value={d.default_start_time} onChange={(e) => e.target.value && set('default_start_time', e.target.value)} /></Field>
      </div>
      <h3 className="sect mt">{t('Bulletin & slides')}</h3>
      <div className="form-grid">
        <Field label={t('Bilingual layout')}>
          <div><Seg<'parallel' | 'stacked'> value={d.bilingual_layout} onChange={(v) => set('bilingual_layout', v)}
            options={[{ value: 'parallel', label: t('Side by side') }, { value: 'stacked', label: t('Stacked') }]} /></div>
        </Field>
        <div className="span-all callout small">
          {t('Paper size, what each bulletin prints, and slide colours and fonts are set in templates and themes.')}{' '}
          <Link to="/bulletin-templates">{t('Bulletin templates')} →</Link>{' · '}<Link to="/slide-templates">{t('Slide templates')} →</Link>
        </div>
        <Field label={t('Bulletin cover')} hint={t('Each service can choose its own.')}>
          <select value={d.bulletin_cover} onChange={(e) => set('bulletin_cover', e.target.value as SettingsT['bulletin_cover'])}>
            {(['plain', 'cross', 'logo', 'verse'] as const).map((c) => <option key={c} value={c}>{t(COVER_LABEL[c])}</option>)}
          </select>
        </Field>
        <Field label={t('Season colours')} hint={t('Accent services, bulletins and slides with the colour of the church year.')}>
          <label className="check" style={{ minHeight: 34 }}>
            <input type="checkbox" checked={d.season_colours} onChange={(e) => set('season_colours', e.target.checked)} />
            {t('Show liturgical season colours')}
          </label>
        </Field>
      </div>
      <div className="row end"><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></div>
    </div>
    <CongregationsCard churchLangs={d.languages} />
    </div>
  );
}

// ---------------------------------------------------------------- users

type UserRow = { id: number; username: string; display_name: string; role: Role; lang: Lang; created_at: string };
const ROLES: Role[] = ['admin', 'editor', 'viewer'];
const ROLE_LABEL: Record<Role, string> = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' };
const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including users, church settings and AI access.',
  editor: 'Plans services and edits the registers, library and rota.',
  viewer: 'Read only — can view and print, and change their own password.',
};

function UsersTab() {
  const { t, lang } = useI18n();
  const { user: me } = useSession();
  const { data, error, loading, reload } = useApi<UserRow[]>('/users');
  const { run, busy } = useAction();
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<UserRow | null>(null);

  const setRole = async (u: UserRow, role: Role) => {
    if (await run(() => api.patch(`/users/${u.id}`, { role }), t('Saved.'))) reload();
  };
  const remove = async (u: UserRow) => {
    if (!confirmAction(`${t('Delete user')} ${u.username}?`)) return;
    if (await run(() => api.del(`/users/${u.id}`), t('Deleted.'))) reload();
  };

  return (
    <div className="stack">
      <div className="card">
        <ul className="plain small">
          {ROLES.map((r) => <li key={r}><strong>{t(ROLE_LABEL[r])}</strong> — {t(ROLE_HELP[r])}</li>)}
        </ul>
      </div>
      <div className="row end"><button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />{t('Add user')}</button></div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr><th>{t('Display name')}</th><th>{t('Username')}</th><th>{t('Role')}</th><th>{t('Created')}</th><th /></tr></thead>
            <tbody>
              {data?.map((u) => (
                <tr key={u.id}>
                  <td className="nowrap">{u.display_name}{u.id === me.id && <span className="badge lapis" style={{ marginLeft: 6 }}>{t('You')}</span>}</td>
                  <td className="nowrap"><span className="code">{u.username}</span></td>
                  <td>
                    <select className="mini" value={u.role} disabled={u.id === me.id || busy} onChange={(e) => setRole(u, e.target.value as Role)} aria-label={t('Role')}>
                      {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}
                    </select>
                  </td>
                  <td className="nowrap muted small">{fmtStamp(u.created_at, lang)}</td>
                  <td className="right nowrap">
                    <button className="btn sm" onClick={() => setResetting(u)}><Icon name="lock" />{t('Reset password')}</button>
                    {u.id !== me.id && <button className="btn ghost sm icon" onClick={() => remove(u)} aria-label={t('Delete')} title={t('Delete')} disabled={busy}><Icon name="trash" /></button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddUserModal onClose={() => setAdding(false)} onSaved={reload} />}
      {resetting && <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function AddUserModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [d, setD] = useState({ username: '', display_name: '', password: '', role: 'editor' as Role });
  const save = async () => {
    const ok = await run(async () => {
      if (d.password.length < 8) throw new Error(t('The password needs at least 8 characters.'));
      return api.post('/users', { ...d, username: d.username.trim(), display_name: d.display_name.trim() });
    }, t('Saved.'));
    if (ok) {
      onSaved();
      onClose();
    }
  };
  return (
    <Modal title={t('Add user')} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></>}>
      <div className="form-grid">
        <Field label={t('Display name')}><input autoFocus value={d.display_name} onChange={(e) => setD({ ...d, display_name: e.target.value })} /></Field>
        <Field label={t('Username')}><input autoComplete="off" value={d.username} onChange={(e) => setD({ ...d, username: e.target.value })} /></Field>
        <Field label={t('Password')} hint={t('At least 8 characters. Ask them to change it after signing in.')}>
          <input type="password" autoComplete="new-password" value={d.password} onChange={(e) => setD({ ...d, password: e.target.value })} />
        </Field>
        <Field label={t('Role')} hint={t(ROLE_HELP[d.role])}>
          <select value={d.role} onChange={(e) => setD({ ...d, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL[r])}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [pw, setPw] = useState('');
  const save = async () => {
    const ok = await run(async () => {
      if (pw.length < 8) throw new Error(t('The password needs at least 8 characters.'));
      return api.patch(`/users/${user.id}`, { password: pw });
    }, t('Password changed.'));
    if (ok) onClose();
  };
  return (
    <Modal title={`${t('Reset password')} · ${user.display_name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></>}>
      <Field label={t('New password')} hint={t('They will be signed out everywhere.')}>
        <input type="password" autoFocus autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </Field>
    </Modal>
  );
}

// ---------------------------------------------------------------- AI / MCP

type Tool = { name: string; module: ModuleKey; access: 'read' | 'write'; title: string; description: string; requires_pii: boolean };
type Grant = {
  grant_id: string; client_id: string; client_name: string; user_id: number; user_name: string; scope: string;
  created_at: string | null; last_used_at: string | null; expires_at: string | null;
};
type Audit = {
  id: number; at: string; user_id: number | null; client_id: string | null; tool: string; module: string | null; access: string | null;
  ok: number; args: string | null; error: string | null; user_name: string | null; client_name: string | null;
};
const MOD_LABEL: Record<ModuleKey, string> = {
  members: 'Members register',
  coworkers: 'Co-workers',
  groups: 'Groups & committees',
  volunteers: 'Volunteers & rota',
  services: 'Services & planner',
  library: 'Library (hymns, texts, Bible)',
  templates: 'Templates',
};
const toolExposed = (tool: Tool, level: ModuleAccess, pii: boolean) =>
  level !== 'off' && (tool.access === 'read' || level === 'write') && (!tool.requires_pii || pii);

/** SQLite "YYYY-MM-DD HH:MM:SS" (UTC) or ISO → local date-time. */
function fmtStamp(s: string | null | undefined, lang: Lang) {
  if (!s) return '—';
  const d = new Date(/T/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(lang === 'zh' ? 'zh-CN' : lang === 'zh-Hant' ? 'zh-TW' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function McpTab() {
  const { t } = useI18n();
  const toast = useToast();
  const cfg = useApi<McpConfig>('/mcp/config');
  const endpoint = useApi<EndpointInfo>('/mcp/endpoint');
  const tools = useApi<Tool[]>('/mcp/tools');
  const [d, setD] = useState<McpConfig | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { run, busy } = useAction();
  useEffect(() => {
    if (cfg.data) setD(cfg.data);
  }, [cfg.data]);
  const dirty = useMemo(() => !!d && !!cfg.data && JSON.stringify(d) !== JSON.stringify(cfg.data), [d, cfg.data]);

  if (cfg.error) return <ErrorBox error={cfg.error} />;
  if (!d) return <Loading />;

  const save = async () => {
    const r = await run(() => api.put<McpConfig>('/mcp/config', d), t('Saved.'));
    if (r) cfg.setData(r);
  };
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast(t('Copied.'));
    } catch {
      window.prompt(t('Copy'), s);
    }
  };
  const visible = (tools.data ?? []).filter((x) => toolExposed(x, d.enabled ? d.modules[x.module] : 'off', d.expose_member_pii)).length;

  return (
    <div className="stack">
      <div className="callout lapis">
        {t('Canon can be connected to Claude (claude.ai) as a custom connector so an AI assistant can help plan services and rotas. You decide exactly which parts of the church’s data it may see or change. Each agent acts as the user who approved it: viewers only ever get read access.')}
      </div>

      <div className="card stack">
        <label className="switch">
          <input type="checkbox" checked={d.enabled} onChange={(e) => { const enabled = e.target.checked; setD((x) => x && { ...x, enabled }); }} />
          <strong>{t('Enable MCP server')}</strong>
          <span className={`badge ${d.enabled ? 'ok' : ''}`}>{d.enabled ? t('On') : t('Off')}</span>
        </label>
        <div>
          <h3 className="sect">{t('Connector URL')}</h3>
          {endpoint.data ? (
            <div className="endpoint">
              <span className="code">{endpoint.data.url}</span>
              <button className="btn sm" onClick={() => copy(endpoint.data!.url)}><Icon name="copy" />{t('Copy')}</button>
            </div>
          ) : endpoint.error ? <ErrorBox error={endpoint.error} /> : <Loading />}
        </div>
        {endpoint.data && <PublicUrlField info={endpoint.data} onSaved={endpoint.reload} />}
        <div className="small">
          <strong>{t('To connect in claude.ai')}</strong>
          <ol className="steps">
            <li>{t('Settings → Connectors → Add custom connector.')}</li>
            <li>{t('Paste the connector URL above. Leave the client ID and secret blank.')}</li>
            <li>{t('Sign in to Canon when asked and approve the access.')}</li>
          </ol>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{t('Module access')}</h2>
          <span className="muted small">{visible} {t('tools available to agents')}</span>
        </div>
        {!d.enabled && <div className="callout small" style={{ marginBottom: 8 }}>{t('The MCP server is off — no tools are available until you enable it.')}</div>}
        {MODULES.map((m) => {
          const level = d.modules[m];
          const mt = (tools.data ?? []).filter((x) => x.module === m);
          const on = mt.filter((x) => toolExposed(x, level, d.expose_member_pii)).length;
          return (
            <div key={m} className="mod-row">
              <div className="row between">
                <div>
                  <strong>{t(MOD_LABEL[m])}</strong>
                  <button className="btn ghost sm" onClick={() => setOpen({ ...open, [m]: !open[m] })} aria-expanded={!!open[m]}>
                    <Icon name={open[m] ? 'chevronDown' : 'chevronRight'} />{on}/{mt.length} {t('tools')}
                  </button>
                </div>
                <Seg<ModuleAccess> value={level} onChange={(v) => setD((x) => x && { ...x, modules: { ...x.modules, [m]: v } })}
                  options={[{ value: 'off', label: t('Off') }, { value: 'read', label: t('Read only') }, { value: 'write', label: t('Read & write') }]} />
              </div>
              {open[m] && (
                <div className="tool-list">
                  {mt.map((x) => {
                    const ex = toolExposed(x, level, d.expose_member_pii);
                    return (
                      <div key={x.name} className={`tool${ex ? '' : ' off'}`}>
                        <Icon name={ex ? 'check' : 'x'} style={{ color: ex ? 'var(--ok)' : 'var(--ink-3)' }} />
                        <div>
                          <span className="tname">{x.name}</span>{' '}
                          <span className={`badge ${x.access === 'write' ? 'warn' : ''}`}>{x.access === 'write' ? t('write') : t('read')}</span>
                          {x.requires_pii && <span className="badge danger" style={{ marginLeft: 4 }}>{t('personal data')}</span>}
                          <div className="muted"><strong>{x.title}</strong> — {x.description}</div>
                        </div>
                      </div>
                    );
                  })}
                  {!mt.length && <span className="muted small">{tools.error ?? t('No tools.')}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card stack">
        <label className="switch">
          <input type="checkbox" checked={d.expose_member_pii} onChange={(e) => { const on = e.target.checked; setD((x) => x && { ...x, expose_member_pii: on }); }} />
          <strong>{t('Expose member contact details & birthdays')}</strong>
        </label>
        <div className="callout warn small">
          {t('PDPA: while this is off, phone numbers, email and home addresses, birth dates, notes and reasons for absence are withheld from everything an AI agent receives, and the birthday tool is hidden. Turn it on only if the church has consent to share members’ personal data with the AI provider.')}
        </div>
      </div>

      <div className="row end mcp-save">
        {dirty && <span className="muted small">{t('Unsaved changes')}</span>}
        <button className="btn" onClick={() => cfg.data && setD(cfg.data)} disabled={!dirty || busy}>{t('Cancel')}</button>
        <button className="btn primary" onClick={save} disabled={!dirty || busy}>{t('Save AI access')}</button>
      </div>

      <GrantsCard />
      <AuditCard />
    </div>
  );
}

function GrantsCard() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useApi<Grant[]>('/mcp/grants');
  const { run, busy } = useAction();
  const revoke = async (g: Grant) => {
    if (!confirmAction(`${t('Revoke access for')} ${g.client_name}?`)) return;
    if (await run(() => api.del(`/mcp/grants/${encodeURIComponent(g.grant_id)}`), t('Revoked.'))) reload();
  };
  return (
    <div className="card flush">
      <div className="card-head" style={{ padding: '14px 16px 0' }}><h2>{t('Connected agents')}</h2></div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : !data?.length ? <Empty title={t('No agents are connected.')} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('Client')}</th><th>{t('User')}</th><th>{t('Access')}</th><th>{t('Connected')}</th><th>{t('Last used')}</th><th>{t('Expires')}</th><th /></tr></thead>
            <tbody>
              {data.map((g) => (
                <tr key={g.grant_id}>
                  <td className="nowrap"><Icon name="bot" width={14} height={14} style={{ verticalAlign: -2 }} /> {g.client_name}</td>
                  <td className="nowrap">{g.user_name}</td>
                  <td>{g.scope.split(' ').map((s) => <span key={s} className={`badge ${s.endsWith('write') ? 'warn' : ''}`} style={{ marginRight: 4 }}>{s.replace('canon:', '')}</span>)}</td>
                  <td className="nowrap small">{fmtStamp(g.created_at, lang)}</td>
                  <td className="nowrap small">{fmtStamp(g.last_used_at, lang)}</td>
                  <td className="nowrap small">{fmtStamp(g.expires_at, lang)}</td>
                  <td className="right"><button className="btn sm danger" onClick={() => revoke(g)} disabled={busy}>{t('Revoke')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type AuditFilters = { module: string; user: string; client: string; tool: string; result: string; from: string; to: string; q: string };
type AuditPage = Paged<Audit> & { facets: { users: { id: number; name: string }[]; clients: { id: string; name: string }[]; tools: string[] } };

function AuditCard() {
  const { t, lang } = useI18n();
  const log = useLogQuery<Audit, AuditFilters>('/mcp/audit', { module: '', user: '', client: '', tool: '', result: '', from: '', to: '', q: '' });
  const { error, loading, reload, filters: f, set } = log;
  const data = log.data as AuditPage | undefined;
  const rows = data?.rows ?? [];
  return (
    <div className="card flush">
      <div className="card-head" style={{ padding: '14px 16px 0' }}>
        <h2>{t('Activity log')}</h2>
        <div className="row">
          <KeepMonths which="mcp_audit_months" />
          <button className="btn ghost sm icon" onClick={reload} aria-label={t('Refresh')} title={t('Refresh')}><Icon name="refresh" /></button>
        </div>
      </div>
      <FilterBar active={log.active} onClear={log.clear}>
        <select className="mini" value={f.module} onChange={(e) => set('module', e.target.value)} aria-label={t('Module')}>
          <option value="">{t('All modules')}</option>
          {MODULES.map((m) => <option key={m} value={m}>{t(MOD_LABEL[m])}</option>)}
        </select>
        <select className="mini" value={f.user} onChange={(e) => set('user', e.target.value)} aria-label={t('User')}>
          <option value="">{t('All users')}</option>
          {data?.facets.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="mini" value={f.client} onChange={(e) => set('client', e.target.value)} aria-label={t('Client')}>
          <option value="">{t('All clients')}</option>
          {data?.facets.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="mini" value={f.tool} onChange={(e) => set('tool', e.target.value)} aria-label={t('Tool')}>
          <option value="">{t('All tools')}</option>
          {data?.facets.tools.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select className="mini" value={f.result} onChange={(e) => set('result', e.target.value)} aria-label={t('Result')}>
          <option value="">{t('OK and errors')}</option>
          <option value="ok">{t('OK')}</option>
          <option value="error">{t('Errors only')}</option>
        </select>
        <DateRange from={f.from} to={f.to} onFrom={(v) => set('from', v)} onTo={(v) => set('to', v)} />
        <input className="mini" type="search" placeholder={t('Search arguments…')} value={f.q} onChange={(e) => set('q', e.target.value)} style={{ width: 170 }} />
      </FilterBar>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : !rows.length ? <Empty title={log.active ? t('Nothing matches these filters.') : t('No AI activity yet.')} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('Time')}</th><th>{t('User')}</th><th>{t('Client')}</th><th>{t('Tool')}</th><th>{t('Module')}</th><th>{t('Result')}</th><th>{t('Arguments')}</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <Fragment key={a.id}>
                  <tr>
                    <td className="nowrap small">{fmtStamp(a.at, lang)}</td>
                    <td className="nowrap">{a.user_name ?? '—'}</td>
                    <td className="nowrap">{a.client_name ?? a.client_id ?? '—'}</td>
                    <td className="nowrap"><span className="code">{a.tool}</span></td>
                    <td className="nowrap small">{a.module ? t(MOD_LABEL[a.module as ModuleKey] ?? a.module) : '—'}</td>
                    <td>{a.ok ? <span className="badge ok">{t('OK')}</span> : <span className="badge danger" title={a.error ?? ''}>{t('Error')}</span>}</td>
                    <td><span className="code args" title={a.args ?? ''}>{a.args ?? ''}</span>{!a.ok && a.error && <div className="small" style={{ color: 'var(--danger)' }}>{a.error}</div>}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > 0 && <div style={{ padding: '0 16px 12px' }}><Pager page={data.page} size={data.size} total={data.total} onPage={log.setPage} /></div>}
    </div>
  );
}

/** From / to dates for a log filter. */
function DateRange({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <span className="row" style={{ gap: 4 }}>
      <input className="mini" type="date" value={from} onChange={(e) => onFrom(e.target.value)} aria-label={t('From')} title={t('From')} />
      <span className="small muted">–</span>
      <input className="mini" type="date" value={to} onChange={(e) => onTo(e.target.value)} aria-label={t('To')} title={t('To')} />
    </span>
  );
}

/** "Keep: 12 months" — how long a log is kept (administrators). */
function KeepMonths({ which }: { which: 'change_log_months' | 'mcp_audit_months' }) {
  const { t } = useI18n();
  const { settings, reloadSettings } = useSession();
  const { run } = useAction();
  const cur = settings?.retention ?? { change_log_months: 24, mcp_audit_months: 12 };
  const save = (n: number) => run(async () => {
    await api.put('/log-retention', { ...cur, [which]: n });
    reloadSettings();
  }, t('Saved.'));
  return (
    <label className="small muted row" style={{ gap: 6 }} title={t('Older entries are deleted once a day.')}>
      {t('Keep')}
      <select className="mini" value={cur[which]} onChange={(e) => save(Number(e.target.value))}>
        {[3, 6, 12, 24, 36, 60].map((n) => <option key={n} value={n}>{t('{n} months').replace('{n}', String(n))}</option>)}
        <option value={0}>{t('Everything')}</option>
      </select>
    </label>
  );
}

// ---------------------------------------------------------------- change log

type ChangeFilters = { entity: string; user: string; via: string; action: string; from: string; to: string; q: string };

/** Settings → Change log: every change by a person, an AI agent or a CSV import. */
function ChangeLogTab() {
  const { t, lang } = useI18n();
  const log = useLogQuery<ChangeRow, ChangeFilters>('/change-log', { entity: '', user: '', via: '', action: '', from: '', to: '', q: '' });
  const { filters: f, set } = log;
  const data = log.data as (Paged<ChangeRow> & { users: { id: number | null; name: string }[]; entities: Record<string, { en: string; zh: string }> }) | undefined;
  return (
    <div className="card flush">
      <div className="card-head" style={{ padding: '14px 16px 0' }}>
        <div>
          <h2>{t('Change log')}</h2>
          <div className="small muted">{t('Who changed what and when: in Canon, through an AI agent, or by CSV import. Only administrators can see it.')}</div>
        </div>
        <div className="row">
          <KeepMonths which="change_log_months" />
          <button className="btn ghost sm icon" onClick={log.reload} aria-label={t('Refresh')} title={t('Refresh')}><Icon name="refresh" /></button>
        </div>
      </div>
      <FilterBar active={log.active} onClear={log.clear}>
        <select className="mini" value={f.entity} onChange={(e) => set('entity', e.target.value)} aria-label={t('What')}>
          <option value="">{t('Everything')}</option>
          {data && Object.entries(data.entities).map(([k, v]) => <option key={k} value={k}>{lang === 'en' ? v.en : v.zh}</option>)}
        </select>
        <select className="mini" value={f.user} onChange={(e) => set('user', e.target.value)} aria-label={t('Who')}>
          <option value="">{t('Everyone')}</option>
          {data?.users.filter((u) => u.id != null).map((u) => <option key={u.id!} value={u.id!}>{u.name}</option>)}
        </select>
        <select className="mini" value={f.via} onChange={(e) => set('via', e.target.value)} aria-label={t('How')}>
          <option value="">{t('Any way')}</option>
          <option value="web">{t('In Canon')}</option>
          <option value="mcp">{t('AI agent')}</option>
          <option value="import">{t('CSV import')}</option>
        </select>
        <select className="mini" value={f.action} onChange={(e) => set('action', e.target.value)} aria-label={t('Action')}>
          <option value="">{t('Added, changed, deleted')}</option>
          <option value="create">{t('Added')}</option>
          <option value="update">{t('Changed')}</option>
          <option value="delete">{t('Deleted')}</option>
        </select>
        <DateRange from={f.from} to={f.to} onFrom={(v) => set('from', v)} onTo={(v) => set('to', v)} />
        <input className="mini" type="search" placeholder={t('Search names and values…')} value={f.q} onChange={(e) => set('q', e.target.value)} style={{ width: 190 }} />
      </FilterBar>
      {log.error && <ErrorBox error={log.error} />}
      {!data ? <Loading /> : !data.rows.length ? <Empty title={log.active ? t('Nothing matches these filters.') : t('No changes recorded yet.')} /> : (
        <>
          <ChangeList rows={data.rows} entities={data.entities} />
          <div style={{ padding: '0 16px 12px' }}><Pager page={data.page} size={data.size} total={data.total} onPage={log.setPage} /></div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- public address (for claude.ai)

interface EndpointInfo { url: string; public_url_set: boolean; public_url: string; trust_proxy: boolean; env_override: boolean }

/** Text box for the public https address, so nobody has to edit environment variables. */
function PublicUrlField({ info, onSaved }: { info: EndpointInfo; onSaved: () => void }) {
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

