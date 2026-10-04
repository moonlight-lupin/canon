// Bulletin templates → "Page layout": the ordered list of sections the bulletin prints, reordered by drag (or the
// up / down buttons), each with "Starts a new page", "Keep together", "On the back cover" and its own settings;
// plus the live sample: real pages of a sample service, drawn by the bulletin renderer as the layout changes.
import { useMemo, useState, type ReactNode } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApi } from '../api.ts';
import { useContentLangs, useI18n } from '../i18n.tsx';
import { L10nInput, Seg, useSession } from '../components/ui.tsx';
import { Icon, type IconName } from '../components/icons.tsx';
import { BulletinPages, PAPERS } from '../outputs/Bulletin.tsx';
import {
  ANNOUNCEMENTS_KEY, SECTION_TYPES, bulletinDecision, newSection, normaliseLayout,
  type BulletinBlock, type BulletinOptions, type BulletinSection, type BulletinSectionType,
} from '../../shared/presentation.ts';
import { sampleLangs, sampleService } from './presentation-sample.ts';
import { BLOCK_KIND_LABEL } from './Blocks.tsx';
import type { L10n, RenderedService, TeamWithRoles } from '../types-client.ts';
import './bulletin-layout-editor.css';

export const SECTION_ICON: Record<BulletinSectionType, IconName> = {
  cover: 'book', order: 'list', full_texts: 'scroll', announcements: 'megaphone', weekly_text: 'edit', fixed_text: 'text',
  serving_this_week: 'users', serving_next_week: 'calendar', note: 'alert', blocks: 'qr', sermon_notes: 'file',
  ccli_contact: 'shield', service_notes: 'mail', page_break: 'section',
};
export const SECTION_LABEL: Record<BulletinSectionType, string> = {
  cover: 'Cover page or banner',
  order: 'Order of service',
  full_texts: 'Full words (creeds, catechism, hymns)',
  announcements: 'Announcements',
  weekly_text: 'Weekly text',
  fixed_text: 'Fixed text',
  serving_this_week: 'Serving today',
  serving_next_week: 'Serving next week',
  note: 'Note (bold, centred)',
  blocks: 'QR codes, pictures and notes',
  sermon_notes: 'Sermon notes page',
  ccli_contact: 'Copyright notices and church contact',
  service_notes: 'Service notes (the Notes box)',
  page_break: 'Page break',
};
const SECTION_HINT: Partial<Record<BulletinSectionType, string>> = {
  cover: 'The cover style and the banner colours are set under Paper and layout.',
  order: 'List or table, hymn numbers and posture: see Order of service below.',
  full_texts: 'Creeds, catechism and hymns marked “All the words” are gathered here, each under its title. Without this section they print under each item.',
  announcements: 'Typed each week in the service’s Bulletin tab. Numbered lines print as a list.',
  weekly_text: 'Typed each week in the service’s Bulletin tab, e.g. a pastor’s note or prayer requests.',
  fixed_text: 'The same every week, e.g. a welcome, the church’s vision or giving details.',
  serving_this_week: 'One column per role. Leave empty to list everyone serving today.',
  serving_next_week: 'The roster of the next service, one column per role.',
  sermon_notes: 'A ruled page for notes.',
  service_notes: 'Prints the Notes box of each service.',
};

/** Weekly-text presets offered in the "Add section" menu. */
const WEEKLY_PRESETS: { key: string; heading: L10n }[] = [
  { key: 'pastor_note', heading: { en: "Pastor's note", zh: '牧者的话' } },
  { key: 'prayer', heading: { en: 'Prayer requests', zh: '代祷事项' } },
];
const FIXED_PRESETS: { heading: L10n; text: L10n }[] = [
  { heading: { en: 'Welcome', zh: '欢迎' }, text: { en: 'A warm welcome to everyone worshipping with us today.', zh: '欢迎各位今天与我们一同敬拜。' } },
];

/** "Weekly text: Pastor's note" — a section's name in plain words. */
export function sectionName(s: BulletinSection, t: (x: string) => string, lt: (v: L10n | undefined) => string): string {
  const base = t(SECTION_LABEL[s.type]);
  const head = lt(s.heading);
  if ((s.type === 'weekly_text' || s.type === 'fixed_text') && head) return `${base}: ${head}`;
  if ((s.type === 'announcements' || s.type === 'service_notes') && head && head !== base) return `${base}: ${head}`;
  return base;
}

