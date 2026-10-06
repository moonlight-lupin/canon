// Canon's bundled public-domain library, chosen while setting up (Onboarding) or later (Library → Canon's library):
// hymns & psalms, liturgical texts, service templates and the Westminster Standards (downloaded).
import { useEffect, useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Loading, Modal, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';

type Part = 'songs' | 'texts' | 'templates';
type Choice = Part | 'standards';
interface Status extends Record<Part, { chosen: boolean; bundled: number; in_library: number }> {
  standards: { key: string; id: number | null }[];
}
interface Result {
  added: Record<Part, number>;
  standards: { key: string; parts: number }[] | { error: string } | null;
}

const ROWS: { key: Choice; name: string; description: string }[] = [
  { key: 'songs', name: 'Hymns & psalms', description: '{n} public-domain hymns, metrical psalms and service music (Doxology, Gloria Patri …): English words, credits, tune and metre; a few also in Chinese.' },
  { key: 'texts', name: 'Liturgical texts', description: '{n} creeds, calls to worship, confessions, prayers and benedictions, in English and Chinese.' },
  { key: 'templates', name: 'Service templates', description: "{n} orders of worship: Lord's Day, Lord's Supper, Evening Worship, Baptism, Lessons and Carols. They use the hymns and texts above." },
  { key: 'standards', name: 'Westminster Standards', description: 'The Shorter Catechism (107 questions), Larger Catechism (196) and Confession of Faith, in English. Downloaded from the internet.' },
];

export function BundledLibraryPanel({ onAdded }: { onAdded?: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const { data, reload } = useApi<Status>('/library/bundled');
  const [picked, setPicked] = useState<Set<Choice> | null>(null);
  const [restore, setRestore] = useState(false);
  const total = (c: Choice) => (c === 'standards' ? (data?.standards.length ?? 0) : (data?.[c].bundled ?? 0));
  const have = (c: Choice) => (c === 'standards' ? (data?.standards.filter((s) => s.id).length ?? 0) : (data?.[c].in_library ?? 0));
  // everything not yet in the library starts ticked; nothing is added until the button is pressed
  useEffect(() => {
    if (data && !picked) setPicked(new Set(ROWS.map((r) => r.key).filter((c) => have(c) < total(c))));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data || !picked) return <Loading />;
  const partial = ROWS.some((r) => r.key !== 'standards' && have(r.key) > 0 && have(r.key) < total(r.key));
  const toggle = (c: Choice, on: boolean) => setPicked((s) => {
    const n = new Set(s);
    if (on) n.add(c);
    else n.delete(c);
    return n;
  });
  const add = async () => {
    const parts = [...picked].filter((c): c is Part => c !== 'standards');
    const r = await run(() => api.post<Result>('/library/bundled', { parts, standards: picked.has('standards'), restore }));
    if (!r) return;
    const done = [
      r.added.songs && `${r.added.songs} ${t('hymns')}`,
      r.added.texts && `${r.added.texts} ${t('texts')}`,
      r.added.templates && `${r.added.templates} ${t('templates')}`,
      r.standards && !('error' in r.standards) && t('Westminster Standards'),
    ].filter(Boolean).join(', ');
    const problem = r.standards && 'error' in r.standards ? `${t('The Westminster Standards could not be downloaded; try again later in Library → Liturgical texts.')} (${r.standards.error})` : '';
    run(async () => r, [done ? `${t('Added to the library')}: ${done}.` : t('Nothing new to add.'), problem].filter(Boolean).join(' '));
    setPicked(new Set());
    reload();
    onAdded?.();
  };
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>{t('Public-domain words to start with. Add what your church will use; the rest can be added later in Library → Canon’s library.')}</p>
      {ROWS.map((r) => {
        const n = total(r.key);
        const m = have(r.key);
        return (
          <label key={r.key} className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={picked.has(r.key)} disabled={busy || (m >= n && !restore)} onChange={(e) => toggle(r.key, e.target.checked)} />
            <span>
              <strong>{t(r.name)}</strong>
              {m >= n ? <span className="small muted"> · <Icon name="check" width={12} height={12} /> {t('In your library')}</span>
                : m > 0 ? <span className="small muted"> · {t('{m} of {n} in your library').replace('{m}', String(m)).replace('{n}', String(n))}</span> : null}
              <br /><span className="small muted">{t(r.description).replace('{n}', String(n))}</span>
            </span>
          </label>
        );
      })}
      {partial && (
        <label className="check">
          <input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} />
          <span className="small">{t('Also add back the ones you deleted')}</span>
        </label>
      )}
      <div className="row end">
        <button className="btn primary" disabled={busy || !picked.size} onClick={add}><Icon name="download" />{t('Add to the library')}</button>
      </div>
    </div>
  );
}

/** Library page button (administrators): Canon's library in a dialog. */
export function BundledLibraryButton({ onAdded }: { onAdded: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}><Icon name="book" />{t('Canon’s library')}</button>
      {open && (
        <Modal title={t('Canon’s library')} onClose={() => setOpen(false)}>
          <BundledLibraryPanel onAdded={onAdded} />
        </Modal>
      )}
    </>
  );
}
