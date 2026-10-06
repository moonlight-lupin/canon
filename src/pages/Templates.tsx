import { useEffect, useMemo, useState } from 'react';
import { hasAnyText } from '../../shared/labels.ts';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { both, useContentLangs, useI18n } from '../i18n.tsx';
import { Bi, Field, L10nInput, Loading, Modal, PageHead, confirmAction, useAction, useSession } from '../components/ui.tsx';
import { CongregationBadge, CongregationField, useCongregations } from '../components/Congregations.tsx';
import { Combo } from '../components/Combo.tsx';
import { Icon } from '../components/icons.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { CsvTools } from '../components/CsvTools.tsx';
import { KIND_ICON, KIND_LABEL } from './service/common.ts';
import { PostureField } from './service/ItemEditor.tsx';
import type { ItemKind, LiturgyText, Song, TeamWithRoles, Template, TemplateItem } from '../types-client.ts';
import type { BulletinBlock } from '../../shared/presentation.ts';
import { SlideBlocksPicker } from './Blocks.tsx';
import { BulletinTemplateField, SlideThemeField } from './presentation-pickers.tsx';
import { CardMenu, type CardAction } from './template-ui.tsx';
import { parsePartSelection, partRuns } from '../../shared/parts.ts';

/** A template item's stanzas or catechism questions, typed as a range ("1-4", "1, 3", "Q5-7"); empty = the usual. */
function PartsField({ label, hint, labels, value, onChange }: { label: string; hint: string; labels: string[]; value: string[] | undefined; onChange: (v: string[] | undefined) => void }) {
  const current = partRuns(value ?? [], labels).join(', ');
  const [range, setRange] = useState(current);
  useEffect(() => setRange(current), [current]);
  const apply = () => {
    if (!range.trim()) return onChange(undefined);
    const picked = parsePartSelection(range, labels).labels;
    if (picked.length) onChange(picked);
    else setRange(current);
  };
  return (
    <Field label={label} hint={hint}>
      <input value={range} style={{ width: 72 }} onChange={(e) => setRange(e.target.value)} onBlur={apply} onKeyDown={(e) => e.key === 'Enter' && apply()} />
    </Field>
  );
}

const KINDS = Object.keys(KIND_LABEL) as ItemKind[];

