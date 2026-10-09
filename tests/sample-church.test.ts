// 0.19.7: the sample church in every part of Canon — services from the built-in templates with rotas and records
// (offerings counted and verified), meetings, the calendar, spaces, the lending library, the asset register, and the
// books (opening balances, offerings posted, bills, a bank statement matched, claims in every state) — and removing
// it takes out exactly that: the church's own service, journal and books stay. Fictional data only.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-sample-church-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const { seed } = await import('../server/seed/index.ts');
const S = await import('../server/repo/settings.ts');
const sd = await import('../server/repo/sample-data.ts');
const svc = await import('../server/repo/services.ts');
const B = await import('../server/repo/bookkeeping.ts');
const { asActor } = await import('../server/lib/actor.ts');
const { get, all, run, closeDb } = await import('../server/db.ts');

const TODAY = '2038-03-26'; // a Friday
const web = <T,>(fn: () => T) => asActor({ user_id: null, user_name: 'Test admin', via: 'web' }, fn);
const n = (sql: string, ...p: unknown[]) => get<{ n: number }>(sql, ...(p as never[]))!.n;
const SAMPLE_TABLES = ['people', 'households', 'groups', 'services', 'spaces', 'events', 'lending_books', 'equipment', 'bk_journals', 'bk_statements', 'bk_claims', 'bk_claim_approvers'];

