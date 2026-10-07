// Settings → Export data (administrators, 0.15.6): what can be downloaded with one click (each part's CSV, the
// library file), everything in one zip, and importing a library file from another Canon.
import express, { type Response } from 'express';
import { requireAdmin } from '../auth.ts';
import { CSV_ENTITIES } from '../csv/index.ts';
import { exportCsv, makeCtx } from '../csv/engine.ts';
import { moduleOff } from '../../shared/modules.ts';
import { getSettings } from '../repo/settings.ts';
import { exportLibrary, importLibrary, type LibrarySection } from '../repo/library-file.ts';
import { all } from '../db.ts';
import { hymnals } from '../repo/library.ts';
import { logMemberView } from '../repo/security.ts';
import { zip } from '../lib/zip.ts';
import { h } from './helpers.ts';
import { uiLang } from './csv.ts';
import { addSampleData, removeSampleData, sampleDataStatus } from '../repo/sample-data.ts';
import { accountsCsv, fundsCsv, journalsCsv } from '../repo/bk-export.ts';
import { toCsv } from '../../shared/reports.ts';

export const exportRoutes = express.Router();
const SECTIONS: LibrarySection[] = ['songs', 'texts', 'blocks', 'backgrounds', 'bibles'];
exportRoutes.use('/export', requireAdmin);

const today = () => new Date().toISOString().slice(0, 10);
const flag = (v: unknown, dflt: boolean) => (v === undefined ? dflt : v === '1' || v === 'true');
const download = (res: Response, name: string, type: string, body: Buffer | string) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(body);
};
/** The CSV exports of the parts of Canon that are switched on. */
const entities = () => Object.values(CSV_ENTITIES).filter((e) => !moduleOff('GET', `/csv/${e.key}`, getSettings().modules));

/** What the page offers: each part's CSV (with whether it holds personal data), and the library file's contents. */
exportRoutes.get('/export', h(() => ({
  csv: entities().flatMap((e) => e.needs?.includes('hymnal_id')
    ? hymnals.list('', [], 'sort, id').map((hy) => ({ key: e.key, label: { en: `${e.label.en}: ${hy.abbr}`, zh: `${e.label.zh}：${hy.abbr}` }, pii: !!e.pii, query: `hymnal_id=${hy.id}` }))
    : e.needs?.length ? [] : [{ key: e.key, label: e.label, pii: !!e.pii, query: '' }]),
  // the library, section by section
  hymnals: hymnals.list('', [], 'sort, id').map((hy) => ({ id: hy.id, abbr: hy.abbr, name: hy.name })),
  bibles: all<{ code: string; name: string }>("SELECT code, name FROM bible_translations WHERE source = 'upload' ORDER BY code"),
  // book-keeping (when switched on): the posted journals, the chart of accounts and the funds
  bookkeeping: !moduleOff('GET', '/bookkeeping', getSettings().modules),
})));

/** The books as CSV (Settings → Export data): every posted journal line, the chart of accounts, the funds. */
const BK_CSV: Record<string, () => (string | number | null | undefined)[][]> = { journals: () => journalsCsv(), accounts: accountsCsv, funds: fundsCsv };
exportRoutes.get('/export/bookkeeping/:what.csv', (req, res, next) => {
  try {
    const make = BK_CSV[String(req.params.what)];
    if (!make || moduleOff('GET', '/bookkeeping', getSettings().modules)) return void res.status(404).json({ error: 'Not found' });
    download(res, `bookkeeping-${req.params.what}-${today()}.csv`, 'text/csv; charset=utf-8', toCsv(make()));
  } catch (e) {
    next(e);
  }
});

