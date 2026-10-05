// Library → Check: songs and liturgical texts whose languages have drifted apart, likely duplicates, and Bible
// versions with missing chapters. Read-only; the check_library playbook lets an AI agent work through it.
import { useState } from 'react';
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Empty, ErrorBox, Loading, Modal } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { InfoTip } from '../components/InfoTip.tsx';

interface Issue {
  kind: string;
  level: 'check' | 'note';
  item: { type: 'song' | 'text' | 'bible'; id: number | string; title: string };
  detail: string;
}

const GROUP: [string, string[], string][] = [
  ['Missing languages', ['song_verses', 'text_parts'], 'A verse or part has words in one language but not in another.'],
  ['Lines that do not line up', ['song_lines', 'text_paragraphs', 'text_speakers'], 'Different numbers of lines or paragraphs, or Leader / People lines in a different order. A translation can rightly differ; these are worth a look.'],
  ['Possible duplicates', ['duplicate_title', 'duplicate_number'], 'Two songs or texts with the same title, or a hymnal number used twice. Keep one and move anything useful (numbers, words) across.'],
  ['Bible versions', ['bible_verses'], 'Chapters where a version has fewer verses than another: usually different verse numbering, sometimes a missing book.'],
];

export function LibraryCheckButton() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}><Icon name="check" />{t('Check library')}</button>
      {open && <LibraryCheck onClose={() => setOpen(false)} />}
    </>
  );
}

function LibraryCheck({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const { data, error } = useApi<{ issues: Issue[]; checked: Record<string, number> }>('/library/checks');
  return (
    <Modal title={t('Check library')} onClose={onClose} size="lg">
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : !data.issues.length ? <Empty title={t('Nothing to report: the languages line up and there are no duplicates.')} /> : (
        <div className="stack">
          <p className="small muted" style={{ margin: 0 }}>
            {t('Checked {s} songs, {x} liturgical texts and {c} Bible chapters.').replace('{s}', String(data.checked.songs)).replace('{x}', String(data.checked.texts)).replace('{c}', String(data.checked.bible_chapters))}
            {' '}{t('An AI assistant can go through this with you: the check_library playbook.')}
          </p>
          {GROUP.map(([label, kinds, tip]) => {
            const xs = data.issues.filter((i) => kinds.includes(i.kind));
            if (!xs.length) return null;
            return (
              <details key={label} className="check-group" open={xs.length <= 12}>
                <summary><strong>{t(label)}</strong> <span className="badge">{xs.length}</span> <InfoTip text={t(tip)} /></summary>
                <table className="t">
                  <tbody>
                    {xs.slice(0, 200).map((i, n) => (
                      <tr key={n}>
                        <td className="nowrap">{i.level === 'check' ? <span className="badge warn">{t('Check')}</span> : <span className="badge">{t('Note')}</span>}</td>
                        <td>{i.item.title || `#${i.item.id}`}<div className="small muted">{i.item.type === 'song' ? t('Song') : i.item.type === 'text' ? t('Liturgical text') : t('Bible')} {i.item.type !== 'bible' ? `#${i.item.id}` : ''}</div></td>
                        <td className="small">{i.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {xs.length > 200 && <div className="small muted">{t('{n} more not shown.').replace('{n}', String(xs.length - 200))}</div>}
              </details>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
