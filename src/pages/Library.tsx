import { useState } from 'react';
import type { L10n } from '../types-client.ts';
import { useApi } from '../api.ts';
import { Icon } from '../components/icons.tsx';
import { CardMenu } from './template-ui.tsx';
import { ImportLibrary, librarySections } from './settings/ExportTab.tsx';
import { useSearchParams } from 'react-router-dom';
import { BlocksTab } from './Blocks.tsx';
import { useI18n } from '../i18n.tsx';
import { PageHead, useSession } from '../components/ui.tsx';
import { BundledLibraryButton } from './library/BundledLibrary.tsx';
import { BackgroundsTab } from './Backgrounds.tsx';
import { ImagesTab } from './Images.tsx';
import { LibraryCheckButton } from './LibraryCheck.tsx';
import { Bible } from './library/Bible.tsx';
import { Hymnals, Songs } from './library/Songs.tsx';
import { Texts } from './library/Texts.tsx';

type LibTab = 'songs' | 'hymnals' | 'texts' | 'bible' | 'images' | 'blocks' | 'backgrounds';

const LIB_TABS: LibTab[] = ['songs', 'hymnals', 'texts', 'bible', 'images', 'blocks', 'backgrounds'];

const LIB_TAB_LABEL: Record<LibTab, string> = { songs: 'Hymns & songs', hymnals: 'Hymnals', texts: 'Liturgical texts', bible: 'Bible', images: 'Images', blocks: 'QR codes & notes', backgrounds: 'Slide backgrounds' };

export default function Library() {
  const { t } = useI18n();
  // ?tab=blocks (and the other tab names) opens that tab, e.g. from the planner's "QR codes & notes on slides"
  const [sp, setSp] = useSearchParams();
  const q = sp.get('tab') as LibTab | null;
  const tab: LibTab = q && LIB_TABS.includes(q) ? q : 'songs';
  const setTab = (k: LibTab) => setSp(k === 'songs' ? {} : { tab: k }, { replace: true });
  const { isAdmin } = useSession();
  const [version, setVersion] = useState(0); // reloads the tab after Canon's library adds items
  return (
    <div className="page">
      <PageHead eyebrow={`${t('Planner')} · ${t('Library')}`} title={t(LIB_TAB_LABEL[tab])}>
        {(tab === 'songs' || tab === 'texts' || tab === 'bible') && <LibraryCheckButton />}
        {isAdmin && (tab === 'songs' || tab === 'texts') && <BundledLibraryButton onAdded={() => setVersion((v) => v + 1)} />}
        {isAdmin && <SectionExport tab={tab} />}
        {isAdmin && <ImportLibrary />}
      </PageHead>
      <div className="tabs">
        {LIB_TABS.map((k) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(LIB_TAB_LABEL[k])}</button>)}
      </div>
      {tab === 'songs' && <Songs key={version} />}
      {tab === 'hymnals' && <Hymnals />}
      {tab === 'texts' && <Texts key={version} />}
      {tab === 'bible' && <Bible />}
      {tab === 'blocks' && <BlocksTab />}
      {tab === 'images' && <ImagesTab />}
      {tab === 'backgrounds' && <BackgroundsTab />}
    </div>
  );
}

// ------------------------------------------------------------------ songs

/** Export this tab's section as a library file (hymns: one hymnal at a time). */
function SectionExport({ tab }: { tab: LibTab }) {
  const { t, lt } = useI18n();
  const data = useApi<{ hymnals: { id: number; abbr: string; name: L10n }[]; bibles: { code: string; name: string }[] }>('/export');
  if (!data.data) return null;
  const want = tab === 'songs' || tab === 'hymnals' ? 'songs' : tab === 'bible' ? 'bibles' : tab;
  const list = librarySections(data.data.hymnals, data.data.bibles, t, lt).filter((x) => x.section === want);
  if (!list.length) return null;
  if (list.length === 1) return <a className="btn" href={list[0].href}><Icon name="download" />{t('Export')}</a>;
  return <CardMenu label={t('Export')} trigger={<><Icon name="download" />{t('Export')} ▾</>} down actions={list.map((x) => ({ label: x.label, onClick: () => { window.location.href = x.href; } }))} />;
}
