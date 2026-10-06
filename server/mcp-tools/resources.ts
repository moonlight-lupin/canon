// MCP tools for the lending library and the asset register (0.15, optional modules "lending" and "equipment").
// Agents read the catalogue, loans and the register, and may add books and copies (e.g. from a list of ISBNs) or
// record equipment and its maintenance; lending and returning stay with people at the desk.
import { z } from 'zod';
import * as L from '../repo/lending.ts';
import * as E from '../repo/equipment.ts';
import { lookupIsbn } from '../lib/isbn.ts';
import { Id, DateStr, RO, WRITE, type ToolDef } from './common.ts';

const BookFields = z.object({
  title: z.string().min(1).max(300).optional(),
  subtitle: z.string().max(300).nullable().optional(),
  authors: z.string().max(500).nullable().optional(),
  isbn: z.string().max(20).nullable().optional(),
  publisher: z.string().max(200).nullable().optional(),
  year: z.number().int().nullable().optional(),
  kind: z.enum(['book', 'dvd', 'curriculum', 'other']).optional(),
  category: z.string().max(100).nullable().optional(),
  language: z.string().max(20).nullable().optional(),
  shelf: z.string().max(60).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const ItemFields = z.object({
  number: z.string().max(30).optional(),
  name: z.string().min(1).max(200).optional(),
  category: z.string().max(100).nullable().optional(),
  make_model: z.string().max(200).nullable().optional(),
  serial_no: z.string().max(100).nullable().optional(),
  location: z.string().max(200).nullable().optional(),
  custodian_id: Id.nullable().optional(),
  bought_on: DateStr.nullable().optional(),
  price: z.number().min(0).nullable().optional(),
  supplier: z.string().max(200).nullable().optional(),
  warranty_until: DateStr.nullable().optional(),
  condition: z.enum(['good', 'fair', 'poor', 'broken']).optional(),
  status: z.enum(['in_use', 'stored', 'out_of_service']).optional(),
  maintenance_every_months: z.number().int().min(1).max(120).nullable().optional(),
  next_maintenance_on: DateStr.nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
});

const bookLine = (b: L.BookSummary) => ({
  id: b.id, title: b.title, authors: b.authors ?? undefined, isbn: b.isbn ?? undefined, kind: b.kind, category: b.category ?? undefined,
  language: b.language ?? undefined, shelf: b.shelf ?? undefined, copies: b.copies, available: b.available, on_loan: b.on_loan,
});

export const RESOURCE_TOOLS: ToolDef[] = [
  {
    name: 'canon_lending', module: 'lending', access: 'read', title: 'Lending library', annotations: RO,
    description: 'The church\'s lending library (books, DVDs, curricula lent to members). Without id: the catalogue — search q (title, author, ISBN or copy number), kind, category, available=true for titles with a copy in now; each with copies, available and on_loan. With id: one title with its copies (number, status, current loan: borrower and due date) and recent loans. loans "open" | "overdue" | "returned" lists loans instead (copy number, title, borrower name, lent / due / returned dates, overdue_days), optionally for one person_id. isbn looks a book up online (Open Library, Google Books) before adding it. Example: {"loans":"overdue"}.',
    input: {
      id: Id.optional(), q: z.string().max(200).optional(), kind: z.enum(['book', 'dvd', 'curriculum', 'other']).optional(), category: z.string().max(100).optional(),
      available: z.boolean().optional(), loans: z.enum(['open', 'overdue', 'returned']).optional(), person_id: Id.optional(), isbn: z.string().max(20).optional(),
    },
    handler: async (a) => {
      if (a.isbn) return { found: await lookupIsbn(a.isbn) };
      if (a.loans) return L.listLoans({ status: a.loans, person_id: a.person_id, q: a.q, limit: 300 });
      if (a.id) return L.getBook(a.id);
      return L.listBooks({ q: a.q, kind: a.kind, category: a.category, available: a.available }).slice(0, 300).map(bookLine);
    },
  },
  {
    name: 'canon_save_book', module: 'lending', access: 'write', title: 'Save a library book', annotations: { ...WRITE, idempotentHint: false },
    description: 'Add a title to the lending library (no id; fields.title required; add_copies numbered copies are created, default 1) or update one (id; only the given fields change; add_copies adds more). ISBNs are checked (10 or 13 digits). Check first with canon_lending {q} that the title isn\'t already there (then add copies to it instead). Lending and returning are done in Canon by the librarian, not here. Returns the title with its copies. Example: {"fields":{"title":"Knowing God","authors":"J. I. Packer","isbn":"9780830816507","category":"Doctrine","shelf":"A3"},"add_copies":2}.',
    input: { id: Id.optional(), fields: BookFields.default({}), add_copies: z.number().int().min(0).max(50).optional() },
    handler: (a) => {
      const book = L.saveBook(a.id ?? null, a.fields as L.BookInput, a.add_copies ?? (a.id ? 0 : 1));
      return L.getBook(book.id);
    },
  },
  {
    name: 'canon_equipment', module: 'equipment', access: 'read', title: 'Asset register', annotations: RO,
    description: 'The church\'s equipment and property. Without id / number: the register — search q (name, number, serial number, place, who looks after it), category, location, status ("in_use" | "stored" | "out_of_service"), due=true for maintenance due within 14 days or overdue; each with number, place, who looks after it, condition, price and next maintenance. With id or number (e.g. "E0012"): one item with its maintenance log and the names of its photos and receipts. Example: {"due":true}.',
    input: {
      id: Id.optional(), number: z.string().max(30).optional(), q: z.string().max(200).optional(), category: z.string().max(100).optional(),
      location: z.string().max(200).optional(), status: z.enum(['in_use', 'stored', 'out_of_service']).optional(), due: z.boolean().optional(),
    },
    handler: (a) => {
      if (a.id) return E.getItem(a.id);
      if (a.number) return E.findItem(a.number);
      return E.listItems({ q: a.q, category: a.category, location: a.location, status: a.status, due: a.due }).slice(0, 300)
        .map(({ photo_id: _p, created_at: _c, updated_at: _u, ...r }) => r);
    },
  },
  {
    name: 'canon_save_equipment', module: 'equipment', access: 'write', title: 'Save an asset', annotations: { ...WRITE, idempotentHint: false },
    description: 'Add an item to the asset register (no id; fields.name required; an empty number gets the next free one, E0001 …) or update one (id; only the given fields change). custodian_id is the member who looks after it. maintenance records work done {done_on?, what, cost?, done_by?}; with maintenance_every_months set, the next maintenance date moves on by that many months. Photos and receipts are added in Canon. Returns the item with its maintenance log. Example: {"id":4,"maintenance":{"done_on":"2026-10-05","what":"Lamp replaced","cost":180,"done_by":"AV Supplies Pte Ltd"}}.',
    input: {
      id: Id.optional(), fields: ItemFields.default({}),
      maintenance: z.object({ done_on: DateStr.optional(), what: z.string().min(1).max(500), cost: z.number().min(0).nullable().optional(), done_by: z.string().max(200).nullable().optional(), notes: z.string().max(2000).nullable().optional() }).optional(),
    },
    handler: (a) => {
      const hasFields = Object.keys(a.fields ?? {}).length > 0;
      const item = !a.id || hasFields ? E.saveItem(a.id ?? null, a.fields as E.ItemInput) : E.items.get(a.id);
      if (a.maintenance) E.addMaintenance(item.id, a.maintenance);
      return E.getItem(item.id);
    },
  },
];
