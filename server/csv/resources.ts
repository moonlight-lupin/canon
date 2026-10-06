// CSV: the lending library's catalogue (one row per title, with how many copies) and the asset register (one row
// per item). Books are matched by id, else ISBN, else the same title and author; items by id, else their number.
import type { Person } from '../../shared/types.ts';
import { all } from '../db.ts';
import { displayName } from '../repo/registers.ts';
import * as L from '../repo/lending.ts';
import * as E from '../repo/equipment.ts';
import { M, fail, type Entity, type Msg, type RowPlan } from './engine.ts';
import {
  PERSON_COLS, col, collect, diff, fmtField, missingRequired, parseDate, parseEnum, parseInt10, parseNumber, parseText, personIndex, readFields, type Field,
} from './common.ts';
import { visiblePeople } from '../lib/walls.ts';

// ---------------------------------------------------------------- the catalogue

const KIND_ALIAS: Record<string, L.BookKind> = { 书: 'book', 書: 'book', 书籍: 'book', 光碟: 'dvd', 影碟: 'dvd', video: 'dvd', 教材: 'curriculum', 课程: 'curriculum', 其他: 'other' };

const BOOK_FIELDS: Field<L.Book>[] = [
  { col: col('title', M('Title', '书名'), M('The title as on the cover.', '封面上的书名。'), { required: true, example: 'Knowing God', aliases: ['book', 'name', '书名', '書名'] }), parse: (s) => parseText(s, 'title', 300), get: (b) => b.title },
  { col: col('subtitle', M('Subtitle', '副标题'), M('Optional.', '可选。')), parse: (s) => parseText(s, 'subtitle', 300), get: (b) => b.subtitle },
  { col: col('authors', M('Author(s)', '作者'), M('Separate several with commas.', '多位作者以逗号分隔。'), { example: 'J. I. Packer', aliases: ['author', '作者'] }), parse: (s) => parseText(s, 'authors', 500), get: (b) => b.authors },
  {
    col: col('isbn', M('ISBN', 'ISBN'), M('10 or 13 digits (hyphens are fine).', '10 或 13 位数字（可带连字号）。'), { example: '9780830816507' }),
    parse: (s) => {
      if (!s.trim()) return null;
      return L.cleanIsbn(s) ?? fail(`"${s}" is not an ISBN (10 or 13 digits).`, `「${s}」不是 ISBN（10 或 13 位数字）。`);
    },
    get: (b) => b.isbn,
  },
  { col: col('publisher', M('Publisher', '出版社'), M('Optional.', '可选。'), { aliases: ['出版社'] }), parse: (s) => parseText(s, 'publisher', 200), get: (b) => b.publisher },
  { col: col('year', M('Year', '年份'), M('Year published.', '出版年份。'), { example: '1973' }), parse: (s) => parseInt10(s, 'year', 1000, 2200), get: (b) => b.year },
  { col: col('kind', M('Kind', '类别'), M('book (default), dvd, curriculum or other.', 'book（书，默认）、dvd（光碟）、curriculum（教材）或 other（其他）。'), { values: [...L.BOOK_KINDS], example: 'book', aliases: ['type'] }), parse: (s) => parseEnum(s, 'kind', L.BOOK_KINDS, KIND_ALIAS), get: (b) => b.kind },
  { col: col('category', M('Category', '分类'), M('Your own grouping, e.g. Doctrine, Children, Missions.', '自定的分类，如教义、儿童、宣教。'), { example: 'Doctrine', aliases: ['subject', '分类'] }), parse: (s) => parseText(s, 'category', 100), get: (b) => b.category },
  { col: col('language', M('Language', '语言'), M('A language code: en, zh, zh-Hant, ms …', '语言代码：en、zh、zh-Hant、ms ……'), { example: 'en', aliases: ['lang'] }), parse: (s) => parseText(s, 'language', 20), get: (b) => b.language },
  { col: col('shelf', M('Shelf', '书架'), M('Where it is kept, e.g. A3.', '存放位置，如 A3。'), { example: 'A3', aliases: ['location', '书架'] }), parse: (s) => parseText(s, 'shelf', 60), get: (b) => b.shelf },
  { col: col('description', M('Description', '简介'), M('Optional.', '可选。')), parse: (s) => parseText(s, 'description', 4000), get: (b) => b.description },
  { col: col('notes', M('Notes', '备注'), M('For the librarian.', '给图书管理员的备注。'), { aliases: ['remarks'] }), parse: (s) => parseText(s, 'notes', 2000), get: (b) => b.notes },
];
const BOOK_ID = col('id', M('Id', '编号'), M('Canon\'s id for the title (from an export). Leave empty for new titles.', 'Canon 的书目编号（来自导出文件）。新书目请留空。'));
const COPIES = col('copies', M('Copies', '册数'), M('How many copies the library has. A new title gets this many numbered copies (default 1); a larger number adds copies; a smaller one changes nothing (withdraw copies in Canon).', '图书馆有几册。新书目会建立这么多有编号的副本（默认 1 册）；数字较大时会增加副本；较小时不会改变（请在 Canon 中注销副本）。'), { example: '2', aliases: ['qty', 'quantity', '册数'] });
const NUMBERS = col('copy_numbers', M('Copy numbers', '副本编号'), M('Shown in exports; ignored when importing.', '导出时显示；导入时会忽略。'));

