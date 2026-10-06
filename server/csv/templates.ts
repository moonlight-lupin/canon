// CSV: service templates (reusable orders of worship), one row per item. Rows with the same template_key
// form one template, items in file order; the whole template is replaced (upserted by key).
import type { ItemKind, L10n, Template, TemplateItem } from '../../shared/types.ts';
import { TemplateInput } from '../../shared/schemas.ts';
import { get } from '../db.ts';
import { parsePartSelection } from '../../shared/parts.ts';
import { KIND_LABEL, templates as tplTable } from '../repo/services.ts';
import { roleByName } from '../repo/volunteers.ts';
import { listBlocks } from '../repo/presentation.ts';
import { M, type Change, type Entity, type InRow, type Msg, type RowPlan } from './engine.ts';
import {
  col, collect, fmtBool, hasText, l10nCols, mergeL10n, parseBool, parseEnum, parseNumber, parseText, parseTime, presentLangs, readL10n,
} from './common.ts';

const POSTURES = ['stand', 'sit', 'kneel'] as const;
const POSTURE_ALIAS: Record<string, (typeof POSTURES)[number]> = {
  'all stand': 'stand', standing: 'stand', 众立: 'stand', 眾立: 'stand', 站: 'stand', 'all sit': 'sit', sitting: 'sit', seated: 'sit', 众坐: 'sit', 眾坐: 'sit', 坐: 'sit',
  kneeling: 'kneel', 跪: 'kneel', 跪下: 'kneel',
};
const PRINT = ['full', 'title'] as const;
const PRINT_ALIAS: Record<string, (typeof PRINT)[number]> = {
  'full text': 'full', words: 'full', 全文: 'full', 'title only': 'title', reference: 'title', 'reference only': 'title', 标题: 'title', 標題: 'title', 仅标题: 'title',
};
/** "PayNow giving; Instagram" → ["PayNow giving", "Instagram"] */
const splitList = (s: string) => s.split(/[;；\n]/).map((x) => x.trim()).filter(Boolean);
/** "1, 2, 4" or "1-4" (or "I.1-3" for a confession) against the song's stanzas / the text's parts, when it exists. */
function readStanzas(cell: string, table: 'songs' | 'texts', key: string): string[] {
  if (!cell.trim()) return [];
  const col = table === 'songs' ? 'stanzas' : 'parts';
  const row = get<{ list: string | null }>(`SELECT ${col} AS list FROM ${table} WHERE key = ?`, key);
  const list = (JSON.parse(row?.list ?? 'null') ?? []) as { label: string }[];
  if (list.length) {
    const picked = parsePartSelection(cell, list.map((x) => x.label));
    if (picked.labels.length) return picked.labels;
  }
  return cell.split(/[,，、;；\s]+/).map((x) => x.trim()).filter(Boolean);
}

const KINDS = ['section', 'song', 'scripture', 'text', 'sermon', 'prayer', 'sacrament', 'offering', 'announcements', 'music', 'other'] as const;
const KIND_ALIAS: Record<string, ItemKind> = {
  hymn: 'song', psalm: 'song', reading: 'scripture', bible: 'scripture', liturgy: 'text', creed: 'text', heading: 'section',
  段落: 'section', 诗歌: 'song', 詩歌: 'song', 圣诗: 'song', 读经: 'scripture', 讀經: 'scripture', 礼文: 'text', 禮文: 'text', 讲道: 'sermon', 講道: 'sermon',
  祷告: 'prayer', 禱告: 'prayer', 圣礼: 'sacrament', 聖禮: 'sacrament', 奉献: 'offering', 奉獻: 'offering', 报告: 'announcements', 報告: 'announcements',
  音乐: 'music', 音樂: 'music', 其他: 'other',
};

const fallbackKey = (t: Template) => t.key ?? `template-${t.id}`;

/** An item as cells (title per language), for export and comparison. */
function itemCells(it: TemplateItem, langs: string[]): Record<string, string> {
  const out: Record<string, string> = {
    kind: it.kind, song_key: it.song_key ?? '', text_key: it.text_key ?? '', stanzas: (it.stanzas ?? []).join(', '), scripture_ref: it.scripture_ref ?? '',
    duration_min: String(it.duration_min ?? 0), role: it.role ?? '', leader: it.leader ?? '',
    in_bulletin: fmtBool(it.in_bulletin), on_slides: fmtBool(it.on_slides), notes: it.notes ?? '',
    posture: it.posture ?? '', bulletin_text: it.bulletin_text ?? '', slide_blocks: (it.slide_blocks ?? []).join('; '),
  };
  for (const l of langs) out[`title_${l}`] = it.title?.[l] ?? '';
  return out;
}

