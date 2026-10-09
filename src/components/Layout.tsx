import { EncryptionBanner } from './Encryption.tsx';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import type { Lang } from '../../shared/types.ts';
import { Icon, ReedMark, type IconName } from './icons.tsx';
import { ChurchMark, Tagline } from './brand.tsx';
import { UI_LANGS, dateLocale, langInfo } from '../../shared/languages.ts';
import { Seg, useSession } from './ui.tsx';
import type { Settings } from '../types-client.ts';
import { allows, pageModule } from '../../shared/permissions.ts';
import { pageOff } from '../../shared/modules.ts';
import { setExportContext } from './xlsx-download.ts';
import { UpdateNotice } from './Updates.tsx';

// newTab: a page outside Canon's frame (the phone claims page) opens in a tab of its own
const NAV: { group: string; items: { to: string; label: string; icon: IconName; admin?: boolean; newTab?: boolean }[] }[] = [
  { group: '', items: [{ to: '/', label: 'Dashboard', icon: 'home' }, { to: '/calendar', label: 'Calendar', icon: 'calendar' }] },
  {
    // services and meetings are both planned here
    group: 'Planner',
    items: [
      { to: '/services', label: 'Services', icon: 'calendar' },
      { to: '/meetings', label: 'Meetings', icon: 'clock' },
      { to: '/library', label: 'Library', icon: 'book' },
      { to: '/templates', label: 'Service templates', icon: 'layout' },
      { to: '/bulletin-templates', label: 'Bulletin templates', icon: 'print' },
      { to: '/slide-templates', label: 'Slide templates', icon: 'monitor' },
    ],
  },
  {
    group: 'Congregation',
    items: [
      { to: '/groups', label: 'Groups', icon: 'layout' },
      { to: '/members', label: 'Members', icon: 'users' },
      { to: '/coworkers', label: 'Co-workers', icon: 'shield' },
      { to: '/volunteers', label: 'Volunteers', icon: 'hands' },
    ],
  },
  { group: 'Records', items: [{ to: '/records', label: 'Service records', icon: 'list' }, { to: '/reports', label: 'Reports', icon: 'chart' }] },
  // optional modules (0.15): shown when switched on (Settings → Modules) and the role may read them
  { group: 'Resources', items: [{ to: '/lending', label: 'Lending library', icon: 'books' }, { to: '/equipment', label: 'Asset register', icon: 'box' }] },
  { group: 'Finance', items: [{ to: '/bookkeeping', label: 'Book-keeping', icon: 'ledger' }, { to: '/self/claims', label: 'My claims', icon: 'file', newTab: true }] },
  { group: 'Administration', items: [{ to: '/settings', label: 'Settings', icon: 'settings' }] },
];

