// Bible versions in the web app: the installed-translations hook, a version select for one language,
// the copyright reminder, and the "Add a Bible" upload dialog (dry run → preview → import).
// Server: server/routes/bible.ts and server/repo/bible-upload.ts.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api, qs, useApi } from '../api.ts';
import { useContentLangs, useI18n } from '../i18n.tsx';
import { Field, Loading, Modal, confirmAction, useAction, useSession, useToast } from './ui.tsx';
import { Icon } from './icons.tsx';
import { LANGUAGE_CATALOG, isChinese, langInfo } from '../../shared/languages.ts';
import type { Lang } from '../types-client.ts';
import './csv.css';
import './bible.css';

export interface Translation {
  code: string;
  lang: string;
  name: string;
  license: string;
  source: 'catalog' | 'upload';
  notes: string | null;
  created_at: string | null;
  verses: number;
}

// One fetch of the installed list shared by every select on the page; refreshBibles() after a change.
let cache: Translation[] | null = null;
let pending: Promise<Translation[]> | null = null;
const listeners = new Set<(t: Translation[]) => void>();
export function refreshBibles() {
  pending = api.get<Translation[]>('/bible/translations').then((t) => {
    cache = t;
    pending = null;
    listeners.forEach((f) => f(t));
    return t;
  });
  return pending;
}

