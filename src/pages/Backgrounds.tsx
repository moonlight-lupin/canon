// Library → Slide backgrounds: full-screen pictures for the slides of one service item (e.g. bread and cup for the
// Lord's Supper). Each shows its size, with a warning when it is smaller than the screen; and the planner's
// "Slide background" picker.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Empty, ErrorBox, Loading, confirmAction, useAction, useSession, useToast } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { Combo } from '../components/Combo.tsx';
import { backgroundUrl } from '../../shared/presentation.ts';

export interface SlideBackground {
  id: number;
  name: string;
  mime: string;
  width: number | null;
  height: number | null;
  bytes: number;
  version: string;
  uses: number;
}

/** Big enough for a widescreen (1920 × 1080) projector, or only for 4:3, or smaller than either. */
export function sizeNote(b: Pick<SlideBackground, 'width' | 'height'>, t: (s: string) => string): { ok: boolean; text: string } {
  if (!b.width || !b.height) return { ok: true, text: '' };
  const dims = `${b.width} × ${b.height}`;
  if (b.width >= 1920 && b.height >= 1080) return { ok: true, text: dims };
  if (b.width >= 1440 && b.height >= 1080) return { ok: true, text: `${dims} · ${t('fits 4:3 screens; small for widescreen')}` };
  return { ok: false, text: `${dims} · ${t('smaller than the screen: it may look blurry')}` };
}

export function BackgroundsTab() {
  const { t } = useI18n();
  const toast = useToast();
  const { canEdit } = useSession();
  const { data, error, reload } = useApi<SlideBackground[]>('/backgrounds');
  const { run, busy } = useAction();
  const file = useRef<HTMLInputElement>(null);
  const replaceFor = useRef<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [name, setName] = useState('');

  const pick = (id: number | null) => {
    replaceFor.current = id;
    file.current?.click();
  };
  const upload = (f: File | undefined) => {
    if (file.current) file.current.value = '';
    if (!f) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) return toast(t('Upload a PNG, JPEG or WebP picture'), true);
    if (f.size > 10 * 1024 * 1024) return toast(t('The picture must be 10 MB or smaller'), true);
    const id = replaceFor.current;
    run(async () => {
      if (id) await api.put(`/backgrounds/${id}`, f);
      else await api.post(`/backgrounds?name=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ''))}`, f);
      await reload();
    }, t('Picture saved.'));
  };
  const rename = (id: number) => run(async () => {
    await api.patch(`/backgrounds/${id}`, { name });
    setEditing(null);
    await reload();
  }, t('Saved.'));
  const remove = async (b: SlideBackground) => {
    if (!await confirmAction(b.uses ? t('Delete this background? {n} service items use it; they go back to the slide template’s background.').replace('{n}', String(b.uses)) : t('Delete this background?'))) return;
    run(async () => {
      await api.del(`/backgrounds/${b.id}`);
      await reload();
    }, t('Deleted.'));
  };

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="row between">
        <p className="small muted" style={{ margin: 0, maxWidth: 680 }}>
          {t('Full-screen pictures for the slides of one service item, e.g. bread and cup for the Lord’s Supper. Choose one in the planner (item → Slide background). For widescreen projectors use 1920 × 1080; for 4:3, 1440 × 1080.')}
          {' '}<InfoTip text={t('QR codes and pictures for the bulletin stay in QR codes & notes; these are only for slide backgrounds.')} />
        </p>
        {canEdit && <button className="btn primary" onClick={() => pick(null)} disabled={busy}><Icon name="upload" />{t('Add background…')}</button>}
      </div>
      <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
      {!data.length ? <div className="card"><Empty title={t('No slide backgrounds yet.')} /></div> : (
        <div className="bg-grid">
          {data.map((b) => {
            const note = sizeNote(b, t);
            return (
              <div key={b.id} className="card bg-card">
                <div className="bg-thumb" style={{ backgroundImage: `url("${backgroundUrl(b.id, b.version)}")` }} />
                {editing === b.id ? (
                  <div className="row" style={{ gap: 6 }}>
                    <input value={name} onChange={(e) => setName(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && rename(b.id)} />
                    <button className="btn sm primary" onClick={() => rename(b.id)} disabled={busy}>{t('Save')}</button>
                  </div>
                ) : <div className="bg-name">{b.name}</div>}
                <div className={`small ${note.ok ? 'muted' : 'warn-text'}`}>{note.text}{note.text ? ' · ' : ''}{(b.bytes / 1e6).toFixed(1)} MB</div>
                <div className="small muted">{b.uses ? t('Used by {n} items').replace('{n}', String(b.uses)) : t('Not used yet')}</div>
                {canEdit && (
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn sm ghost" onClick={() => { setEditing(b.id); setName(b.name); }}><Icon name="edit" />{t('Rename')}</button>
                    <button className="btn sm ghost" onClick={() => pick(b.id)} disabled={busy}><Icon name="upload" />{t('Replace')}</button>
                    <button className="btn sm ghost icon danger" onClick={() => remove(b)} aria-label={t('Delete')} title={t('Delete')}><Icon name="trash" /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The planner's "Slide background": a picture from Library → Slide backgrounds, or the template's. */
export function SlideBackgroundPicker({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const { t } = useI18n();
  const { data } = useApi<SlideBackground[]>('/backgrounds');
  const cur = data?.find((b) => b.id === value);
  return (
    <div className="pr-chips">
      {cur && <span className="bg-mini" style={{ backgroundImage: `url("${backgroundUrl(cur.id, cur.version)}")` }} />}
      <span style={{ width: 260 }}>
        <Combo
          value={value ? String(value) : ''}
          noneLabel={t('Slide template background')}
          ariaLabel={t('Slide background')}
          options={(data ?? []).map((b) => ({ value: String(b.id), label: b.name, hint: b.width ? `${b.width}×${b.height}` : undefined }))}
          onChange={(v) => onChange(v ? Number(v) : null)}
        />
      </span>
      <Link className="small" to="/library?tab=backgrounds" target="_blank">{data && !data.length ? t('Add a picture in Library → Slide backgrounds') : t('New…')}</Link>
    </div>
  );
}
