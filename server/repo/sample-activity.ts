// The sample church's activity (0.19.7): what its people do, across every part of Canon, so that everything can be
// seen working together — the last eight Sundays and the next two (from Canon's own service templates) with their
// rotas and service records (attendance, visitors, offerings counted and verified), cell-group and Sunday school
// meetings, events on the calendar, spaces, the lending library with loans, the asset register, and — when the books
// haven't been started — the books themselves: opening balances, the offerings drafted from the verified counts and
// posted, the monthly bills, the cash banked, a bank statement matched, and expense claims in every state.
//
// Each optional part only when its module is on (Settings → Modules can switch them on first). Every row added carries
// the sample's batch (migration 38), and removeSampleActivity() takes out exactly those: a sample row that real
// records now depend on (a real journal reversing a sample one, a real bank line matched to it) is kept and listed.
import zlib from 'node:zlib';
import { all, get, run } from '../db.ts';
import { getSettings, updateSettings } from './settings.ts';
import * as svc from './services.ts';
import * as R from './records.ts';
import * as vol from './volunteers.ts';
import * as cal from './calendar.ts';
import * as sp from './spaces.ts';
import * as lend from './lending.ts';
import * as eq from './equipment.ts';
import * as B from './bookkeeping.ts';
import * as C from './bk-claims.ts';
import * as Bank from './bk-bank.ts';
import { DENOMINATIONS } from '../../shared/records.ts';

/** What the activity added (kept in the sample's meta, next to the people). */
export interface ActivityAdded {
  spaces: number[];
  events: number[];
  books: number[];
  equipment: number[];
  journals: number[];
  statements: number[];
  claims: number[];
  approvers: number[];
  /** the sample started the books (they weren't): removing it un-starts them when nothing real is in them */
  books_started?: boolean;
  /** the service records the sample wrote, with their revision then: one changed since is someone's work, and stays */
  records?: Record<number, number>;
}
export const noActivity = (): ActivityAdded => ({ spaces: [], events: [], books: [], equipment: [], journals: [], statements: [], claims: [], approvers: [] });

interface Person { id: number; name: string; adult: boolean; age: number }

const day = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------- small pictures: receipts and signatures (PNG)

