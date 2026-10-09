// Church logo upload for Settings → Church: preview, replace and remove (PUT/DELETE /api/assets/logo).
import { useRef } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { confirmAction, useAction } from './ui.tsx';
import { Icon } from './icons.tsx';
import { logoIsSvg, logoUrl, refreshLogo, useLogo } from './brand.tsx';

// no SVG (0.19.11): it can carry script. One uploaded before keeps showing, with a suggestion to replace it.
const ACCEPT = 'image/png,image/jpeg,image/webp';
const MAX = 2 * 1024 * 1024;

export function LogoField() {
  const { t } = useI18n();
  const version = useLogo();
  const { run, busy } = useAction();
  const input = useRef<HTMLInputElement>(null);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    await run(async () => {
      if (!ACCEPT.split(',').includes(file.type)) throw new Error(t('Upload a PNG, JPEG or WebP image'));
      if (file.size > MAX) throw new Error(t('The logo must be 2 MB or smaller'));
      await api.put('/assets/logo', file);
      await refreshLogo();
      return true;
    }, t('Logo saved.'));
    if (input.current) input.current.value = '';
  };
  const remove = async () => {
    if (!confirmAction(t('Remove the church logo?'))) return;
    await run(async () => {
      await api.del('/assets/logo');
      await refreshLogo();
      return true;
    }, t('Logo removed.'));
  };

  return (
    <div className="logo-drop">
      <div className="logo-preview">
        {version ? <img src={logoUrl(version)} alt={t('Church logo')} /> : <span className="muted">{t('No logo')}</span>}
      </div>
      <div className="stack tight">
        <div className="row">
          <button type="button" className="btn sm" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="upload" />{version ? t('Replace logo') : t('Upload logo')}
          </button>
          {version && <button type="button" className="btn sm ghost danger" disabled={busy} onClick={remove}><Icon name="trash" />{t('Remove')}</button>}
        </div>
        <span className="field-hint">{t('PNG, JPEG or WebP, up to 2 MB. Shown in the sidebar, on the sign-in page, share page, slides and the “Church logo” bulletin cover.')}</span>
        {version && logoIsSvg() && <span className="field-hint">{t('This logo is an SVG, which Canon no longer takes (it can carry script). It still shows; replace it with a PNG when you can.')}</span>}
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </div>
  );
}
