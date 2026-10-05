import { StrictMode, Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { api, onUnauthorised, setCsrf, useApi } from './api.ts';
import { ChurchLanguages, I18nProvider, useI18n } from './i18n.tsx';
import type { Settings } from './types-client.ts';
import { Loading, SessionCtx, ToastProvider, type SessionUser } from './components/ui.tsx';
import { Layout } from './components/Layout.tsx';
import Login from './pages/Login.tsx';

const Dashboard = lazy(() => import('./pages/Dashboard.tsx'));
const Services = lazy(() => import('./pages/Services.tsx'));
const ServiceEditor = lazy(() => import('./pages/ServiceEditor.tsx'));
const Members = lazy(() => import('./pages/Members.tsx'));
const Coworkers = lazy(() => import('./pages/Coworkers.tsx'));
const Groups = lazy(() => import('./pages/Groups.tsx'));
const Volunteers = lazy(() => import('./pages/Volunteers.tsx'));
const Library = lazy(() => import('./pages/Library.tsx'));
const Templates = lazy(() => import('./pages/Templates.tsx'));
const Presentation = lazy(() => import('./pages/Presentation.tsx'));
const BulletinTemplates = lazy(() => import('./pages/Presentation.tsx').then((m) => ({ default: m.BulletinTemplatesPage })));
const SlideTemplates = lazy(() => import('./pages/Presentation.tsx').then((m) => ({ default: m.SlideTemplatesPage })));
const Settings = lazy(() => import('./pages/Settings.tsx'));
const Records = lazy(() => import('./pages/Records.tsx'));
const RecordEditor = lazy(() => import('./pages/Records.tsx').then((m) => ({ default: m.RecordEditor })));
const CashDeclaration = lazy(() => import('./pages/Records.tsx').then((m) => ({ default: m.CashDeclaration })));
const Reports = lazy(() => import('./pages/Reports.tsx'));
const OfferingsMonth = lazy(() => import('./pages/Reports.tsx').then((m) => ({ default: m.OfferingsMonth })));
const Bulletin = lazy(() => import('./outputs/Bulletin.tsx'));
const Slides = lazy(() => import('./outputs/Slides.tsx'));
const RunSheet = lazy(() => import('./outputs/RunSheet.tsx'));
const Share = lazy(() => import('./outputs/Share.tsx'));
const Onboarding = lazy(() => import('./pages/Onboarding.tsx'));
const About = lazy(() => import('./pages/About.tsx'));
const Guide = lazy(() => import('./pages/Guide.tsx'));

interface Me {
  user: SessionUser | null;
  csrf: string | null;
  needsSetup: boolean;
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const { setLang } = useI18n();
  const loc = useLocation();

  const refresh = useCallback(async () => {
    const m = await api.get<Me>('/me');
    setCsrf(m.csrf);
    if (m.user?.lang) setLang(m.user.lang);
    setMe(m);
  }, [setLang]);

  useEffect(() => {
    refresh().catch(() => setMe({ user: null, csrf: null, needsSetup: false }));
    return onUnauthorised(() => setMe((m) => (m ? { ...m, user: null } : m)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Public share pages need no session.
  if (loc.pathname.startsWith('/share/')) {
    return (
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/share/:token/*" element={<Share />} />
        </Routes>
      </Suspense>
    );
  }
  if (!me) return <Loading />;
  if (!me.user) return <Login needsSetup={me.needsSetup} onDone={refresh} />;

  const logout = async () => {
    await api.post('/logout').catch(() => {});
    setCsrf(null);
    setMe({ user: null, csrf: null, needsSetup: false });
  };
  return <Authed user={me.user} logout={logout} refresh={refresh} />;
}

function Authed({ user, logout, refresh }: { user: SessionUser; logout: () => void; refresh: () => Promise<void> }) {
  const { data: settings, reload: reloadSettings } = useApi<Settings>('/settings');
  if (!settings) return <Loading />;
  // First run: an administrator chooses the church's languages and imports Bibles.
  if (!settings.onboarded && user.role === 'admin') {
    return (
      <Suspense fallback={<Loading />}>
        <Onboarding settings={settings} onDone={reloadSettings} />
      </Suspense>
    );
  }
  return (
    <SessionCtx.Provider value={{ user, canEdit: user.role !== 'viewer', isAdmin: user.role === 'admin', logout, refresh, settings, reloadSettings }}>
     <ChurchLanguages langs={settings.languages}>
      <Suspense fallback={<Loading />}>
        <Routes>
          {/* Full-screen outputs (no app chrome) */}
          <Route path="/services/:id/bulletin" element={<Bulletin />} />
          <Route path="/records/:id/declaration" element={<CashDeclaration />} />
          <Route path="/reports/offerings/:month" element={<OfferingsMonth />} />
          <Route path="/services/:id/slides" element={<Slides />} />
          <Route path="/services/:id/runsheet" element={<RunSheet />} />
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="services" element={<Services />} />
            <Route path="services/:id" element={<ServiceEditor />} />
            <Route path="records" element={<Records />} />
            <Route path="records/:id" element={<RecordEditor />} />
            <Route path="reports" element={<Reports />} />
            <Route path="members" element={<Members />} />
            <Route path="coworkers" element={<Coworkers />} />
            <Route path="groups" element={<Groups />} />
            <Route path="volunteers" element={<Volunteers />} />
            <Route path="library" element={<Library />} />
            <Route path="templates" element={<Templates />} />
            <Route path="presentation" element={<Presentation />} />
            <Route path="bulletin-templates" element={<BulletinTemplates />} />
            <Route path="slide-templates" element={<SlideTemplates />} />
            <Route path="settings" element={<Settings />} />
            <Route path="about" element={<About />} />
            <Route path="guide" element={<Guide />} />
            <Route path="login" element={<Navigate to="/" replace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
     </ChurchLanguages>
    </SessionCtx.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
