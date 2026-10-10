// Bulletin templates: the gallery and the editor.
import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Bi, ErrorBox, Field, L10nInput, Loading, PageHead, Seg, confirmAction, useAction, useSession, L10nEditScope, L10nSwitcher } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { COVER_LABEL } from '../../outputs/bulletin-build.tsx';
import { PAPERS, PAPER_ORDER } from '../../outputs/bulletin-paper.tsx';
import { BulletinSample, PageLayoutEditor } from '../BulletinLayoutEditor.tsx';
import { COVER_STYLES, type BulletinOptions, type BulletinTemplate, type HymnNumberStyle } from '../../../shared/presentation.ts';
import { GuideLink, HowItWorks, InfoTip, SaveBar, Step, TemplateCard, TipLabel, useSteps } from '../template-ui.tsx';
import {
  Badges, cardActions, GalleryGrid, ImportTemplateButton, sameDraft, useAfterImport, useEditParam, useGalleryActions,
} from './gallery.tsx';
import '../../outputs/outputs.css';
import '../presentation.css';

export type PrintKey = keyof BulletinOptions['print'];

export const PRINT_ROWS: { key: PrintKey; label: string; hint: string; choices: { value: string; label: string }[] }[] = [
  {
    key: 'song', label: 'Hymns and songs', hint: 'Hymns, psalms and the doxology',
    choices: [{ value: 'full', label: 'All the words' }, { value: 'first_stanza', label: 'First verse only' }, { value: 'title', label: 'Title only' }],
  },
  {
    key: 'scripture', label: 'Bible readings', hint: 'Scripture readings',
    choices: [{ value: 'full', label: 'All the words' }, { value: 'reference', label: 'Reference only' }],
  },
  {
    key: 'text', label: 'Creeds and liturgy', hint: 'Creeds, catechism, call to worship, responsive readings',
    choices: [{ value: 'full', label: 'All the words' }, { value: 'title', label: 'Title only' }],
  },
  {
    key: 'other', label: 'Prayers and other items', hint: 'Prayers, offering, announcements — when they have words',
    choices: [{ value: 'full', label: 'All the words' }, { value: 'title', label: 'Title only' }],
  },
];

export const PRINT_COLUMNS = [
  { value: 'full', label: 'All the words' },
  { value: 'first_stanza', label: 'First verse only' },
  { value: 'title', label: 'Title or reference only' },
];

export const colOf = (v: string) => (v === 'reference' ? 'title' : v);

export const CHOICE_SHORT: Record<string, string> = { full: 'words', first_stanza: 'first verse', title: 'title', reference: 'reference' };