/** An ordered list of chosen names (roles or blocks) with a picker to add more. */
export function OrderedPicker<T extends string | number>({ value, options, onChange, placeholder }: {
  value: T[]; options: { value: T; label: ReactNode }[]; onChange: (v: T[]) => void; placeholder: string;
}) {
  const label = (v: T) => options.find((o) => o.value === v)?.label ?? String(v);
  const rest = options.filter((o) => !value.includes(o.value));
  const move = (i: number, d: number) => {
    const a = [...value];
    const [m] = a.splice(i, 1);
    a.splice(i + d, 0, m);
    onChange(a);
  };
  return (
    <div className="pr-chips">
      {value.map((v, i) => (
        <span key={String(v)} className="pr-chip">
          {i > 0 && <button type="button" className="pr-chip-x" aria-label="←" onClick={() => move(i, -1)}>‹</button>}
          {label(v)}
          <button type="button" className="pr-chip-x" aria-label="×" onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
        </span>
      ))}
      {rest.length > 0 && value.length < 12 && (
        <select value="" onChange={(e) => { const o = rest.find((x) => String(x.value) === e.target.value); if (o) onChange([...value, o.value]); }}>
          <option value="">{placeholder}</option>
          {rest.map((o) => <option key={String(o.value)} value={String(o.value)}>{typeof o.label === 'string' ? o.label : String(o.value)}</option>)}
        </select>
      )}
    </div>
  );
}

// ================================================================= page layout panel