/** Installed Bible versions (catalog and uploaded), with verse counts. */
export function useBibles(): Translation[] | undefined {
  const [list, setList] = useState<Translation[] | null>(cache);
  useEffect(() => {
    listeners.add(setList);
    if (!cache && !pending) refreshBibles().catch(() => undefined);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  return list ?? undefined;
}

/** Can a translation be used for a language? Same language, or the other Chinese script (converted automatically). */
export const compatible = (tLang: string, lang: Lang) => tLang === lang || (isChinese(tLang) && isChinese(lang));

/** The church's default version for a language (Settings → Languages), else the catalog's first. */
export function useChurchBible() {
  const { settings } = useSession();
  return (l: Lang): string | undefined => settings?.bibles?.[l] ?? langInfo(l).bibles[0]?.code;
}

/**
 * Select a version for one language. '' = inherit (label e.g. "Church default (KJV)").
 * Only installed versions for that language (or the other Chinese script) are listed.
 */
export function BibleSelect({ lang, value, onChange, inheritLabel, className, title }: {
  lang: Lang; value: string; onChange: (code: string) => void; inheritLabel: string; className?: string; title?: string;
}) {
  const bibles = useBibles() ?? [];
  const options = bibles.filter((b) => compatible(b.lang, lang));
  const missing = value && !options.some((o) => o.code === value);
  return (
    <select className={className} title={title} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{inheritLabel}</option>
      {options.map((o) => (
        <option key={o.code} value={o.code}>{o.code} — {o.name}{o.lang !== lang ? ` (${langInfo(o.lang).short})` : ''}</option>
      ))}
      {missing && <option value={value}>{value} (?)</option>}
    </select>
  );
}

/** One-line reminder that some publishers limit printing / projecting. */
export function CopyrightNote() {
  const { t } = useI18n();
  return (
    <p className="small muted bible-note" style={{ margin: 0 }}>
      <Icon name="file" style={{ width: 13, height: 13, verticalAlign: -2 }} />{' '}
      {t('Uploaded Bibles are only shown inside your church’s Canon and its bulletins and slides. Some publishers (e.g. ESV, NIV) limit how many verses may be printed or projected; your church is responsible for following the licence.')}
    </p>
  );
}

// ------------------------------------------------------------------ upload dialog

interface UploadPreview {
  applied: boolean;
  format: 'csv' | 'json';
  encoding: string;
  notes: string[];
  fatal: string | null;
  existing: { name: string; lang: string; source: string; verses: number; default_for: string[]; services: number } | null;
  verses: number;
  chapters: number;
  books: { found: { n: number; name: string; chapters: number; verses: number }[]; missing: { n: number; name: string }[] };
  duplicates: { count: number; rows: { row: number; first: number; ref: string }[] };
  errors: { count: number; rows: { row: number; message: string }[] };
  samples: { ref: string; text: string }[];
}
interface CatalogBible { code: string; name: string; lang: string }

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,11}$/;

export function AddBibleDialog({ langs, initialLang, onClose, onDone }: {
  /** the church's languages (default: from the session; onboarding passes its unsaved choice) */
  langs?: Lang[]; initialLang?: Lang; onClose: () => void; onDone?: (code: string, lang: Lang) => void;
}) {
  const { t, lang: ui } = useI18n();
  const toast = useToast();
  const { run, busy } = useAction();
  const contentLangs = useContentLangs();
  const church = langs ?? contentLangs;
  const bibles = useBibles() ?? [];
  const catalog = useApi<CatalogBible[]>('/bible/catalog');
  const [bibleLang, setBibleLang] = useState<Lang>(initialLang ?? church[0] ?? 'en');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [permission, setPermission] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<UploadPreview | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const langOptions = [...new Set([...church, ...LANGUAGE_CATALOG.map((l) => l.code)])];
  const existing = bibles.find((b) => b.code === code);
  const cat = (catalog.data ?? []).find((b) => b.code === code);
  const problems: string[] = [];
  if (code && !CODE_RE.test(code)) problems.push(t('Code: 2–12 capital letters, digits or hyphens (e.g. ESV, CUNP, TB2).'));
  if (cat && cat.lang !== bibleLang) problems.push(t('This code belongs to a public-domain Bible in another language; choose another code.'));
  const ready = !!code && CODE_RE.test(code) && !!name.trim() && !problems.length;

  const params = (extra: Record<string, string | number | undefined>) =>
    qs({ code, name: name.trim(), language: bibleLang, notes: notes.trim(), permission: permission ? 1 : undefined, lang: ui, ...extra });
  // Sent as octet-stream so a large .json file is not parsed as a JSON request body.
  const body = (f: File) => new Blob([f], { type: 'application/octet-stream' });

  const check = async (f: File) => {
    setFile(f);
    setPreview(null);
    const p = await run(() => api.post<UploadPreview>(`/bible/uploads${params({ dry_run: 1 })}`, body(f)));
    if (p) setPreview(p);
    else setFile(null);
  };
  const doImport = async (skipErrors: boolean) => {
    if (!file || !preview) return;
    if (existing && !confirmAction(t('Replace {code} ({name}, {n} verses) with this file?').replace('{code}', code).replace('{name}', existing.name).replace('{n}', existing.verses.toLocaleString()))) return;
    const p = await run(() => api.post<UploadPreview>(`/bible/uploads${params({ replace: existing ? 1 : undefined, skip_errors: skipErrors ? 1 : undefined })}`, body(file)));
    if (!p?.applied) return;
    toast(`${t('Imported')}: ${code} · ${p.verses.toLocaleString()} ${t('verses')}`);
    await refreshBibles();
    onDone?.(code, bibleLang);
    onClose();
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && ready) check(f);
  };

  const canImport = !!preview && !preview.fatal && ready && permission && preview.verses > 0;
  const footer = (
    <>
      <button className="btn left" onClick={onClose}>{t('Cancel')}</button>
      {preview && <button className="btn" onClick={() => input.current?.click()} disabled={busy}>{t('Choose another file')}</button>}
      {preview && preview.errors.count > 0 && (
        <button className="btn" onClick={() => doImport(true)} disabled={busy || !canImport}>{t('Import readable verses and skip problem rows')}</button>
      )}
      {preview && (
        <button className="btn primary" onClick={() => doImport(false)} disabled={busy || !canImport || preview.errors.count > 0}
          title={!permission ? t('Tick the permission box first') : undefined}>
          <Icon name="upload" />{existing ? t('Replace {code}').replace('{code}', code) : t('Import {n} verses').replace('{n}', preview.verses.toLocaleString())}
        </button>
      )}
    </>
  );

  return (
    <Modal title={t('Add a Bible')} onClose={onClose} size="lg" footer={footer}>
      <input ref={input} type="file" accept=".csv,.txt,.json,text/csv,text/plain,application/json" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) check(f);
      }} />
      <div className="stack">
        <div className="callout lapis small bible-help">
          <strong>{t('How to add a Bible')}</strong>
          <ul>
            <li>{t('Use a translation your church has permission to use: ask the publisher or Bible society (e.g. Crossway for ESV, the Hong Kong Bible Society for 和合本修订版, the Indonesian Bible Society for Alkitab) for a licensed text file.')}</li>
            <li>{t('Put it in a spreadsheet with one verse per row and the columns book, chapter, verse, text. Book can be a number 1–66, an English name or abbreviation (Gen, 1 Cor) or a Chinese name (创世记, 林前).')}</li>
            <li>{t('Save it from Excel as "CSV UTF-8 (Comma delimited)". A scrollmapper JSON file also works.')}</li>
            <li>{t('Nothing is saved until you have checked the preview and pressed Import.')}</li>
          </ul>
          <a href={`/api/bible/template.csv`} download><Icon name="file" style={{ width: 13, height: 13, verticalAlign: -2 }} /> {t('Download the CSV template')}</a>
        </div>

        <div className="form-grid">
          <Field label={t('Language')}>
            <select value={bibleLang} onChange={(e) => setBibleLang(e.target.value)}>
              {langOptions.map((l) => <option key={l} value={l}>{langInfo(l).native}{langInfo(l).native !== langInfo(l).name ? ` — ${langInfo(l).name}` : ''}</option>)}
            </select>
          </Field>
          <Field label={t('Code')} hint={t('Short, e.g. ESV, NIV, RCUV, CNV, TB')}>
            <input value={code} maxLength={12} placeholder="ESV" onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))} />
          </Field>
          <Field label={t('Name')} className="bible-name">
            <input value={name} maxLength={100} placeholder={t('e.g. English Standard Version, 和合本修订版')} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label={t('Copyright / licence note')} hint={t('Printed nowhere automatically; kept so everyone knows the terms.')}>
          <textarea rows={2} value={notes} maxLength={1000} placeholder={t('e.g. Scripture quotations are from the ESV® Bible, © 2001 by Crossway. Used by permission.')} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <label className="check bible-permission">
          <input type="checkbox" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
          <span>{t('We have permission to use this translation in our church (copyright)')}</span>
        </label>
        {problems.map((p) => <div key={p} className="callout warn small">{p}</div>)}
        {existing && (
          <div className="callout warn small">
            {t('{code} is already installed ({name}, {n} verses). Importing replaces it.').replace('{code}', code).replace('{name}', existing.name).replace('{n}', existing.verses.toLocaleString())}
          </div>
        )}

        {!preview && !busy && (
          <div
            className={`csv-drop${over ? ' over' : ''}${ready ? '' : ' disabled'}`} role="button" tabIndex={0} aria-disabled={!ready}
            onClick={() => ready && input.current?.click()} onKeyDown={(e) => ready && (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}
          >
            <Icon name="upload" />
            <strong>{ready ? t('Choose the Bible file (CSV or JSON) or drop it here') : t('Fill in the code and name first')}</strong>
            <span className="small">{t('Nothing is saved yet: you will see a preview first.')}</span>
          </div>
        )}
        {busy && !preview && <><div className="small muted">{t('Checking the file…')} {file?.name}</div><Loading /></>}
        {preview && <UploadSummary p={preview} file={file} />}
        <CopyrightNote />
      </div>
    </Modal>
  );
}