/** Planner → Bulletin templates: what the printed bulletin includes and how it is laid out. */
export function BulletinTemplatesPage() {
  const { t, lt } = useI18n();
  const { canEdit, isAdmin, settings, reloadSettings } = useSession();
  const { data: list, error, reload } = useApi<BulletinTemplate[]>('/bulletin-templates');
  const [editId, setEditId] = useEditParam();
  const { run, busy } = useAction();
  const acts = useGalleryActions('bulletin', reload, reloadSettings, setEditId);
  const afterImport = useAfterImport('bulletin', reload, setEditId);
  // old links to the QR codes tab go to the Library
  if (new URLSearchParams(location.search).get('tab') === 'blocks') return <Navigate to="/library?tab=blocks" replace />;

  const defaultId = list?.find((x) => x.id === settings?.default_bulletin_template_id)?.id ?? list?.find((x) => x.builtin === 'full')?.id ?? null;
  const create = async () => {
    const x = await run(() => api.post<BulletinTemplate>('/bulletin-templates', { name: { en: 'New template', zh: '新模板' }, description: {} }));
    if (x) {
      await reload();
      setEditId(x.id);
    }
  };

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!list) return <div className="page"><Loading /></div>;
  const editing = editId ? list.find((x) => x.id === editId) : null;
  if (editing) {
    return (
      <div className="page">
        <TemplateEditor key={editing.id} tpl={editing} isDefault={editing.id === defaultId} onBack={() => setEditId(null)} acts={acts} onSaved={reload} />
      </div>
    );
  }

  const facts = (o: BulletinOptions) => [
    t(PAPERS[o.paper].label),
    `${t('Hymns')}: ${t(CHOICE_SHORT[o.print.song])}`,
    `${t('Readings')}: ${t(CHOICE_SHORT[o.print.scripture])}`,
  ];
  return (
    <div className="page">
      <PageHead eyebrow={t('Planner')} title={t('Bulletin templates')} sub={t('What each printed bulletin includes: paper, cover, which items print in full, and the order of its pages.')}>
        <GuideLink anchor="bulletin-templates" />
        {canEdit && <ImportTemplateButton onImported={afterImport} />}
      </PageHead>
      <HowItWorks steps={[
        t('Pick the template most services should use and choose Set as church default (in the ⋯ menu).'),
        t('To change a built-in template, make a copy and edit the copy.'),
        t('Each week, type the announcements in the service’s Bulletin tab, then print from Outputs → Bulletin.'),
      ]} />
      <p className="small muted" style={{ margin: '-4px 0 14px' }}>
        <Icon name="qr" width={14} height={14} style={{ verticalAlign: -2, marginRight: 6 }} />
        {t('QR codes and notes are kept in Library → QR codes & notes and can be used on bulletins and slides.')}{' '}
        <Link to="/library?tab=blocks">{t('Open')} →</Link>
      </p>
      <GalleryGrid
        items={list}
        card={(x) => (
          <TemplateCard
            key={x.id}
            muted={x.hidden}
            thumb={<BulletinThumb o={x.options} />}
            name={<Bi v={x.name} />}
            desc={lt(x.description) || facts(x.options).join(' · ')}
            badges={<Badges builtin={!!x.builtin} isDefault={x.id === defaultId} hidden={x.hidden} refCode={x.ref} />}
            primary={x.builtin || !canEdit ? { label: t('Preview'), onClick: () => setEditId(x.id), icon: 'eye' } : { label: t('Edit'), onClick: () => setEditId(x.id), icon: 'edit' }}
            actions={cardActions(x, x.id === defaultId, { edit: canEdit, admin: isAdmin }, acts, t)}
          />
        )}
        newCard={canEdit && (
          <button type="button" className="tp-card tp-new" onClick={create} disabled={busy}>
            <Icon name="plus" />
            <span>{t('New template')}</span>
            <span className="tp-card-desc">{t('Starts from the full-words booklet')}</span>
          </button>
        )}
      />
    </div>
  );
}

/** A small drawing of a bulletin's paper and how much it prints (no rendering, so the gallery stays fast). */
export function BulletinThumb({ o }: { o: BulletinOptions }) {
  const { t } = useI18n();
  const p = PAPERS[o.paper];
  const lines = o.print.song === 'full' ? 7 : o.print.song === 'first_stanza' ? 5 : 3;
  return (
    <div className="tp-bthumb" aria-hidden="true">
      <div className="tp-bthumb-page">
        {o.cover === 'banner' ? <div className="tp-bthumb-banner" style={{ background: o.banner.bg }} /> : <div className="tp-bthumb-cross">✝</div>}
        {Array.from({ length: lines }, (_, i) => <div key={i} className="tp-bthumb-line" style={{ width: `${55 + ((i * 17) % 40)}%` }} />)}
      </div>
      <span className="tp-bthumb-paper">{t(p.label)}</span>
    </div>
  );
}

