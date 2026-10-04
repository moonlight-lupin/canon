import { useMemo, useState } from 'react';
import { hasAnyText } from '../../shared/labels.ts';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { both, useContentLangs, useI18n } from '../i18n.tsx';
import { Bi, Field, L10nInput, Loading, Modal, PageHead, confirmAction, useAction, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { CsvTools } from '../components/CsvTools.tsx';
import { KIND_ICON, KIND_LABEL, PostureField } from './ServiceEditor.tsx';
import type { ItemKind, LiturgyText, Song, TeamWithRoles, Template, TemplateItem } from '../types-client.ts';
import type { BulletinBlock } from '../../shared/presentation.ts';
import { SlideBlocksPicker } from './Blocks.tsx';

const KINDS = Object.keys(KIND_LABEL) as ItemKind[];

export default function Templates() {
  const { t, lt } = useI18n();
  const { canEdit, isAdmin, settings, reloadSettings } = useSession();
  const { data, reload } = useApi<Template[]>('/templates');
  const { run } = useAction();
  const defaultId = data?.find((x) => x.id === settings?.default_service_template_id)?.id ?? data?.[0]?.id ?? null;
  const makeDefault = (tid: number) => run(async () => {
    await api.put('/templates-default', { template_id: tid });
    reloadSettings();
  }, t('This is now the church default.'));
  const [edit, setEdit] = useState<Partial<Template> | null>(null);
  return (
    <div className="page">
      <PageHead eyebrow={t('Service Planner')} title={t('Service templates')} sub={lt({ en: 'Reusable orders of worship. Hymn slots are left empty to fill each week.', zh: '可重复使用的聚会程序。诗歌位置留空，每周填写。' })}>
        <CsvTools entity="templates" label={t('Templates')} onImported={reload} />
        {canEdit && <button className="btn primary" onClick={() => setEdit({ name: {}, description: {}, service_type: 'lords_day', start_time: '10:00', items: [] })}><Icon name="plus" />{t('New template')}</button>}
      </PageHead>
      {!data ? <Loading /> : (
        <div className="grid cols-2">
          {data.map((tp) => (
            <div key={tp.id} className="card">
              <div className="card-head">
                <h2><Bi v={tp.name} /></h2>
                <span className="row" style={{ gap: 6 }}>
                  {tp.id === defaultId && <span className="badge reed" title={t('New service starts from this template.')}><Icon name="check" width={12} height={12} />{t('Church default')}</span>}
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
              <div className="row">
                <span className="small muted">{tp.items.length} · {tp.items.reduce((a, i) => a + i.duration_min, 0)} {t('min')}</span>
                <div className="grow" />
                {isAdmin && tp.id !== defaultId && <button className="btn sm ghost" onClick={() => makeDefault(tp.id)} title={t('New service starts from this template.')}><Icon name="check" />{t('Set as church default')}</button>}
                {canEdit && <button className="btn sm" onClick={() => setEdit(tp)}><Icon name="edit" />{t('Edit')}</button>}
                {canEdit && <Link className="btn sm primary" to={`/services?new&template=${tp.id}`}>{t('Use template')}</Link>}
              </div>
            </div>
          ))}
        </div>
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
    const { id, ...body } = x;
    const r = id ? await run(() => api.patch(`/templates/${id}`, body), t('Saved.')) : await run(() => api.post('/templates', body), t('Saved.'));
    if (r) onSaved();
  };
  return (
    <Modal title={x.id ? lt(x.name) : t('New template')} onClose={onClose} size="lg" footer={
      <>
        {x.id && <button className="btn danger left" onClick={async () => { if (confirmAction(t('Are you sure?')) && await run(() => api.del(`/templates/${x.id}`))) onSaved(); }}><Icon name="trash" />{t('Delete')}</button>}
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !hasAnyText(x.name)} onClick={save}>{t('Save')}</button>
      </>
    }>
      <div className="stack">
        <Field label={t('Name')}><L10nInput value={x.name} onChange={(v) => setX({ ...x, name: v })} /></Field>
        <Field label={t('Description')}><L10nInput value={x.description} onChange={(v) => setX({ ...x, description: v })} /></Field>
        <div className="form-grid">
          <Field label={t('Start time')}><input type="time" value={x.start_time} onChange={(e) => setX({ ...x, start_time: e.target.value })} /></Field>
          <Field label="Type"><input value={x.service_type ?? ''} onChange={(e) => setX({ ...x, service_type: e.target.value })} /></Field>
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
                  <select value={it.song_key ?? ''} onChange={(e) => setItem(i, { song_key: e.target.value || undefined })}>
                    <option value="">— ({lt({ en: 'fill each week', zh: '每周填写' })})</option>
                    {(songs ?? []).filter((s) => s.key).map((s) => <option key={s.id} value={s.key!}>{both(s.title)}</option>)}
                  </select>
                </Field>
              )}
              {it.kind === 'text' && (
                <Field label={t('Liturgy')} className="grow">
                  <select value={it.text_key ?? ''} onChange={(e) => setItem(i, { text_key: e.target.value || undefined })}>
                    <option value="">—</option>
                    {(texts ?? []).filter((s) => s.key).map((s) => <option key={s.id} value={s.key!}>{both(s.title)}</option>)}
                  </select>
                </Field>
              )}
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