// Sections folded in the sidebar (this browser only): room for more modules without a long list.
const FOLD_KEY = 'canon.nav.folded';
function readFolded(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function Layout() {
  const { user: me, isAdmin: admin, settings: church } = useSession();
  // pages the account's role can't read are left out of the sidebar (the server refuses them anyway)
  const visible = (it: { to: string; admin?: boolean }) => {
    if (it.admin) return admin;
    if (pageOff(it.to, church?.modules)) return false;
    const m = pageModule(it.to);
    // Settings is everyone's (their own profile); its tabs are for administrators
    return m === null || m === 'admin' || allows(me.role_def, m, 'read');
  };
  const { t, lt, lang, setLang } = useI18n();
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const [folded, setFolded] = useState<string[]>(readFolded);
  const toggleFold = (group: string) => setFolded((f) => {
    const next = f.includes(group) ? f.filter((g) => g !== group) : [...f, group];
    try {
      localStorage.setItem(FOLD_KEY, JSON.stringify(next));
    } catch { /* private window: folding still works for this visit */ }
    return next;
  });
  useEffect(() => {
    const role = lt(me.role_def?.name);
    setExportContext({
      church: lt(church?.church_name), who: `${me.display_name}${role ? ` (${role})` : ''}`, lang,
      exported: t('Exported {at} by {who}'), pii: t('Contains personal data: keep it where only the office can open it.'),
    });
  }, [lang, me, church]); // eslint-disable-line react-hooks/exhaustive-deps
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to));
  // going to a page in a folded section opens that section (it can be folded again by hand)
  useEffect(() => {
    const g = NAV.find((x) => x.group && x.items.some((it) => (it.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(it.to))))?.group;
    if (!g) return;
    setFolded((f) => {
      if (!f.includes(g)) return f;
      const next = f.filter((x) => x !== g);
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify(next));
      } catch { /* private window */ }
      return next;
    });
  }, [loc.pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: settings } = useApi<Settings>('/settings');

  // UI languages offered: English plus any of the church's languages that have a translated interface.
  const uiLangs = UI_LANGS.filter((l) => l === 'en' || (settings?.languages ?? ['zh']).includes(l));
  const changeLang = (l: Lang) => {
    setLang(l);
    api.patch('/me', { lang: l }).catch(() => {});
  };

  return (
    <div className="shell">
      <aside className={`side${open ? ' open' : ''}`} onClick={() => setOpen(false)}>
        <div className="brand">
          <ChurchMark className="brand-mark" />
          <div>
            <div className="brand-name">Canon</div>
            {settings && <div className="brand-church">{lt(settings.church_name)}</div>}
          </div>
        </div>
        <Tagline className="brand-tagline" />
        <nav className="nav">
          {NAV.filter((g) => g.items.some(visible)).map((g) => {
            const items = g.items.filter(visible);
            const shut = !!g.group && folded.includes(g.group);
            const id = `nav-${g.group.toLowerCase().replace(/\W+/g, '-')}`;
            return (
              <div key={g.group} className="nav" style={{ gap: 1 }}>
                {g.group && (
                  <button type="button" className="nav-group" aria-expanded={!shut} aria-controls={id}
                    onClick={(e) => { e.stopPropagation(); toggleFold(g.group); }} title={shut ? t('Show this section') : t('Fold this section')}>
                    <span>{t(g.group)}</span>
                    <Icon name={shut ? 'chevronRight' : 'chevronDown'} />
                  </button>
                )}
                {!shut && (
                  <div id={id} className="nav" style={{ gap: 1 }}>
                    {items.map((it) => (it.newTab ? (
                      <a key={it.to} href={it.to} target="_blank" rel="noopener">
                        <Icon name={it.icon} />
                        {t(it.label)}
                      </a>
                    ) : (
                      <NavLink key={it.to} to={it.to} end={it.to === '/'} className={() => (isActive(it.to) ? 'active' : '')}>
                        <Icon name={it.icon} />
                        {t(it.label)}
                      </NavLink>
                    )))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="side-foot">
          <Seg<Lang> value={lang} onChange={changeLang} options={uiLangs.map((l) => ({ value: l, label: langInfo(l).short }))} />
          <div className="row" style={{ gap: 14 }}>
            <NavLink to="/guide" className="small muted" style={{ textDecoration: 'none' }}>{t('Guide')}</NavLink>
            <NavLink to="/about" className="small muted" style={{ textDecoration: 'none' }}>{t('About Canon')}</NavLink>
          </div>
          {admin && <UpdateNotice />}
          <div className="row between">
            <span title={user.username}>{user.display_name} · <span className="badge">{t(user.role[0].toUpperCase() + user.role.slice(1))}</span></span>
            <button className="btn ghost sm icon" onClick={logout} title={t('Sign out')} aria-label={t('Sign out')}>
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="mobile-bar no-print">
          <button className="btn ghost icon" onClick={() => setOpen((o) => !o)} aria-label="Menu"><Icon name="menu" /></button>
          <ReedMark className="brand-mark" />
          <strong className="serif">Canon</strong>
        </div>
        <main id="main">
          <EncryptionBanner />
          <TestCopyBanner />
          <MemberLinkReminder />
          <UnknownRoleNotice />
          <AccountNotices />
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Every account belongs to a church member, except an external guest's. The administrator who set Canon up may
 * start without one: until they link it, this reminder sits above every page (it can be hidden until the next
 * sign-in).
 */
function MemberLinkReminder() {
  const { t } = useI18n();
  const { user } = useSession();
  const key = `canon.member-link-later.${user.id}`;
  const [later, setLater] = useState(() => {
    try {
      return sessionStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  if (!user.first_admin || user.person_id || later) return null;
  const hide = () => {
    try {
      sessionStorage.setItem(key, '1');
    } catch { /* hidden for this page only */ }
    setLater(true);
  };
  return (
    <div className="callout warn row no-print member-link-reminder" role="status">
      <span className="grow small">
        <strong>{t('Your account is not linked to your member record.')}</strong>{' '}
        {t('Every other account belongs to a church member. Add yourself in Members if you are not there yet, then choose yourself under Member in Settings → User accounts.')}
      </span>
      <Link className="btn sm primary" to="/settings?tab=users">{t('Link my account')}</Link>
      <button className="btn sm ghost" onClick={hide}>{t('Remind me later')}</button>
    </div>
  );
}

/**
 * Notices about this account's own sign-in (0.19.9): a recovery code used, two-step sign-in reset by an administrator.
 * They stay above every page until read; if it wasn't them, the notice says what to do.
 */
function AccountNotices() {
  const { t, lang } = useI18n();
  const { user, refresh } = useSession();
  const notices = user.notices ?? [];
  if (!notices.length) return null;
  const what = (k: string) => ({
    recovery_code_used: t('A recovery code was used to sign in to your account.'),
    two_step_reset: t('An administrator reset two-step sign-in for your account.'),
    two_step_on: t('Two-step sign-in was turned on for your account.'),
    two_step_off: t('Two-step sign-in was turned off for your account.'),
    recovery_codes_new: t('New recovery codes were made for your account.'),
  } as Record<string, string>)[k] ?? k;
  const seen = async () => {
    await api.post('/me/notices/seen', { ids: notices.map((n) => n.id) }).catch(() => {});
    await refresh();
  };
  return (
    <div className="callout warn no-print" role="status" style={{ marginBottom: 12 }}>
      {notices.map((n) => (
        <div key={n.id} className="small">
          <strong>{what(n.kind)}</strong>{' '}
          {new Date(n.created_at).toLocaleString(dateLocale(lang), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          {n.detail.ip ? ` · ${t('from the address {ip}').replace('{ip}', n.detail.ip)}` : ''}
          {n.detail.by ? ` · ${t('by {name}').replace('{name}', n.detail.by)}` : ''}
          {n.kind === 'recovery_code_used' && n.detail.left !== undefined ? ` · ${t('{n} recovery codes left.').replace('{n}', String(n.detail.left))}` : ''}
        </div>
      ))}
      <div className="row" style={{ marginTop: 6, gap: 8, alignItems: 'center' }}>
        <span className="grow small">{t('If this wasn’t you, change your password (Settings → My profile) and tell your church’s administrator at once.')}</span>
        <Link className="btn sm" to="/settings?tab=profile">{t('My profile')}</Link>
        <button className="btn sm primary" onClick={() => void seen()}>{t('Got it')}</button>
      </div>
    </div>
  );
}

/** A role Canon doesn't know gives no access (0.19.9): said plainly, so the person knows whom to ask. */
function UnknownRoleNotice() {
  const { t } = useI18n();
  const { user } = useSession();
  if (!user.role_def?.unknown) return null;
  return (
    <div className="callout warn no-print" role="status" style={{ marginBottom: 12 }}>
      <strong>{t('Your account has no access.')}</strong>{' '}
      {t('Its role (“{role}”) is not one Canon knows. Ask an administrator to choose a role for it in Settings → User accounts.').replace('{role}', user.role)}
    </div>
  );
}

/** A test copy of the church's data (CANON_TEST_COPY=1): said on every page, so nobody takes it for the real Canon. */
function TestCopyBanner() {
  const { t } = useI18n();
  const { data } = useApi<{ test_copy?: boolean }>('/about');
  if (!data?.test_copy) return null;
  return <div className="callout warn no-print" style={{ marginBottom: 12 }}>{t('Test copy: Canon sends no e-mail here and leaves Google Drive alone.')}</div>;
}
