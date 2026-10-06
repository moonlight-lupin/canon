// Library → Hymns & songs → Upload sheet music (0.15.5): many scans at once, each matched to its hymn by the
// hymnal number in its file name ("HP 178.jpg", "HP 178-2.jpg" for page 2). Check the matches (change or skip any),
// then upload: each hymn's files are added in page order after the pages it already has, or replace them.
import { useMemo, useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Modal, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { Combo } from '../../components/Combo.tsx';
import { matchScoreName, parseScoreName, type NumberedSong } from '../../../shared/score-names.ts';
import type { Hymnal, Song } from '../../types-client.ts';

interface Row { file: File; song: number | null; page: number }
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

export function BulkSheetMusic({ songs, hymnals, onClose, onDone }: { songs: Song[]; hymnals: Hymnal[]; onClose: () => void; onDone: () => void }) {
  const { t, lt } = useI18n();
  const { busy } = useAction();
  const [rows, setRows] = useState<Row[]>([]);
  const [replace, setReplace] = useState(false);
  const [progress, setProgress] = useState<{ done: number; failed: string[] } | null>(null);
  const [sending, setSending] = useState(false);

  // every hymnal number, in the church's hymnal order
  const numbered = useMemo<NumberedSong[]>(() => {
    const order = new Map(hymnals.map((h, i) => [h.id, h.sort ?? i]));
    return songs.flatMap((s) => (s.hymnals ?? []).map((r) => ({ song_id: s.id, abbr: r.abbr, number: r.number, hymnal: r.hymnal_id })))
      .sort((a, b) => (order.get(a.hymnal) ?? 0) - (order.get(b.hymnal) ?? 0))
      .map(({ song_id, abbr, number }) => ({ song_id, abbr, number }));
  }, [songs, hymnals]);
  const label = (s: Song) => `${(s.hymnals ?? []).map((r) => `${r.abbr} ${r.number}`).join(' / ')}${s.hymnals?.length ? ' · ' : ''}${lt(s.title)}`;
  const options = useMemo(() => songs.map((s) => ({ value: String(s.id), label: label(s) })), [songs]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);

  const add = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files).filter((f) => OK_TYPES.includes(f.type) || /\.(png|jpe?g|webp|pdf)$/i.test(f.name)).map((file) => {
      const n = parseScoreName(file.name);
      return { file, song: matchScoreName(n, numbered), page: n?.page ?? 1 };
    });
    setRows((r) => [...r, ...next]);
  };
  const set = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const matched = rows.filter((r) => r.song);
  const hymnCount = new Set(matched.map((r) => r.song)).size;

  const upload = async () => {
    setSending(true);
    const failed: string[] = [];
    let done = 0;
    const bySong = new Map<number, Row[]>();
    for (const r of matched) bySong.set(r.song!, [...(bySong.get(r.song!) ?? []), r]);
    for (const [song, list] of bySong) {
      if (replace) {
        const old = await api.get<{ id: number }[]>(`/songs/${song}/scores`).catch(() => []);
        for (const o of old) await api.del(`/songs/scores/${o.id}`).catch(() => null);
      }
      for (const r of [...list].sort((a, b) => a.page - b.page || a.file.name.localeCompare(b.file.name))) {
        try {
          await api.upload(`/songs/${song}/scores?name=${encodeURIComponent(r.file.name)}`, r.file);
        } catch (e) {
          failed.push(`${r.file.name}: ${(e as Error).message}`);
        }
        setProgress({ done: ++done, failed: [...failed] });
      }
    }
    setSending(false);
    onDone();
  };

  return (
    <Modal title={t('Upload sheet music')} onClose={onClose} size="lg" footer={progress && !sending ? (
      <button className="btn primary" onClick={onClose}>{t('Close')}</button>
    ) : (
      <>
        <button className="btn" onClick={onClose} disabled={sending}>{t('Cancel')}</button>
        <button className="btn primary" disabled={sending || busy || !matched.length} onClick={() => void upload()}>
          <Icon name="upload" />{t('Upload {n} file(s) to {h} hymn(s)').replace('{n}', String(matched.length)).replace('{h}', String(hymnCount))}
        </button>
      </>
    )}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('Name each file by its hymnal number, e.g. “HP 178.jpg”, and “HP 178-2.jpg” for its second page. Canon matches them to the hymns; check the list, change or skip any, then upload. PNG, JPEG, WebP or PDF, up to 10 MB each.')}</p>
        <label className="btn" style={{ alignSelf: 'flex-start' }}>
          <Icon name="upload" />{rows.length ? t('Add more files') : t('Choose files')}
          <input type="file" hidden multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => { add(e.target.files); e.target.value = ''; }} disabled={sending} />
        </label>
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>{t('File')}</th><th>{t('Hymn')}</th><th className="right">{t('Page')}</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.file.name}-${i}`}>
                    <td className="small" style={{ wordBreak: 'break-all' }}>{r.file.name}</td>
                    <td style={{ minWidth: 220 }}>
                      <Combo value={r.song ? String(r.song) : ''} options={options} noneLabel={t('— skip —')} ariaLabel={t('Hymn')} onChange={(v) => set(i, { song: v ? Number(v) : null })} />
                      {r.song && (byId.get(r.song)?.hymnals?.length ?? 0) === 0 && <div className="small muted">{t('no hymnal number')}</div>}
                    </td>
                    <td className="right"><input type="number" min={1} max={99} value={r.page} style={{ width: 64 }} onChange={(e) => set(i, { page: Math.max(1, Number(e.target.value) || 1) })} /></td>
                    <td className="right"><button className="btn sm ghost icon" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label={t('Remove')} disabled={sending}><Icon name="x" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > 0 && rows.length > matched.length && <div className="small muted">{t('{n} file(s) not matched to a hymn will be skipped.').replace('{n}', String(rows.length - matched.length))}</div>}
        <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} disabled={sending} />{t('Replace the pages these hymns already have (else add after them)')}</label>
        {progress && (
          <div className={`callout small${progress.failed.length ? ' warn' : ''}`}>
            {t('{n} of {m} uploaded.').replace('{n}', String(progress.done - progress.failed.length)).replace('{m}', String(matched.length))}
            {progress.failed.map((f) => <div key={f}>{f}</div>)}
          </div>
        )}
      </div>
    </Modal>
  );
}
