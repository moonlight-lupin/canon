// A Bible version's licence (administrators): its edition, the licence text, and what it may be used for — printed
// (bulletins, Word files), projected (slides) and online (the public share page). Outputs a use isn't allowed for
// show the passage's reference without the text (shared/bible-rights.ts).
import { useState } from 'react';
import { api } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, Modal, useAction } from '../../components/ui.tsx';
import { refreshBibles, type Translation } from '../../components/BibleTools.tsx';
import { ALL_RIGHTS, BIBLE_USES, type BibleRights, type BibleUse } from '../../../shared/bible-rights.ts';

const USE_LABEL: Record<BibleUse, [string, string]> = {
  print: ['Printed', 'Bulletins and Word files'],
  project: ['Projected', 'Slides, presentation files and FreeShow'],
  online: ['Online', 'The public share page'],
};

export function RightsDialog({ version, onClose, onSaved }: { version: Translation; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [edition, setEdition] = useState(version.edition ?? '');
  const [license, setLicense] = useState(version.license ?? '');
  const [rights, setRights] = useState<BibleRights>(version.rights ?? ALL_RIGHTS);
  const save = async () => {
    const ok = await run(() => api.patch(`/bible/translations/${encodeURIComponent(version.code)}`, { edition: edition.trim() || null, license: license.trim(), rights }), t('Saved.'));
    if (ok) {
      refreshBibles();
      onSaved();
    }
  };
  return (
    <Modal
      title={`${version.code} — ${t('Licence and allowed uses')}`}
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>{t('Cancel')}</button><button className="btn primary" onClick={save} disabled={busy}>{t('Save')}</button></>}
    >
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('Record what the publisher’s permission covers. Where a use isn’t allowed, that output shows the passage’s reference without the text, and the service planner warns beforehand.')}</p>
        <Field label={t('Edition')} hint={t('e.g. the year of the text')}>
          <input value={edition} onChange={(e) => setEdition(e.target.value)} maxLength={100} />
        </Field>
        <Field label={t('Licence')}>
          <textarea value={license} onChange={(e) => setLicense(e.target.value)} maxLength={300} rows={3} />
        </Field>
        <div className="stack tight">
          {BIBLE_USES.map((u) => (
            <label key={u} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={rights[u]} onChange={(e) => setRights({ ...rights, [u]: e.target.checked })} />
              <span><strong>{t(USE_LABEL[u][0])}</strong> <span className="small muted">— {t(USE_LABEL[u][1])}</span></span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
