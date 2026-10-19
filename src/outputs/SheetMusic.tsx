// Outputs → Sheet music: the service's songs in order, each with the sheet music kept with it in the Library (scans
// or photos; a PDF opens on its own). For the musicians: print it, or open it on a tablet at the piano.
import { FitToScreen } from '../components/onscreen.ts';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { ErrorBox, Loading } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import type { L10n, Lang } from '../types-client.ts';
import { Bi, formatDate, hasAny } from './content.tsx';
import { scoreUrl } from '../../shared/presentation.ts';
import './outputs.css';

interface Score { id: number; name: string; mime: string; size: number }
interface SongRow { item_id: number; start: string; title: L10n; subtitle: L10n; song: { id: number; title: L10n }; stanzas: string[]; scores: Score[] }
interface Data { service: { id: number; date: string; title: L10n; languages: Lang[]; status: string }; songs: SongRow[] }

export default function SheetMusic() {
  const { id } = useParams();
  const { t } = useI18n();
  const { data, error } = useApi<Data>(`/services/${id}/scores`);
  if (error) return <div className="out-page"><ErrorBox error={error} /></div>;
  if (!data) return <Loading />;
  const langs = data.service.languages.length ? data.service.languages : (['en'] as Lang[]);
  const missing = data.songs.filter((s) => !s.scores.length).length;
  return (
    <div className="out sm-out">
      <div className="out-bar no-print">
        <Link to={`/services/${id}`} className="btn ghost sm"><Icon name="chevronLeft" />{t('Back')}</Link>
        <div className="out-bar-title"><Bi v={data.service.title} langs={langs} /> <span className="muted">· {t('Sheet music')}</span></div>
        {missing > 0 && <span className="small muted">{t('{n} without sheet music').replace('{n}', String(missing))}</span>}
        <button className="btn primary sm" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
      </div>
      <FitToScreen className="sm-sheet" deps={[data]}>
        <header className="sm-head">
          <h1 className="rs-title"><Bi v={data.service.title} langs={langs} sep="  " /></h1>
          <div className="rs-date">{formatDate(data.service.date, langs)}</div>
        </header>
        {!data.songs.length && <p className="muted">{t('This service has no songs yet.')}</p>}
        {/* the order at a glance */}
        {data.songs.length > 0 && (
          <ol className="sm-index">
            {data.songs.map((s) => (
              <li key={s.item_id}>
                <span className="sm-time">{s.start}</span> <Bi v={s.title} langs={langs} />
                {hasAny(s.subtitle) && <span className="muted"> · <Bi v={s.subtitle} langs={langs.slice(0, 1)} /></span>}
                {s.stanzas.length > 0 && <span className="muted"> · {t('Stanzas')} {s.stanzas.join(', ')}</span>}
                {!s.scores.length && <span className="sm-none"> — {t('no sheet music')}</span>}
              </li>
            ))}
          </ol>
        )}
        {data.songs.filter((s) => s.scores.length).map((s) => (
          <section key={s.item_id} className="sm-song">
            <h2 className="sm-song-title">
              <Bi v={s.title} langs={langs} />
              {hasAny(s.subtitle) && <span className="muted"> · <Bi v={s.subtitle} langs={langs.slice(0, 1)} /></span>}
              {s.stanzas.length > 0 && <span className="sm-stanzas">{t('Stanzas')} {s.stanzas.join(', ')}</span>}
            </h2>
            {s.scores.map((f) => f.mime === 'application/pdf' ? (
              <div key={f.id} className="sm-pdf">
                <Icon name="file" /> {f.name}
                <a className="btn sm no-print" href={scoreUrl(f.id)} target="_blank" rel="noreferrer"><Icon name="eye" />{t('Open')}</a>
                <span className="small muted sm-print-note">{t('(a PDF: open it to print it)')}</span>
              </div>
            ) : (
              <img key={f.id} className="sm-page" src={scoreUrl(f.id)} alt={f.name} loading="lazy" />
            ))}
          </section>
        ))}
      </FitToScreen>
    </div>
  );
}
