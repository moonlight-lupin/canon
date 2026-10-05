import { useSearchParams } from 'react-router-dom';
import { BlocksTab } from './Blocks.tsx';
import { useI18n } from '../i18n.tsx';
import { PageHead } from '../components/ui.tsx';
import { BackgroundsTab } from './Backgrounds.tsx';
import { LibraryCheckButton } from './LibraryCheck.tsx';
import { Bible } from './library/Bible.tsx';
import { Hymnals, Songs } from './library/Songs.tsx';
import { Texts } from './library/Texts.tsx';

type LibTab = 'songs' | 'hymnals' | 'texts' | 'bible' | 'blocks' | 'backgrounds';

const LIB_TABS: LibTab[] = ['songs', 'hymnals', 'texts', 'bible', 'blocks', 'backgrounds'];

const LIB_TAB_LABEL: Record<LibTab, string> = { songs: 'Hymns & songs', hymnals: 'Hymnals', texts: 'Liturgical texts', bible: 'Bible', blocks: 'QR codes & notes', backgrounds: 'Slide backgrounds' };

export default function Library() {
  const { t } = useI18n();
  // ?tab=blocks (and the other tab names) opens that tab, e.g. from the planner's "QR codes & notes on slides"
  const [sp, setSp] = useSearchParams();
  const q = sp.get('tab') as LibTab | null;
  const tab: LibTab = q && LIB_TABS.includes(q) ? q : 'songs';
  const setTab = (k: LibTab) => setSp(k === 'songs' ? {} : { tab: k }, { replace: true });
  return (
    <div className="page">
      <PageHead eyebrow={`${t('Service Planner')} · ${t('Library')}`} title={t(LIB_TAB_LABEL[tab])}>
        {(tab === 'songs' || tab === 'texts' || tab === 'bible') && <LibraryCheckButton />}
      </PageHead>
      <div className="tabs">
        {LIB_TABS.map((k) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(LIB_TAB_LABEL[k])}</button>)}
      </div>
      {tab === 'songs' && <Songs />}
      {tab === 'hymnals' && <Hymnals />}
      {tab === 'texts' && <Texts />}
      {tab === 'bible' && <Bible />}
      {tab === 'blocks' && <BlocksTab />}
      {tab === 'backgrounds' && <BackgroundsTab />}
    </div>
  );
}

// ------------------------------------------------------------------ songs
