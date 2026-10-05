// Library → Liturgy texts, with their parts.
import { useMemo, useState } from 'react';
import { hasAnyText } from '../../../shared/labels.ts';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Bi, Field, L10nInput, Loading, Modal, SearchBox, confirmAction, useAction, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { CsvTools } from '../../components/CsvTools.tsx';
import type { LiturgyText, TextCategory, TextPart } from '../../types-client.ts';
import { LangBadges, langsIn, STANDARD_KEYS, TEXT_CAT_LABEL, TEXT_CATS } from './common.tsx';

export function Texts() {
  const { t, lt } = useI18n();
  const { canEdit, isAdmin } = useSession();
  const { run, busy } = useAction();
  const { data, reload } = useApi<LiturgyText[]>('/texts');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<LiturgyText> | null>(null);
  const ql = q.trim().toLowerCase();
  const grouped = useMemo(() => {
    const rows = (data ?? []).filter((x) => !ql || JSON.stringify([x.title, x.body, x.tags, x.source]).toLowerCase().includes(ql));
    return TEXT_CATS.map((c) => [c, rows.filter((x) => x.category === c)] as const).filter(([, xs]) => xs.length);
  }, [data, ql]);
  const missingStandards = !!data && STANDARD_KEYS.some((k) => !data.some((x) => x.key === k));
  const importStandards = async () => {
    const r = await run(() => api.post<{ key: string; parts: number; action: string }[]>('/library/import-standards', {}));
    if (r) {
      reload();
      run(async () => r, `${t('Imported')}: ${r.map((x) => `${x.key.toUpperCase()} (${x.parts})`).join(', ')}`);
    }
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="grow" style={{ maxWidth: 360 }}><SearchBox value={q} onChange={setQ} /></div>
        <div className="grow" />
        <CsvTools entity="texts" label={t('Liturgical texts')} onImported={reload} />
        {canEdit && <button className="btn primary" onClick={() => setEdit({ category: 'prayer', title: {}, body: {}, tags: [], public_domain: false, parts: null })}><Icon name="plus" />{t('New text')}</button>}
      </div>
      {missingStandards && isAdmin && (
        <div className="callout row" style={{ marginBottom: 12 }}>
          <div className="grow small">
            <strong>{t('Westminster Standards')}</strong> — {t('the Shorter Catechism (107 questions), Larger Catechism (196) and Confession of Faith (33 chapters), public domain, English. Use any questions or sections in a service.')}
          </div>
          <button className="btn sm primary" disabled={busy} onClick={importStandards}><Icon name="download" />{t('Import Westminster Standards')}</button>
        </div>
      )}
      {!data ? <Loading /> : (
        <div className="stack">
          {grouped.map(([cat, xs]) => (
            <div key={cat}>
              <div className="eyebrow" style={{ margin: '6px 0 6px' }}>{lt(TEXT_CAT_LABEL[cat])}</div>
              <div className="grid cols-3" style={{ gap: 8 }}>
                {xs.map((x) => (
                  <button key={x.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: '12px 14px' }} onClick={() => setEdit(x)}>
                    <div className="row between" style={{ flexWrap: 'nowrap' }}>
                      <strong className="serif"><Bi v={x.title} /></strong>
                      <LangBadges present={langsIn([x.body, ...(x.parts ?? []).map((p) => p.body)])} />
                    </div>
                    <div className="small muted" style={{ marginTop: 4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {(lt(x.body) || lt(x.parts?.[0]?.body)).replace(/^[LCA]:\s?/gm, '')}
                    </div>
                    <div className="row small" style={{ marginTop: 4, gap: 6 }}>
                      {x.parts?.length ? <span className="badge reed">{x.parts.length} {t('parts')}</span> : null}
                      {x.source && <span style={{ color: 'var(--reed-ink)' }}>{x.source}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <TextEditor text={edit} canEdit={canEdit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

export function TextEditor({ text, canEdit, onClose, onSaved }: { text: Partial<LiturgyText>; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { t, lt } = useI18n();
  const { run, busy } = useAction();
  const [x, setX] = useState(text);
  const set = <K extends keyof LiturgyText>(k: K, v: LiturgyText[K]) => setX((o) => ({ ...o, [k]: v }));
  const hasParts = Array.isArray(x.parts);
  const partsOk = !hasParts || (x.parts!.every((p) => p.label.trim()) && new Set(x.parts!.map((p) => p.label.trim())).size === x.parts!.length);
  const save = async () => {
    const { id, ...body } = x;
    if (body.parts) body.parts = body.parts.map((p) => ({ ...p, label: p.label.trim() }));
    const r = id ? await run(() => api.patch(`/texts/${id}`, body), t('Saved.')) : await run(() => api.post('/texts', body), t('Saved.'));
    if (r) onSaved();
  };
  return (
    <Modal title={x.id ? lt(x.title) : t('New text')} onClose={onClose} size="lg" footer={canEdit ? (
      <>
        {x.id && <button className="btn danger left" onClick={async () => { if (confirmAction(t('Are you sure?')) && await run(() => api.del(`/texts/${x.id}`))) onSaved(); }}><Icon name="trash" />{t('Delete')}</button>}
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !hasAnyText(x.title) || !partsOk} onClick={save}>{t('Save')}</button>
      </>
    ) : undefined}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="form-grid">
          <Field label={t('Category')}>
            <select value={x.category} onChange={(e) => set('category', e.target.value as TextCategory)}>
              {TEXT_CATS.map((c) => <option key={c} value={c}>{lt(TEXT_CAT_LABEL[c])}</option>)}
            </select>
          </Field>
          <Field label={t('Source')}><input value={x.source ?? ''} onChange={(e) => set('source', e.target.value)} /></Field>
          <Field label={t('Tags')}><input value={(x.tags ?? []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></Field>
        </div>
        <Field label={t('Title')}><L10nInput value={x.title} onChange={(v) => set('title', v)} /></Field>
        <Field label={hasParts ? t('Introduction (optional)') : t('Body')} hint={t('Responsive format: start a line with L: (leader), C: (congregation) or A: (all). Blank line = new paragraph / slide.')}>
          <L10nInput multiline serif rows={hasParts ? 3 : 14} value={x.body} onChange={(v) => set('body', v)} />
        </Field>
        {hasParts ? (
          <PartsEditor parts={x.parts!} catechism={x.category === 'catechism'} onChange={(p) => set('parts', p)} />
        ) : canEdit && (
          <div className="row">
            <button className="btn sm" onClick={() => set('parts', [{ label: '1', body: {} }])}><Icon name="list" />{t('Use numbered parts')}</button>
            <span className="small muted">{t('For catechisms and confessions: each question or section is a part that services can pick.')}</span>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={!!x.public_domain} onChange={(e) => set('public_domain', e.target.checked)} />{t('Public domain')}</label>
      </fieldset>
    </Modal>
  );
}

/** The label after `l`: "7" → "8", "I.3" → "I.4", otherwise "". */
export const nextLabel = (l: string | undefined) => {
  const m = l?.match(/^(.*?)(\d+)$/);
  return m ? `${m[1]}${Number(m[2]) + 1}` : '';
};

/** Editor for many numbered parts: a collapsed, searchable list; one part is edited at a time. */
export function PartsEditor({ parts, catechism, onChange }: { parts: TextPart[]; catechism: boolean; onChange: (p: TextPart[]) => void }) {
  const { t, lt } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(parts.length === 1 ? 0 : null);
  const ql = q.trim().toLowerCase().replace(/^q\.?\s*/, '');
  const shown = parts.map((p, i) => [p, i] as const).filter(([p]) => !ql || p.label.toLowerCase() === ql || JSON.stringify([p.title, p.body]).toLowerCase().includes(ql));
  const setPart = (i: number, p: TextPart) => onChange(parts.map((x, j) => (j === i ? p : x)));
  const move = (i: number, d: number) => {
    const a = [...parts];
    const [x] = a.splice(i, 1);
    a.splice(i + d, 0, x);
    onChange(a);
    setOpen(i + d);
  };
  const add = () => {
    const at = open ?? parts.length - 1;
    const prev = parts[at];
    const a = [...parts];
    a.splice(at + 1, 0, { label: nextLabel(prev?.label) || String(parts.length + 1), title: prev?.title ? { ...prev.title } : undefined, body: catechism ? { en: 'L: \nC: ' } : {} });
    onChange(a);
    setOpen(at + 1);
    setQ('');
  };
  const dupes = new Set(parts.map((p) => p.label.trim()).filter((l, i, all) => all.indexOf(l) !== i));
  const firstLine = (p: TextPart) => (lt(p.body).split('\n').find((l) => l.trim()) ?? '').replace(/^[LCA][:：]\s?/, '');
  return (
    <div className="stack tight">
      <div className="row">
        <h3>{t('Parts')} <span className="badge reed">{parts.length}</span></h3>
        <div className="grow" />
        <div style={{ width: 240 }}><SearchBox value={q} onChange={setQ} placeholder={t('Number or words')} /></div>
        <button className="btn sm" onClick={add}><Icon name="plus" />{t('Add part')}</button>
      </div>
      <div className="field-hint">{catechism ? t('Each part is one question: "L: question" on the first line, "C: answer" on the next, so the minister asks and the congregation answers.') : t('Each part is one section; a part title (e.g. the chapter) is printed when it changes.')}</div>
      <div className="card flush" style={{ maxHeight: 460, overflowY: 'auto' }}>
        {shown.map(([p, i]) => (
          <div key={i} style={{ borderBottom: '1px solid var(--rule)' }}>
            <div className="lib-item" style={{ borderRadius: 0, margin: 0, alignItems: 'center' }} onClick={() => setOpen(open === i ? null : i)}>
              <span className={`badge ${dupes.has(p.label.trim()) || !p.label.trim() ? 'warn' : 'reed'}`} style={{ minWidth: 44, justifyContent: 'center' }}>{p.label || '?'}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                {hasAnyText(p.title) && <div className="s">{lt(p.title)}</div>}
                <div className="t" style={{ fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{firstLine(p) || <span className="muted">—</span>}</div>
              </div>
              <LangBadges present={langsIn([p.body])} />
              <Icon name="chevronDown" width={14} height={14} style={{ transform: open === i ? 'rotate(180deg)' : undefined, flex: 'none' }} />
            </div>
            {open === i && (
              <div className="stack tight" style={{ padding: '8px 12px 12px', background: 'var(--paper)' }}>
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <Field label={t('Label')}><input style={{ width: 90 }} value={p.label} maxLength={20} onChange={(e) => setPart(i, { ...p, label: e.target.value })} /></Field>
                  <div className="grow" />
                  <button className="btn sm ghost icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up"><Icon name="chevronDown" style={{ transform: 'rotate(180deg)' }} /></button>
                  <button className="btn sm ghost icon" disabled={i === parts.length - 1} onClick={() => move(i, 1)} aria-label="Down"><Icon name="chevronDown" /></button>
                  <button className="btn sm ghost icon danger" onClick={() => { onChange(parts.filter((_, j) => j !== i)); setOpen(null); }} aria-label={t('Delete')}><Icon name="trash" /></button>
                </div>
                <Field label={t('Part title (optional)')}><L10nInput value={p.title} onChange={(v) => setPart(i, { ...p, title: hasAnyText(v) ? v : undefined })} /></Field>
                <Field label={t('Text')}><L10nInput multiline serif rows={5} value={p.body} onChange={(v) => setPart(i, { ...p, body: v })} /></Field>
              </div>
            )}
          </div>
        ))}
        {!shown.length && <div className="empty small" style={{ padding: 12 }}>—</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ bible
