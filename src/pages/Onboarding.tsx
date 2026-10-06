// First-run onboarding (and Settings → Languages): content languages, Bibles per language (catalog downloads
// and church uploads),
// default languages for bulletins/slides and the bilingual layout.
import { useEffect, useState } from 'react';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Field, Seg, confirmAction, useAction, useSession } from '../components/ui.tsx';
import { Icon, ReedMark } from '../components/icons.tsx';
import { AddBibleDialog, CopyrightNote, refreshBibles, type Translation } from '../components/BibleTools.tsx';
import { LanguagePicker } from '../components/LanguagePicker.tsx';
import { MAX_SERVICE_LANGS, langInfo } from '../../shared/languages.ts';
import type { Lang, Settings } from '../types-client.ts';
import { ModulesPanel } from './settings/ModulesTab.tsx';
import { BundledLibraryPanel } from './library/BundledLibrary.tsx';
import { BIBLE_USES, type BibleUse } from '../../shared/bible-rights.ts';
import { RightsDialog } from './library/RightsDialog.tsx';

interface CatalogBible { code: string; name: string; lang: string; year?: number; imported: number; job: { status: string; message: string } | null }
const OTHER = '_other';

const NOT_USE: Record<BibleUse, string> = { print: 'Not for printing', project: 'Not for projection', online: 'Not online' };

