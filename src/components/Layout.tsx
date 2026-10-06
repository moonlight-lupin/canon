import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import type { Lang } from '../../shared/types.ts';
import { Icon, ReedMark, type IconName } from './icons.tsx';
import { ChurchMark, Tagline } from './brand.tsx';
import { UI_LANGS, langInfo } from '../../shared/languages.ts';
import { Seg, useSession } from './ui.tsx';
import type { Settings } from '../types-client.ts';
import { allows, pageModule } from '../../shared/permissions.ts';
import { pageOff } from '../../shared/modules.ts';

const NAV: { group: string; items: { to: string; label: string; icon: IconName; admin?: boolean }[] }[] = [
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
                    {items.map((it) => (
                      <NavLink key={it.to} to={it.to} end={it.to === '/'} className={() => (isActive(it.to) ? 'active' : '')}>
                        <Icon name={it.icon} />
                        {t(it.label)}
                      </NavLink>
                    ))}
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
          <MemberLinkReminder />
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
        {t('Every other account belongs to a church member. Add yourself in Members if you are not there yet, then choose yourself under Member in Settings → Users & access.')}
      </span>
      <Link className="btn sm primary" to="/settings?tab=users">{t('Link my account')}</Link>
      <button className="btn sm ghost" onClick={hide}>{t('Remind me later')}</button>
    </div>
  );
}