function UploadSummary({ p, file }: { p: UploadPreview; file: File | null }) {
  const { t } = useI18n();
  const found = p.books.found.length;
  return (
    <div className="stack tight">
      <div className="small muted"><Icon name="file" style={{ width: 14, height: 14, verticalAlign: -2 }} /> {file?.name} · {p.format.toUpperCase()} · {p.encoding}</div>
      {p.notes.length > 0 && <div className="callout lapis small">{p.notes.map((x) => <div key={x}>{x}</div>)}</div>}
      {p.fatal ? <div className="callout warn">{p.fatal}</div> : (
        <>
          <div className="csv-summary">
            <span className="badge ok">{p.verses.toLocaleString()} {t('verses')}</span>
            <span className="badge lapis">{found} / 66 {t('books')}</span>
            <span className="badge">{p.chapters.toLocaleString()} {t('chapters')}</span>
            {p.duplicates.count > 0 && <span className="badge warn">{p.duplicates.count} {t('duplicates')}</span>}
            <span className={`badge${p.errors.count ? ' danger' : ''}`}>{p.errors.count} {t('with problems')}</span>
          </div>
          {p.samples.length > 0 && (
            <div className="bible-samples">
              {p.samples.map((s) => <div key={s.ref}><span className="badge reed nowrap">{s.ref}</span> <span className="serif">{s.text}</span></div>)}
            </div>
          )}
          {p.errors.count > 0 && (
            <>
              <div className="callout warn small">{t('Some rows could not be read. Fix them and choose the file again, or import the readable verses and skip the others.')}</div>
              <div className="csv-rows" aria-label={t('Problems')}>
                {p.errors.rows.map((r) => (
                  <div key={r.row} className="csv-row error"><span className="rn">{t('Row {n}').replace('{n}', String(r.row))}</span><div>{r.message}</div></div>
                ))}
                {p.errors.count > p.errors.rows.length && <div className="csv-row"><span /><div className="muted">… +{p.errors.count - p.errors.rows.length}</div></div>}
              </div>
            </>
          )}
          {p.books.missing.length > 0 && (
            <details className="csv-details" open={p.books.missing.length < 66 && p.books.missing.length <= 12}>
              <summary>{t('Books not in the file')} ({p.books.missing.length})</summary>
              <div className="small bible-books">{p.books.missing.map((b) => b.name).join(' · ')}</div>
              {found > 0 && found < 66 && <div className="small muted">{t('That is fine for a New Testament or partial Bible; readings from missing books will show nothing for this version.')}</div>}
            </details>
          )}
          {p.duplicates.count > 0 && (
            <details className="csv-details">
              <summary>{t('Duplicates')} ({p.duplicates.count}) — {t('the first row of each verse is kept')}</summary>
              <div className="csv-rows">
                {p.duplicates.rows.map((d) => (
                  <div key={d.row} className="csv-row"><span className="rn">{t('Row {n}').replace('{n}', String(d.row))}</span><div>{d.ref} — {t('same verse as row {n}').replace('{n}', String(d.first))}</div></div>
                ))}
              </div>
            </details>
          )}
          {found > 0 && (
            <details className="csv-details">
              <summary>{t('Books found')} ({found})</summary>
              <div className="small bible-books">{p.books.found.map((b) => `${b.name} (${b.chapters})`).join(' · ')}</div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
