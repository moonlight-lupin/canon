// QR codes, pictures and short notes ("bulletin blocks"): made once in Library → QR codes & notes, then used on the
// bulletin's back cover (bulletin templates) and on a slide after a service item (e.g. PayNow during the offering).
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { ErrorBox, Field, L10nInput, Loading, Seg, confirmAction, useAction, useDebounced, useSession, useToast } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import {
  QR_PRESETS, blockImageUrl, blockQrUrl, qrPresetValue, qrPreviewUrl,
  type BulletinBlock, type BulletinBlockData, type BulletinBlockKind, type QrPreset,
} from '../../shared/presentation.ts';
import { MAX_SLIDE_BLOCKS } from '../outputs/slideModel.ts';
import '../outputs/outputs.css';
import './presentation.css';

/** A selectable card in a list (a div, because it may contain a rendered slide). */
export function Card({ on, onSelect, children }: { on: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <div
      className={`pr-card${on ? ' on' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={on}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      {children}
    </div>
  );
}

export const BLOCK_KIND_LABEL: Record<BulletinBlockKind, string> = { qr: 'QR code', image: 'Picture', text: 'Short note' };
const PRESET_LABEL: Record<QrPreset, string> = { website: 'Website', instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp', link: 'Any link or text' };
const PRESET_HINT: Record<QrPreset, string> = {
  website: 'e.g. www.ourchurch.org',
  instagram: 'e.g. @ourchurch',
  facebook: 'e.g. ourchurch or a facebook.com link',
  whatsapp: 'Phone number with country code, e.g. 6591234567',
  link: 'A Google Form or any link, or plain text',
};
const PAYNOW_WARNING = "For PayNow / bank QR codes, upload the official image from your bank — don't generate one.";

/** Which preset a saved QR text looks like. */
function presetOf(v: string): QrPreset {
  if (/instagram\.com\//i.test(v)) return 'instagram';
  if (/(facebook|fb)\.com\//i.test(v)) return 'facebook';
  if (/wa\.me\//i.test(v)) return 'whatsapp';
  if (/^https?:\/\//i.test(v)) return 'website';
  return 'link';
}

/** Library → QR codes & notes: the list of blocks and the editor of the selected one. */
export function BlocksTab() {
  const { t } = useI18n();
  const { canEdit } = useSession();
  const { data: list, error, reload } = useApi<BulletinBlock[]>('/bulletin-blocks');
  const { run, busy } = useAction();
  const [selId, setSelId] = useState<number | null>(null);
  const sel = list?.find((x) => x.id === selId) ?? list?.[0] ?? null;
  const create = async (kind: BulletinBlockKind) => {
    const name = { qr: t('New QR code'), image: t('New picture'), text: t('New note') }[kind];
    const b = await run(() => api.post<BulletinBlock>('/bulletin-blocks', { kind, name, data: {} }));
    if (b) {
      await reload();
      setSelId(b.id);
    }
  };
  if (error) return <ErrorBox error={error} />;
  if (!list) return <Loading />;
  return (
    <>
    <p className="muted small" style={{ margin: '0 0 14px' }}>{t('Used on the printed bulletin (back cover) and on the projector slides: in the service planner, an item such as the offering can show them on a slide of their own.')}</p>
    <div className="pr-split">
      <div className="pr-list">
        {canEdit && (
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn sm" disabled={busy} onClick={() => create('qr')}><Icon name="plus" />{t('QR code')}</button>
            <button className="btn sm" disabled={busy} onClick={() => create('image')}><Icon name="plus" />{t('Picture')}</button>
            <button className="btn sm" disabled={busy} onClick={() => create('text')}><Icon name="plus" />{t('Short note')}</button>
          </div>
        )}
        {!list.length && <p className="small muted">{t('QR codes (website, Instagram, sign-up forms), pictures such as a PayNow code, and short notes for the bulletin and the slides.')}</p>}
        {list.map((b) => (
          <Card key={b.id} on={b.id === sel?.id} onSelect={() => setSelId(b.id)}>
            <div className="pr-block-card">
              <BlockThumb b={b} />
              <div>
                <div className="pr-card-name">{b.name}</div>
                <div className="pr-card-desc">{t(BLOCK_KIND_LABEL[b.kind])}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {sel && <BlockEditor key={`${sel.id}:${sel.updated_at}`} block={sel} canEdit={canEdit} onChanged={reload} onDeleted={async () => { setSelId(null); await reload(); }} />}
    </div>
    </>
  );
}

export function BlockThumb({ b, small }: { b: BulletinBlock; small?: boolean }) {
  const { lt } = useI18n();
  const cls = `pr-block-thumb${small ? ' sm' : ''}`;
  if (b.kind === 'qr') return b.data.value ? <img className={cls} src={blockQrUrl(b.id, b.updated_at)} alt="" /> : <div className={cls} />;
  if (b.kind === 'image') return b.data.image ? <img className={cls} src={blockImageUrl(b.id, b.data.image)} alt="" /> : <div className={cls} />;
  return <div className={`${cls} text`}>{small ? '¶' : lt(b.data.text ?? {}).slice(0, 18)}</div>;
}

function BlockEditor({ block, canEdit, onChanged, onDeleted }: { block: BulletinBlock; canEdit: boolean; onChanged: () => Promise<void> | void; onDeleted: () => Promise<void> }) {
  const { t } = useI18n();
  const toast = useToast();
  const { run, busy } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(block.name);
  const [data, setData] = useState<BulletinBlockData>(block.data);
  const [preset, setPreset] = useState<QrPreset>(() => presetOf(block.data.value ?? ''));
  const [typed, setTyped] = useState(block.data.value ?? '');
  const value = block.kind === 'qr' ? qrPresetValue(preset, typed) : '';
  const shown = useDebounced(value, 300);
  const dirty = name !== block.name || JSON.stringify({ ...data, ...(block.kind === 'qr' ? { value } : {}) }) !== JSON.stringify(block.data);

  const save = async () => {
    const body = block.kind === 'qr' ? { caption: data.caption, value } : block.kind === 'image' ? { caption: data.caption } : { text: data.text, bold: data.bold, align: data.align };
    if (await run(() => api.patch(`/bulletin-blocks/${block.id}`, { name, data: body }), t('Saved.'))) await onChanged();
  };
  const remove = async () => {
    if (!confirmAction(t('Delete this block? Bulletins and slides that use it will leave it out.'))) return;
    if (await run(() => api.del(`/bulletin-blocks/${block.id}`), t('Deleted.'))) await onDeleted();
  };
  const upload = async (file: File | undefined) => {
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast(t('Upload a PNG, JPEG or WebP picture'), true);
    if (file.size > 2 * 1024 * 1024) return toast(t('The picture must be 2 MB or smaller'), true);
    if (await run(() => api.put(`/bulletin-blocks/${block.id}/image`, file), t('Picture saved.'))) await onChanged();
  };

  return (
    <div className="card">
      <div className="pr-head">
        <h2>{block.name}</h2>
        <span className="badge">{t(BLOCK_KIND_LABEL[block.kind])}</span>
        {canEdit && <button className="btn sm ghost danger" disabled={busy} onClick={remove}><Icon name="trash" />{t('Delete')}</button>}
        {canEdit && <button className="btn sm primary" disabled={busy || !dirty || (block.kind === 'qr' && !value)} onClick={save}>{t('Save')}</button>}
      </div>
      <div className="pr-editor">
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
          <Field label={t('Name')} hint={t('Only for you, to find it again, e.g. "Church website".')}><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {block.kind === 'qr' && (
            <>
              <Field label={t('What the code opens')}>
                <div className="stack tight">
                  <div><Seg<QrPreset> value={preset} onChange={setPreset} options={QR_PRESETS.map((p) => ({ value: p, label: t(PRESET_LABEL[p]) }))} /></div>
                  <input value={typed} placeholder={t(PRESET_HINT[preset])} onChange={(e) => setTyped(e.target.value)} />
                  {value && <code className="small" style={{ wordBreak: 'break-all' }}>{value}</code>}
                </div>
              </Field>
              <div className="callout small">{t(PAYNOW_WARNING)}</div>
            </>
          )}
          {block.kind === 'image' && (
            <>
              <div className="callout small">{t(PAYNOW_WARNING)}</div>
              <div className="row">
                <button type="button" className="btn sm" disabled={busy} onClick={() => fileRef.current?.click()}><Icon name="upload" />{data.image ? t('Replace picture') : t('Upload picture')}</button>
                {data.image && <button type="button" className="btn sm ghost danger" disabled={busy} onClick={async () => { if (await run(() => api.del(`/bulletin-blocks/${block.id}/image`), t('Picture removed.'))) await onChanged(); }}><Icon name="trash" />{t('Remove')}</button>}
              </div>
              <span className="field-hint">{t('PNG, JPEG or WebP, up to 2 MB. Printed about 3 cm wide; shown large on slides.')}</span>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
            </>
          )}
          {block.kind !== 'text' ? (
            <Field label={t('Caption')} hint={t('Printed under the code. Several lines are fine, e.g. "Scan to give" and the UEN.')}>
              <L10nInput multiline rows={2} value={data.caption} onChange={(v) => setData({ ...data, caption: v })} placeholder={{ en: 'Our website', zh: '教会网站' }} />
            </Field>
          ) : (
            <>
              <Field label={t('Text of the note')}>
                <L10nInput multiline rows={2} value={data.text} onChange={(v) => setData({ ...data, text: v })} placeholder={{ en: 'Please stay for the prayer meeting!', zh: '敬请留下参加祷告会！' }} />
              </Field>
              <div className="row" style={{ gap: 16 }}>
                <label className="check"><input type="checkbox" checked={data.bold !== false} onChange={(e) => setData({ ...data, bold: e.target.checked })} />{t('Bold')}</label>
                <Seg<'center' | 'left'> value={data.align ?? 'center'} onChange={(a) => setData({ ...data, align: a })} options={[{ value: 'center', label: t('Centred') }, { value: 'left', label: t('Left') }]} />
              </div>
            </>
          )}
        </fieldset>
        <div className="pr-side">
          <div className="pr-sec" style={{ marginTop: 0 }}>{t('Live preview')}</div>
          <div className="pr-block-preview bl-doc">
            {block.kind === 'qr' && (shown ? <img src={qrPreviewUrl(shown)} alt="" /> : <div className="pr-block-empty">{t('Type a web address to see the code.')}</div>)}
            {block.kind === 'image' && (data.image ? <img src={blockImageUrl(block.id, data.image)} alt="" /> : <div className="pr-block-empty">{t('No picture')}</div>)}
            {block.kind !== 'text'
              ? <div className="pr-block-cap">{Object.values(data.caption ?? {}).filter(Boolean).slice(0, 1).map((c, i) => <div key={i} style={{ whiteSpace: 'pre-wrap' }}>{c}</div>)}</div>
              : <div className={`bl-bnote${data.bold !== false ? ' b' : ''}${data.align === 'left' ? ' left' : ''}`} style={{ whiteSpace: 'pre-wrap' }}>{Object.values(data.text ?? {}).find(Boolean) ?? ''}</div>}
          </div>
          {block.kind === 'qr' && value && (
            <div className="row" style={{ gap: 6 }}>
              <a className="btn sm" href={qrPreviewUrl(value, 'png', true)} download><Icon name="download" />{t('Download PNG')}</a>
              <a className="btn sm" href={qrPreviewUrl(value, 'svg', true)} download><Icon name="download" />{t('Download SVG')}</a>
            </div>
          )}
          {block.kind === 'qr' && <span className="field-hint">{t('Use the download on posters, slides or WhatsApp. Test the code with your phone before printing.')}</span>}
        </div>
      </div>
    </div>
  );
}


// ================================================================= picker: QR codes & notes on slides

/**
 * "QR codes & notes on slides" for a service item (block ids) or a template item (block names): chips with a small
 * thumbnail, a select to add one (up to MAX_SLIDE_BLOCKS) and a link to make a new one in the Library.
 */
export function SlideBlocksPicker<T extends number | string>({ value, blocks, keyOf, onChange, newTab }: {
  value: T[]; blocks: BulletinBlock[] | undefined; keyOf: (b: BulletinBlock) => T; onChange: (v: T[]) => void;
  /** open the Library in a new tab (inside a dialog with unsaved changes) */
  newTab?: boolean;
}) {
  const { t } = useI18n();
  const byKey = new Map((blocks ?? []).map((b) => [keyOf(b), b]));
  const rest = (blocks ?? []).filter((b) => !value.includes(keyOf(b)));
  return (
    <div className="pr-chips">
      {value.map((v) => {
        const b = byKey.get(v);
        return (
          <span key={String(v)} className={`pr-chip${b ? '' : ' missing'}`} title={b ? t(BLOCK_KIND_LABEL[b.kind]) : t('Not found in the Library')}>
            {b && <BlockThumb b={b} small />}
            {b ? b.name : String(v)}
            <button type="button" className="pr-chip-x" aria-label={t('Remove')} onClick={() => onChange(value.filter((x) => x !== v))}>×</button>
          </span>
        );
      })}
      {blocks && rest.length > 0 && value.length < MAX_SLIDE_BLOCKS && (
        <select value="" aria-label={t('Add a QR code or note…')} onChange={(e) => { const b = rest.find((x) => String(keyOf(x)) === e.target.value); if (b) onChange([...value, keyOf(b)]); }}>
          <option value="">{t('Add a QR code or note…')}</option>
          {rest.map((b) => <option key={b.id} value={String(keyOf(b))}>{b.name} ({t(BLOCK_KIND_LABEL[b.kind])})</option>)}
        </select>
      )}
      <Link className="small" to="/library?tab=blocks" target={newTab ? '_blank' : undefined}>{blocks && !blocks.length ? t('Make one in Library → QR codes & notes') : t('New…')}</Link>
    </div>
  );
}
