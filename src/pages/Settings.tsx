// Settings: my profile (everyone), church settings, users & access, and AI / MCP exposure control (admins).
import { useState } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { UI_LANGS, langInfo } from '../../shared/languages.ts';
import { LanguagesPanel } from './Onboarding.tsx';
import EmailTab from './settings/EmailTab.tsx';
import BackupsTab from './settings/BackupsTab.tsx';
import { Field, PageHead, Seg, useAction, useSession } from '../components/ui.tsx';
import type { Lang } from '../types-client.ts';
import { OfferingsTab } from './settings/OfferingsTab.tsx';
import { MemberFieldsTab } from './settings/MemberFieldsTab.tsx';
import { SecurityTab } from './settings/SecurityTab.tsx';
import { VisitorFormTab } from './settings/VisitorFormTab.tsx';
import './people.css';
import { ChangeLogTab } from './settings/ChangeLogTab.tsx';
import { ChurchTab } from './settings/ChurchTab.tsx';
import { SpacesTab } from './settings/SpacesTab.tsx';
import { ExportTab } from './settings/ExportTab.tsx';
import { SampleDataTab } from './settings/SampleDataTab.tsx';
import { McpTab } from './settings/McpTab.tsx';
import { UsersTab } from './settings/UsersTab.tsx';
import { RolesTab } from './settings/RolesCard.tsx';
import { ModulesPanel } from './settings/ModulesTab.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { Icon } from '../components/icons.tsx';

type Tab = 'profile' | 'church' | 'spaces' | 'export' | 'languages' | 'modules' | 'users' | 'roles' | 'member-fields' | 'offerings' | 'visitor-form' | 'email' | 'backups' | 'security' | 'mcp' | 'changelog' | 'sample';