export function PageLayoutEditor({ layout, onChange, readOnly }: { layout: BulletinSection[]; onChange: (l: BulletinSection[]) => void; readOnly: boolean }) {
  const { t, lt } = useI18n();
  const { data: teams } = useApi<TeamWithRoles[]>('/teams');
  const { data: blocks } = useApi<BulletinBlock[]>('/bulletin-blocks');
  const main = layout.filter((s) => !s.last_page);
  const back = layout.filter((s) => s.last_page);
  // roles are stored by their English name (any language works when matching)
  const roles = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const tm of teams ?? []) for (const r of tm.roles) {
      const key = r.name.en?.trim() || Object.values(r.name).find((v) => v?.trim()) || '';
      if (key && !out.some((x) => x.value === key)) out.push({ value: key, label: lt(r.name) });
    }
    for (const s of layout) for (const k of s.roles ?? []) if (!out.some((x) => x.value === k)) out.push({ value: k, label: k });
    return out;
  }, [teams, lt, layout]);
  const blockOpts = (blocks ?? []).map((b) => ({ value: b.id, label: `${b.name} (${t(BLOCK_KIND_LABEL[b.kind])})` }));

  const commit = (next: BulletinSection[]) => onChange([...next.filter((s) => !s.last_page), ...next.filter((s) => s.last_page)]);
  const patch = (id: string, p: Partial<BulletinSection>) => commit(layout.map((s) => (s.id === id ? { ...s, ...p } : s)));
  const remove = (id: string) => commit(layout.filter((s) => s.id !== id));
  const move = (id: string, d: number) => {
    const group = layout.find((s) => s.id === id)?.last_page ? back : main;
    const i = group.findIndex((s) => s.id === id);
    const j = i + d;
    if (j < 0 || j >= group.length) return;
    const moved = arrayMove(group, i, j);
    commit(group === back ? [...main, ...moved] : [...moved, ...back]);
  };
  const toBack = (id: string, on: boolean) => {
    const s = layout.find((x) => x.id === id);
    if (!s) return;
    const rest = layout.filter((x) => x.id !== id);
    const m = rest.filter((x) => !x.last_page);
    const b = rest.filter((x) => x.last_page);
    // joining the back cover puts the section at its top; leaving it puts it at the end of the pages before
    commit(on ? [...m, { ...s, last_page: true }, ...b] : [...m, { ...s, last_page: undefined }, ...b]);
  };
  const add = (s: BulletinSection) => commit([...main, s, ...back]);
  const has = (type: BulletinSectionType) => layout.some((s) => s.type === type);
  const single: BulletinSectionType[] = ['cover', 'order', 'full_texts', 'announcements', 'ccli_contact', 'service_notes'];

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = layout.findIndex((s) => s.id === e.active.id);
    const to = layout.findIndex((s) => s.id === e.over!.id);
    if (from < 0 || to < 0) return;
    // dropped among the back-cover sections, a section joins the back cover (and leaves it the other way)
    const next = arrayMove(layout, from, to).map((s) => (s.id === e.active.id ? { ...s, last_page: layout[to].last_page || undefined } : s));
    commit(next);
  };

  const card = (s: BulletinSection, i: number, group: BulletinSection[]) => (
    <SectionCard
      key={s.id}
      s={s}
      first={i === 0}
      last={i === group.length - 1}
      readOnly={readOnly}
      roles={roles}
      blockOpts={blockOpts}
      onPatch={(p) => patch(s.id, p)}
      onMove={(d) => move(s.id, d)}
      onRemove={() => remove(s.id)}
      onBack={(on) => toBack(s.id, on)}
    />
  );

  return (
    <div className="bll">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={layout.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="bll-list">
            {main.map((s, i) => card(s, i, main))}
            {!main.length && <div className="bll-empty">{t('Nothing yet — add a section below.')}</div>}
            <div className="bll-group">
              <Icon name="book" width={14} height={14} />
              <span>{t('Back cover (last page)')}</span>
            </div>
            <div className="field-hint bll-group-hint">{t('Always printed on the last page. A folded booklet adds its blank pages before it.')}</div>
            {back.map((s, i) => card(s, i, back))}
            {!back.length && <div className="bll-empty">{t('No back cover: the last section ends the bulletin.')}</div>}
          </div>
        </SortableContext>
      </DndContext>
      {!readOnly && (
        <div className="row bll-add">
          <select
            value=""
            aria-label={t('Add section')}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const [type, preset] = v.split(':') as [BulletinSectionType, string | undefined];
              if (type === 'weekly_text' && preset) {
                const p = WEEKLY_PRESETS[Number(preset)];
                const key = layout.some((s) => s.key === p.key) ? `${p.key}_${Math.random().toString(36).slice(2, 5)}` : p.key;
                add(newSection('weekly_text', { key, heading: { ...p.heading } }));
              } else if (type === 'fixed_text' && preset) {
                const p = FIXED_PRESETS[Number(preset)];
                add(newSection('fixed_text', { heading: { ...p.heading }, text: { ...p.text } }));
              } else add(newSection(type));
            }}
          >
            <option value="">{t('Add section')} ▾</option>
            {SECTION_TYPES.filter((x) => x !== 'page_break').map((type) => {
              if (type === 'weekly_text') {
                return [
                  ...WEEKLY_PRESETS.map((p, i) => <option key={`w${i}`} value={`weekly_text:${i}`}>{t('Weekly text')}: {lt(p.heading)}</option>),
                  <option key="w" value="weekly_text">{t('Weekly text')} ({t('blank')})</option>,
                ];
              }
              if (type === 'fixed_text') {
                return [
                  ...FIXED_PRESETS.map((p, i) => <option key={`f${i}`} value={`fixed_text:${i}`}>{t('Fixed text')}: {lt(p.heading)}</option>),
                  <option key="f" value="fixed_text">{t('Fixed text')} ({t('blank')})</option>,
                ];
              }
              return <option key={type} value={type} disabled={single.includes(type) && has(type)}>{t(SECTION_LABEL[type])}</option>;
            })}
          </select>
          <button type="button" className="btn sm" onClick={() => add(newSection('page_break'))}><Icon name="section" />{t('Add page break')}</button>
        </div>
      )}
    </div>
  );
}