export function LanguagesPanel({ settings, onSaved, saveLabel }: { settings: Settings; onSaved: () => void; saveLabel?: string }) {
  const { t, lt } = useI18n();
  const { run, busy } = useAction();
  const [langs, setLangs] = useState<Lang[]>(settings.languages);
  const [bibles, setBibles] = useState<Record<string, string>>(settings.bibles);
  const [defaults, setDefaults] = useState<Lang[]>(settings.default_languages);
  const [layout, setLayout] = useState(settings.bilingual_layout);
  const catalog = useApi<CatalogBible[]>('/bible/catalog');
  const installed = useApi<Translation[]>('/bible/translations');
  // an administrator records a version's edition, licence and allowed uses
  const [rightsFor, setRightsFor] = useState<Translation | null>(null);
  const running = (catalog.data ?? []).some((b) => b.job?.status === 'running');
  // Onboarding runs before the session context exists; only an administrator ever sees it.
  const session = useSession() as ReturnType<typeof useSession> | null;
  const isAdmin = session ? session.isAdmin : true;
  const [adding, setAdding] = useState(false);
  const otherLangs = [...new Set((installed.data ?? []).map((x) => x.lang).filter((l) => !langs.includes(l)))];
  /** The default version shown for a language: the saved choice, else the catalog's first, else an upload. */
  const chosenFor = (l: Lang) =>
    bibles[l] ?? (catalog.data ?? []).find((b) => b.lang === l)?.code ?? (installed.data ?? []).find((x) => x.lang === l)?.code ?? '';
  const reloadBibles = () => {
    installed.reload();
    catalog.reload();
    refreshBibles().catch(() => undefined);
  };
  const remove = async (x: Translation) => {
    const u = await run(() => api.get<{ default_for: string[]; services: number }>(`/bible/translations/${encodeURIComponent(x.code)}/usage`));
    if (!u) return;
    const lines = [t('Delete {code} ({name}, {n} verses)?').replace('{code}', x.code).replace('{name}', x.name).replace('{n}', x.verses.toLocaleString())];
    if (u.default_for.length) lines.push(t('It is the default Bible for: {langs}. Readings will use another installed version until you choose a new default.').replace('{langs}', u.default_for.map((l) => langInfo(l).native).join(', ')));
    if (u.services) lines.push(t('{n} service(s) chose this version; they will fall back to the church default.').replace('{n}', String(u.services)));
    lines.push(x.source === 'upload' ? t('You would need the file to upload it again.') : t('It can be downloaded again at any time.'));
    if (!confirmAction(lines.join('\n\n'))) return;
    await run(() => api.del(`/bible/translations/${encodeURIComponent(x.code)}`), t('Deleted.'));
    reloadBibles();
  };

  // Poll while an import is running.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      catalog.reload();
      installed.reload();
    }, 1500);
    return () => clearInterval(id);
  }, [running, catalog, installed]);

  const defaultsShown = defaults.filter((l) => langs.includes(l));
  const toggleDefault = (l: Lang) => {
    const next = defaultsShown.includes(l) ? defaultsShown.filter((x) => x !== l) : [...defaultsShown, l];
    setDefaults(langs.filter((x) => next.includes(x)).slice(0, MAX_SERVICE_LANGS));
  };
  const save = () =>
    run(async () => {
      await api.patch('/settings', {
        languages: langs,
        bibles: Object.fromEntries(langs.map((l) => [l, chosenFor(l)]).filter(([, c]) => c)),
        default_languages: defaultsShown.length ? defaultsShown : langs.slice(0, 2),
        bilingual_layout: layout,
        onboarded: true,
      });
      onSaved();
    }, t('Saved.'));

  return (
    <div className="stack">
      {rightsFor && <RightsDialog version={rightsFor} onClose={() => setRightsFor(null)} onSaved={() => { setRightsFor(null); reloadBibles(); }} />}
      <section className="card stack">
        <h2>{t('Worship languages')}</h2>
        <p className="muted small" style={{ margin: 0 }}>{t('Every title, hymn, prayer and creed can be entered in each language. The first is the primary language. Simplified and Traditional Chinese convert automatically, so text only needs entering once.')}</p>
        <LanguagePicker value={langs} onChange={setLangs} />
      </section>

      <section className="card stack">
        <div className="row between">
          <h2>{t('Bible')}</h2>
          {isAdmin && <button className="btn sm" onClick={() => setAdding(true)}><Icon name="plus" />{t('Add a Bible')}</button>}
        </div>
        <p className="muted small" style={{ margin: 0 }}>{t('Public-domain Bibles can be downloaded and imported here. To use a licensed translation your church has permission for (e.g. ESV, NIV, 和合本修订版, Alkitab), choose Add a Bible and upload it as a CSV file.')}</p>
        <div className="table-wrap">
          <table className="t">
            <tbody>
              {[...langs, ...(otherLangs.length ? [OTHER] : [])].map((l) => {
                const other = l === OTHER;
                const info = langInfo(l);
                const options = other ? [] : (catalog.data ?? []).filter((b) => b.lang === l);
                const extra = other ? [] : (installed.data ?? []).filter((x) => x.lang === l && !options.some((o) => o.code === x.code));
                const chosen = chosenFor(l);
                const cur = options.find((o) => o.code === chosen);
                const mine = (installed.data ?? []).filter((x) => (other ? otherLangs.includes(x.lang) : x.lang === l));
                return (
                  <tr key={l}>
                    <td style={{ width: 180, verticalAlign: 'top' }}>
                      {other ? <strong>{t('Other languages')}</strong> : <><strong>{info.native}</strong><div className="small muted">{info.name}</div></>}
                    </td>
                    <td style={{ verticalAlign: 'top' }}>
                      {other ? null : options.length + extra.length ? (
                        <select value={chosen} onChange={(e) => setBibles({ ...bibles, [l]: e.target.value })} aria-label={t('Default version')}>
                          {options.map((o) => <option key={o.code} value={o.code}>{o.name}{o.year ? ` (${o.year})` : ''}{o.imported ? ' ✓' : ''}</option>)}
                          {extra.map((o) => <option key={o.code} value={o.code}>{o.code} — {o.name} ✓</option>)}
                        </select>
                      ) : (
                        <span className="small muted">{l === 'zh-Hant' || l === 'zh' ? '' : t('No public-domain Bible available — add one your church has permission to use.')}</span>
                      )}
                      {mine.length > 0 && (
                        <div className="bible-vers">
                          {mine.map((x) => (
                            <div key={x.code} className="bible-ver">
                              {/* the name and badges wrap among themselves; the buttons stay on the first line, at the right */}
                              <span className="info">
                                <span className="code">{x.code}</span>
                                <span>{x.name}{other ? ` · ${langInfo(x.lang).native}` : ''}</span>
                                <span className="muted">{x.verses.toLocaleString()} {t('verses')}</span>
                                <span className={`badge ${x.source === 'upload' ? 'reed' : 'lapis'}`} title={x.notes ?? x.license}>{x.source === 'upload' ? t('Uploaded') : t('Public domain')}</span>
                                {!other && x.code === chosen && <span className="badge ok">{t('Default')}</span>}
                                {x.rights && BIBLE_USES.some((u) => !x.rights![u]) && (
                                  <span className="badge warn" title={t('What the licence allows')}>{BIBLE_USES.filter((u) => !x.rights![u]).map((u) => t(NOT_USE[u])).join(' · ')}</span>
                                )}
                              </span>
                              {isAdmin && (
                                <span className="acts">
                                  <button className="btn ghost sm icon" title={t('Licence and allowed uses')} onClick={() => setRightsFor(x)}><Icon name="lock" /></button>
                                  <a className="btn ghost sm icon" href={`/api/bible/translations/${encodeURIComponent(x.code)}/export.csv`} download title={t('Export CSV')}><Icon name="download" /></a>
                                  <button className="btn ghost sm icon" title={t('Delete')} onClick={() => remove(x)}><Icon name="trash" /></button>
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="right nowrap" style={{ width: 230, verticalAlign: 'top' }}>
                      {cur && (cur.job?.status === 'running' ? (
                        <span className="small muted"><span className="spinner" style={{ width: 12, height: 12, display: 'inline-block', verticalAlign: -2 }} /> {cur.job.message}</span>
                      ) : cur.imported ? (
                        <span className="badge ok">{cur.imported.toLocaleString()} {t('verses')}</span>
                      ) : (
                        <button className="btn sm" onClick={() => run(() => api.post('/bible/import', { code: cur.code }).then(() => reloadBibles()))}>
                          {t('Download & import')}
                        </button>
                      ))}
                      {cur?.job?.status === 'error' && <div className="small" style={{ color: 'var(--danger)' }}>{cur.job.message}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <CopyrightNote />
        {adding && (
          <AddBibleDialog
            langs={langs}
            onClose={() => setAdding(false)}
            onDone={(code, l) => {
              reloadBibles();
              // a language without a public-domain Bible gets the upload as its default (saved with the rest of this page)
              if (langs.includes(l) && !bibles[l] && !(catalog.data ?? []).some((b) => b.lang === l)) setBibles((b) => ({ ...b, [l]: code }));
            }}
          />
        )}
      </section>

      <section className="card stack">
        <h2>{t('Bulletins & slides')}</h2>
        <Field label={t('Languages printed and projected by default')} hint={t('Up to 3. Each service can change this.')}>
          <div className="row">
            {langs.map((l) => (
              <label key={l} className="check"><input type="checkbox" checked={defaultsShown.includes(l)} onChange={() => toggleDefault(l)} />{langInfo(l).native}</label>
            ))}
          </div>
        </Field>
        <Field label={t('Bilingual layout')}>
          <Seg value={layout} onChange={setLayout} options={[{ value: 'parallel', label: t('Side by side') }, { value: 'stacked', label: t('Stacked') }]} />
        </Field>
        <div className="small muted">{lt({ en: 'Example', zh: '示例' })}: {defaultsShown.map((l) => langInfo(l).native).join(' · ')}</div>
      </section>

      <div className="row end">
        <button className="btn primary" onClick={save} disabled={busy || !langs.length}>{saveLabel ?? t('Save')}</button>
      </div>
    </div>
  );
}

export default function Onboarding({ settings, onDone }: { settings: Settings; onDone: () => void }) {
  const { t, lt } = useI18n();
  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="row" style={{ gap: 12, marginBottom: 8 }}>
        <ReedMark className="brand-mark" />
        <div>
          <div className="eyebrow">{t('Getting started')}</div>
          <h1>{lt(settings.church_name)}</h1>
        </div>
      </div>
      <p className="muted">{t('Choose the parts of Canon you use, add Canon’s library, and choose the languages your church worships in and their Bibles. You can change all of this later.')}</p>
      <section className="card stack" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>{t('Modules')}</h2>
        <ModulesPanel initial={settings.modules} />
      </section>
      <section className="card stack" style={{ marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>{t('Canon’s library')}</h2>
        <BundledLibraryPanel />
      </section>
      <LanguagesPanel settings={settings} onSaved={onDone} saveLabel={t('Finish setup')} />
    </div>
  );
}