export function TemplateEditor({ tpl, isDefault, onBack, acts, onSaved }: {
  tpl: BulletinTemplate;
  isDefault: boolean;
  onBack: () => void;
  acts: ReturnType<typeof useGalleryActions>;
  onSaved: () => Promise<unknown>;
}) {
  const { t, lt } = useI18n();
  const { canEdit, isAdmin } = useSession();
  const { run, busy } = useAction();
  const steps = useSteps(1);
  const [draft, setDraft] = useState<BulletinTemplate>(() => structuredClone(tpl));
  const ro = !canEdit || !!tpl.builtin;
  const dirty = !ro && !sameDraft(draft, tpl, ['name', 'description', 'options']);
  const o = draft.options;
  const setO = (p: Partial<BulletinOptions>) => setDraft((d) => ({ ...d, options: { ...d.options, ...p } }));
  const setPrint = (k: PrintKey, v: string) => setO({ print: { ...o.print, [k]: v } });

  const back = async () => {
    if (dirty && !await confirmAction(t('Discard your unsaved changes?'))) return;
    onBack();
  };
  const save = async () => {
    const x = await run(() => api.patch<BulletinTemplate>(`/bulletin-templates/${draft.id}`, { name: draft.name, description: draft.description, options: draft.options }), t('Saved.'));
    if (x) {
      setDraft(structuredClone(x));
      await onSaved();
    }
  };

  const sum = {
    paper: `${t(PAPERS[o.paper].label)} · ${o.font_pt ? `${o.font_pt}pt` : t('Automatic')} · ${o.languages === 'primary' ? t('Main language only') : o.layout === 'stacked' ? t('One after the other') : t('Side by side')}`,
    print: PRINT_ROWS.map((r) => `${t(r.label)}: ${t(CHOICE_SHORT[o.print[r.key]])}`).join(' · '),
    order: `${o.cover === 'default' ? t('Cover as chosen for the service') : t(COVER_LABEL[o.cover])} · ${o.order_style === 'table' ? t('Table') : t('List')}`,
    layout: t('{n} sections').replace('{n}', String(o.page_layout.length)),
  };

  const head = (
    <div className="tp-edit-head">
      <button type="button" className="btn sm ghost" onClick={back}><Icon name="chevronLeft" />{t('All bulletin templates')}</button>
      <h1><Bi v={draft.name} /></h1>
      <Badges builtin={!!tpl.builtin} isDefault={isDefault} hidden={tpl.hidden} refCode={tpl.ref} />
      <div className="grow" />
      <GuideLink anchor="bulletin-templates" />
      {isAdmin && !isDefault && <button className="btn sm" disabled={busy || dirty} title={dirty ? t('Save your changes first') : t('Services use this template unless they choose another.')} onClick={() => acts.makeDefault(tpl.id)}><Icon name="check" />{t('Set as church default')}</button>}
      {canEdit && !tpl.builtin && <button className="btn sm" disabled={busy} onClick={async () => { if (!dirty || await confirmAction(t('Discard your unsaved changes?'))) acts.copy(tpl.id); }}><Icon name="copy" />{t('Duplicate')}</button>}
      {isAdmin && tpl.hidden && !tpl.builtin && <button className="btn sm ghost danger" disabled={busy} onClick={async () => { if (await acts.remove(tpl.id)) onBack(); }}><Icon name="trash" />{t('Delete')}</button>}
    </div>
  );
  const previewPane = (
    <div className="tp-preview">
      <BulletinSample options={o} />
      <span className="field-hint">{t('Every page of a sample service, drawn by the real bulletin. Your own services print the same way.')}</span>
    </div>
  );

  if (ro) {
    return (
      <>
        {head}
        <div className="tp-editor">
          <div className="stack">
            <div className="callout">
              {tpl.builtin ? t('Built-in templates come with Canon and can’t be changed. Make a copy to change what prints or the page layout.') : t('You can look at this template, but only editors can change it.')}
            </div>
            {canEdit && tpl.builtin && <div><button className="btn primary" onClick={() => acts.copy(tpl.id)} disabled={busy}><Icon name="copy" />{t('Make a copy to customise')}</button></div>}
            {lt(tpl.description) && <p style={{ margin: 0 }}>{lt(tpl.description)}</p>}
            <dl className="tp-facts">
              <dt>{t('Paper and languages')}</dt><dd>{sum.paper}</dd>
              <dt>{t('What to print')}</dt><dd>{sum.print}</dd>
              <dt>{t('Cover and order of service')}</dt><dd>{sum.order}</dd>
              <dt>{t('Page layout')}</dt><dd>{sum.layout}</dd>
            </dl>
          </div>
          {previewPane}
        </div>
      </>
    );
  }

  return (
    <>
      {head}
      <div className="tp-editor">
        <div className="tp-steps">
          <L10nEditScope>
            <div className="l10n-section-head"><span /><L10nSwitcher min={2} /></div>
            <div className="pr-grid">
              <Field label={t('Template name')}><L10nInput value={draft.name} onChange={(n) => setDraft((d) => ({ ...d, name: n }))} /></Field>
              <Field label={<TipLabel label={t('Description')} tip={t('A short note shown in the template list, e.g. “Lord’s Supper Sundays”.')} />}><L10nInput value={draft.description} onChange={(n) => setDraft((d) => ({ ...d, description: n }))} /></Field>
            </div>
          </L10nEditScope>

          <Step n={1} title={t('Paper and languages')} summary={sum.paper} open={steps.isOpen(1)} onToggle={() => steps.toggle(1)}>
            <div className="pr-grid">
              <Field label={<TipLabel label={t('Paper')} tip={t('A4 landscape, folded, makes an A5 booklet: print double-sided, flip on the short edge, then fold.')} />}>
                <select value={o.paper} onChange={(e) => setO({ paper: e.target.value as BulletinOptions['paper'] })}>
                  {PAPER_ORDER.map((p) => <option key={p} value={p}>{t(PAPERS[p].label)}</option>)}
                </select>
              </Field>
              <Field label={<TipLabel label={t('Font size')} tip={t('Automatic picks a size that suits the paper. Choose a smaller size if pages overflow.')} />}>
                <select value={o.font_pt ?? ''} onChange={(e) => setO({ font_pt: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">{t('Automatic')} ({PAPERS[o.paper].font}pt)</option>
                  {[8, 8.5, 9, 9.5, 10, 10.5, 11, 12, 13, 14, 15, 16].map((n) => <option key={n} value={n}>{n}pt</option>)}
                </select>
              </Field>
            </div>
            <div className="pr-grid">
              <Field label={t('Languages')}>
                <div><Seg<BulletinOptions['languages']> value={o.languages} onChange={(l) => setO({ languages: l })} options={[{ value: 'service', label: t('All languages of the service') }, { value: 'primary', label: t('Main language only') }]} /></div>
              </Field>
              <Field label={<TipLabel label={t('Two languages')} tip={t('Side by side keeps each line next to its translation; one after the other suits narrow paper.')} />}>
                <div><Seg<BulletinOptions['layout']> value={o.layout} onChange={(l) => setO({ layout: l })} options={[{ value: 'parallel', label: t('Side by side') }, { value: 'stacked', label: t('One after the other') }]} /></div>
              </Field>
            </div>
          </Step>

          <Step n={2} title={t('What to print')} summary={sum.print} open={steps.isOpen(2)} onToggle={() => steps.toggle(2)}>
            <div className="table-wrap">
              <table className="t pr-print">
                <thead>
                  <tr><th />{PRINT_COLUMNS.map((c) => <th key={c.value}>{t(c.label)}</th>)}</tr>
                </thead>
                <tbody>
                  {PRINT_ROWS.map((row) => (
                    <tr key={row.key}>
                      <td><div style={{ fontWeight: 600 }}>{t(row.label)} <InfoTip text={t(row.hint)} /></div></td>
                      {PRINT_COLUMNS.map((c) => {
                        const choice = row.choices.find((x) => colOf(x.value) === c.value);
                        if (!choice) return <td key={c.value} className="na">—</td>;
                        return (
                          <td key={c.value}>
                            <input type="radio" name={`print-${row.key}`} aria-label={`${t(row.label)}: ${t(choice.label)}`} checked={o.print[row.key] === choice.value} onChange={() => setPrint(row.key, choice.value)} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="field-hint">{t('In the service planner each item can still be set to “Full text” or “Title only”, whatever the template says.')}</span>
          </Step>

          <Step n={3} title={t('Cover and order of service')} summary={sum.order} open={steps.isOpen(3)} onToggle={() => steps.toggle(3)}>
            <Field label={<TipLabel label={t('Cover')} tip={t('“As chosen for the service” follows the cover picked in each service, else the church default in Settings → Church.')} />}>
              <select value={o.cover} onChange={(e) => setO({ cover: e.target.value as BulletinOptions['cover'] })}>
                <option value="default">{t('As chosen for the service, else the church default')}</option>
                {COVER_STYLES.map((c) => <option key={c} value={c}>{t(COVER_LABEL[c])}</option>)}
                <option value="banner">{t(COVER_LABEL.banner)}</option>
              </select>
            </Field>
            <OrderOptions o={o} setO={setO} />
          </Step>

          <Step n={4} title={t('Page layout')} summary={sum.layout} open={steps.isOpen(4)} onToggle={() => steps.toggle(4)}>
            <span className="field-hint">{t('The sections in print order. Drag them (or use ↑ ↓) to reorder; add page breaks where a new page should start. Weekly texts are typed in each service’s Bulletin tab.')}</span>
            <PageLayoutEditor layout={o.page_layout} onChange={(l) => setO({ page_layout: l })} readOnly={false} />
          </Step>
        </div>
        {previewPane}
      </div>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onDiscard={() => setDraft(structuredClone(tpl))} />
    </>
  );
}

// ================================================================= template editor: the order of service

export const HYMN_NUMBER_LABEL: Record<HymnNumberStyle, string> = {
  abbr: 'Hymnal and number: HP 123 · Title',
  number: 'Number only: 123 Title',
  none: 'Title only',
};

/** Banner colours and how the order of service is printed. */
export function OrderOptions({ o, setO }: { o: BulletinOptions; setO: (p: Partial<BulletinOptions>) => void }) {
  const { t } = useI18n();
  return (
    <>
      {o.cover === 'banner' && (
        <div className="pr-grid">
          <Field label={t('Banner background')}>
            <span className="pr-colour"><input type="color" value={o.banner.bg} onChange={(e) => setO({ banner: { ...o.banner, bg: e.target.value } })} /><code>{o.banner.bg}</code></span>
          </Field>
          <Field label={t('Banner text')}>
            <span className="pr-colour"><input type="color" value={o.banner.fg} onChange={(e) => setO({ banner: { ...o.banner, fg: e.target.value } })} /><code>{o.banner.fg}</code></span>
          </Field>
        </div>
      )}
      <div className="pr-grid">
        <Field label={<TipLabel label={t('Order of service layout')} tip={t('A table has three columns: the item, what (hymn, reading, sermon title) and who leads it.')} />}>
          <div><Seg<BulletinOptions['order_style']> value={o.order_style} onChange={(v) => setO({ order_style: v })} options={[{ value: 'list', label: t('List') }, { value: 'table', label: t('Table with shaded rows') }]} /></div>
        </Field>
        <Field label={t('Hymn numbers')}>
          <select value={o.hymn_number} onChange={(e) => setO({ hymn_number: e.target.value as HymnNumberStyle })}>
            {(Object.keys(HYMN_NUMBER_LABEL) as HymnNumberStyle[]).map((k) => <option key={k} value={k}>{t(HYMN_NUMBER_LABEL[k])}</option>)}
          </select>
        </Field>
      </div>
      <div className="pr-grid">
        <label className="check"><input type="checkbox" checked={o.show_posture} onChange={(e) => setO({ show_posture: e.target.checked })} />{t('Posture (All stand / 众立)')}</label>
        <label className="check"><input type="checkbox" checked={o.sermon_brackets} onChange={(e) => setO({ sermon_brackets: e.target.checked })} />{t('Sermon and creed titles in 【】')}</label>
        <label className="check"><input type="checkbox" checked={o.show_leaders} onChange={(e) => setO({ show_leaders: e.target.checked })} />{t('Names of those leading each item')}</label>
        <label className="check"><input type="checkbox" checked={o.show_times} onChange={(e) => setO({ show_times: e.target.checked })} />{t('Time of each item')}</label>
      </div>
    </>
  );
}