export const templatesCsv: Entity = {
  key: 'templates',
  label: M('Templates', '聚会程序模板'),
  module: 'templates',
  pii: false,
  l10n: ['name', 'title'],
  intro: M(
    'One row per item of the order of worship, in order. Rows with the same template_key make one template; the template\'s name, start time and type may be written on the first row only. Importing replaces that template\'s whole order; a new key adds a template.',
    '每行是聚会程序中的一个项目，依次排列。template_key 相同的行组成一个模板；模板名称、开始时间和类型只需写在第一行。导入会取代该模板的整个程序；新的 key 会新增模板。',
  ),
  columns: (ctx) => [
    col('template_key', M('Template key', '模板代码'), M('A short code that groups the rows of one template, e.g. lords-day.', '把同一模板的各行归在一起的简短代码，如 lords-day。'), { required: true, example: 'lords-day', aliases: ['key', 'template', 'template_code'] }),
    ...l10nCols('name', ctx, M('Template name', '模板名称'), M('Name of the template (first row is enough). A new template needs a name.', '模板名称（写在第一行即可）。新增模板时必填。'), { examples: { en: "Lord's Day Worship", zh: '主日聚会' }, aliases: ['template_name'] }),
    col('start_time', M('Start time', '开始时间'), M('e.g. 10:00 (first row is enough).', '如 10:00（写在第一行即可）。'), { example: '10:00', aliases: ['time', 'start'] }),
    col('service_type', M('Service type', '聚会类型'), M('A short code, e.g. lords_day (default), evening, prayer_meeting.', '简短代码，如 lords_day（默认）、evening、prayer_meeting。'), { example: 'lords_day', aliases: ['type'] }),
    col('kind', M('Item kind', '项目类别'), M('What the item is. Needed on every item row.', '项目的类别。每个项目行都必须填写。'), { values: [...KINDS], example: 'song', aliases: ['item_kind', 'item_type'] }),
    ...l10nCols('title', ctx, M('Item title', '项目标题'), M('Title printed for the item, e.g. Hymn of Praise. Empty = the usual title for its kind.', '项目显示的标题，如「赞美诗」。留空则使用该类别的常用标题。'), { examples: { en: 'Hymn of Praise', zh: '颂赞诗歌' }, aliases: ['item_title'] }),
    col('song_key', M('Song key', '诗歌代码'), M('For a fixed song: the song\'s key in the library (e.g. doxology). Leave empty for a slot filled each week.', '固定的诗歌：资料库中诗歌的 key（如 doxology）。每周填写的诗歌位置请留空。'), { example: 'doxology' }),
    col('text_key', M('Text key', '礼文代码'), M('For a fixed liturgical text: its key (e.g. apostles-creed).', '固定的礼文：礼文的 key（如 apostles-creed）。'), {}),
    col('stanzas', M('Stanzas / questions', '诗节／问题'), M('Only some stanzas of the song, or some questions of a catechism, e.g. 1-4 or 1, 2, 4. Empty = the usual.', '只用诗歌的部分诗节，或要理问答的部分问题，如 1-4 或 1, 2, 4。留空则照常。'), { example: '1-4', aliases: ['parts', 'questions', 'verses'] }),
    col('scripture_ref', M('Scripture', '经文'), M('A fixed reading, e.g. Psalm 100. Usually empty.', '固定的经文，如 Psalm 100。通常留空。'), { aliases: ['scripture', 'reference', 'passage'] }),
    col('duration_min', M('Minutes', '分钟'), M('Planned length in minutes.', '预计时长（分钟）。'), { example: '4', aliases: ['duration', 'minutes', 'mins'] }),
    col('role', M('Role', '负责岗位'), M('Who leads it: an English role name from Volunteers, e.g. Liturgist, Scripture Reader.', '负责的岗位：义工事奉中的英文岗位名称，如 Liturgist、Scripture Reader。'), { example: 'Liturgist' }),
    col('leader', M('Leader', '负责人'), M('A fixed leader by name, when not tied to a role.', '不按岗位时的固定负责人姓名。'), {}),
    col('in_bulletin', M('In bulletin', '印在次序单'), M('no to leave it out of the printed bulletin (default yes).', '填 no 则不印在次序单上（默认 yes）。'), { values: ['yes', 'no'] }),
    col('on_slides', M('On slides', '显示在投影'), M('no to leave it out of the slides.', '填 no 则不显示在投影片上。'), { values: ['yes', 'no'] }),
    col('posture', M('Posture', '姿势'), M('What the congregation does: stand, sit or kneel (众立 / 众坐 also work). Empty = not printed.', '会众的姿势：stand、sit 或 kneel（也可写 众立 / 众坐）。留空则不印。'), { values: [...POSTURES], aliases: ['stand_sit'] }),
    col('bulletin_text', M('Bulletin text', '次序单内容'), M('full = print the words, title = title / reference only. Empty = follow the bulletin template.', 'full = 印全文，title = 只印标题／经文出处。留空则按次序单模板。'), { values: [...PRINT], aliases: ['print', 'bulletin_print'] }),
    col('slide_blocks', M('QR codes on slides', '投影二维码'), M('Names of QR codes / notes from Library → QR codes & notes, separated by ";" — shown on a slide after this item.', '资料库「二维码与备注」中的名称，用「;」分隔 —— 在此项目之后的投影片显示。'), { example: 'PayNow giving; Instagram', aliases: ['qr', 'qr_codes', 'blocks'] }),
    col('notes', M('Notes', '备注'), M('Notes for the planner, e.g. Choose a hymn on the sermon theme.', '给策划者的备注，如「按讲道主题选诗」。'), {}),
  ],
  example: () => [
    { template_key: 'evening-prayer', name_en: 'Evening Prayer', name_zh: '晚间祷告会', start_time: '20:00', service_type: 'prayer_meeting', kind: 'section', title_en: 'Gathering', title_zh: '聚集', duration_min: '0', on_slides: 'no' },
    { template_key: 'evening-prayer', kind: 'song', title_en: 'Opening Hymn', title_zh: '开会诗', duration_min: '4', role: 'Liturgist', notes: 'Choose each week' },
    { template_key: 'evening-prayer', kind: 'scripture', title_en: 'Scripture Reading', title_zh: '读经', duration_min: '3', role: 'Scripture Reader' },
    { template_key: 'evening-prayer', kind: 'prayer', title_en: 'Prayers of the Church', title_zh: '代祷', duration_min: '25', role: 'Prayer Leader' },
    { template_key: 'evening-prayer', kind: 'song', title_en: 'Doxology', title_zh: '三一颂', song_key: 'doxology', duration_min: '1', role: 'Liturgist' },
  ],
  export(ctx) {
    const out: Record<string, unknown>[] = [];
    for (const t of tplTable.list('', [], 'id')) {
      const head: Record<string, unknown> = { template_key: fallbackKey(t), start_time: t.start_time, service_type: t.service_type };
      for (const l of ctx.langs) head[`name_${l}`] = t.name[l] ?? '';
      if (!t.items.length) out.push(head);
      t.items.forEach((it, i) => out.push({ ...(i === 0 ? head : { template_key: fallbackKey(t) }), ...itemCells(it, ctx.langs) }));
    }
    return out;
  },
  plan(input, ctx, present) {
    const all_ = tplTable.list('', [], 'id');
    const nameLangs = presentLangs('name', ctx, present);
    const titleLangs = presentLangs('title', ctx, present);
    const groups = new Map<string, InRow[]>();
    const plans: RowPlan[] = [];
    for (const r of input) {
      const k = (r.v.template_key ?? '').trim();
      if (!k) {
        plans.push({ row: r.row, label: '—', action: 'error', errors: [M('template_key is empty — every row needs the key of its template.', 'template_key 是空的 —— 每一行都要写所属模板的代码。')] });
        continue;
      }
      const list = groups.get(k.toLowerCase()) ?? [];
      list.push(r);
      groups.set(k.toLowerCase(), list);
    }
    const itemCols = ['kind', 'song_key', 'text_key', 'stanzas', 'scripture_ref', 'duration_min', 'role', 'leader', 'in_bulletin', 'on_slides', 'notes', 'posture', 'bulletin_text', 'slide_blocks'];
    const blockNames = new Set(listBlocks().map((b) => b.name.trim().toLowerCase()));

    for (const rows of groups.values()) {
      const key = rows[0].v.template_key.trim();
      const cur = all_.find((t) => t.key?.toLowerCase() === key.toLowerCase()) ?? all_.find((t) => !t.key && fallbackKey(t) === key);
      const errors: Msg[] = [];
      const warnings: Msg[] = [];
      const at = (row: number, m: Msg) => M(`Row ${row}: ${m.en}`, `第 ${row} 行：${m.zh}`);
      // template-level values: first non-empty wins; a different value later is a mistake
      const name: L10n = {};
      let startTime: string | null = null;
      let serviceType: string | null = null;
      const items: TemplateItem[] = [];
      for (const r of rows) {
        const n = readL10n(r, 'name', nameLangs);
        for (const l of nameLangs) {
          if (!n[l]) continue;
          if (name[l] && name[l] !== n[l]) errors.push(at(r.row, M(`a different template name than an earlier row ("${name[l]}").`, `模板名称与前面的行不同（「${name[l]}」）。`)));
          else name[l] = n[l];
        }
        if (present.has('start_time') && r.v.start_time) {
          const t = collect(errors, () => parseTime(r.v.start_time, 'start_time'));
          if (t && startTime && t !== startTime) errors.push(at(r.row, M(`a different start time than an earlier row (${startTime}).`, `开始时间与前面的行不同（${startTime}）。`)));
          else if (t) startTime = t;
        }
        if (present.has('service_type') && r.v.service_type) {
          const t = r.v.service_type.trim().slice(0, 50);
          if (serviceType && t !== serviceType) errors.push(at(r.row, M(`a different service type than an earlier row (${serviceType}).`, `聚会类型与前面的行不同（${serviceType}）。`)));
          else serviceType = t;
        }
        // item part of the row
        const title = readL10n(r, 'title', titleLangs);
        const isItem = itemCols.some((c) => c !== 'duration_min' && r.v[c]) || hasText(title);
        if (!isItem) continue;
        const rowErr: Msg[] = [];
        const kind = collect(rowErr, () => parseEnum(r.v.kind ?? '', 'kind', KINDS, KIND_ALIAS));
        if (kind === null) rowErr.push(M('kind is empty — every item needs a kind (song, scripture, prayer …).', 'kind（项目类别）是空的 —— 每个项目都要写类别（song、scripture、prayer …）。'));
        const dur = collect(rowErr, () => parseNumber(r.v.duration_min ?? '', 'duration_min', 0, 240));
        const inB = collect(rowErr, () => parseBool(r.v.in_bulletin ?? '', 'in_bulletin'));
        const onS = collect(rowErr, () => parseBool(r.v.on_slides ?? '', 'on_slides'));
        const posture = collect(rowErr, () => parseEnum(r.v.posture ?? '', 'posture', POSTURES, POSTURE_ALIAS));
        const printChoice = collect(rowErr, () => parseEnum(r.v.bulletin_text ?? '', 'bulletin_text', PRINT, PRINT_ALIAS));
        const text = (c: string, max = 2000) => collect(rowErr, () => parseText(r.v[c] ?? '', c, max)) ?? undefined;
        errors.push(...rowErr.map((m) => at(r.row, m)));
        if (!kind) continue;
        const it: TemplateItem = { kind, title: hasText(title) ? mergeL10n({}, title) : { ...KIND_LABEL[kind] }, duration_min: dur ?? 0 };
        const song = text('song_key', 100);
        const txt = text('text_key', 100);
        const ref = text('scripture_ref', 200);
        const role = text('role', 100);
        const leader = text('leader', 200);
        const notes = text('notes');
        if (song) {
          it.song_key = song;
          if (!get('SELECT 1 FROM songs WHERE key = ?', song)) warnings.push(at(r.row, M(`no song has the key "${song}" yet — the slot will be empty until it exists.`, `目前没有 key 为「${song}」的诗歌 —— 在加入之前此位置会是空的。`)));
        }
        if (txt) {
          it.text_key = txt;
          if (!get('SELECT 1 FROM texts WHERE key = ?', txt)) warnings.push(at(r.row, M(`no text has the key "${txt}" yet.`, `目前没有 key 为「${txt}」的礼文。`)));
        }
        if (ref) it.scripture_ref = ref;
        const stanzas = song || txt ? readStanzas(r.v.stanzas ?? '', song ? 'songs' : 'texts', (song ?? txt)!) : [];
        if (stanzas.length) it.stanzas = stanzas;
        if (role) {
          it.role = role;
          if (!roleByName(role)) warnings.push(at(r.row, M(`no volunteer role is called "${role}"; nobody will be linked to this item.`, `没有名为「${role}」的岗位；此项目不会连到任何人。`)));
        }
        if (leader) it.leader = leader;
        if (notes) it.notes = notes;
        if (inB !== null && inB !== undefined) it.in_bulletin = inB;
        if (onS !== null && onS !== undefined) it.on_slides = onS;
        if (posture) it.posture = posture;
        if (printChoice) it.bulletin_text = printChoice;
        const blocks = splitList(r.v.slide_blocks ?? '');
        if (blocks.length) {
          it.slide_blocks = blocks;
          for (const b of blocks) {
            if (!blockNames.has(b.toLowerCase())) warnings.push(at(r.row, M(`no QR code or note is called "${b}" (Library → QR codes & notes); it will be skipped until one exists.`, `「二维码与备注」中没有名为「${b}」的项目；在建立之前会被略过。`)));
          }
        }
        // keep what the CSV does not carry (pasted text, titles in languages without a column) when the item
        // at this position is the same kind
        const old = cur?.items[items.length];
        if (old && old.kind === it.kind) for (const l of Object.keys(old.title ?? {})) if (!titleLangs.includes(l) && old.title[l]) it.title[l] = old.title[l];
        if (old?.body && old.kind === it.kind) it.body = old.body;
        if (!present.has('leader') && old?.leader && old.kind === it.kind) it.leader = old.leader;
        // columns missing from the file keep their current values
        if (!present.has('posture') && old?.posture && old.kind === it.kind) it.posture = old.posture;
        if (!present.has('bulletin_text') && old?.bulletin_text && old.kind === it.kind) it.bulletin_text = old.bulletin_text;
        if (!present.has('slide_blocks') && old?.slide_blocks?.length && old.kind === it.kind) it.slide_blocks = old.slide_blocks;
        if (!present.has('stanzas') && old?.stanzas?.length && old.kind === it.kind && (it.song_key || it.text_key)) it.stanzas = old.stanzas;
        items.push(it);
      }

      const first = rows[0].row;
      const last = rows[rows.length - 1].row;
      const fullName = cur ? mergeL10n(cur.name, Object.fromEntries(nameLangs.map((l) => [l, name[l] ?? cur.name[l] ?? '']))) : mergeL10n({}, name);
      const label = `${Object.values(fullName).filter(Boolean).join(' · ') || key} (${items.length} ${items.length === 1 ? 'item' : 'items'})`;
      if (!cur && !hasText(name)) errors.push(M(`The template "${key}" has no name — write it in a name_ column on its first row.`, `模板「${key}」没有名称 —— 请在第一行的 name_ 栏位填写。`));
      const data = {
        key: cur?.key ?? key, name: fullName, items,
        start_time: startTime ?? cur?.start_time ?? '10:00', service_type: serviceType ?? cur?.service_type ?? 'lords_day',
      };
      if (!errors.length) {
        const check = TemplateInput.safeParse(data);
        if (!check.success) errors.push(...check.error.issues.map((i) => M(`${i.path.join('.')}: ${i.message}`, `${i.path.join('.')}：${i.message}`)));
      }
      const base = { row: first, to_row: last, label, warnings };
      if (errors.length) {
        plans.push({ ...base, action: 'error', errors });
        continue;
      }
      if (!cur) {
        plans.push({ ...base, action: 'create', changes: [{ field: 'items', from: '', to: String(items.length) }], apply: () => void tplTable.insert({ description: {}, ...data }) });
        continue;
      }
      const changes: Change[] = [];
      for (const l of nameLangs) if ((cur.name[l] ?? '') !== (fullName[l] ?? '')) changes.push({ field: `name_${l}`, from: cur.name[l] ?? '', to: fullName[l] ?? '' });
      if (data.start_time !== cur.start_time) changes.push({ field: 'start_time', from: cur.start_time, to: data.start_time });
      if (data.service_type !== cur.service_type) changes.push({ field: 'service_type', from: cur.service_type, to: data.service_type });
      if (!cur.key) changes.push({ field: 'template_key', from: '', to: key });
      if (cur.items.length !== items.length) changes.push({ field: 'items', from: String(cur.items.length), to: String(items.length) });
      const langs = [...new Set([...ctx.langs, ...titleLangs])];
      for (let i = 0; i < Math.max(cur.items.length, items.length) && changes.length < 30; i++) {
        const a = cur.items[i] ? itemCells(cur.items[i], langs) : {};
        const b = items[i] ? itemCells(items[i], langs) : {};
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
          if ((a[k] ?? '') !== (b[k] ?? '') && (k !== 'leader' || present.has('leader'))) changes.push({ field: `item ${i + 1} ${k}`, from: a[k] ?? '', to: b[k] ?? '' });
        }
        if (JSON.stringify(cur.items[i]?.body ?? null) !== JSON.stringify(items[i]?.body ?? null)) changes.push({ field: `item ${i + 1} text`, from: cur.items[i]?.body ? '…' : '', to: items[i]?.body ? '…' : '' });
      }
      if (!changes.length) {
        plans.push({ ...base, action: 'unchanged' });
        continue;
      }
      const id = cur.id;
      plans.push({ ...base, action: 'update', changes, apply: () => void tplTable.update(id, data) });
    }
    return plans.sort((a, b) => a.row - b.row);
  },
};