const crcTable = (b: Buffer) => zlib.crc32(b) >>> 0;
function png(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = px(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crcTable(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
/** A pretend till receipt: paper with lines of "print" and a bold total near the bottom (no real text). */
function receiptPng(seed: number): Buffer {
  const w = 300, h = 460;
  const rows = 14 + (seed % 6);
  return png(w, h, (x, y) => {
    if (x < 6 || x > w - 7 || y < 6 || y > h - 7) return [214, 207, 190];
    const r = Math.floor((y - 30) / 22);
    const inLine = y >= 30 && (y - 30) % 22 < 7 && r < rows;
    const total = r === rows - 2;
    const len = total ? 0.85 : 0.35 + (((r * 37 + seed * 11) % 50) / 100);
    if (inLine && x > 24 && x < 24 + (w - 48) * len) return total ? [40, 40, 40] : [120, 120, 120];
    if (inLine && !total && x > w - 80 && x < w - 24) return [90, 90, 90];
    return [252, 250, 244];
  });
}
/** A signature: a looping stroke. */
const INK = `data:image/png;base64,${png(240, 64, (x, y) => {
  const c = 32 + 14 * Math.sin(x / 9) * Math.cos(x / 31);
  return Math.abs(y - c) < 1.6 && x > 8 && x < 232 ? [30, 40, 90] : [255, 255, 255];
}).toString('base64')}`;

// ---------------------------------------------------------------- the activity

const SERMONS: [string, string, string][] = [
  ['Isaiah 6:1-8', 'Here am I; send me', '我在这里，请差遣我'],
  ['Psalm 23', 'The Lord is my shepherd', '耶和华是我的牧者'],
  ['John 15:1-11', 'Abide in me', '常在我里面'],
  ['Romans 8:28-39', 'More than conquerors', '得胜有余'],
  ['Ephesians 2:1-10', 'Saved by grace', '因恩典得救'],
  ['Matthew 5:1-12', 'The blessed life', '蒙福的人'],
  ['Philippians 4:4-9', 'Rejoice in the Lord always', '要靠主常常喜乐'],
  ['Luke 15:11-32', 'The father who runs', '奔跑的父亲'],
  ['Hebrews 11:1-16', 'By faith', '因着信'],
  ['Genesis 12:1-9', 'The call of Abram', '亚伯兰蒙召'],
];
const VISITORS = [
  { name: 'Peter Lau (sample)', source: 'Invited by a friend', status: 'contacted' as const },
  { name: 'Wendy Chong (sample)', source: 'Walked past', status: 'returning' as const },
  { name: 'Marcus Lim (sample)', source: 'Online search', status: 'new' as const },
  { name: 'Felicia Tan (sample)', source: 'Invited by family', status: 'joined' as const },
];

export function addSampleActivity(o: {
  today: string; batch: string; people: Person[]; serviceIds: number[]; groupIds: number[]; assignments: number[];
  pools: Map<number, number[]>; rnd: () => number; pick: <T>(a: T[], n: number) => T[];
}): ActivityAdded {
  const out = noActivity();
  const { today, batch, rnd, pick } = o;
  const mods = getSettings().modules;
  const adults = o.people.filter((p) => p.adult && p.age <= 76);
  const who: R.Who = { name: 'Sample data', admin: true, money: true };
  const mark = (table: string, id: number) => run(`UPDATE ${table} SET sample_batch = ? WHERE id = ?`, batch, id);

  // ------------------------------------------------ spaces (only when the church has none of its own)
  let sanctuary: number | null = null, hall: number | null = null, room: number | null = null;
  if (!get('SELECT 1 FROM spaces')) {
    for (const [name, capacity] of [[{ en: 'Sanctuary', zh: '礼堂' }, 220], [{ en: 'Fellowship Hall', zh: '团契厅' }, 90], [{ en: 'Room 2', zh: '二号房' }, 24]] as const) {
      const s = sp.createSpace({ name, capacity, notes: 'Sample space (fictional)' });
      out.spaces.push(s.id);
      mark('spaces', s.id);
    }
    [sanctuary, hall, room] = out.spaces;
  }

  // ------------------------------------------------ the books, before anything is counted (offerings draft into them)
  const bk = mods.bookkeeping && !B.bkSettings().start_date && !get('SELECT 1 FROM bk_journals');
  const lastSunday = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (d.getUTCDay() || 7));
    return d.toISOString().slice(0, 10);
  })();
  const sundays = [...Array(10)].map((_, i) => day(lastSunday, (i - 7) * 7)); // eight past (incl. the last), two ahead
  const start = `${sundays[0].slice(0, 7)}-01`;
  const acct = (code: string) => get<{ id: number }>('SELECT id FROM bk_accounts WHERE code = ?', code)?.id;
  const fund = (code: string) => get<{ id: number }>('SELECT id FROM bk_funds WHERE code = ?', code)?.id;
  const post = (input: B.JournalInput) => {
    const j = B.saveDraft(null, input);
    out.journals.push(j.id);
    mark('bk_journals', j.id);
    return B.postJournal(j.id);
  };
  if (bk) {
    B.setupBooks({ start_date: start, year_end_month: 12, template: true });
    out.books_started = true;
    const [bank, savings, opening, GEN, MIS, BLD] = [acct('1100'), acct('1110'), acct('3000'), fund('GEN'), fund('MIS'), fund('BLD')];
    if (bank && savings && opening && GEN && MIS && BLD) {
      post({ date: start, kind: 'opening', memo: 'Opening balances (sample)', lines: [
        { account_id: bank, fund_id: GEN, debit: 1_850_000, credit: 0 }, { account_id: bank, fund_id: MIS, debit: 640_000, credit: 0 },
        { account_id: savings, fund_id: BLD, debit: 4_200_000, credit: 0 },
        { account_id: opening, fund_id: GEN, debit: 0, credit: 1_850_000 }, { account_id: opening, fund_id: MIS, debit: 0, credit: 640_000 },
        { account_id: opening, fund_id: BLD, debit: 0, credit: 4_200_000 },
      ] });
    }
  }

  // ------------------------------------------------ services: the last eight Sundays and the next two
  const tpl = (key: string) => get<{ id: number }>('SELECT id FROM templates WHERE key = ?', key)?.id ?? null;
  const lordsDay = tpl('lords-day-morning');
  const supper = tpl('lords-supper') ?? lordsDay;
  const sampleServices: { id: number; date: string }[] = [];
  sundays.forEach((date, i) => {
    if (get("SELECT 1 FROM services WHERE kind = 'service' AND date = ?", date)) return; // the church's own stays as it is
    const first = Number(date.slice(8, 10)) <= 7;
    const [ref, en, zh] = SERMONS[i % SERMONS.length];
    const s = svc.createService({ date, sermon_ref: ref, sermon_title: { en, zh }, space_id: sanctuary, status: date < today ? 'final' : 'draft' } as never, first ? supper : lordsDay).service;
    o.serviceIds.push(s.id);
    sampleServices.push({ id: s.id, date });
  });
  // rotas: the sample's people in the empty places (served and confirmed in the past)
  const roles = vol.teamsWithRoles().flatMap((t) => t.roles);
  for (const s of sampleServices) {
    const busy = new Set<number>();
    for (const r of roles) {
      const pool = (o.pools.get(r.id) ?? []).filter((pid) => !busy.has(pid));
      for (const pid of pick(pool, Math.max(0, r.needed))) {
        if (get('SELECT 1 FROM assignments WHERE service_id = ? AND person_id = ?', s.id, pid)) continue;
        o.assignments.push((vol.assign(s.id, r.id, pid, s.date < today ? 'confirmed' : 'scheduled') as { id: number }).id);
        busy.add(pid);
      }
    }
  }

  // ------------------------------------------------ service records: attendance, visitors, offerings counted
  const currency = getSettings().offering.currency;
  const denoms = DENOMINATIONS[currency];
  const funds = getSettings().offering.funds;
  const minCounters = Math.max(2, getSettings().offering.min_counters ?? 2);
  const breakdown = (amount: number) => {
    const out: Record<string, number> = {};
    let left = amount;
    for (const d of [...denoms.notes, ...denoms.coins]) {
      const n = Math.floor(left / d);
      if (n) { out[String(d)] = n; left -= n * d; }
    }
    return left === 0 ? out : null;
  };
  let v = 0;
  for (const s of sampleServices.filter((x) => x.date < today)) {
    const attendance = 85 + Math.floor(rnd() * 40);
    const visitors = rnd() < 0.5 ? [{ ...VISITORS[v++ % VISITORS.length], follow_up_by: pick(adults, 1)[0]?.name ?? '' }] : [];
    const roundTo = (n: number, step: number) => Math.round(n / step) * step;
    const cash = denoms ? roundTo(180_000 + rnd() * 120_000, 500) : 0;
    const offerings = [
      ...(cash ? [{ fund: funds[0] ?? 'General', method: 'cash' as const, amount: cash }] : []),
      { fund: funds[0] ?? 'General', method: 'paynow' as const, amount: roundTo(250_000 + rnd() * 150_000, 100) },
      ...(funds[1] ? [{ fund: funds[1], method: 'paynow' as const, amount: roundTo(30_000 + rnd() * 50_000, 100) }] : []),
      ...(funds[2] && rnd() < 0.4 ? [{ fund: funds[2], method: 'transfer' as const, amount: roundTo(50_000 + rnd() * 150_000, 1000) }] : []),
    ];
    const counters = pick(adults, minCounters).map((p) => p.name);
    const counted = cash && denoms ? breakdown(cash) : null;
    R.saveRecord(s.id, {
      attendance, children: 14 + Math.floor(rnd() * 12), online: 8 + Math.floor(rnd() * 20), visitors,
      notes: rnd() < 0.3 ? 'Sample note: the projector flickered during the second hymn.' : null,
      offerings, currency, cash: counted ?? {}, counters, counted_on: s.date,
    } as never, who);
    try {
      // the count verified as the church signs: on paper, or on screen (counters approving from their own accounts can't be sampled)
      if (R.signingMode() === 'screen') {
        if (!R.ownAccounts()) {
          for (const name of counters) R.sign(s.id, { name, image: INK }, who);
          R.finishSigning(s.id, who);
        }
      } else R.setVerified(s.id, true, who);
    } catch (e) {
      console.error(`sample data: service ${s.date} not verified — ${(e as Error).message}`);
    }
  }

  // ------------------------------------------------ meetings: cell groups every other Friday, Sunday school weekly
  if (mods.meetings) {
    const groups = all<{ id: number; kind: string; name: string }>(
      `SELECT id, kind, name FROM groups WHERE id IN (${o.groupIds.map(() => '?').join(',') || 'NULL'}) AND kind IN ('cell_group', 'sunday_school')`, ...o.groupIds,
    );
    for (const g of groups) {
      const dates = g.kind === 'cell_group'
        ? [-5, -3, -1, 1].map((k) => day(lastSunday, 5 + k * 7))   // Fridays, every other week
        : [-3, -2, -1, 0, 1].map((k) => day(lastSunday, k * 7));    // Sundays
      for (const date of dates) {
        const m = svc.createMeeting({
          group_id: g.id, date, start_time: g.kind === 'cell_group' ? '20:00' : '09:30',
          place: g.kind === 'cell_group' ? 'A member’s home (sample)' : null, space_id: g.kind === 'sunday_school' ? room : null,
        } as never);
        o.serviceIds.push(m.id);
        if (date < today) R.saveRecord(m.id, { attendance: g.kind === 'cell_group' ? 7 + Math.floor(rnd() * 6) : 18 + Math.floor(rnd() * 8), notes: rnd() < 0.3 ? 'Sample note: prayed for the church camp.' : null } as never, who);
      }
    }
  }

  // ------------------------------------------------ the calendar
  for (const e of [
    { title: { en: 'Church camp (sample)', zh: '教会营会（样本）' }, date: day(lastSunday, 34), end_date: day(lastSunday, 36), place: 'A retreat centre', description: 'Three days away together: talks, games and a night of praise.' },
    { title: { en: 'Annual general meeting (sample)', zh: '年度大会（样本）' }, date: day(lastSunday, 20), start_time: '14:00', end_time: '16:00', space_id: hall, description: 'Reports, accounts and the election of the council.' },
    { title: { en: 'Working bee: tidy the hall (sample)', zh: '大扫除（样本）' }, date: day(lastSunday, 13), start_time: '09:00', end_time: '12:00', space_id: hall, description: 'Bring gloves; lunch provided.' },
  ]) {
    const ev = cal.events.insert({ end_date: null, start_time: null, end_time: null, place: null, space_id: null, congregation_id: null, group_id: null, ...e } as never);
    out.events.push(ev.id);
    mark('events', ev.id);
  }

  // ------------------------------------------------ the lending library
  if (mods.lending) {
    const titles: [string, string, number, string, string, number][] = [
      ['Knowing God', 'J. I. Packer', 1973, 'book', 'Christian living', 2],
      ['The Pilgrim’s Progress', 'John Bunyan', 1678, 'book', 'Classics', 2],
      ['Mere Christianity', 'C. S. Lewis', 1952, 'book', 'Apologetics', 1],
      ['Holiness', 'J. C. Ryle', 1877, 'book', 'Christian living', 1],
      ['The Valley of Vision', 'Arthur Bennett (ed.)', 1975, 'book', 'Prayer', 2],
      ['荒漠甘泉', 'L. B. Cowman', 1925, 'book', 'Devotional', 2],
      ['The Big Picture Story Bible', 'David Helm', 2004, 'book', 'Children', 3],
      ['Sunday school teachers’ kit (sample)', 'Sample church', 2024, 'curriculum', 'Sunday school', 1],
    ];
    const copies: number[] = [];
    for (const [title, authors, year, kind, category, n] of titles) {
      const b = lend.saveBook(null, { title, authors, year, kind: kind as never, category, notes: 'Sample book (fictional copy)' }, n);
      out.books.push(b.id);
      mark('lending_books', b.id);
      copies.push(...all<{ id: number }>('SELECT id FROM lending_copies WHERE book_id = ?', b.id).map((c) => c.id));
    }
    // loans: some out now (two overdue), some back
    const borrowers = pick(o.people.filter((p) => p.adult), 8);
    pick(copies, 8).forEach((copy, i) => {
      const l = lend.lend({ copy_id: copy, person_id: borrowers[i].id, due_on: day(today, 21) }, null);
      if (i < 2) lend.loans.update(l.id, { lent_on: day(today, -40), due_on: day(today, -12 + i * 4) });
      else if (i >= 5) lend.loans.update(l.id, { lent_on: day(today, -70 + i), due_on: day(today, -40 + i), returned_on: day(today, -45 + i * 2) });
      else lend.loans.update(l.id, { lent_on: day(today, -7 * i) });
    });
  }

  // ------------------------------------------------ the asset register
  if (mods.equipment) {
    const av = pick(adults, 3);
    const items: [string, string, string, string, number | null, string, 'good' | 'fair' | 'poor', 'in_use' | 'stored' | 'out_of_service', number | null][] = [
      ['Projector', 'Audio-visual', 'Epson EB-L630U (sample)', 'Sanctuary', av[0]?.id ?? null, '2022-03-15', 'good', 'in_use', 12],
      ['Sound mixer', 'Audio-visual', 'Behringer X32 Compact (sample)', 'Sanctuary', av[1]?.id ?? null, '2021-06-01', 'good', 'in_use', null],
      ['Digital piano', 'Music', 'Yamaha Clavinova (sample)', 'Sanctuary', av[2]?.id ?? null, '2019-09-20', 'fair', 'in_use', 6],
      ['Wireless microphones (4)', 'Audio-visual', 'Shure BLX (sample)', 'AV cabinet', av[0]?.id ?? null, '2023-01-10', 'good', 'in_use', null],
      ['Folding chairs (60)', 'Furniture', null as unknown as string, 'Store room', null, '2018-05-05', 'fair', 'stored', null],
      ['Office laptop', 'Office', 'ThinkPad (sample)', 'Church office', av[1]?.id ?? null, '2020-02-02', 'poor', 'out_of_service', null],
    ];
    for (const [name, category, make_model, location, custodian_id, bought_on, condition, status, every] of items) {
      const it = eq.saveItem(null, {
        name, category, make_model: make_model ?? null, location, custodian_id, bought_on, condition, status,
        price: 50_000 + Math.floor(rnd() * 300_000), maintenance_every_months: every, notes: 'Sample item (fictional)',
      });
      out.equipment.push(it.id);
      mark('equipment', it.id);
      if (every) eq.addMaintenance(it.id, { done_on: day(today, -40), what: name === 'Digital piano' ? 'Tuned and cleaned' : 'Filter cleaned, lamp hours checked', cost: 12_000, done_by: 'A service company (sample)' });
    }
  }

  const noteRecords = () => {
    out.records = Object.fromEntries(all<{ service_id: number; revision: number }>(
      `SELECT service_id, revision FROM service_records WHERE service_id IN (${o.serviceIds.map(() => '?').join(',') || 'NULL'})`, ...o.serviceIds,
    ).map((r) => [r.service_id, r.revision]));
  };
  if (!bk) {
    noteRecords();
    return out;
  }

  // ------------------------------------------------ the books: offerings posted, cash banked, the monthly bills
  const [bank, undeposited, GEN, MIS] = [acct('1100'), acct('1010'), fund('GEN'), fund('MIS')];
  for (const s of sampleServices) {
    for (const j of all<{ id: number }>("SELECT id FROM bk_journals WHERE service_id = ? AND status = 'draft'", s.id)) {
      out.journals.push(j.id);
      mark('bk_journals', j.id);
      try {
        B.postJournal(j.id);
      } catch (e) {
        console.error(`sample data: offering journal not posted — ${(e as Error).message}`);
      }
    }
    // the cash is banked the next day
    const r = R.recordFor(s.id);
    const cashByFund = new Map<string, number>();
    for (const l of r.offerings ?? []) if (l.method === 'cash' && !l.currency) cashByFund.set(l.fund, (cashByFund.get(l.fund) ?? 0) + l.amount);
    const lines: B.JournalInput['lines'] = [];
    for (const [fname, amt] of cashByFund) {
      const f = B.bkSettings().fund_map[fname]?.fund_id ?? GEN;
      if (bank && undeposited && f) lines.push({ account_id: bank, fund_id: f, debit: amt, credit: 0, memo: 'Cash deposit' }, { account_id: undeposited, fund_id: f, debit: 0, credit: amt });
    }
    if (lines.length && r.verified_at) post({ date: day(s.date, 1), memo: `Offering cash banked (${s.date})`, lines });
  }
  const bills: [string, string, number, string][] = [['5000', 'GEN', 420_000, 'Staff salary'], ['5500', 'GEN', 185_000, 'Rent and utilities'], ['5100', 'MIS', 100_000, 'Missions support'], ['5700', 'GEN', 1_200, 'Bank charges']];
  for (let m = start; m <= today; m = `${day(`${m.slice(0, 7)}-28`, 5).slice(0, 7)}-01`) {
    const date = `${m.slice(0, 7)}-25`;
    if (date > today) break;
    for (const [code, fcode, amount, memo] of bills) {
      const a = acct(code), f = fund(fcode);
      if (a && f && bank) post({ date, memo: `${memo} (sample)`, lines: [{ account_id: a, fund_id: f, debit: amount, credit: 0 }, { account_id: bank, fund_id: f, debit: 0, credit: amount }] });
    }
  }

  // ------------------------------------------------ expense claims: approvers, and a claim in every state
  const [ap1, ap2, ...claimants] = pick(o.people.filter((p) => p.adult && p.age >= 30 && p.age <= 70), 7);
  for (const a of [ap1, ap2]) {
    const r = C.saveApprover(null, { person_id: a.id }) as { id: number } | { id: number }[];
    const id = Array.isArray(r) ? get<{ id: number }>('SELECT id FROM bk_claim_approvers WHERE person_id = ?', a.id)!.id : r.id;
    out.approvers.push(id);
    mark('bk_claim_approvers', id);
  }
  const claim = (p: Person, purpose: string, lines: [string, string, number][]) => {
    const party: C.Party = { as: 'claimant', person_id: p.id, name: p.name };
    const c = C.createClaim(p.id, { purpose, pay_to: `PayNow 9${String(p.id).padStart(7, '0')} (fictional)`, lines: lines.map(([description, payee, amount], i) => ({ date: day(today, -10 - i), description, payee, amount })) }, party);
    out.claims.push(c.id);
    mark('bk_claims', c.id);
    c.lines.forEach((l, i) => C.addClaimFile(c.id, { name: `receipt-${i + 1}.png`, mime: 'image/png', data: receiptPng(c.id * 7 + i), line_id: l.id }, party));
    return { id: c.id, party };
  };
  const submit = (x: { id: number; party: C.Party }) => C.submitClaim(x.id, { image: INK }, x.party);
  const decide = (id: number, a: Person, decision: 'approved' | 'returned', note?: string) => C.decideClaim(id, { decision, note, image: INK, via: 'device' }, { person_id: a.id, name: a.name });
  if (ap1 && ap2 && claimants.length >= 5) {
    claim(claimants[0], 'Youth camp supplies (sample)', [['Snacks and drinks', 'A supermarket', 8_640], ['Craft materials', 'A stationery shop', 3_250]]); // still being prepared
    submit(claim(claimants[1], 'Flowers for the Lord’s Supper (sample)', [['Flowers', 'A florist', 6_500]])); // waiting for approval
    const back = claim(claimants[2], 'Welcome packs (sample)', [['Printing', 'A print shop', 14_800]]);
    submit(back);
    decide(back.id, ap1, 'returned', 'Please add the second receipt for the bags.');
    const approved = claim(claimants[3], 'Cell group outreach dinner (sample)', [['Dinner', 'A restaurant', 23_400], ['Drinks', 'A supermarket', 2_890]]);
    submit(approved);
    decide(approved.id, ap1, 'approved'); // to pay
    const paid = claim(claimants[4], 'Sunday school books (sample)', [['Story books', 'A bookshop', 11_960]]);
    submit(paid);
    const c = decide(paid.id, ap2, 'approved');
    for (const id of [c.approval_journal_id, C.getClaim(approved.id).approval_journal_id]) {
      if (!id) continue;
      // dated within the sample's weeks (the approval took today's date)
      const j = B.getJournal(id);
      B.saveDraft(id, { date: day(today, -3), memo: j.memo, kind: j.kind, claim_id: j.claim_id ?? null, lines: j.lines });
      out.journals.push(id);
      mark('bk_journals', id);
    }
    if (c.approval_journal_id) B.postJournal(c.approval_journal_id);
    if (bank) {
      // marked as the sample's while still a draft (a posted journal can't be marked), then posted
      const p = C.payClaim(paid.id, { date: day(today, -2), bank_account_id: bank, reference: 'PayNow (sample)', post: false }, { name: 'Sample treasurer', person_id: null });
      if (p.payment_journal_id) {
        out.journals.push(p.payment_journal_id);
        mark('bk_journals', p.payment_journal_id);
        B.postJournal(p.payment_journal_id);
      }
    }
  }

  // ------------------------------------------------ the bank statement: what went through the current account, matched
  if (bank) {
    const rows = all<{ date: string; memo: string | null; jmemo: string | null; number: string | null; debit: number; credit: number }>(
      `SELECT j.date, l.memo, j.memo AS jmemo, j.number, l.debit, l.credit FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id
       WHERE l.account_id = ? AND j.status = 'posted' AND j.kind != 'opening' AND j.sample_batch = ? ORDER BY j.date, j.id, l.id`, bank, batch,
    );
    const opening = all<{ d: number; c: number }>(
      "SELECT l.debit d, l.credit c FROM bk_lines l JOIN bk_journals j ON j.id = l.journal_id WHERE l.account_id = ? AND j.kind = 'opening' AND j.status = 'posted'", bank,
    ).reduce((n, r) => n + r.d - r.c, 0);
    const csv = ['Date,Description,Amount,Reference', ...rows.map((r) => `${r.date},"${(r.memo || r.jmemo || 'Transfer').replace(/"/g, "'")}",${((r.debit - r.credit) / 100).toFixed(2)},${r.number ?? ''}`)];
    // one line the books don't have yet: to match by hand
    csv.push(`${day(today, -1)},"SERVICE CHARGE",-2.00,`);
    const closing = rows.reduce((n, r) => n + r.debit - r.credit, opening) - 200;
    const st = Bank.importStatement({
      account_id: bank, data: Buffer.from(csv.join('\n')), file_name: 'sample-bank-statement.csv', opening_balance: opening, closing_balance: closing,
      layout: { header_row: 0, date: 'Date', description: 'Description', amount: 'Amount', reference: 'Reference', date_format: 'YYYY-MM-DD' },
    });
    const sid = st.statement_id as number | null;
    if (sid) {
      out.statements.push(sid);
      mark('bk_statements', sid);
      Bank.autoMatch(sid);
    }
  }
  void MIS;
  noteRecords();
  return out;
}