function SectionCard({ s, first, last, readOnly, roles, blockOpts, onPatch, onMove, onRemove, onBack }: {
  s: BulletinSection; first: boolean; last: boolean; readOnly: boolean;
  roles: { value: string; label: string }[]; blockOpts: { value: number; label: string }[];
  onPatch: (p: Partial<BulletinSection>) => void; onMove: (d: number) => void; onRemove: () => void; onBack: (on: boolean) => void;
}) {
  const { t, lt } = useI18n();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id, disabled: readOnly });
  const style = { transform: CSS.Transform.toString(transform), transition };
  const hint = SECTION_HINT[s.type];
  const brk = s.type === 'page_break';
  const head = (
    <div className="bll-head">
      {!readOnly && <span className="grip" {...attributes} {...listeners} aria-label={t('Drag to move')} title={t('Drag to move')}><Icon name="grip" width={16} height={16} /></span>}
      <span className="bll-icon"><Icon name={SECTION_ICON[s.type]} width={15} height={15} /></span>
      <span className="bll-name">{sectionName(s, t, lt)}</span>
      {!readOnly && (
        <span className="bll-tools">
          <button type="button" className="btn ghost sm icon" disabled={first} onClick={() => onMove(-1)} aria-label={t('Move up')} title={t('Move up')}>↑</button>
          <button type="button" className="btn ghost sm icon" disabled={last} onClick={() => onMove(1)} aria-label={t('Move down')} title={t('Move down')}>↓</button>
          <button type="button" className="btn ghost sm icon danger" onClick={onRemove} aria-label={t('Remove')} title={t('Remove')}><Icon name="x" width={14} height={14} /></button>
        </span>
      )}
    </div>
  );
  if (brk) {
    return (
      <div ref={setNodeRef} style={style} className={`bll-card brk${isDragging ? ' dragging' : ''}`} data-section={s.type}>
        {head}
      </div>
    );
  }
  return (
    <div ref={setNodeRef} style={style} className={`bll-card${isDragging ? ' dragging' : ''}`} data-section={s.type}>
      {head}
      <fieldset disabled={readOnly} className="bll-body">
        <div className="bll-toggles">
          <label className="check"><input type="checkbox" checked={!!s.new_page} onChange={(e) => onPatch({ new_page: e.target.checked || undefined })} />{t('Starts a new page')}</label>
          <label className="check"><input type="checkbox" checked={!!s.keep_together} onChange={(e) => onPatch({ keep_together: e.target.checked || undefined })} />{t('Keep together')}</label>
          <label className="check"><input type="checkbox" checked={!!s.last_page} onChange={(e) => onBack(e.target.checked)} />{t('On the back cover')}</label>
        </div>
        {hint && <div className="field-hint">{t(hint)}</div>}
        {(s.type === 'announcements' || s.type === 'weekly_text' || s.type === 'fixed_text' || s.type === 'service_notes') && (
          <label className="bll-field">
            <span>{t('Heading')}</span>
            <L10nInput
              value={s.heading}
              onChange={(v) => onPatch({ heading: v })}
              placeholder={s.type === 'announcements' || s.type === 'service_notes' ? { en: 'Announcements', zh: '报告事项' } : s.type === 'weekly_text' ? { en: "Pastor's note", zh: '牧者的话' } : { en: 'Welcome', zh: '欢迎' }}
            />
          </label>
        )}
        {s.type === 'announcements' && (
          <label className="check"><input type="checkbox" checked={!!s.service_notes} onChange={(e) => onPatch({ service_notes: e.target.checked || undefined })} />{t('Also print the service’s Notes box')}</label>
        )}
        {s.type === 'fixed_text' && (
          <label className="bll-field">
            <span>{t('Text')}</span>
            <L10nInput multiline rows={3} value={s.text} onChange={(v) => onPatch({ text: v })} />
          </label>
        )}
        {s.type === 'note' && (
          <label className="bll-field">
            <span>{t('Text')}</span>
            <L10nInput value={s.text} onChange={(v) => onPatch({ text: v })} placeholder={{ en: 'Please stay for the prayer meeting!', zh: '敬请留下参加祷告会！' }} />
          </label>
        )}
        {(s.type === 'serving_this_week' || s.type === 'serving_next_week') && (
          <OrderedPicker value={s.roles ?? []} options={roles} onChange={(v) => onPatch({ roles: v })} placeholder={t('Add a role…')} />
        )}
        {s.type === 'blocks' && (
          <>
            <OrderedPicker value={s.blocks ?? []} options={blockOpts} onChange={(v) => onPatch({ blocks: v })} placeholder={t('Add a block…')} />
            <span className="field-hint">{t('Make them in Library → QR codes & notes.')}</span>
          </>
        )}
        {s.type === 'sermon_notes' && (
          <label className="check"><input type="checkbox" checked={!!s.spare_only} onChange={(e) => onPatch({ spare_only: e.target.checked || undefined })} />{t('Only on a spare page of a folded booklet')}</label>
        )}
        {s.type === 'ccli_contact' && (
          <div className="bll-toggles">
            <label className="check"><input type="checkbox" checked={s.ccli !== false} onChange={(e) => onPatch({ ccli: e.target.checked })} />{t('Copyright and CCLI notices')}</label>
            <label className="check"><input type="checkbox" checked={s.contact !== false} onChange={(e) => onPatch({ contact: e.target.checked })} />{t('Church address and contact')}</label>
          </div>
        )}
      </fieldset>
    </div>
  );
}

