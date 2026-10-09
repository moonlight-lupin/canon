// Settings → Export data (administrators, 0.15.6): one click for each part of Canon (CSV, opens in Excel), the
// library as one file (hymnals, songs with words, numbers and sheet music, liturgical texts, QR codes & notes, and
// uploaded Bibles when chosen), everything in one zip, and importing a library file from another Canon.
import { useRef, useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Loading, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import type { L10n } from '../../types-client.ts';

interface Part { key: string; label: { en: string; zh: string }; pii: boolean; query: string }
interface Summary {
  hymnals: { added: number; existing: number };
  songs: { added: number; existing: number; numbers_added: number; sheet_music_added: number };
  texts: { added: number; existing: number };
  blocks: { added: number; existing: number };
  backgrounds?: { added: number; existing: number };
  images?: { added: number; existing: number };
  bibles: { added: number; existing: number; skipped: number };
  problems: string[];
}

export function ExportTab() {
  const { t, lt, lang } = useI18n();
  const parts = useApi<{ csv: Part[]; hymnals: { id: number; abbr: string; name: L10n }[]; bibles: { code: string; name: string }[]; bookkeeping?: boolean }>('/export');
  const [scores, setScores] = useState(true);
  const [blocks, setBlocks] = useState(true);
  const [bibles, setBibles] = useState(false);
  const label = (l: Part['label']) => lt(l as Record<string, string>);
  const q = (o: Record<string, boolean>) => Object.entries(o).map(([k, v]) => `${k}=${v ? 1 : 0}`).join('&');
  return (
    <div className="stack">
      <section className="card stack">
        <h3 style={{ margin: 0 }}>{t('Everything')}</h3>
        <p className="small muted" style={{ margin: 0 }}>{t('One zip with every part below as a CSV, and the library file. It is not a backup: services, records and accounts are only in a backup (Settings → Backups). It holds members’ personal data: keep it where only the office can open it.')}</p>
        <div><a className="btn primary" href="/api/export/all.zip"><Icon name="download" />{t('Download everything (zip)')}</a></div>
      </section>

      {parts.data?.bookkeeping && (
        <section className="card stack">
          <h3 style={{ margin: 0 }}>{t('Book-keeping')}</h3>
          <p className="small muted" style={{ margin: 0 }}>{t('Every posted journal line since the books started (for the church’s accountant or other accounting software), the chart of accounts and the funds. Also in the zip above.')}</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <a className="btn" href="/api/export/bookkeeping/journals.xlsx"><Icon name="download" />{t('Journals (Excel)')}</a>
            <a className="btn" href="/api/export/bookkeeping/accounts.xlsx"><Icon name="download" />{t('Chart of accounts (Excel)')}</a>
            <a className="btn" href="/api/export/bookkeeping/funds.xlsx"><Icon name="download" />{t('Funds (Excel)')}</a>
            <a className="btn ghost" href="/api/export/bookkeeping/journals.csv" title={t('For accounting software that imports a manual journal file')}><Icon name="download" />{t('Journals (CSV, for accounting software)')}</a>
          </div>
        </section>
      )}

      <section className="card stack">
        <h3 style={{ margin: 0 }}>{t('Library file')} <InfoTip text={t('Hymnals, songs with their words, hymnal numbers and sheet music, liturgical texts, and QR codes & notes, in one file another Canon can import — at another church, or on a new computer. Importing adds only what that Canon doesn’t have yet.')} /></h3>
        <div className="row" style={{ gap: 14, flexWrap: 'wrap' }}>
          <label className="check"><input type="checkbox" checked={scores} onChange={(e) => setScores(e.target.checked)} />{t('Sheet music')}</label>
          <label className="check"><input type="checkbox" checked={blocks} onChange={(e) => setBlocks(e.target.checked)} />{t('QR codes & notes')}</label>
          <label className="check"><input type="checkbox" checked={bibles} onChange={(e) => setBibles(e.target.checked)} />{t('Bibles you uploaded')}</label>
        </div>
        {bibles && <div className="callout warn small">{t('A Bible you uploaded may be licensed to your church only. Give the file to another church only if the licence allows it.')}</div>}
        {scores && <div className="small muted">{t('Sheet music is often still in copyright: share it only where the church may copy the music.')}</div>}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <a className="btn" href={`/api/export/library.canonlib?${q({ scores, blocks, bibles })}`}><Icon name="download" />{t('Download the library file')}</a>
          <ImportLibrary />
        </div>
      </section>

      <section className="card stack">
        <h3 style={{ margin: 0 }}>{t('The library, section by section')}</h3>
        <p className="small muted" style={{ margin: 0 }}>{t('Each is a library file another Canon can import (Import a library file…). Hymns come one hymnal at a time.')}</p>
        {!parts.data ? <Loading /> : (
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {librarySections(parts.data.hymnals, parts.data.bibles, t, lt).map((x) => (
                  <tr key={x.href}>
                    <td><strong>{x.label}</strong>{x.note && <span className="small muted"> · {x.note}</span>}</td>
                    <td className="right"><a className="btn sm" href={x.href}><Icon name="download" />{t('Export')}</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card stack">
        <h3 style={{ margin: 0 }}>{t('Each part')}</h3>
        <p className="small muted" style={{ margin: 0 }}>{t('Each opens in Excel, and can be imported again with Import CSV above the same list.')}</p>
        {!parts.data ? <Loading /> : (
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {parts.data.csv.map((p) => (
                  <tr key={`${p.key}${p.query}`}>
                    <td><strong>{label(p.label)}</strong>{p.pii && <span className="badge warn" style={{ marginLeft: 6 }}>{t('personal data')}</span>}</td>
                    <td className="right"><a className="btn sm" href={`/api/csv/${p.key}/export.xlsx?lang=${lang}${p.query ? `&${p.query}` : ''}`}><Icon name="download" />CSV</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Import a library file: first what it would add, then (confirmed) add it. */
export function ImportLibrary() {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Summary | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const [permission, setPermission] = useState(false);
  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setDone(null);
    setPermission(false);
    void run(async () => setPreview(await api.upload<Summary>('/export/library/import?dry_run=1&bibles=1', f)));
  };
  const apply = () => file && run(async () => {
    setDone(await api.upload<Summary>(`/export/library/import?bibles=${permission ? 1 : 0}`, file));
    setPreview(null);
  }, t('Imported.'));
  const line = (s: Summary) => [
    t('Songs: {a} new, {e} already here').replace('{a}', String(s.songs.added)).replace('{e}', String(s.songs.existing)),
    s.songs.numbers_added ? t('{n} hymnal numbers added').replace('{n}', String(s.songs.numbers_added)) : '',
    s.songs.sheet_music_added ? t('{n} pages of sheet music').replace('{n}', String(s.songs.sheet_music_added)) : '',
    t('Liturgical texts: {a} new, {e} already here').replace('{a}', String(s.texts.added)).replace('{e}', String(s.texts.existing)),
    t('Hymnals: {a} new').replace('{a}', String(s.hymnals.added)),
    t('QR codes & notes: {a} new').replace('{a}', String(s.blocks.added)),
    s.backgrounds?.added ? t('Slide backgrounds: {a} new').replace('{a}', String(s.backgrounds.added)) : '',
    s.images?.added ? t('Images: {a} new').replace('{a}', String(s.images.added)) : '',
    s.bibles.added + s.bibles.skipped ? t('Bibles: {a} new').replace('{a}', String(s.bibles.added + (done ? 0 : s.bibles.skipped))) : '',
  ].filter(Boolean);
  return (
    <>
      <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}><Icon name="upload" />{t('Import a library file…')}</button>
      <input ref={input} type="file" hidden accept=".canonlib,application/gzip" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
      {preview && (
        <div className="callout small stack tight" style={{ width: '100%' }}>
          <strong>{t('This file would add:')}</strong>
          {line(preview).map((l) => <div key={l}>{l}</div>)}
          <div className="muted">{t('Nothing already here is changed; songs only gain hymnal numbers and sheet music they don’t have.')}</div>
          {preview.bibles.added > 0 && (
            <label className="check"><input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />{t('Our church has permission to use these Bibles (copyright). Without it, they are left out.')}</label>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn sm primary" disabled={busy} onClick={() => void apply()}>{t('Import')}</button>
            <button type="button" className="btn sm" onClick={() => setPreview(null)}>{t('Cancel')}</button>
          </div>
        </div>
      )}
      {done && (
        <div className="callout small stack tight" style={{ width: '100%' }}>
          <strong>{t('Imported:')}</strong>
          {line(done).map((l) => <div key={l}>{l}</div>)}
          {done.problems.map((p) => <div key={p} className="danger">{p}</div>)}
        </div>
      )}
    </>
  );
}

/** The library's sections as files: each hymnal's songs, songs in no hymnal, texts, each uploaded Bible, QR codes & notes, backgrounds. */
export function librarySections(hymnals: { id: number; abbr: string; name: L10n }[], bibles: { code: string; name: string }[], t: (s: string) => string, lt: (v: L10n) => string) {
  const u = (q: string) => `/api/export/library.canonlib?${q}`;
  return [
    ...hymnals.map((h) => ({ section: 'songs', label: `${t('Hymns')}: ${h.abbr} · ${lt(h.name)}`, note: t('words, numbers, sheet music'), href: u(`section=songs&hymnal=${h.id}`) })),
    { section: 'songs', label: t('Songs in no hymnal'), note: '', href: u('section=songs&hymnal=none') },
    { section: 'texts', label: t('Liturgical texts'), note: '', href: u('section=texts') },
    ...bibles.map((b) => ({ section: 'bibles', label: `${t('Bible')}: ${b.code} · ${b.name}`, note: t('only if its licence allows sharing'), href: u(`section=bibles&bible=${encodeURIComponent(b.code)}`) })),
    { section: 'blocks', label: t('QR codes & notes'), note: '', href: u('section=blocks') },
    { section: 'backgrounds', label: t('Slide backgrounds'), note: '', href: u('section=backgrounds') },
    { section: 'images', label: t('Images'), note: '', href: u('section=images') },
  ];
}
