// Licence warnings in the planner: a passage whose Bible version doesn't allow how this service uses it (printed in
// the bulletin, projected, online on the share page). Those outputs show the reference only (Library → Bible versions).
import { useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import type { BibleUse } from '../../../shared/bible-rights.ts';
import type { L10n, Lang } from '../../../shared/types.ts';

interface RightsWarning { item_id: number; ref: L10n; lang: Lang; translation: string; uses: BibleUse[] }

const USE: Record<BibleUse, string> = { print: 'printed in the bulletin', project: 'projected', online: 'online (the share link is on)' };

/** `version` changes whenever the passages, their versions, the outputs they go to or the share link change. */
export function RightsWarnings({ sid, version }: { sid: number; version: string }) {
  const { t, lt } = useI18n();
  // a short hash keeps the address small (the key includes pasted texts)
  let hash = 0;
  for (let i = 0; i < version.length; i++) hash = (hash * 31 + version.charCodeAt(i)) | 0;
  const w = useApi<RightsWarning[]>(`/services/${sid}/rights?v=${(hash >>> 0).toString(36)}`);
  if (!w.data?.length) return null;
  return (
    <div className="callout warn small">
      <strong>{t('Bible licence')}</strong> — {t('these passages show their reference without the text where the version’s licence doesn’t allow it:')}
      <ul style={{ margin: '4px 0 0' }}>
        {w.data.map((x) => (
          <li key={`${x.item_id}-${x.lang}`}>
            {lt(x.ref) || x.ref[x.lang]} ({x.translation}): {t('not licensed to be')} {x.uses.map((u) => t(USE[u])).join(', ')}
          </li>
        ))}
      </ul>
      <div className="muted">{t('Choose another version for the passage, paste licensed text, or record the licence in Settings → Languages.')}</div>
    </div>
  );
}