// ---------------------------------------------------------------- taking it out again

const ofBatch = (table: string, id: number, batch: string | undefined) => !!batch && !!get(`SELECT 1 FROM ${table} WHERE id = ? AND sample_batch = ?`, id, batch);

/** Remove what the activity added. Returns what was kept (and why). Runs inside removeSampleData's transaction. */
export function removeSampleActivity(a: ActivityAdded, batch: string | undefined) {
  const kept: { what: 'journal' | 'space' | 'claim'; id: number; name: string; why: string[] }[] = [];
  // the bank statements first (their matches point at the journals' lines)
  for (const id of a.statements) if (ofBatch('bk_statements', id, batch)) Bank.deleteStatement(id);
  // journals: unless something real now depends on one
  for (const id of a.journals) {
    if (!ofBatch('bk_journals', id, batch)) continue;
    const why = [
      get('SELECT 1 FROM bk_journals WHERE reverses_id = ? AND sample_batch IS NULL', id) && 'reversed by a real journal',
      get('SELECT 1 FROM bk_statement_lines sl JOIN bk_lines l ON l.id = sl.line_id JOIN bk_statements s ON s.id = sl.statement_id WHERE l.journal_id = ? AND s.sample_batch IS NULL', id) && 'matched to a real bank statement',
    ].filter((x): x is string => !!x);
    if (why.length) {
      const j = get<{ number: string | null; date: string }>('SELECT number, date FROM bk_journals WHERE id = ?', id)!;
      kept.push({ what: 'journal', id, name: `${j.number ?? 'Draft'} ${j.date}`, why });
      continue;
    }
    run('UPDATE bk_claims SET approval_journal_id = NULL WHERE approval_journal_id = ?', id);
    run('UPDATE bk_claims SET payment_journal_id = NULL WHERE payment_journal_id = ?', id);
    run('UPDATE bk_journals SET reversed_by_id = NULL WHERE reversed_by_id = ? AND status != ?', id, 'posted');
    run('DELETE FROM bk_lines WHERE journal_id = ?', id);
    run('DELETE FROM bk_journals WHERE id = ?', id);
  }
  for (const id of a.claims) if (ofBatch('bk_claims', id, batch)) run('DELETE FROM bk_claims WHERE id = ?', id);
  for (const id of a.approvers) if (ofBatch('bk_claim_approvers', id, batch)) run('DELETE FROM bk_claim_approvers WHERE id = ?', id);
  // the books go back to not started — when the sample started them and nothing real is in them
  if (a.books_started && !get('SELECT 1 FROM bk_journals') && !get('SELECT 1 FROM bk_statements')) {
    updateSettings({ bookkeeping: { ...B.bkSettings(), start_date: null, closed_through: null } });
  }
  for (const id of a.books) if (ofBatch('lending_books', id, batch)) run('DELETE FROM lending_books WHERE id = ?', id);
  for (const id of a.equipment) if (ofBatch('equipment', id, batch)) eq.deleteItem(id);
  for (const id of a.events) if (ofBatch('events', id, batch)) run('DELETE FROM events WHERE id = ?', id);
  return kept;
}

/** Spaces go last: after the sample's services and meetings (a space something real is booked in stays). */
export function removeSampleSpaces(a: ActivityAdded, batch: string | undefined) {
  const kept: { what: 'space'; id: number; name: string; why: string[] }[] = [];
  for (const id of a.spaces) {
    if (!ofBatch('spaces', id, batch)) continue;
    if (get('SELECT 1 FROM services WHERE space_id = ?', id) || get('SELECT 1 FROM events WHERE space_id = ?', id)) {
      kept.push({ what: 'space', id, name: JSON.parse(get<{ name: string }>('SELECT name FROM spaces WHERE id = ?', id)!.name).en ?? 'A space', why: ['booked for something real'] });
      continue;
    }
    run('DELETE FROM spaces WHERE id = ?', id);
  }
  return kept;
}
