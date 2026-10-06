// REST routes for the lending library (0.15, optional module "lending"; switched off = 404, shared/modules.ts).
// Mounted inside /api after authentication; reading needs the role's Lending library access, changes need edit.
import express from 'express';
import { z } from 'zod';
import { get, run } from '../db.ts';
import * as L from '../repo/lending.ts';
import { sendLoanReminders, dueReminders } from '../repo/lending-reminders.ts';
import { fetchCover, lookupIsbn } from '../lib/isbn.ts';
import { getSettings, updateSettings } from '../repo/settings.ts';
import { qrSvg } from '../repo/presentation.ts';
import { BadRequest } from '../lib/table.ts';
import { h, id, str } from './helpers.ts';

export const lendingRoutes = express.Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = (max: number) => z.string().max(max).nullable().optional();
const BookInput = z.object({
  title: z.string().min(1).max(300),
  subtitle: text(300),
  authors: text(500),
  isbn: text(20),
  publisher: text(200),
  year: z.number().int().nullable().optional(),
  kind: z.enum(['book', 'dvd', 'curriculum', 'other']).optional(),
  category: text(100),
  language: text(20),
  shelf: text(60),
  description: text(4000),
  notes: text(2000),
});

// ---- the catalogue
lendingRoutes.get('/lending/books', h((req) => L.listBooks({
  q: str(req.query.q), kind: str(req.query.kind), category: str(req.query.category), available: req.query.available === '1',
})));
lendingRoutes.get('/lending/categories', h(() => L.bookCategories()));
lendingRoutes.get('/lending/books/:id', h((req) => L.getBook(id(req))));
lendingRoutes.post('/lending/books', h(async (req) => {
  const b = BookInput.extend({ copies: z.number().int().min(0).max(200).optional(), cover_url: z.string().max(500).nullable().optional() }).parse(req.body);
  const { copies, cover_url, ...fields } = b;
  const book = L.saveBook(null, fields, copies ?? 1);
  if (cover_url) await saveCover(book.id, cover_url).catch(() => undefined); // a missing cover never stops the book
  return L.getBook(book.id);
}));
lendingRoutes.patch('/lending/books/:id', h(async (req) => {
  const b = BookInput.partial().extend({ cover_url: z.string().max(500).nullable().optional(), remove_cover: z.literal(true).optional() }).parse(req.body);
  const { cover_url, remove_cover, ...fields } = b;
  L.saveBook(id(req), fields);
  if (remove_cover) {
    run('DELETE FROM assets WHERE key = ?', `book-cover-${id(req)}`);
    L.books.update(id(req), { has_cover: false });
  }
  if (cover_url) await saveCover(id(req), cover_url);
  return L.getBook(id(req));
}));
lendingRoutes.delete('/lending/books/:id', h((req) => {
  L.deleteBook(id(req));
  return { deleted: true };
}));

async function saveCover(bookId: number, url: string) {
  const c = await fetchCover(url);
  run("INSERT INTO assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at",
    `book-cover-${bookId}`, c.mime, c.data);
  L.books.update(bookId, { has_cover: true });
}
lendingRoutes.get('/lending/books/:id/cover', (req, res) => {
  const a = get<{ mime: string; data: Uint8Array }>('SELECT mime, data FROM assets WHERE key = ?', `book-cover-${Number(req.params.id)}`);
  if (!a) return res.status(404).json({ error: 'No cover' });
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(a.mime).send(Buffer.from(a.data));
});
lendingRoutes.get('/lending/isbn/:isbn', h(async (req) => ({ found: await lookupIsbn(String(req.params.isbn)) })));

// ---- copies
lendingRoutes.post('/lending/books/:id/copies', h((req) => {
  const b = z.object({ count: z.number().int().min(1).max(200), numbers: z.array(z.string().max(30)).max(200).optional() }).parse(req.body);
  return L.addCopies(id(req), b.count, b.numbers);
}));
lendingRoutes.patch('/lending/copies/:id', h((req) => L.updateCopy(id(req), z.object({
  number: z.string().min(1).max(30).optional(), status: z.enum(['in', 'lost', 'withdrawn']).optional(),
  condition: text(100), acquired_on: date.nullable().optional(), notes: text(1000),
}).parse(req.body))));
lendingRoutes.delete('/lending/copies/:id', h((req) => {
  L.removeCopy(id(req));
  return { deleted: true };
}));
/** A scanned or typed number (or the address in a QR label): the copy, its book and whether it is out. */
lendingRoutes.get('/lending/scan', h((req) => L.findCopy(str(req.query.q) ?? '')));

// ---- labels: QR codes for copies, opening their page in Canon
const base = (v: unknown) => {
  const s = str(v) ?? '';
  if (!/^https?:\/\/[^\s/?#]+$/.test(s)) throw new BadRequest('Bad address for the labels.');
  return s;
};
lendingRoutes.get('/lending/labels', h(async (req) => {
  const ids = (str(req.query.copies) ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500);
  const origin = base(req.query.base);
  const rows = ids.length
    ? (await import('../db.ts')).all<{ id: number; number: string; title: string; shelf: string | null }>(
      `SELECT c.id, c.number, b.title, b.shelf FROM lending_copies c JOIN lending_books b ON b.id = c.book_id WHERE c.id IN (${ids.map(() => '?').join(',')}) ORDER BY c.number`, ...ids)
    : [];
  return Promise.all(rows.map(async (r) => ({ ...r, qr: await qrSvg(`${origin}/lending/copy/${encodeURIComponent(r.number)}`) })));
}));

// ---- lending, returns, renewals
lendingRoutes.get('/lending/borrowers', h((req) => L.borrowers(str(req.query.q) ?? '')));
lendingRoutes.get('/lending/loans', h((req) => {
  const status = str(req.query.status);
  return L.listLoans({
    status: status === 'overdue' || status === 'returned' || status === 'all' ? status : 'open',
    person_id: Number(req.query.person) || undefined, book_id: Number(req.query.book) || undefined, q: str(req.query.q),
  });
}));
lendingRoutes.post('/lending/loans', h((req) => {
  const b = z.object({ copy_id: z.number().int(), person_id: z.number().int(), due_on: date.nullable().optional(), notes: text(1000) }).parse(req.body);
  return L.lend(b, req.user?.id ?? null);
}));
lendingRoutes.post('/lending/loans/:id/return', h((req) => L.returnLoan(id(req))));
lendingRoutes.post('/lending/loans/:id/renew', h((req) => L.renewLoan(id(req), z.object({ due_on: date.nullable().optional() }).parse(req.body ?? {}).due_on)));

// ---- the rules and reminders
lendingRoutes.get('/lending/settings', h(() => getSettings().lending));
lendingRoutes.put('/lending/settings', h((req) => {
  const b = z.object({
    loan_days: z.number().int().optional(), max_renewals: z.number().int().optional(),
    remind_days_before: z.number().int().optional(), send_reminders: z.boolean().optional(),
  }).parse(req.body);
  L.checkRules(b);
  return updateSettings({ lending: { ...getSettings().lending, ...b } }).lending;
}));
lendingRoutes.get('/lending/reminders', h(() => {
  const d = dueReminders();
  const people = (list: typeof d.due) => new Set(list.map((x) => x.person_id)).size;
  return { due_soon: d.due.length, overdue: d.overdue.length, people: people(d.due) + people(d.overdue) };
}));
lendingRoutes.post('/lending/reminders/send', h((req) => sendLoanReminders({ userId: req.user?.id ?? null })));
lendingRoutes.get('/lending/summary', h(() => L.lendingCounts()));