exportRoutes.get('/export/library.canonlib', (req, res, next) => {
  try {
    // one section (?section=songs&hymnal=3 | none, texts, bibles&bible=CODE, blocks, backgrounds) or the whole library
    const section = typeof req.query.section === 'string' && SECTIONS.includes(req.query.section as LibrarySection) ? (req.query.section as LibrarySection) : null;
    const hymnal = req.query.hymnal === 'none' ? 'none' : Number(req.query.hymnal) || undefined;
    const bible = typeof req.query.bible === 'string' && /^[\w-]{1,20}$/.test(req.query.bible) ? req.query.bible : undefined;
    const body = exportLibrary({
      scores: flag(req.query.scores, true), blocks: flag(req.query.blocks, true), bibles: flag(req.query.bibles, false), backgrounds: flag(req.query.backgrounds, true),
      ...(section ? { sections: [section], hymnal, bible } : {}),
    });
    const abbr = typeof hymnal === 'number' ? hymnals.list('id = ?', [hymnal])[0]?.abbr : hymnal === 'none' ? 'no-hymnal' : undefined;
    const what = !section ? 'library' : section === 'songs' ? `hymns${abbr ? `-${abbr}` : ''}` : section === 'bibles' ? `bible${bible ? `-${bible}` : ''}` : section === 'blocks' ? 'qr-codes-notes' : section;
    download(res, `canon-${what.replace(/[^\w-]+/g, '_')}-${today()}.canonlib`, 'application/gzip', body);
  } catch (e) {
    next(e);
  }
});

/** Everything in one zip: each part's CSV, the library file (without uploaded Bibles) and a note on what is inside. */
exportRoutes.get('/export/all.zip', (req, res, next) => {
  try {
    const lang = uiLang(req);
    const list = entities();
    const files: { name: string; data: string | Buffer }[] = [];
    for (const e of list) {
      if (e.needs?.includes('hymnal_id')) {
        // one index per hymnal
        for (const hy of hymnals.list('', [], 'sort, id')) files.push({ name: `hymnal-index-${hy.abbr.replace(/[^\w-]+/g, '_')}.csv`, data: exportCsv(e, makeCtx(lang, { hymnal_id: String(hy.id) })) });
      } else if (!e.needs?.length) {
        files.push({ name: `${e.key.replace(/_/g, '-')}.csv`, data: exportCsv(e, makeCtx(lang, {})) });
      }
    }
    if (!moduleOff('GET', '/bookkeeping', getSettings().modules)) for (const [k, make] of Object.entries(BK_CSV)) files.push({ name: `bookkeeping-${k}.csv`, data: toCsv(make()) });
    files.push({ name: `canon-library-${today()}.canonlib`, data: exportLibrary({ scores: true, blocks: true, bibles: false }) });
    files.push({
      name: 'README.txt',
      data: [
        `Canon export, ${today()}.`,
        '',
        'Each .csv opens in Excel and can be imported into Canon again (the Import CSV button above the same list).',
        'canon-library-*.canonlib holds the hymnals, songs (words, hymnal numbers, sheet music), liturgical texts and',
        'QR codes & notes: import it in Settings → Export data on another Canon.',
        '',
        'members.csv, coworkers.csv and the like hold personal data (PDPA): keep this file where only the office can open it.',
        'This is not a backup: Settings → Backups copies everything, including services, records and accounts.',
      ].join('\r\n'),
    });
    if (list.some((e) => e.pii)) logMemberView({ user_id: req.user?.id ?? null, user_name: req.user?.display_name ?? null, person_id: null, via: 'export', detail: 'Everything (zip)' });
    download(res, `canon-export-${today()}.zip`, 'application/zip', zip(files));
  } catch (e) {
    next(e);
  }
});

/** Import a library file from another Canon (?dry_run=1 to see what it would add; ?bibles=1 = permission confirmed). */
exportRoutes.post('/export/library/import', express.raw({ type: () => true, limit: '400mb' }), h((req) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw Object.assign(new Error('Choose a library file.'), { status: 400 });
  return importLibrary(req.body, { dryRun: flag(req.query.dry_run, false), biblePermission: flag(req.query.bibles, false) });
}));

// Settings → Sample data (0.15.8): a fictional church to try Canon with, and taking it out again
exportRoutes.use('/sample-data', requireAdmin);
exportRoutes.get('/sample-data', h(() => sampleDataStatus()));
exportRoutes.post('/sample-data', h((req) => addSampleData({ rota: (req.body as { rota?: boolean } | undefined)?.rota !== false })));
exportRoutes.delete('/sample-data', h(() => removeSampleData()));
