// The lending library (0.15, optional module "lending"): the church's books, DVDs and curricula — a catalogue, numbered
// copies with QR labels, and loans to members with due dates, renewals, returns and e-mail reminders. Separate from
// the Library of songs, liturgy and Bibles. Borrowers are people on the member register.
import { all, get, run, tx, type SqlValue } from '../db.ts';
import { visiblePeopleIds } from '../lib/walls.ts';
import { BadRequest, Conflict, NotFound, table } from '../lib/table.ts';
import { getSettings } from './settings.ts';

export type BookKind = 'book' | 'dvd' | 'curriculum' | 'other';
export const BOOK_KINDS: BookKind[] = ['book', 'dvd', 'curriculum', 'other'];
export type CopyStatus = 'in' | 'lost' | 'withdrawn';

export interface Book {
  id: number;
  title: string;
  subtitle: string | null;
  authors: string | null;
  isbn: string | null;
  publisher: string | null;
  year: number | null;
  kind: BookKind;
  category: string | null;
  language: string | null;
  shelf: string | null;
  description: string | null;
  notes: string | null;
  has_cover: boolean;
  created_at: string;
  updated_at: string;
}

export interface Copy {
  id: number;
  book_id: number;
  number: string;
  status: CopyStatus;
  condition: string | null;
  acquired_on: string | null;
  notes: string | null;
  created_at: string;
}

export interface Loan {
  id: number;
  copy_id: number;
  person_id: number | null;
  lent_on: string;
  due_on: string;
  returned_on: string | null;
  renewals: number;
  reminded_on: string | null;
  overdue_reminded_on: string | null;
  notes: string | null;
  lent_by: number | null;
  via: 'desk' | 'self';
  return_pending_on: string | null;
  created_at: string;
}

export const books = table<Book>({
  name: 'lending_books',
  cols: ['title', 'subtitle', 'authors', 'isbn', 'publisher', 'year', 'kind', 'category', 'language', 'shelf', 'description', 'notes', 'has_cover'],
  bool: ['has_cover'],
  touch: true,
});
export const copies = table<Copy>({
  name: 'lending_copies',
  cols: ['book_id', 'number', 'status', 'condition', 'acquired_on', 'notes'],
  log: { parent: (r) => ({ entity: 'lending_books', id: Number(r.book_id) }) },
});
export const loans = table<Loan>({
  name: 'lending_loans',
  cols: ['copy_id', 'person_id', 'lent_on', 'due_on', 'returned_on', 'renewals', 'reminded_on', 'overdue_reminded_on', 'notes', 'lent_by', 'via', 'return_pending_on'],
  guard: { refs: { person_id: 'people' } },
  log: { parent: (r) => ({ entity: 'lending_books', id: get<{ book_id: number }>('SELECT book_id FROM lending_copies WHERE id = ?', Number(r.copy_id))?.book_id ?? 0 }) },
});

/** Today on this computer (loans are due on local dates). */
export const localToday = () => new Date().toLocaleDateString('en-CA');
export const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
};

const PERSON_NAME = `TRIM(IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) || CASE WHEN p.native_name IS NOT NULL THEN ' ' || p.native_name ELSE '' END`;

// ---------------------------------------------------------------- numbers and ISBNs