before(async () => {
  await seed();
  S.updateSettings({ modules: { ...S.getSettings().modules, meetings: true, lending: true, equipment: true, bookkeeping: true } });
});
after(() => {
  try {
    closeDb();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('the sample church does everything: services, records, meetings, calendar, library, assets, books and claims', async () => {
  // the church's own service on one of the Sundays stays as it is
  const own = web(() => svc.createService({ date: '2038-03-14', title: { en: 'Our own service (fictional)' } })).service.id;
  assert.equal(await sd.prepareSampleLibrary(), true, 'Canon’s library added first (the templates)');
  assert.equal(await sd.prepareSampleLibrary(), false, 'once');
  const st = web(() => sd.addSampleData({ today: TODAY }));
  assert.equal(st.present, true);

  // services: the last eight Sundays and the next two, from the built-in templates, but not over the church's own
  const services = all<{ id: number; date: string; template_id: number | null }>("SELECT id, date, template_id FROM services WHERE kind = 'service' AND sample_batch IS NOT NULL ORDER BY date");
  assert.ok(services.length >= 9, `services: ${services.length}`);
  assert.ok(!services.some((s) => s.date === '2038-03-14'), 'not on the church’s own Sunday');
  assert.ok(services.every((s) => s.template_id), 'each from a template');
  assert.ok(n('SELECT COUNT(*) n FROM service_items WHERE service_id = ?', services[0].id) > 5, 'with its order of service');
  assert.equal(get<{ title: string }>('SELECT title FROM services WHERE id = ?', own)!.title, JSON.stringify({ en: 'Our own service (fictional)' }));
  // records: attendance and offerings, verified, for the past ones
  const past = services.filter((s) => s.date < TODAY);
  const verified = n(`SELECT COUNT(*) n FROM service_records WHERE verified_at IS NOT NULL AND service_id IN (${past.map((s) => s.id).join(',')})`);
  assert.equal(verified, past.length, 'every past sample service counted and verified');
  assert.ok(n('SELECT COUNT(*) n FROM assignments a JOIN services s ON s.id = a.service_id WHERE s.sample_batch IS NOT NULL') > 20, 'rotas');
  // meetings and the calendar
  assert.ok(n("SELECT COUNT(*) n FROM services WHERE kind = 'meeting' AND sample_batch IS NOT NULL") >= 10, 'meetings');
  assert.ok(n("SELECT COUNT(*) n FROM service_records r JOIN services s ON s.id = r.service_id WHERE s.kind = 'meeting' AND s.sample_batch IS NOT NULL") >= 5, 'meeting records');
  assert.equal(n('SELECT COUNT(*) n FROM events WHERE sample_batch IS NOT NULL'), 3);
  assert.equal(n('SELECT COUNT(*) n FROM spaces WHERE sample_batch IS NOT NULL'), 3);
  // the library: loans out (two overdue) and back
  assert.equal(n('SELECT COUNT(*) n FROM lending_books WHERE sample_batch IS NOT NULL'), 8);
  assert.equal(n('SELECT COUNT(*) n FROM lending_loans WHERE returned_on IS NULL AND due_on < ?', TODAY), 2, 'two overdue');
  assert.equal(n('SELECT COUNT(*) n FROM lending_loans WHERE returned_on IS NOT NULL'), 3);
  // the asset register
  assert.equal(n('SELECT COUNT(*) n FROM equipment WHERE sample_batch IS NOT NULL'), 6);
  assert.ok(n('SELECT COUNT(*) n FROM equipment_maintenance') >= 2);
  // the books: started by the sample, everything posted balances, offerings in, a statement matched
  assert.ok(B.bkSettings().start_date, 'the books were started');
  const posted = all<{ d: number; c: number }>("SELECT SUM(l.debit) d, SUM(l.credit) c FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id WHERE j.status = 'posted'")[0];
  assert.ok(posted.d > 0 && posted.d === posted.c, 'posted journals balance');
  assert.equal(n("SELECT COUNT(*) n FROM bk_journals WHERE kind = 'offering' AND status = 'posted'"), past.length, 'each verified offering posted');
  assert.equal(n("SELECT COUNT(*) n FROM bk_journals WHERE status = 'posted' AND sample_batch IS NULL"), 0, 'every journal is the sample’s');
  const lines = all<{ status: string }>('SELECT status FROM bk_statement_lines');
  assert.ok(lines.filter((l) => l.status === 'matched').length > 10, 'statement lines matched');
  assert.ok(lines.some((l) => l.status === 'open'), 'one left to match by hand');
  // claims in every state
  const claims = all<{ status: string; note: string | null }>('SELECT status, note FROM bk_claims ORDER BY id').map((c) => c.status);
  assert.deepEqual([...claims].sort(), ['approved', 'draft', 'draft', 'paid', 'submitted'].sort(), claims.join(','));
  assert.ok(n('SELECT COUNT(*) n FROM bk_claim_files') >= 6, 'receipts');
  assert.equal(n('SELECT COUNT(*) n FROM bk_claim_approvers WHERE sample_batch IS NOT NULL'), 2);
  const status = sd.sampleDataStatus() as Record<string, unknown>;
  assert.ok((status.journals as number) > 10 && status.claims === 5 && status.books === 8 && status.equipment === 6 && status.events === 3);
});

test('a real posted journal can never be deleted; the sample’s can be, and can’t be passed off as real (or the reverse)', () => {
  const real = web(() => B.saveDraft(null, {
    date: '2038-03-20', memo: 'A real gift (fictional)', lines: [
      { account_id: get<{ id: number }>("SELECT id FROM bk_accounts WHERE code = '1100'")!.id, fund_id: get<{ id: number }>("SELECT id FROM bk_funds WHERE code = 'GEN'")!.id, debit: 5000, credit: 0 },
      { account_id: get<{ id: number }>("SELECT id FROM bk_accounts WHERE code = '4000'")!.id, fund_id: get<{ id: number }>("SELECT id FROM bk_funds WHERE code = 'GEN'")!.id, debit: 0, credit: 5000 },
    ],
  }));
  web(() => B.postJournal(real.id));
  assert.throws(() => run('DELETE FROM bk_journals WHERE id = ?', real.id), /cannot be deleted/);
  assert.throws(() => run("UPDATE bk_journals SET sample_batch = 'x' WHERE id = ?", real.id), /cannot be changed/, 'a real one can’t be made to look like the sample’s');
  const sample = get<{ id: number }>("SELECT id FROM bk_journals WHERE status = 'posted' AND sample_batch IS NOT NULL LIMIT 1")!.id;
  assert.throws(() => run('UPDATE bk_journals SET sample_batch = NULL WHERE id = ?', sample), /cannot be changed/);
});

test('removing the sample takes out exactly what it added; the church’s service, journal and books stay', () => {
  const r = web(() => sd.removeSampleData());
  for (const t of SAMPLE_TABLES) assert.equal(n(`SELECT COUNT(*) n FROM ${t} WHERE sample_batch IS NOT NULL`), 0, `${t}: none of the sample’s left`);
  assert.equal(r.kept.length, 0, JSON.stringify(r.kept));
  assert.equal(n('SELECT COUNT(*) n FROM lending_loans'), 0);
  assert.equal(n('SELECT COUNT(*) n FROM bk_claims'), 0);
  assert.equal(n('SELECT COUNT(*) n FROM bk_statements'), 0);
  assert.equal(n("SELECT COUNT(*) n FROM services WHERE date = '2038-03-14'"), 1, 'the church’s own service stays');
  assert.equal(n("SELECT COUNT(*) n FROM bk_journals WHERE memo = 'A real gift (fictional)' AND status = 'posted'"), 1, 'the real journal stays');
  assert.ok(B.bkSettings().start_date, 'the books stay started: they have a real journal');
});

test('added again and removed with nothing real in the books: the books go back to not started', async () => {
  // a fresh church's books: none of the real journal from above (a separate Canon would be cleaner; here, a new start)
  const fresh = path.join(tmp, 'second');
  fs.mkdirSync(fresh);
  const { spawnSync } = await import('node:child_process');
  const out = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `
    const { seed } = await import('./server/seed/index.ts');
    await seed();
    const S = await import('./server/repo/settings.ts');
    S.updateSettings({ modules: { ...S.getSettings().modules, bookkeeping: true } });
    const sd = await import('./server/repo/sample-data.ts');
    const B = await import('./server/repo/bookkeeping.ts');
    const { asActor } = await import('./server/lib/actor.ts');
    const web = (fn) => asActor({ user_id: null, user_name: 'Test', via: 'web' }, fn);
    await sd.prepareSampleLibrary();
    web(() => sd.addSampleData({ today: '${TODAY}' }));
    const started = B.bkSettings().start_date;
    const r = web(() => sd.removeSampleData());
    console.log(JSON.stringify({ started, after: B.bkSettings().start_date, kept: r.kept.length }));
  `], { cwd: path.resolve(import.meta.dirname, '..'), env: { ...process.env, CANON_DB: path.join(fresh, 'canon.db'), NODE_TEST_CONTEXT: 'child', CANON_LOG: 'off' }, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const res = JSON.parse(out.stdout.trim().split('\n').pop()!);
  assert.ok(res.started);
  assert.equal(res.after, null, 'not started again');
  assert.equal(res.kept, 0);
});
