// Library → Images (0.19.10): pictures for the slides — a poster, a photo, a map — each shown on a slide of its own
// after a service item. Each picture is shown whole (on the slide template's background) or fills the slide. Also the
// planner's "Pictures on slides" picker and the library panel's Pictures tab.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Empty, ErrorBox, Loading, SearchBox, Seg, confirmAction, useAction, useSession, useToast } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { Combo } from '../components/Combo.tsx';
import { imageUrl } from '../../shared/presentation.ts';
import type { ServiceItem } from '../types-client.ts';

export type ImageFit = 'contain' | 'cover';
export interface LibraryImage {
  id: number;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  version: string;
  fit: ImageFit;
  uses: number;
}

/**
 * Will the picture look sharp on a widescreen projector (1920 × 1080)? Shown whole, it is enlarged only when it is
 * smaller than the screen both ways; filling the slide, when it is smaller either way.
 */
function imageNote(i: Pick<LibraryImage, 'width' | 'height' | 'fit'>, t: (s: string) => string): { ok: boolean; text: string } {
  if (!i.width || !i.height) return { ok: true, text: '' };
  const dims = `${i.width} × ${i.height}`;
  const small = i.fit === 'cover' ? i.width < 1920 || i.height < 1080 : i.width < 1920 && i.height < 1080;
  return small ? { ok: false, text: `${dims} · ${t('smaller than the screen: it may look blurry')}` } : { ok: true, text: dims };
}

/** At most this many pictures after one item (as the server allows). */
export const MAX_ITEM_IMAGES = 12;