const copyCount = (bookId: number) => all<{ n: number }>("SELECT COUNT(*) n FROM lending_copies WHERE book_id = ? AND status = 'in'", bookId)[0].n;

export const booksCsv: Entity = {
  key: 'books',
  label: M('Lending library', '图书馆目录'),
  module: 'lending',
  pii: false,
  intro: M(
    'One row per title. A row with an id updates that title; otherwise a title with the same ISBN, or the same title and author, is updated; anything else is added with its copies (numbered B0001 …). Loans are not imported.',
    '每行一个书目。有编号的行会更新该书目；否则 ISBN 相同、或书名与作者都相同的书目会被更新；其余的会新增，并建立副本（编号 B0001 ……）。借阅记录不会导入。',
  ),
  columns: () => [BOOK_ID, ...BOOK_FIELDS.map((f) => f.col), COPIES, NUMBERS],
  example: () => [
    { title: 'Knowing God', authors: 'J. I. Packer', isbn: '9780830816507', year: '1973', kind: 'book', category: 'Doctrine', language: 'en', shelf: 'A3', copies: '2' },
    { title: '天路历程', authors: '班扬', kind: 'book', category: '灵修', language: 'zh', shelf: 'C1', copies: '1' },
    { title: 'The Jesus Storybook Bible (DVD)', kind: 'dvd', category: 'Children', language: 'en', shelf: 'D2' },
  ],
  export: () => L.books.list('', [], 'title COLLATE NOCASE').map((b) => {
    const out: Record<string, unknown> = { id: b.id };
    for (const f of BOOK_FIELDS) out[f.col.key] = fmtField(f, f.get(b));
    out.copies = copyCount(b.id);
    out.copy_numbers = all<{ number: string }>('SELECT number FROM lending_copies WHERE book_id = ? ORDER BY number', b.id).map((c) => c.number).join('; ');
    return out;
  }),
  plan(input, _ctx, present) {
    const cur_ = L.books.list();
    const byId = new Map(cur_.map((b) => [b.id, b]));
    const what: Msg = M('title', '书目');
    return input.map((r): RowPlan => {
      const errors: Msg[] = [];
      let cur: L.Book | undefined;
      if (present.has('id') && r.v.id) {
        cur = byId.get(Number(r.v.id));
        if (!cur) errors.push(M(`No title with id ${r.v.id}. Leave id empty to add one.`, `没有编号为 ${r.v.id} 的书目。新增请把编号留空。`));
      }
      const f = readFields(BOOK_FIELDS, r, present, cur);
      errors.push(...f.errors);
      if (!cur && f.values.isbn) cur = cur_.find((b) => b.isbn === f.values.isbn);
      if (!cur && f.values.title) {
        const t = String(f.values.title).trim().toLowerCase();
        const a = String(f.values.authors ?? '').trim().toLowerCase();
        cur = cur_.find((b) => b.title.trim().toLowerCase() === t && (b.authors ?? '').trim().toLowerCase() === a);
      }
      const copies = present.has('copies') && r.v.copies ? collect(errors, () => parseInt10(r.v.copies, 'copies', 0, 200)) : undefined;
      const label = String(f.values.title ?? cur?.title ?? r.v.title ?? '');
      if (!cur) errors.push(...missingRequired(BOOK_FIELDS, f.values, what));
      if (cur && present.has('title') && !f.values.title) errors.push(M('title cannot be emptied.', '书名不能清空。'));
      if (errors.length) return { row: r.row, label, action: 'error', errors };
      const patch = { ...f.patch };
      if (patch.kind === null) delete patch.kind;
      if (!cur) {
        const n = copies ?? 1;
        return { row: r.row, label, action: 'create', changes: [{ field: 'copies', from: '', to: String(n) }], apply: () => void L.saveBook(null, patch as L.BookInput, n) };
      }
      const changes = diff(f.cur, f.inc);
      const have = copyCount(cur.id);
      const more = copies != null && copies > have ? copies - have : 0;
      if (more) changes.push({ field: 'copies', from: String(have), to: String(copies) });
      const id = cur.id;
      return changes.length
        ? { row: r.row, label, action: 'update', changes, apply: () => void L.saveBook(id, patch as L.BookInput, more) }
        : { row: r.row, label, action: 'unchanged' };
    });
  },
};