export default function Templates() {
  const { t, lt } = useI18n();
  const { canEdit, isAdmin, settings, reloadSettings } = useSession();
  const { data, reload } = useApi<Template[]>('/templates');
  const congs = useCongregations();
  const { run } = useAction();
  const defaultId = data?.find((x) => x.id === settings?.default_service_template_id)?.id ?? data?.find((x) => !x.hidden)?.id ?? null;
  const makeDefault = (tid: number) => run(async () => {
    await api.put('/templates-default', { template_id: tid });
    reloadSettings();
  }, t('This is now the church default.'));
  const [edit, setEdit] = useState<Partial<Template> | null>(null);
  const setHidden = (tp: Template, hidden: boolean) => run(async () => {
    await api.put(`/templates/${tp.id}/hidden`, { hidden });
    reload();
  }, hidden ? t('Archived. Find it under Archived templates.') : t('Restored.'));
  const remove = (tp: Template) => {
    if (!confirmAction(t('Delete this archived template for good? Services made from it keep their order of service.'))) return;
    run(async () => {
      await api.del(`/templates/${tp.id}`);
      reload();
    }, t('Deleted.'));
  };
  // the "⋯" menu, as on the slide and bulletin template pages
  const menuFor = (tp: Template): CardAction[] => {
    const isDefault = tp.id === defaultId;
    const out: CardAction[] = [];
    if (isAdmin && !isDefault && !tp.hidden) out.push({ label: t('Set as church default'), onClick: () => makeDefault(tp.id), title: t('New service starts from this template.') });
    if (canEdit) {
      out.push(tp.hidden
        ? { label: t('Restore'), onClick: () => setHidden(tp, false) }
        : { label: t('Archive'), onClick: () => setHidden(tp, true), disabled: isDefault, title: isDefault ? t('The church default cannot be archived.') : t('Move it to Archived templates, out of the template lists. Services already using it keep it.') });
    }
    // deleting: administrators, archived templates only, never Canon's built-in ones
    if (isAdmin && tp.hidden && !tp.builtin) out.push({ label: t('Delete'), onClick: () => remove(tp), danger: true });
    return out;
  };
  const shown = (data ?? []).filter((x) => !x.hidden);
  const archived = (data ?? []).filter((x) => x.hidden);
  const card = (tp: Template) => (
    <div key={tp.id} className={`card${tp.hidden ? ' muted-card' : ''}`}>
      <div className="card-head">
        <h2><Bi v={tp.name} /></h2>
        <span className="row" style={{ gap: 6 }}>
          {tp.id === defaultId && <span className="badge reed" title={t('New service starts from this template.')}><Icon name="check" width={12} height={12} />{t('Church default')}</span>}
          {tp.ref && <span className="badge lapis ref-badge" title={t('Reference')}>{tp.ref}</span>}
          {tp.builtin && <span className="badge" title={t('One of Canon’s own templates: it can be archived, not deleted.')}>{t('Built-in')}</span>}
          {tp.hidden && <span className="badge">{t('Archived')}</span>}
          <CongregationBadge id={tp.congregation_id} list={congs} />
          <span className="badge">{tp.start_time}</span>
        </span>
      </div>
      <p className="muted small">{lt(tp.description)}</p>
      <div className="small" style={{ columns: 2, columnGap: 16, margin: '10px 0' }}>
        {tp.items.map((it, i) => (
          <div key={i} style={{ breakInside: 'avoid', fontWeight: it.kind === 'section' ? 600 : 400, color: it.kind === 'section' ? 'var(--reed-ink)' : undefined, marginTop: it.kind === 'section' && i ? 6 : 0 }}>
            {lt(it.title)}
          </div>
        ))}
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="small muted">{tp.items.length} · {tp.items.reduce((a, i) => a + i.duration_min, 0)} {t('min')}</span>
        <div className="grow" />
        {canEdit && <button className="btn sm" onClick={() => setEdit(tp)}><Icon name="edit" />{t('Edit')}</button>}
        {canEdit && !tp.hidden && <Link className="btn sm primary" to={`/services?new&template=${tp.id}`}>{t('Use template')}</Link>}
        {menuFor(tp).length > 0 && <CardMenu label={t('More actions')} actions={menuFor(tp)} />}
      </div>
    </div>
  );
  return (
    <div className="page">
      <PageHead eyebrow={t('Planner')} title={t('Service templates')} sub={lt({ en: 'Reusable orders of worship. Hymn slots are left empty to fill each week.', zh: '可重复使用的聚会程序。诗歌位置留空，每周填写。' })}>
        <CsvTools entity="templates" label={t('Templates')} onImported={reload} />
        {canEdit && <button className="btn primary" onClick={() => setEdit({ name: {}, description: {}, service_type: 'lords_day', start_time: '10:00', items: [] })}><Icon name="plus" />{t('New template')}</button>}
      </PageHead>
      {!data ? <Loading /> : (
        <>
          <div className="grid cols-2">{shown.map(card)}</div>
          {archived.length > 0 && (
            <details className="tp-archived">
              <summary>{t('Archived templates')} <span className="badge">{archived.length}</span> <InfoTip text={t('Archived templates are left out of the lists in the service planner; services already made from one keep their order of service. Restore one to use it again; administrators can delete archived templates (not Canon’s built-in ones).')} /></summary>
              <div className="grid cols-2" style={{ marginTop: 10 }}>{archived.map(card)}</div>
            </details>
          )}
        </>
      )}
      {edit && <TemplateEditor tpl={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </div>
  );
}

function TemplateEditor({ tpl, onClose, onSaved }: { tpl: Partial<Template>; onClose: () => void; onSaved: () => void }) {
  const { t, lt } = useI18n();
  const { run, busy } = useAction();
  const [x, setX] = useState(tpl);
  const { data: songs } = useApi<Song[]>('/songs');
  const { data: texts } = useApi<LiturgyText[]>('/texts');
  const { data: teams } = useApi<TeamWithRoles[]>('/teams');
  const { data: blocks } = useApi<BulletinBlock[]>('/bulletin-blocks');
  const langs = useContentLangs();
  const roleNames = useMemo(() => (teams ?? []).flatMap((tm) => tm.roles.map((r) => r.name)), [teams]);
  const items = x.items ?? [];
  const setItems = (its: TemplateItem[]) => setX((o) => ({ ...o, items: its }));
  const setItem = (i: number, p: Partial<TemplateItem>) => setItems(items.map((it, j) => (j === i ? { ...it, ...p } : it)));
  const move = (i: number, d: number) => {
    const a = [...items];
    const [m] = a.splice(i, 1);
    a.splice(i + d, 0, m);
    setItems(a);
  };
  const save = async () => {
    const { id, builtin: _b, hidden: _h, ...body } = x;
    const r = id ? await run(() => api.patch(`/templates/${id}`, body), t('Saved.')) : await run(() => api.post('/templates', body), t('Saved.'));
    if (r) onSaved();
  };
  return (
    <Modal title={x.id ? lt(x.name) : t('New template')} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !hasAnyText(x.name)} onClick={save}>{t('Save')}</button>
      </>
    }>
      <div className="stack">
        <Field label={t('Template name')}><L10nInput value={x.name} onChange={(v) => setX({ ...x, name: v })} /></Field>
        <div className="form-grid">
          <Field label={<>{t('Reference')} <InfoTip text={t('Your own short code for it, e.g. EN-001 or CN-10pmService: letters, digits and - _ . without spaces. People and AI assistants can then name it, e.g. “create Sunday’s service from template CN-10pmService”.')} /></>}>
            <input value={x.ref ?? ''} maxLength={40} placeholder="EN-001" onChange={(e) => setX({ ...x, ref: e.target.value.replace(/\s+/g, '') || null })} style={{ maxWidth: 220 }} />
          </Field>
          <SlideThemeField label={t('Slide template')} value={x.slide_theme_id ?? null} onChange={(v) => setX({ ...x, slide_theme_id: v })} />
          <BulletinTemplateField value={x.bulletin_template_id ?? null} hint={t('New services from this template start with these; each service can still choose others.')} onChange={(v) => setX({ ...x, bulletin_template_id: v })} />
        </div>
        <Field label={t('Description')}><L10nInput value={x.description} onChange={(v) => setX({ ...x, description: v })} /></Field>
        <div className="form-grid">
          <Field label={t('Start time')}><input type="time" value={x.start_time} onChange={(e) => setX({ ...x, start_time: e.target.value })} /></Field>
          <Field label="Type"><input value={x.service_type ?? ''} onChange={(e) => setX({ ...x, service_type: e.target.value })} /></Field>
          <CongregationField value={x.congregation_id} onChange={(v) => setX({ ...x, congregation_id: v })} hint={t('Services made from this template belong to this congregation.')} />
        </div>
        <h3>{t('Items')}</h3>
        {items.map((it, i) => (
          <div key={i} className="card" style={{ padding: 10, background: it.kind === 'section' ? 'var(--reed-wash)' : undefined }}>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <Icon name={KIND_ICON[it.kind]} width={16} height={16} style={{ marginBottom: 9, color: 'var(--reed-ink)' }} />
              <Field label={t('Item')}>
                <select value={it.kind} onChange={(e) => setItem(i, { kind: e.target.value as ItemKind })} style={{ width: 150 }}>
                  {KINDS.map((k) => <option key={k} value={k}>{lt(KIND_LABEL[k])}</option>)}
                </select>
              </Field>
              {it.kind === 'song' && (
                <Field label={t('Hymn')} className="grow">
                  <Combo value={it.song_key ?? ''} noneLabel={`— (${lt({ en: 'fill each week', zh: '每周填写' })})`} ariaLabel={t('Hymn')}
                    options={(songs ?? []).filter((s) => s.key).map((s) => ({
                      value: s.key!, label: both(s.title), hint: s.hymnals?.map((h) => `${h.abbr} ${h.number}`).join(', ') || undefined,
                      search: [...Object.values(s.title ?? {}), ...(s.hymnals ?? []).map((h) => `${h.abbr} ${h.number} ${h.number}`)].join(' '),
                      keys: (s.hymnals ?? []).flatMap((h) => [`${h.abbr} ${h.number}`, h.number]),
                    }))}
                    onChange={(v) => setItem(i, { song_key: v || undefined, stanzas: undefined })} />
                </Field>
              )}
              {it.kind === 'song' && (() => {
                const labels = (songs ?? []).find((s) => s.key && s.key === it.song_key)?.stanzas.map((s) => s.label) ?? [];
                return labels.length > 1 && <PartsField label={t('Stanzas')} hint={t('Empty = all')} labels={labels} value={it.stanzas} onChange={(v) => setItem(i, { stanzas: v })} />;
              })()}
              {it.kind === 'text' && (
                <Field label={t('Liturgy')} className="grow">
                  <Combo value={it.text_key ?? ''} noneLabel="—" ariaLabel={t('Liturgy')}
                    options={(texts ?? []).filter((s) => s.key).map((s) => ({ value: s.key!, label: both(s.title), group: s.category.replace(/_/g, ' '), search: Object.values(s.title ?? {}).join(' ') }))}
                    onChange={(v) => setItem(i, { text_key: v || undefined, stanzas: undefined })} />
                </Field>
              )}
              {it.kind === 'text' && (() => {
                const text = (texts ?? []).find((s) => s.key && s.key === it.text_key);
                const labels = (text?.parts ?? []).map((x) => x.label);
                const catechism = text?.category === 'catechism';
                return labels.length > 0 && <PartsField label={catechism ? t('Questions') : t('Parts')} hint={catechism ? '1-4' : 'I.1-3'} labels={labels} value={it.stanzas} onChange={(v) => setItem(i, { stanzas: v })} />;
              })()}
              {it.kind === 'scripture' && (
                <Field label={t('Reference')} className="grow"><input value={it.scripture_ref ?? ''} onChange={(e) => setItem(i, { scripture_ref: e.target.value || undefined })} /></Field>
              )}
              {!['song', 'text', 'scripture'].includes(it.kind) && <div className="grow" />}
              {it.kind !== 'section' && (
                <>
                  <Field label={t('min')}><input type="number" min={0} style={{ width: 64 }} value={it.duration_min} onChange={(e) => setItem(i, { duration_min: Number(e.target.value) || 0 })} /></Field>
                  <Field label={t('Role')}>
                    <select value={it.role ?? ''} onChange={(e) => setItem(i, { role: e.target.value || undefined })} style={{ width: 150 }}>
                      <option value="">—</option>
                      {roleNames.map((r) => <option key={r.en} value={r.en}>{lt(r)}</option>)}
                    </select>
                  </Field>
                  <PostureField value={it.posture ?? null} langs={langs} onChange={(p) => setItem(i, { posture: p ?? undefined })} />
                </>
              )}
              <div className="row" style={{ gap: 2, marginBottom: 2 }}>
                <button className="btn sm ghost icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up"><Icon name="chevronDown" style={{ transform: 'rotate(180deg)' }} /></button>
                <button className="btn sm ghost icon" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Down"><Icon name="chevronDown" /></button>
                <button className="btn sm ghost icon danger" onClick={() => setItems(items.filter((_, j) => j !== i))} aria-label={t('Delete')}><Icon name="trash" /></button>
              </div>
            </div>
            <div style={{ marginTop: 6 }}><L10nInput value={it.title} onChange={(v) => setItem(i, { title: v })} /></div>
            {it.kind !== 'section' && (
              <div className="row" style={{ marginTop: 6, gap: 8, alignItems: 'center' }}>
                <span className="small muted nowrap">{t('QR codes & notes on slides')}</span>
                {/* stored by block name, matched when a service is made from the template */}
                <SlideBlocksPicker value={it.slide_blocks ?? []} blocks={blocks} keyOf={(b) => b.name} newTab onChange={(v) => setItem(i, { slide_blocks: v.length ? v : undefined })} />
              </div>
            )}
          </div>
        ))}
        <div className="row">
          <button className="btn" onClick={() => setItems([...items, { kind: 'other', title: { en: 'Item', zh: '项目' }, duration_min: 3 }])}><Icon name="plus" />{t('Add item')}</button>
          <button className="btn" onClick={() => setItems([...items, { kind: 'section', title: { en: 'Section', zh: '段落' }, duration_min: 0 }])}><Icon name="section" />{t('Section')}</button>
        </div>
      </div>
    </Modal>
  );
}
