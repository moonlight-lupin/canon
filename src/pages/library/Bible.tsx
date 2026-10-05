// Library → Bible: read a passage in the church's versions side by side.
import { useEffect, useState } from 'react';
import { api, qs } from '../../api.ts';
import { Link } from 'react-router-dom';
import { useContentLangs, useI18n } from '../../i18n.tsx';
import { langInfo } from '../../../shared/languages.ts';
import { Field, Loading, useDebounced, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { CopyrightNote, useBibles, useChurchBible } from '../../components/BibleTools.tsx';
import type { Lang } from '../../types-client.ts';

export interface Passage { ref: string; translation: string; verses: { book: number; chapter: number; verse: number; text: string }[] }

/** One column of the lookup: a language and a version ('' = the church default for that language). */
export interface BibleCol { lang: Lang; code: string }

export function Bible() {
  const { t } = useI18n();
  const langs = useContentLangs();
  const { isAdmin } = useSession();
  const bibles = useBibles() ?? [];
  const churchBible = useChurchBible();
  const [ref, setRef] = useState('Psalm 23');
  const dref = useDebounced(ref, 400);
  const [cols, setCols] = useState<BibleCol[]>(() => langs.map((l) => ({ lang: l, code: '' })));
  const [res, setRes] = useState<Record<number, Passage | string>>({});
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 400);
  const [hits, setHits] = useState<{ ref: string; text: string }[]>([]);
  const colKey = cols.map((c) => `${c.lang}:${c.code}`).join('|');
  useEffect(() => {
    if (!dref.trim()) return;
    let live = true;
    Promise.all(cols.map((c, i) => api.get<Passage>(`/bible/passage${qs({ ref: dref, lang: c.lang, translation: c.code })}`).then((p) => [i, p] as const).catch((e) => [i, (e as Error).message] as const)))
      .then((r) => live && setRes(Object.fromEntries(r)));
    return () => { live = false; };
  }, [dref, colKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (dq.trim().length < 2) { setHits([]); return; }
    // search the first column whose language matches the script of the query
    const cjk = /[一-鿿]/.test(dq);
    const col = cols.find((c) => (cjk ? langInfo(c.lang).cjk : !langInfo(c.lang).cjk));
    const tr = col ? col.code || churchBible(col.lang) : cjk ? 'CUVS' : 'KJV';
    api.get<{ ref: string; text: string }[]>(`/bible/search${qs({ q: dq, translation: tr })}`).then(setHits).catch(() => setHits([]));
  }, [dq, colKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Choosing a version of another language moves the column to that language. */
  const pick = (i: number, value: string) => {
    const [lang, code] = value.split('|');
    setCols(cols.map((c, j) => (j === i ? { lang, code } : c)));
  };
  const byLang = [...new Set([...langs, ...bibles.map((b) => b.lang)])];
  return (
    <div className="stack">
      <div className="grid cols-2">
        <Field label={t('Reference')} hint="Romans 8:28-39 · Ps 23 · 约翰福音 3:16 · 林前 13"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        <Field label={t('Search')} hint="grace · 恩典"><input value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      </div>
      <div className="row between">
        <div className="bible-pick">
          <span className="small muted">{t('Versions')}</span>
          {cols.map((c, i) => (
            <span key={i} className="row" style={{ gap: 2 }}>
              <select className="bible-sel" value={`${c.lang}|${c.code}`} onChange={(e) => pick(i, e.target.value)} aria-label={`${t('Version')} ${i + 1}`}>
                {byLang.map((l) => (
                  <optgroup key={l} label={langInfo(l).native}>
                    {langs.includes(l) && <option value={`${l}|`}>{t('Church default')} ({churchBible(l) ?? '—'})</option>}
                    {bibles.filter((b) => b.lang === l).map((b) => <option key={b.code} value={`${l}|${b.code}`}>{b.code} — {b.name}</option>)}
                  </optgroup>
                ))}
              </select>
              {cols.length > 1 && <button className="btn ghost sm icon" title={t('Remove')} onClick={() => setCols(cols.filter((_, j) => j !== i))}><Icon name="x" /></button>}
            </span>
          ))}
          {cols.length < 4 && <button className="btn ghost sm" onClick={() => setCols([...cols, { lang: cols[0]?.lang ?? langs[0], code: '' }])}><Icon name="plus" />{t('Compare')}</button>}
        </div>
        {isAdmin && <Link className="small" to="/settings?tab=languages">{t('Add a Bible')} →</Link>}
      </div>
      {hits.length > 0 ? (
        <div className="card">
          {hits.map((h, i) => (
            <div key={i} className="lib-item" onClick={() => { setRef(h.ref); setQ(''); }}>
              <span className="badge reed nowrap">{h.ref}</span><span className="serif small">{h.text}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="pair" style={cols.length > 2 ? { gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` } : cols.length === 1 ? { gridTemplateColumns: '1fr' } : undefined}>
          {cols.map((c, i) => {
            const p = res[i];
            return (
              <div key={i} className="card serif" lang={langInfo(c.lang).htmlLang} style={{ lineHeight: 1.75, fontSize: 15 }}>
                {typeof p === 'string' ? <span className="muted">{p}</span> : p ? (
                  <>
                    <div className="eyebrow">{p.ref}<span className="bible-tag">{p.translation || '—'}</span></div>
                    {p.verses.map((v, k) => (
                      <span key={k}>{(k === 0 || v.chapter !== p.verses[k - 1].chapter) && p.verses.some((x) => x.chapter !== p.verses[0].chapter) && <strong> {v.chapter}:</strong>}<sup style={{ color: 'var(--reed-ink)' }}>{v.verse}</sup>{v.text} </span>
                    ))}
                    {!p.verses.length && <span className="muted">—</span>}
                  </>
                ) : <Loading />}
              </div>
            );
          })}
        </div>
      )}
      {bibles.some((b) => b.source === 'upload') && <CopyrightNote />}
    </div>
  );
}