// ---------------------------------------------------------------- the asset register

const COND_ALIAS: Record<string, E.Condition> = { 良好: 'good', 好: 'good', 尚可: 'fair', 一般: 'fair', 差: 'poor', 坏: 'broken', 壞: 'broken', 损坏: 'broken' };
const STATUS_ALIAS: Record<string, E.ItemStatus> = { 'in use': 'in_use', 使用中: 'in_use', stored: 'stored', storage: 'stored', 存放: 'stored', 'out of service': 'out_of_service', 停用: 'out_of_service' };

const ITEM_FIELDS: Field<E.Item>[] = [
  { col: col('name', M('Name', '名称'), M('What it is, e.g. Projector.', '物品名称，如投影机。'), { required: true, example: 'Projector', aliases: ['item', '名称', '名稱'] }), parse: (s) => parseText(s, 'name', 200), get: (i) => i.name },
  { col: col('category', M('Category', '类别'), M('e.g. AV, Music, Furniture.', '如影音、乐器、家具。'), { example: 'AV', aliases: ['type', '类别'] }), parse: (s) => parseText(s, 'category', 100), get: (i) => i.category },
  { col: col('make_model', M('Make and model', '品牌型号'), M('Optional.', '可选。'), { example: 'Epson EB-X51', aliases: ['model', 'make', 'brand'] }), parse: (s) => parseText(s, 'make_model', 200), get: (i) => i.make_model },
  { col: col('serial_no', M('Serial number', '序号'), M('Optional.', '可选。'), { aliases: ['serial', 'sn'] }), parse: (s) => parseText(s, 'serial_no', 100), get: (i) => i.serial_no },
  { col: col('location', M('Place', '存放地点'), M('Where it is kept.', '存放的地方。'), { example: 'Sanctuary', aliases: ['place', 'room', '地点'] }), parse: (s) => parseText(s, 'location', 200), get: (i) => i.location },
  { col: col('bought_on', M('Bought on', '购买日期'), M('Date of purchase.', '购买日期。'), { example: '2024-03-02', aliases: ['purchase_date', 'bought'] }), parse: (s) => parseDate(s, 'bought_on'), get: (i) => i.bought_on },
  { col: col('price', M('Price', '价格'), M('What it cost (a number).', '价格（数字）。'), { example: '899', aliases: ['cost', 'value'] }), parse: (s) => parseNumber(s.replace(/[,$\s]|SGD|S\$/gi, ''), 'price', 0, 1e9), get: (i) => i.price },
  { col: col('supplier', M('Supplier', '供应商'), M('Optional.', '可选。'), { aliases: ['vendor', 'shop'] }), parse: (s) => parseText(s, 'supplier', 200), get: (i) => i.supplier },
  { col: col('warranty_until', M('Warranty until', '保修期至'), M('Optional.', '可选。'), { aliases: ['warranty'] }), parse: (s) => parseDate(s, 'warranty_until'), get: (i) => i.warranty_until },
  { col: col('condition', M('Condition', '状况'), M('good (default), fair, poor or broken.', 'good（良好，默认）、fair（尚可）、poor（差）或 broken（损坏）。'), { values: [...E.CONDITIONS], example: 'good' }), parse: (s) => parseEnum(s, 'condition', E.CONDITIONS, COND_ALIAS), get: (i) => i.condition },
  { col: col('status', M('Status', '状态'), M('in_use (default), stored or out_of_service.', 'in_use（使用中，默认）、stored（存放）或 out_of_service（停用）。'), { values: [...E.ITEM_STATUSES], example: 'in_use' }), parse: (s) => parseEnum(s, 'status', E.ITEM_STATUSES, STATUS_ALIAS), get: (i) => i.status },
  { col: col('maintenance_every_months', M('Maintenance every (months)', '保养周期（月）'), M('How often it is serviced.', '多久保养一次。'), { example: '6', aliases: ['every_months', 'service_interval'] }), parse: (s) => parseInt10(s, 'maintenance_every_months', 1, 120), get: (i) => i.maintenance_every_months },
  { col: col('next_maintenance_on', M('Next maintenance', '下次保养'), M('Date the next service is due.', '下次保养日期。'), { aliases: ['next_service'] }), parse: (s) => parseDate(s, 'next_maintenance_on'), get: (i) => i.next_maintenance_on },
  { col: col('notes', M('Notes', '备注'), M('Anything else.', '其他备注。'), { aliases: ['remarks'] }), parse: (s) => parseText(s, 'notes', 4000), get: (i) => i.notes },
];
const ITEM_ID = col('id', M('Id', '编号'), M('Canon\'s id for the item (from an export). Leave empty for new items.', 'Canon 的物品编号（来自导出文件）。新物品请留空。'));
const NUMBER = col('number', M('Number', '资产编号'), M('The number on its label (E0001 …). Empty = the next free number.', '标签上的编号（E0001 ……）。留空则使用下一个编号。'), { example: 'E0001', aliases: ['asset_no', 'tag'] });
const CUSTODIAN: () => ReturnType<typeof PERSON_COLS> = () => PERSON_COLS(false).map((c) => (c.key === 'person'
  ? { ...c, label: M('Looked after by', '负责人'), description: M('Who looks after it, by name as in the member register (optional).', '负责照管的人，填写会友名册中的姓名（可选）。'), example: 'David Tan', aliases: [...(c.aliases ?? []), 'custodian', 'looked_after_by', '负责人'] }
  : c));