/** The next free number with this prefix: B0001, B0002 … (copies) or E0001 … (equipment). */
export function nextNumber(tableName: 'lending_copies' | 'equipment', prefix: string): string {
  const rows = all<{ number: string }>(`SELECT number FROM ${tableName} WHERE number LIKE ?`, `${prefix}%`);
  const max = rows.reduce((m, r) => Math.max(m, Number(r.number.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** An ISBN with the hyphens and spaces taken out; null when it isn't one (10 or 13 digits, 10 may end in X). */
export function cleanIsbn(raw: string | null | undefined): string | null {
  const s = (raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(s) || /^\d{9}[\dX]$/.test(s)) return s;
  return null;
}

/** A copy's number from what was typed or scanned: the number itself, or the address in its QR label. */
export function copyNumberFrom(scanned: string): string {
  const s = scanned.trim();
  const m = s.match(/\/lending\/copy\/([^/?#\s]+)/i);
  return decodeURIComponent(m ? m[1] : s).trim();
}

// ---------------------------------------------------------------- the catalogue

export interface BookSummary extends Book {
  copies: number;
  available: number;
  on_loan: number;
  numbers: string[];
}

export function listBooks(q: { q?: string; kind?: string; category?: string; available?: boolean } = {}): BookSummary[] {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (q.q?.trim()) {
    const like = `%${q.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    const isbn = cleanIsbn(q.q);
    where.push(`(b.title LIKE ? ESCAPE '\\' OR b.subtitle LIKE ? ESCAPE '\\' OR b.authors LIKE ? ESCAPE '\\' OR b.category LIKE ? ESCAPE '\\' OR b.shelf LIKE ? ESCAPE '\\'
      OR b.id IN (SELECT book_id FROM lending_copies WHERE number LIKE ? ESCAPE '\\')${isbn ? ' OR b.isbn = ?' : ''})`);
    params.push(like, like, like, like, like, like);
    if (isbn) params.push(isbn);
  }
  if (q.kind && BOOK_KINDS.includes(q.kind as BookKind)) {
    where.push('b.kind = ?');
    params.push(q.kind);
  }
  if (q.category?.trim()) {
    where.push('b.category = ?');
    params.push(q.category.trim());
  }
  const rows = all<Record<string, unknown>>(
    `SELECT b.*,
       (SELECT COUNT(*) FROM lending_copies c WHERE c.book_id = b.id AND c.status = 'in') AS copies,
       (SELECT COUNT(*) FROM lending_copies c JOIN lending_loans l ON l.copy_id = c.id AND l.returned_on IS NULL WHERE c.book_id = b.id) AS on_loan,
       (SELECT group_concat(number, ' ') FROM (SELECT number FROM lending_copies c WHERE c.book_id = b.id ORDER BY number)) AS numbers
     FROM lending_books b ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY b.title COLLATE NOCASE, b.id`,
    ...params,
  );
  const out = rows.map((r) => {
    const b = books.decode(r)! as Book & { copies: number; on_loan: number; numbers: string | null };
    return { ...b, available: Math.max(0, b.copies - b.on_loan), numbers: b.numbers ? b.numbers.split(' ') : [] } as BookSummary;
  });
  return q.available ? out.filter((b) => b.available > 0) : out;
}

/** The categories in use (for the filter and the form's suggestions). */
export const bookCategories = () => all<{ category: string }>("SELECT DISTINCT category FROM lending_books WHERE category IS NOT NULL AND category <> '' ORDER BY category COLLATE NOCASE").map((r) => r.category);

export interface CopyDetail extends Copy {
  loan: { id: number; person_id: number | null; borrower: string | null; lent_on: string; due_on: string; renewals: number } | null;
}

/**
 * Congregation walls (v0.17.2 review, F6): the catalogue is shared, but a person outside this account's congregation
 * is not shown — a loan or a custodian keeps its place (the copy is out, the item is looked after) with no name,
 * number or e-mail flag, marked `elsewhere`. Returns a test for a person id.
 */
export function walledPerson(): (personId: unknown) => boolean {
  const vis = visiblePeopleIds();
  return (pid) => vis !== null && pid !== null && pid !== undefined && !vis.has(Number(pid));
}

export function getBook(id: number) {
  const hidden = walledPerson();
  const book = books.get(id);
  const cs = all<Record<string, unknown>>(
    `SELECT c.*, l.id AS loan_id, l.person_id, l.lent_on, l.due_on, l.renewals, ${PERSON_NAME} AS borrower
     FROM lending_copies c
     LEFT JOIN lending_loans l ON l.copy_id = c.id AND l.returned_on IS NULL
     LEFT JOIN people p ON p.id = l.person_id
     WHERE c.book_id = ? ORDER BY c.number`,
    id,
  ).map((r) => ({
    id: r.id, book_id: r.book_id, number: r.number, status: r.status, condition: r.condition, acquired_on: r.acquired_on, notes: r.notes, created_at: r.created_at,
    loan: r.loan_id ? (hidden(r.person_id)
      ? { id: r.loan_id, person_id: null, borrower: null, elsewhere: true, lent_on: r.lent_on, due_on: r.due_on, renewals: r.renewals }
      : { id: r.loan_id, person_id: r.person_id, borrower: r.borrower ?? null, lent_on: r.lent_on, due_on: r.due_on, renewals: r.renewals }) : null,
  })) as CopyDetail[];
  const history = all<{ id: number; number: string; borrower: string | null; person_id?: number | null; elsewhere?: boolean; lent_on: string; due_on: string; returned_on: string | null }>(
    `SELECT l.id, c.number, ${PERSON_NAME} AS borrower, l.person_id, l.lent_on, l.due_on, l.returned_on
     FROM lending_loans l JOIN lending_copies c ON c.id = l.copy_id LEFT JOIN people p ON p.id = l.person_id
     WHERE c.book_id = ? ORDER BY l.lent_on DESC, l.id DESC LIMIT 30`,
    id,
  ).map(({ person_id, ...h }) => (hidden(person_id) ? { ...h, borrower: null, elsewhere: true } : h));
  return { ...book, copies: cs, history };
}

export type BookInput = Partial<Omit<Book, 'id' | 'created_at' | 'updated_at' | 'has_cover'>>;

function normaliseBook(b: BookInput): BookInput {
  const out = { ...b };
  if (out.title !== undefined && !out.title?.trim()) throw new BadRequest('A title is needed.');
  if (out.isbn !== undefined && out.isbn) {
    const isbn = cleanIsbn(out.isbn);
    if (!isbn) throw new BadRequest(`“${out.isbn}” is not an ISBN (10 or 13 digits).`);
    out.isbn = isbn;
  }
  if (out.kind !== undefined && !BOOK_KINDS.includes(out.kind)) throw new BadRequest('Unknown kind.');
  if (out.year != null && (!Number.isInteger(out.year) || out.year < 1000 || out.year > 2200)) throw new BadRequest('The year looks wrong.');
  return out;
}

/** Create a book (with `copies` numbered copies) or update one. */
export function saveBook(id: number | null, input: BookInput, addCopyCount = 0): Book {
  const b = normaliseBook(input);
  return tx(() => {
    const book = id ? books.update(id, b) : books.insert({ kind: 'book', ...b, title: b.title?.trim() });
    if (addCopyCount > 0) addCopies(book.id, addCopyCount);
    return book;
  });
}

/** Add numbered copies (B0001 …) to a book. */
export function addCopies(bookId: number, count: number, numbers?: string[]): Copy[] {
  books.get(bookId);
  if (count < 1 || count > 200) throw new BadRequest('Add between 1 and 200 copies at a time.');
  return tx(() => {
    const out: Copy[] = [];
    for (let i = 0; i < count; i++) {
      const wanted = numbers?.[i]?.trim();
      if (wanted && get('SELECT 1 FROM lending_copies WHERE number = ?', wanted)) throw new Conflict(`Copy number ${wanted} is already used.`);
      out.push(copies.insert({ book_id: bookId, number: wanted || nextNumber('lending_copies', 'B'), status: 'in' }));
    }
    return out;
  });
}

export function updateCopy(id: number, patch: Partial<Pick<Copy, 'number' | 'status' | 'condition' | 'acquired_on' | 'notes'>>): Copy {
  const cur = copies.get(id);
  if (patch.number !== undefined) {
    const n = patch.number.trim();
    if (!n) throw new BadRequest('A copy needs a number.');
    if (get('SELECT 1 FROM lending_copies WHERE number = ? AND id <> ?', n, id)) throw new Conflict(`Copy number ${n} is already used.`);
    patch.number = n;
  }
  if (patch.status && patch.status !== 'in' && openLoanOf(cur.id)) throw new BadRequest('This copy is on loan: take it back first.');
  return copies.update(id, patch);
}

/** A copy that was never lent can be deleted; one with history is withdrawn instead. */
export function removeCopy(id: number) {
  copies.get(id);
  if (get('SELECT 1 FROM lending_loans WHERE copy_id = ?', id)) throw new BadRequest('This copy has been lent before: mark it withdrawn (or lost) instead, so its history stays.');
  copies.remove(id);
}

export function deleteBook(id: number) {
  books.get(id);
  if (get('SELECT 1 FROM lending_loans l JOIN lending_copies c ON c.id = l.copy_id WHERE c.book_id = ? AND l.returned_on IS NULL', id)) {
    throw new BadRequest('A copy of this book is on loan: take it back first.');
  }
  tx(() => {
    run('DELETE FROM assets WHERE key = ?', `book-cover-${id}`);
    books.remove(id);
  });
}

// ---------------------------------------------------------------- lending

const openLoanOf = (copyId: number) => get<Loan>('SELECT * FROM lending_loans WHERE copy_id = ? AND returned_on IS NULL', copyId);

/** What a scanned or typed number is: the copy, its book and whether it is out. */
export function findCopy(scanned: string) {
  const number = copyNumberFrom(scanned);
  const c = get<Copy>('SELECT * FROM lending_copies WHERE number = ?', number);
  if (!c) throw new NotFound(`No copy is numbered ${number}.`);
  const book = books.get(c.book_id);
  const loan = openLoanOf(c.id);
  if (loan && walledPerson()(loan.person_id)) return { copy: c, book, loan: { ...loan, person_id: null, borrower: null, elsewhere: true } };
  const borrower = loan?.person_id ? personLabel(loan.person_id) : null;
  return { copy: c, book, loan: loan ? { ...loan, borrower } : null };
}

const personLabel = (id: number) => get<{ name: string }>(`SELECT ${PERSON_NAME} AS name FROM people p WHERE id = ?`, id)?.name ?? null;

/** Borrowers are people on the member register (names only: a librarian needs no access to members' details). */
export function borrowers(q: string, limit = 20) {
  const like = `%${q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
  return all<{ id: number; name: string; status: string; on_loan: number; overdue: number }>(
    `SELECT p.id, ${PERSON_NAME} AS name, p.status,
       (SELECT COUNT(*) FROM lending_loans l WHERE l.person_id = p.id AND l.returned_on IS NULL) AS on_loan,
       (SELECT COUNT(*) FROM lending_loans l WHERE l.person_id = p.id AND l.returned_on IS NULL AND l.due_on < ?) AS overdue
     FROM people p
     WHERE p.erased_at IS NULL AND (p.first_name LIKE ? ESCAPE '\\' OR p.last_name LIKE ? ESCAPE '\\' OR p.preferred_name LIKE ? ESCAPE '\\' OR p.native_name LIKE ? ESCAPE '\\'
       OR (IFNULL(p.preferred_name, p.first_name) || ' ' || p.last_name) LIKE ? ESCAPE '\\')
     ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE LIMIT ?`,
    localToday(), like, like, like, like, like, limit,
  ).filter((p) => !walledPerson()(p.id));
}

export function lend(input: { copy_id: number; person_id: number; due_on?: string | null; notes?: string | null }, userId: number | null, via: 'desk' | 'self' = 'desk'): Loan {
  const c = copies.get(input.copy_id);
  if (c.status !== 'in') throw new BadRequest(`Copy ${c.number} is marked ${c.status === 'lost' ? 'lost' : 'withdrawn'}.`);
  const p = get<{ erased_at: string | null }>('SELECT erased_at FROM people WHERE id = ?', input.person_id);
  if (!p || p.erased_at) throw new BadRequest('Choose a borrower from the member register.');
  const today = localToday();
  const due = input.due_on || addDays(today, getSettings().lending.loan_days);
  if (due < today) throw new BadRequest('The due date is in the past.');
  return tx(() => {
    if (openLoanOf(c.id)) throw new Conflict(`Copy ${c.number} is already on loan: take it back first.`);
    return loans.insert({ copy_id: c.id, person_id: input.person_id, lent_on: today, due_on: due, notes: input.notes ?? null, lent_by: userId, renewals: 0, via });
  });
}

export function returnLoan(loanId: number): Loan {
  const l = loans.get(loanId);
  if (l.returned_on) throw new BadRequest('This loan was already returned.');
  return loans.update(loanId, { returned_on: localToday(), return_pending_on: null });
}

export function renewLoan(loanId: number, dueOn?: string | null): Loan {
  const l = loans.get(loanId);
  if (l.returned_on) throw new BadRequest('This loan was already returned.');
  // the borrower said it is back (self-service): it is checked in, not renewed (0.19.10)
  if (l.return_pending_on) throw new BadRequest('The borrower said this copy is back: check it in.');
  const rules = getSettings().lending;
  if (l.renewals >= rules.max_renewals) throw new BadRequest(`Renewed ${l.renewals} time(s) already — the most this library allows.`);
  const today = localToday();
  const due = dueOn || addDays(l.due_on > today ? l.due_on : today, rules.loan_days);
  if (due <= l.due_on) throw new BadRequest('A renewal moves the due date later.');
  return loans.update(loanId, { due_on: due, renewals: l.renewals + 1, reminded_on: null, overdue_reminded_on: null });
}

export interface LoanRow {
  /** the borrower is in another congregation than this account's: not named */
  elsewhere?: boolean;
  id: number;
  copy_id: number;
  number: string;
  book_id: number;
  title: string;
  authors: string | null;
  person_id: number | null;
  borrower: string | null;
  has_email: boolean;
  lent_on: string;
  due_on: string;
  returned_on: string | null;
  renewals: number;
  overdue_days: number;
  via: 'desk' | 'self';
  return_pending_on: string | null;
}

/** Loans: open ones (overdue first), or the history; for one borrower or book, or matching a search. */
export function listLoans(q: { status?: 'open' | 'overdue' | 'returned' | 'pending' | 'all'; person_id?: number; book_id?: number; q?: string; limit?: number } = {}): LoanRow[] {
  const today = localToday();
  const where: string[] = [];
  const params: SqlValue[] = [];
  const status = q.status ?? 'open';
  if (status === 'open') where.push('l.returned_on IS NULL');
  if (status === 'pending') where.push('l.returned_on IS NULL AND l.return_pending_on IS NOT NULL');
  if (status === 'overdue') {
    where.push('l.returned_on IS NULL AND l.return_pending_on IS NULL AND l.due_on < ?');
    params.push(today);
  }
  if (status === 'returned') where.push('l.returned_on IS NOT NULL');
  if (q.person_id) {
    where.push('l.person_id = ?');
    params.push(q.person_id);
  }
  if (q.book_id) {
    where.push('c.book_id = ?');
    params.push(q.book_id);
  }
  if (q.q?.trim()) {
    const like = `%${q.q.trim().replace(/[%_]/g, (c) => `\\${c}`)}%`;
    where.push(`(b.title LIKE ? ESCAPE '\\' OR c.number LIKE ? ESCAPE '\\' OR (${PERSON_NAME}) LIKE ? ESCAPE '\\')`);
    params.push(like, like, like);
  }
  const rows = all<Record<string, unknown>>(
    `SELECT l.id, l.copy_id, c.number, c.book_id, b.title, b.authors, l.person_id, ${PERSON_NAME} AS borrower, p.email IS NOT NULL AND p.email <> '' AS has_email,
       l.lent_on, l.due_on, l.returned_on, l.renewals, l.via, l.return_pending_on
     FROM lending_loans l JOIN lending_copies c ON c.id = l.copy_id JOIN lending_books b ON b.id = c.book_id LEFT JOIN people p ON p.id = l.person_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY ${status === 'open' || status === 'overdue' || status === 'pending' ? 'l.return_pending_on IS NULL, l.due_on, l.id' : 'l.lent_on DESC, l.id DESC'} LIMIT ?`,
    ...params, Math.min(q.limit ?? 500, 2000),
  );
  const hidden = walledPerson();
  return rows.map((r) => {
    const due = String(r.due_on);
    const open = r.returned_on == null;
    const overdue = open && !r.return_pending_on && due < today ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400_000) : 0;
    if (hidden(r.person_id)) return { ...r, person_id: null, has_email: false, borrower: null, elsewhere: true, overdue_days: overdue } as unknown as LoanRow;
    return { ...r, has_email: !!r.has_email, borrower: (r.borrower as string | null) ?? null, overdue_days: overdue } as LoanRow;
  });
}

/** The dashboard's numbers. */
export function lendingCounts() {
  const today = localToday();
  return {
    on_loan: get<{ n: number }>('SELECT COUNT(*) n FROM lending_loans WHERE returned_on IS NULL')!.n,
    overdue: get<{ n: number }>('SELECT COUNT(*) n FROM lending_loans WHERE returned_on IS NULL AND return_pending_on IS NULL AND due_on < ?', today)!.n,
    to_check_in: get<{ n: number }>('SELECT COUNT(*) n FROM lending_loans WHERE returned_on IS NULL AND return_pending_on IS NOT NULL')!.n,
    titles: get<{ n: number }>('SELECT COUNT(*) n FROM lending_books')!.n,
  };
}

/** A member's loans, for the member's page and their personal data. */
export const loansOf = (personId: number) => listLoans({ status: 'all', person_id: personId, limit: 200 });
export const openLoanCount = (personId: number) => get<{ n: number }>('SELECT COUNT(*) n FROM lending_loans WHERE person_id = ? AND returned_on IS NULL', personId)!.n;

// ---------------------------------------------------------------- the rules

export type LendingRules = ReturnType<typeof getSettings>['lending'];

export function checkRules(r: Partial<LendingRules>) {
  if (r.loan_days !== undefined && (!Number.isInteger(r.loan_days) || r.loan_days < 1 || r.loan_days > 365)) throw new BadRequest('A loan lasts 1 to 365 days.');
  if (r.max_renewals !== undefined && (!Number.isInteger(r.max_renewals) || r.max_renewals < 0 || r.max_renewals > 20)) throw new BadRequest('Renewals: 0 to 20.');
  if (r.remind_days_before !== undefined && (!Number.isInteger(r.remind_days_before) || r.remind_days_before < 0 || r.remind_days_before > 30)) throw new BadRequest('Remind 0 to 30 days before.');
}