export function ImagesTab() {
  const { t } = useI18n();
  const toast = useToast();
  const { canEdit } = useSession();
  const { data, error, reload } = useApi<LibraryImage[]>('/images');
  const { run, busy } = useAction();
  const file = useRef<HTMLInputElement>(null);
  const replaceFor = useRef<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');

  const pick = (id: number | null) => {
    replaceFor.current = id;
    file.current?.click();
  };
  const upload = (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (file.current) file.current.value = '';
    if (!list.length) return;
    const bad = list.find((f) => !['image/png', 'image/jpeg', 'image/webp'].includes(f.type));
    if (bad) return toast(t('Upload a PNG, JPEG or WebP picture'), true);
    if (list.some((f) => f.size > 10 * 1024 * 1024)) return toast(t('The picture must be 10 MB or smaller'), true);
    const id = replaceFor.current;
    run(async () => {
      if (id) await api.put(`/images/${id}`, list[0]);
      // several at once (a set of photos): each named after its file
      else for (const f of list) await api.post(`/images?name=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ''))}`, f);
      await reload();
    }, list.length > 1 ? t('{n} pictures saved.').replace('{n}', String(list.length)) : t('Picture saved.'));
  };
  const rename = (id: number) => run(async () => {
    await api.patch(`/images/${id}`, { name });
    setEditing(null);
    await reload();
  }, t('Saved.'));
  const setFit = (i: LibraryImage, fit: ImageFit) => run(async () => {
    await api.patch(`/images/${i.id}`, { fit });
    await reload();
  });
  const remove = async (i: LibraryImage) => {
    if (!await confirmAction(i.uses ? t('Delete this picture? {n} service items show it; it comes off their slides.').replace('{n}', String(i.uses)) : t('Delete this picture?'))) return;
    run(async () => {
      await api.del(`/images/${i.id}`);
      await reload();
    }, t('Deleted.'));
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const ql = q.trim().toLowerCase();
  const shown = data.filter((i) => !ql || i.name.toLowerCase().includes(ql));
  return (
    <div className="stack">
      <div className="row between" style={{ flexWrap: 'wrap', gap: 10 }}>
        <p className="small muted" style={{ margin: 0, maxWidth: 680 }}>
          {t('Pictures for the slides — a poster for the announcements, a photo, a map. Each is shown on a slide of its own after a service item: choose them in the planner (item → Pictures on slides), or add one from the Pictures tab beside the order of service.')}
          {' '}<InfoTip text={t('Slide backgrounds go behind an item’s words; QR codes & notes are small cards that also print on the bulletin. These pictures fill a slide of their own, and are not printed.')} />
        </p>
        {canEdit && <button className="btn primary" onClick={() => pick(null)} disabled={busy}><Icon name="upload" />{t('Add pictures…')}</button>}
      </div>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => upload(e.target.files)} />
      {data.length > 8 && <div style={{ maxWidth: 320 }}><SearchBox value={q} onChange={setQ} placeholder={t('Name')} /></div>}
      {!data.length ? <div className="card"><Empty title={t('No pictures yet.')} /></div> : (
        <div className="bg-grid">
          {shown.map((i) => {
            const note = imageNote(i, t);
            return (
              <div key={i.id} className="card bg-card">
                <div className={`bg-thumb img-thumb fit-${i.fit}`} style={{ backgroundImage: `url("${imageUrl(i.id, i.version)}")` }} />
                {editing === i.id ? (
                  <div className="row" style={{ gap: 6 }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && rename(i.id)} />
                    <button className="btn sm primary" onClick={() => rename(i.id)} disabled={busy}>{t('Save')}</button>
                  </div>
                ) : <div className="bg-name">{i.name}</div>}
                <div className={`small ${note.ok ? 'muted' : 'warn-text'}`}>{note.text}{note.text ? ' · ' : ''}{(i.bytes / 1e6).toFixed(1)} MB</div>
                <div className="small muted">{i.uses ? t('Used by {n} items').replace('{n}', String(i.uses)) : t('Not used yet')}</div>
                {canEdit ? (
                  <>
                    <Seg<ImageFit> value={i.fit} onChange={(v) => setFit(i, v)} options={[{ value: 'contain', label: t('Whole picture') }, { value: 'cover', label: t('Fill the slide') }]} />
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn sm ghost" onClick={() => { setEditing(i.id); setName(i.name); }}><Icon name="edit" />{t('Rename')}</button>
                      <button className="btn sm ghost" onClick={() => pick(i.id)} disabled={busy}><Icon name="upload" />{t('Replace')}</button>
                      <button className="btn sm ghost icon danger" onClick={() => remove(i)} aria-label={t('Delete')} title={t('Delete')}><Icon name="trash" /></button>
                    </div>
                  </>
                ) : <div className="small muted">{i.fit === 'cover' ? t('Fill the slide') : t('Whole picture')}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The planner's "Pictures on slides": pictures from Library → Images, in order, each on a slide after the item. */
export function SlideImagesPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const { t } = useI18n();
  const { data } = useApi<LibraryImage[]>('/images');
  const byId = new Map((data ?? []).map((i) => [i.id, i]));
  const move = (from: number, to: number) => {
    const v = [...value];
    const [x] = v.splice(from, 1);
    v.splice(to, 0, x);
    onChange(v);
  };
  return (
    <div className="stack tight">
      {value.length > 0 && (
        <div className="img-chips">
          {value.map((pid, n) => {
            const i = byId.get(pid);
            return (
              <span key={`${pid}-${n}`} className="img-chip">
                {i && <span className="bg-mini" style={{ backgroundImage: `url("${imageUrl(i.id, i.version)}")` }} />}
                <span className="small">{i?.name ?? '…'}</span>
                {n > 0 && <button type="button" className="btn ghost sm icon" onClick={() => move(n, n - 1)} aria-label={t('Earlier')} title={t('Earlier')}>‹</button>}
                {n < value.length - 1 && <button type="button" className="btn ghost sm icon" onClick={() => move(n, n + 1)} aria-label={t('Later')} title={t('Later')}>›</button>}
                <button type="button" className="btn ghost sm icon" onClick={() => onChange(value.filter((_, k) => k !== n))} aria-label={t('Remove')} title={t('Remove')}>×</button>
              </span>
            );
          })}
        </div>
      )}
      <div className="pr-chips">
        {value.length < MAX_ITEM_IMAGES && (
          <span style={{ width: 260 }}>
            <Combo
              value=""
              noneLabel={t('Add a picture…')}
              ariaLabel={t('Pictures on slides')}
              options={(data ?? []).map((i) => ({ value: String(i.id), label: i.name, hint: i.width ? `${i.width}×${i.height}` : undefined }))}
              onChange={(v) => v && onChange([...value, Number(v)])}
            />
          </span>
        )}
        <Link className="small" to="/library?tab=images" target="_blank">{data && !data.length ? t('Add pictures in Library → Images') : t('New…')}</Link>
      </div>
    </div>
  );
}

/**
 * The library panel's Pictures tab: a picture becomes an item of its own (not in the bulletin), shown as a slide —
 * e.g. a poster after the announcements.
 */
export function PicturesPanel({ onAdd }: { onAdd: (i: Partial<ServiceItem>) => void }) {
  const { t } = useI18n();
  const { settings } = useSession();
  const { data } = useApi<LibraryImage[]>('/images');
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  if (!data) return <Loading />;
  if (!data.length) return <p className="small muted">{t('No pictures yet.')} <Link to="/library?tab=images" target="_blank">{t('Add pictures in Library → Images')}</Link></p>;
  const add = (i: LibraryImage) => onAdd({
    kind: 'other',
    title: Object.fromEntries((settings?.languages ?? ['en']).map((l) => [l, i.name])),
    on_slides: false,
    in_bulletin: false,
    duration_min: 1,
    slide_images: [i.id],
  });
  return (
    <div className="stack tight">
      <SearchBox value={q} onChange={setQ} />
      <div className="lib-list img-pick">
        {data.filter((i) => !ql || i.name.toLowerCase().includes(ql)).map((i) => (
          <div key={i.id} className="lib-item" onClick={() => add(i)}>
            <span className="bg-mini" style={{ backgroundImage: `url("${imageUrl(i.id, i.version)}")` }} />
            <div className="grow">
              <div className="t">{i.name}</div>
              <div className="s">{i.width ? `${i.width}×${i.height}` : ''}{i.fit === 'cover' ? ` · ${t('Fill the slide')}` : ''}</div>
            </div>
            <span className="btn sm icon add" aria-label={t('Add')}><Icon name="plus" /></span>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>{t('Adds the picture as an item of its own, on the slides only. To show pictures after an item instead, open the item: Pictures on slides.')}</p>
    </div>
  );
}