export const equipmentCsv: Entity = {
  key: 'equipment',
  label: M('Asset register', '资产登记'),
  module: 'equipment',
  pii: false,
  intro: M(
    'One row per item. A row with an id or an existing number updates that item; anything else is added (an empty number gets the next free one, E0001 …). Who looks after it must be in the member register. Photos, receipts and the maintenance log are not imported.',
    '每行一件物品。有编号或已有资产编号的行会更新该物品；其余的会新增（资产编号留空则使用下一个编号，E0001 ……）。负责人必须已在会友名册中。照片、收据和保养记录不会导入。',
  ),
  columns: () => [ITEM_ID, NUMBER, ...ITEM_FIELDS.map((f) => f.col), ...CUSTODIAN()],
  example: () => [
    { number: 'E0001', name: 'Projector', category: 'AV', make_model: 'Epson EB-X51', location: 'Sanctuary', bought_on: '2024-03-02', price: '899', condition: 'good', maintenance_every_months: '6', person: 'David Tan' },
    { name: '折叠桌', category: '家具', location: '礼堂仓库', condition: 'fair' },
  ],
  export: () => {
    const people = new Map(visiblePeople<Person>().map((p) => [p.id, p]));
    return E.items.list('', [], 'number COLLATE NOCASE').map((i) => {
      const out: Record<string, unknown> = { id: i.id, number: i.number };
      for (const f of ITEM_FIELDS) out[f.col.key] = fmtField(f, f.get(i));
      const p = i.custodian_id ? people.get(i.custodian_id) : undefined;
      out.person_id = p ? p.id : '';
      out.person = p ? displayName(p) : '';
      return out;
    });
  },
  plan(input, _ctx, present) {
    const idx = personIndex();
    const cur_ = E.items.list();
    const byId = new Map(cur_.map((i) => [i.id, i]));
    const what: Msg = M('item', '物品');
    const seen = new Set<string>();
    return input.map((r): RowPlan => {
      const errors: Msg[] = [];
      let cur: E.Item | undefined;
      if (present.has('id') && r.v.id) {
        cur = byId.get(Number(r.v.id));
        if (!cur) errors.push(M(`No item with id ${r.v.id}. Leave id empty to add one.`, `没有编号为 ${r.v.id} 的物品。新增请把编号留空。`));
      }
      const number = (r.v.number ?? '').trim();
      if (!cur && number) cur = cur_.find((i) => i.number.toLowerCase() === number.toLowerCase());
      if (number) {
        if (seen.has(number.toLowerCase())) errors.push(M(`Number ${number} appears twice in the file.`, `资产编号 ${number} 在文件中出现两次。`));
        seen.add(number.toLowerCase());
      }
      const f = readFields(ITEM_FIELDS, r, present, cur);
      errors.push(...f.errors);
      let custodian: number | null | undefined;
      if ((present.has('person') && r.v.person) || (present.has('person_id') && r.v.person_id)) {
        const p = collect(errors, () => idx.resolve(r));
        if (p) custodian = p.id;
      } else if (present.has('person') && cur?.custodian_id) custodian = null;
      const label = [number || cur?.number, f.values.name ?? cur?.name ?? r.v.name].filter(Boolean).join(' · ');
      if (!cur) errors.push(...missingRequired(ITEM_FIELDS, f.values, what));
      if (cur && present.has('name') && !f.values.name) errors.push(M('name cannot be emptied.', '名称不能清空。'));
      if (errors.length) return { row: r.row, label, action: 'error', errors };
      const patch: Record<string, unknown> = { ...f.patch };
      for (const k of ['condition', 'status'] as const) if (patch[k] === null) delete patch[k];
      if (custodian !== undefined) patch.custodian_id = custodian;
      if (!cur) return { row: r.row, label, action: 'create', apply: () => void E.saveItem(null, { ...patch, number: number || undefined } as E.ItemInput) };
      const changes = diff(f.cur, f.inc);
      if (custodian !== undefined && custodian !== cur.custodian_id) changes.push({ field: 'looked after by', from: String(cur.custodian_id ?? ''), to: String(custodian ?? '') });
      const id = cur.id;
      return changes.length
        ? { row: r.row, label, action: 'update', changes, apply: () => void E.saveItem(id, patch as E.ItemInput) }
        : { row: r.row, label, action: 'unchanged' };
    });
  },
};
