import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import type { Lang } from '../../shared/types.ts';
import { Icon, ReedMark, type IconName } from './icons.tsx';
import { ChurchMark, Tagline } from './brand.tsx';
import { UI_LANGS, langInfo } from '../../shared/languages.ts';
import { Seg, useSession } from './ui.tsx';
import type { Settings } from '../types-client.ts';

const NAV: { group: string; items: { to: string; label: string; icon: IconName; admin?: boolean }[] }[] = [
  { group: '', items: [{ to: '/', label: 'Dashboard', icon: 'home' }] },
  {
    group: 'Service Planner',
    items: [
      { to: '/services', label: 'Services', icon: 'calendar' },
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


export function Layout() {
  const { t, lt, lang, setLang } = useI18n();
  const { user, logout } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
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
          {NAV.map((g) => (
            <div key={g.group} className="nav" style={{ gap: 1 }}>
              {g.group && <div className="nav-group">{t(g.group)}</div>}
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.to === '/'} className={({ isActive }) => (isActive || (it.to !== '/' && loc.pathname.startsWith(it.to)) ? 'active' : '')}>
                  <Icon name={it.icon} />
                  {t(it.label)}
                </NavLink>
              ))}
            </div>
          ))}
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
        <Outlet />
      </div>
    </div>
  );
}