// ================================================================= live sample

/** Sample words for the weekly sections (fictional), so the preview shows where they print. */
function sampleContent(layout: BulletinSection[]): Record<string, L10n> {
  const out: Record<string, L10n> = {
    [ANNOUNCEMENTS_KEY]: {
      en: '1. Prayer meeting after the service in the hall.\n2. Bible study on Wednesday at 8pm.\n3. Welcome to our visitors — please fill in a welcome card.',
      zh: '1. 崇拜后在礼堂有祷告会。\n2. 周三晚上8点查经。\n3. 欢迎新朋友，请填写新朋友卡。',
      'zh-Hant': '1. 崇拜後在禮堂有禱告會。\n2. 週三晚上8點查經。\n3. 歡迎新朋友，請填寫新朋友卡。',
    },
  };
  for (const s of layout) {
    if (s.type !== 'weekly_text' || !s.key || out[s.key]) continue;
    out[s.key] = {
      en: 'The words for this week are typed in each service’s Bulletin tab.\nThey print here, under the heading.',
      zh: '本周的内容在每次崇拜的「程序单」分页输入。\n会印在这里的标题下面。',
      'zh-Hant': '本週的內容在每次崇拜的「程序單」分頁輸入。\n會印在這裡的標題下面。',
    };
  }
  return out;
}

/** Every page of a sample service, laid out by the real bulletin renderer (page boundaries and numbers shown). */
export function BulletinSample({ options: o }: { options: BulletinOptions }) {
  const { t } = useI18n();
  const { settings } = useSession();
  const church = useContentLangs();
  const all = useMemo(() => sampleLangs(church), [church]);
  const [size, setSize] = useState<'small' | 'large'>('small');
  const layout = useMemo(() => normaliseLayout(o.page_layout), [o.page_layout]);
  const needBlocks = layout.some((s) => s.type === 'blocks' && s.blocks?.length);
  const { data: blockList } = useApi<BulletinBlock[]>(needBlocks ? '/bulletin-blocks' : null);
  const langs = useMemo(() => (o.languages === 'primary' ? all.slice(0, 1) : all), [o.languages, all]);
  const r = useMemo<RenderedService>(() => {
    const base = sampleService(all, settings?.church_name ?? { en: 'Our Church' }, settings?.season_colours !== false);
    return { ...base, bulletin: { ...base.bulletin, content: sampleContent(layout) } };
  }, [all, settings, layout]);
  const options = useMemo(() => ({ ...o, page_layout: layout }), [o, layout]);
  const spec = PAPERS[o.paper] ?? PAPERS['a4-booklet'];
  const twoLangLayout = langs.length > 1 ? o.layout : 'stacked';
  const cover = o.cover === 'banner' ? 'banner' : o.cover === 'default' ? 'plain' : o.cover;
  const decide = useMemo(() => (it: RenderedService['items'][number]) => bulletinDecision(it.kind, it.bulletin_text, o), [o]);
  const show = useMemo(() => ({ leaders: o.show_leaders, times: o.show_times, posture: o.show_posture }), [o.show_leaders, o.show_times, o.show_posture]);
  // small: two A5 pages side by side in the panel; large: one page across
  const pagePx = (spec.page[0] * 96) / 25.4;
  const scale = (size === 'small' ? 168 : 360) / pagePx;
  return (
    <div className="bll-sample">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="field-hint">{t('A sample service, page by page.')}</span>
        <Seg<'small' | 'large'> value={size} onChange={setSize} options={[{ value: 'small', label: t('Small') }, { value: 'large', label: t('Large') }]} />
      </div>
      <BulletinPages
        key={`${o.paper}-${o.font_pt}`}
        r={r}
        spec={spec}
        langs={langs}
        layout={twoLangLayout}
        cover={cover}
        pt={o.font_pt ?? spec.font}
        decide={decide}
        show={show}
        options={options}
        blocks={blockList ?? []}
        variant="sample"
        scale={scale}
      />
    </div>
  );
}