export default function Settings() {
  const { t } = useI18n();
  const { isAdmin, settings, reloadSettings } = useSession();
  // the sections in groups, listed down the side (a dropdown on a phone): my account; the church; people; Canon itself
  const groups: [Tab, string][][] = [
    [['profile', 'My profile']],
    [['church', 'Church'], ['spaces', 'Spaces'], ['languages', 'Languages'], ['modules', 'Modules'], ['offerings', 'Offerings']],
    [['users', 'User accounts'], ['roles', 'Roles & permissions'], ['member-fields', 'Member fields'], ['visitor-form', 'Visitor form']],
    [['security', 'Security & privacy'], ['backups', 'Backups'], ['export', 'Export data'], ['email', 'E-mail'], ['mcp', 'AI / MCP'], ['changelog', 'Change log'], ['sample', 'Sample data']],
  ];
  const groupTitles = ['My account', 'Church', 'People and access', 'Canon'];
  const all = groups.flat().map(([k]) => k);
  // ?tab=email etc. opens a section (links from other screens); the address follows the section chosen
  const [tab, setTabState] = useState<Tab>(() => {
    const q = new URLSearchParams(location.search).get('tab') as Tab | null;
    return q && all.includes(q) ? q : 'profile';
  });
  const setTab = (k: Tab) => {
    setTabState(k);
    history.replaceState(history.state, '', k === 'profile' ? location.pathname : `${location.pathname}?tab=${k}`);
  };
  const shown = (k: Tab) => k !== 'visitor-form' || settings?.modules?.visitor_form !== false;
  return (
    <div className="page people-page">
      <PageHead eyebrow={t('Admin')} title={t('Settings')} />
      <div className="stack">
        {!isAdmin && <ProfileCard />}
        {isAdmin && (
          <div className="settings-layout">
            <nav className="settings-nav" aria-label={t('Settings')}>
              {groups.map((g, gi) => (
                <div key={gi} className="settings-nav-group">
                  <div className="eyebrow">{t(groupTitles[gi])}</div>
                  {g.filter(([k]) => shown(k)).map(([k, l]) => (
                    <button key={k} type="button" aria-current={tab === k ? 'page' : undefined} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(l)}</button>
                  ))}
                </div>
              ))}
            </nav>
            <select className="settings-nav-select" aria-label={t('Settings')} value={tab} onChange={(e) => setTab(e.target.value as Tab)}>
              {groups.map((g, gi) => (
                <optgroup key={gi} label={t(groupTitles[gi])}>
                  {g.filter(([k]) => shown(k)).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
                </optgroup>
              ))}
            </select>
            <div className="settings-body">
            {tab === 'profile' && <ProfileCard />}
            {tab === 'church' && <ChurchTab />}
            {tab === 'spaces' && <SpacesTab />}
            {tab === 'export' && <ExportTab />}
            {tab === 'changelog' && <ChangeLogTab />}
            {tab === 'sample' && <SampleDataTab />}
            {tab === 'languages' && settings && <LanguagesPanel settings={settings} onSaved={reloadSettings} />}
            {tab === 'modules' && settings && <div className="card"><ModulesPanel initial={settings.modules} onSaved={reloadSettings} /></div>}
            {tab === 'users' && <UsersTab />}
            {tab === 'roles' && <RolesTab />}
            {tab === 'member-fields' && <MemberFieldsTab />}
            {tab === 'offerings' && <OfferingsTab />}
            {tab === 'visitor-form' && <VisitorFormTab />}
            {tab === 'email' && <EmailTab />}
            {tab === 'backups' && <BackupsTab />}
            {tab === 'security' && <SecurityTab />}
            {tab === 'mcp' && <McpTab />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- my profile

/** Two-step sign-in for my account: an authenticator app's code after the password, and recovery codes. */
export function TwoStepCard({ forced }: { forced?: boolean }) {
  const { t } = useI18n();
  const { user, refresh } = useSession();
  const { run, busy } = useAction();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pw, setPw] = useState('');
  const start = () => run(async () => setSetup(await api.post<{ secret: string; qr: string }>('/me/two-step/setup', {})));
  const enable = () => run(async () => {
    // the password too (0.19.9): a session left open on a shared computer isn't enough to change how you sign in
    const r = await api.post<{ recovery_codes: string[] }>('/me/two-step/enable', { code, password: pw }).catch((e: Error) => {
      throw new Error(t(e.message));
    });
    setCodes(r.recovery_codes);
    setSetup(null);
    setCode('');
    setPw('');
    // on the "set it up first" screen, Canon opens once the codes are saved (refreshing now would hide them)
    if (!forced) await refresh();
  }, t('Two-step sign-in is on.'));
  const disable = () => run(async () => {
    await api.post('/me/two-step/disable', { password: pw }).catch((e: Error) => {
      throw new Error(t(e.message));
    });
    setPw('');
    await refresh();
  }, t('Two-step sign-in is off.'));
  // new recovery codes replace all the old ones (when they run low, or the shorter kind made before 0.19.9)
  const newCodes = () => run(async () => {
    const r = await api.post<{ recovery_codes: string[] }>('/me/two-step/recovery-codes', { password: pw }).catch((e: Error) => {
      throw new Error(t(e.message));
    });
    setCodes(r.recovery_codes);
    setPw('');
    await refresh();
  }, t('New recovery codes made. The old ones no longer work.'));
  const left = user.two_step?.recovery_left ?? 0;
  return (
    <div className="stack tight">
      <h3 className="sect" style={{ marginBottom: 0 }}>{t('Two-step sign-in')} <InfoTip text={t('After your password, Canon asks for a 6-digit code from an authenticator app on your phone (Google or Microsoft Authenticator, 1Password …), so a stolen password alone can’t sign in.')} /></h3>
      {codes && (
        <div className="callout">
          <strong>{t('Your recovery codes')}</strong> — {t('keep them somewhere safe: each signs you in once if you lose your phone. They are shown only now.')}
          <pre className="small" style={{ margin: '6px 0 0' }}>{codes.join('\n')}</pre>
          {forced && <div className="row end" style={{ marginTop: 8 }}><button className="btn primary sm" onClick={() => void refresh()}>{t('I’ve saved them: open Canon')}</button></div>}
        </div>
      )}
      {codes && forced ? null : user.totp_enabled ? (
        <div className="stack tight">
          {!codes && user.two_step?.recovery_old && (
            <div className="callout warn small">{t('Your recovery codes are of an older, shorter kind. Make new ones (with your password): they replace all the old ones.')}</div>
          )}
          {!codes && !user.two_step?.recovery_old && left <= 2 && (
            <div className="callout warn small">{left === 0 ? t('You have no recovery codes left. Make new ones (with your password).') : t('{n} recovery codes left. Make new ones (with your password).').replace('{n}', String(left))}</div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="badge ok">{t('On')}</span>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('Your password')} autoComplete="current-password" style={{ maxWidth: 200 }} />
            <button className="btn sm" onClick={newCodes} disabled={busy || !pw}>{t('New recovery codes')}</button>
            <button className="btn sm" onClick={disable} disabled={busy || !pw}>{t('Turn off')}</button>
          </div>
          {!codes && left > 2 && !user.two_step?.recovery_old && <div className="small muted">{t('{n} recovery codes left.').replace('{n}', String(left))}</div>}
        </div>
      ) : setup ? (
        <div className="stack tight">
          <p className="small" style={{ margin: 0 }}>{t('Scan this with your authenticator app (or type the key), then enter the code it shows.')}</p>
          <img src={setup.qr} alt="" width={180} height={180} />
          <code className="small">{setup.secret}</code>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" style={{ width: 120 }} aria-label={t('Code from your authenticator app')} />
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={t('Your password')} autoComplete="current-password" style={{ maxWidth: 200 }} aria-label={t('Your password')} />
            <button className="btn primary sm" onClick={enable} disabled={busy || code.trim().length < 6 || !pw}>{t('Turn on')}</button>
          </div>
        </div>
      ) : (
        <div><button className="btn sm" onClick={start} disabled={busy}><Icon name="lock" />{t('Set up two-step sign-in')}</button></div>
      )}
    </div>
  );
}

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
    }, t('Password changed. You are signed out everywhere else.'));
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
        <TwoStepCard />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- church
