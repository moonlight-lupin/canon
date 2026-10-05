import { useEffect, useMemo, useState } from 'react';
import { hasAnyText } from '../../shared/labels.ts';
import { compareHymnNumbers, matchesHymnNumber } from '../../shared/parts.ts';
import { api, qs, useApi } from '../api.ts';
import { Link, useSearchParams } from 'react-router-dom';
import { BlocksTab } from './Blocks.tsx';
import { useContentLangs, useI18n } from '../i18n.tsx';
import { langInfo } from '../../shared/languages.ts';
import { Bi, Empty, Field, L10nInput, Loading, Modal, PageHead, SearchBox, confirmAction, useAction, useDebounced, useSession } from '../components/ui.tsx';
import { BackgroundsTab } from './Backgrounds.tsx';
import { LibraryCheckButton } from './LibraryCheck.tsx';
import { Icon } from '../components/icons.tsx';
import { CsvTools } from '../components/CsvTools.tsx';
import { CopyrightNote, useBibles, useChurchBible } from '../components/BibleTools.tsx';
import type { Hymnal, L10n, Lang, LiturgyText, Song, SongCategory, Stanza, TextCategory, TextPart } from '../types-client.ts';

const SONG_CATS: SongCategory[] = ['hymn', 'psalm', 'song', 'doxology', 'response'];
const SONG_CAT_LABEL: Record<SongCategory, L10n> = {
  hymn: { en: 'Hymn', zh: '圣诗' }, psalm: { en: 'Psalm', zh: '诗篇' }, song: { en: 'Song', zh: '诗歌' },
  doxology: { en: 'Doxology', zh: '颂荣' }, response: { en: 'Response', zh: '回应' },
};
export const TEXT_CATS: TextCategory[] = ['call_to_worship', 'invocation', 'confession', 'assurance', 'creed', 'catechism', 'prayer', 'sacrament', 'benediction', 'liturgy', 'other'];
export const TEXT_CAT_LABEL: Record<TextCategory, L10n> = {
  call_to_worship: { en: 'Call to worship', zh: '宣召' }, invocation: { en: 'Invocation', zh: '祈祷' },
  confession: { en: 'Confession of sin', zh: '认罪' }, assurance: { en: 'Assurance of pardon', zh: '赦罪宣告' },
  creed: { en: 'Creed', zh: '信经' }, catechism: { en: 'Catechism', zh: '要理问答' }, prayer: { en: 'Prayer', zh: '祷文' },
  sacrament: { en: 'Sacrament', zh: '圣礼' }, benediction: { en: 'Benediction', zh: '祝福' }, liturgy: { en: 'Liturgy', zh: '礼文' },
  other: { en: 'Other', zh: '其他' },
};

type HymnalRow = Hymnal & { song_count: number };
const STANDARD_KEYS = ['wsc', 'wlc', 'wcf'];

/** "HP 123 · TH 100" */
const numbersOf = (s: Song) => (s.hymnals ?? []).map((h) => `${h.abbr} ${h.number}`).join(' · ');

/** Does a song match a search: words anywhere, or a hymnal number ("HP 123", "#123", "123")? */
export function songMatches(s: Song, q: string): boolean {
  const ql = q.trim().toLowerCase();
  if (!ql) return true;
  if (matchesHymnNumber(s.hymnals, ql)) return true;
  return JSON.stringify([s.title, s.author, s.tune, s.tags, s.psalm, s.stanzas[0]]).toLowerCase().includes(ql);
}

type LibTab = 'songs' | 'hymnals' | 'texts' | 'bible' | 'blocks' | 'backgrounds';
const LIB_TABS: LibTab[] = ['songs', 'hymnals', 'texts', 'bible', 'blocks', 'backgrounds'];
const LIB_TAB_LABEL: Record<LibTab, string> = { songs: 'Hymns & songs', hymnals: 'Hymnals', texts: 'Liturgical texts', bible: 'Bible', blocks: 'QR codes & notes', backgrounds: 'Slide backgrounds' };

export default function Library() {
  const { t } = useI18n();
  // ?tab=blocks (and the other tab names) opens that tab, e.g. from the planner's "QR codes & notes on slides"
  const [sp, setSp] = useSearchParams();
  const q = sp.get('tab') as LibTab | null;
  const tab: LibTab = q && LIB_TABS.includes(q) ? q : 'songs';
  const setTab = (k: LibTab) => setSp(k === 'songs' ? {} : { tab: k }, { replace: true });
  return (
    <div className="page">
      <PageHead eyebrow={`${t('Service Planner')} · ${t('Library')}`} title={t(LIB_TAB_LABEL[tab])}>
        {(tab === 'songs' || tab === 'texts' || tab === 'bible') && <LibraryCheckButton />}
      </PageHead>
      <div className="tabs">
        {LIB_TABS.map((k) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t(LIB_TAB_LABEL[k])}</button>)}
      </div>
      {tab === 'songs' && <Songs />}
      {tab === 'hymnals' && <Hymnals />}
      {tab === 'texts' && <Texts />}
      {tab === 'bible' && <Bible />}
      {tab === 'blocks' && <BlocksTab />}
      {tab === 'backgrounds' && <BackgroundsTab />}
    </div>
  );
}

// ------------------------------------------------------------------ songs

function Songs() {
  const { t, lt } = useI18n();
  const { canEdit } = useSession();
  const { data, reload } = useApi<Song[]>('/songs');
  const { data: hymnals } = useApi<HymnalRow[]>('/hymnals');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<SongCategory | ''>('');
  const [hymnal, setHymnal] = useState<string>('');
  const [edit, setEdit] = useState<Partial<Song> | null>(null);
  const hid = Number(hymnal) || 0;
  const numIn = (s: Song) => s.hymnals?.find((h) => h.hymnal_id === hid)?.number;
  const rows = useMemo(() => {
    const xs = (data ?? []).filter((s) => (!cat || s.category === cat)
      && (!hymnal || (hymnal === 'none' ? !s.hymnals?.length : !!numIn(s)))
      && songMatches(s, q));
    return hid ? xs.sort((a, b) => compareHymnNumbers(numIn(a)!, numIn(b)!)) : xs;
  }, [data, cat, hymnal, q]);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="grow" style={{ maxWidth: 360 }}><SearchBox value={q} onChange={setQ} placeholder={t('Title, words or number (HP 123)')} /></div>
        <select value={cat} onChange={(e) => setCat(e.target.value as SongCategory | '')} style={{ width: 150 }}>
          <option value="">{t('All')}</option>
          {SONG_CATS.map((c) => <option key={c} value={c}>{lt(SONG_CAT_LABEL[c])}</option>)}
        </select>
        {!!hymnals?.length && (
          <select value={hymnal} onChange={(e) => setHymnal(e.target.value)} style={{ width: 200 }} aria-label={t('Hymnal')}>
            <option value="">{t('All hymnals')}</option>
            {hymnals.map((h) => <option key={h.id} value={h.id}>{h.abbr} · {lt(h.name)}</option>)}
            <option value="none">{t('Not in a hymnal')}</option>
          </select>
        )}
        <div className="grow" />
        <CsvTools entity="songs" label={t('Hymns & songs')} onImported={reload} />
        {canEdit && <button className="btn primary" onClick={() => setEdit({ title: {}, stanzas: [{ label: '1', text: {} }], category: 'hymn', tags: [], public_domain: false, refrain_after_each: false, hymnals: [] })}><Icon name="plus" />{t('New song')}</button>}
      </div>
      {!data ? <Loading /> : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr><th style={{ width: 90 }}>{t('Number')}</th><th>{t('Title')}</th><th>{t('Author')}</th><th>{t('Tune')}</th><th>{t('Languages')}</th><th></th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const present = langsIn(s.stanzas.map((x) => x.text));
                return (
                  <tr key={s.id} className="click" onClick={() => setEdit(s)}>
                    <td className="small nowrap" style={{ color: 'var(--reed-ink)', fontVariantNumeric: 'tabular-nums' }}>{hid ? `${hymnals?.find((h) => h.id === hid)?.abbr ?? ''} ${numIn(s) ?? ''}` : numbersOf(s)}</td>
                    <td>
                      <strong className="serif"><Bi v={s.title} /></strong>
                      {s.psalm ? <span className="badge reed" style={{ marginLeft: 6 }}>Ps {s.psalm}</span> : null}
                      {!s.stanzas.length && <span className="badge warn" style={{ marginLeft: 6 }}>{t('No words yet')}</span>}
                    </td>
                    <td className="small">{s.author}</td>
                    <td className="small muted">{s.tune}{s.meter ? ` · ${s.meter}` : ''}</td>
                    <td className="nowrap">
                      <LangBadges present={present} />
                    </td>
                    <td className="right">{s.public_domain ? <span className="badge ok">PD</span> : <span className="badge warn">© {s.ccli ? `CCLI ${s.ccli}` : ''}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!rows.length && <Empty title="—" />}
        </div>
      )}
      {edit && <SongEditor song={edit} hymnals={hymnals ?? []} canEdit={canEdit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function SongEditor({ song, hymnals, canEdit, onClose, onSaved }: { song: Partial<Song>; hymnals: Hymnal[]; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { t, lt } = useI18n();
  const { run, busy } = useAction();
  const [s, setS] = useState<Partial<Song>>(song);
  const [refs, setRefs] = useState<{ hymnal_id: number; number: string }[]>((song.hymnals ?? []).map(({ hymnal_id, number }) => ({ hymnal_id, number })));
  const set = <K extends keyof Song>(k: K, v: Song[K]) => setS((x) => ({ ...x, [k]: v }));
  const stanzas = s.stanzas ?? [];
  const setStanza = (i: number, st: Stanza) => set('stanzas', stanzas.map((x, j) => (j === i ? st : x)));
  const move = (i: number, d: number) => {
    const a = [...stanzas];
    const [x] = a.splice(i, 1);
    a.splice(i + d, 0, x);
    set('stanzas', a);
  };
  const refsChanged = JSON.stringify(refs) !== JSON.stringify((song.hymnals ?? []).map(({ hymnal_id, number }) => ({ hymnal_id, number })));
  const refsOk = refs.every((r) => r.number.trim()) && new Set(refs.map((r) => r.hymnal_id)).size === refs.length;
  const save = async () => {
    const { id, hymnals: _h, ...body } = s as Song;
    const saved = id
      ? await run(() => api.patch<Song>(`/songs/${id}`, body))
      : await run(() => api.post<Song>('/songs', body));
    if (!saved) return;
    if (refsChanged && !(await run(() => api.put(`/songs/${saved.id}/hymnals`, refs.map((r) => ({ ...r, number: r.number.trim() })))))) return;
    await run(async () => saved, t('Saved.'));
    onSaved();
  };
  const unused = hymnals.filter((h) => !refs.some((r) => r.hymnal_id === h.id));
  return (
    <Modal title={s.id ? lt(s.title) : t('New song')} onClose={onClose} size="lg" footer={canEdit ? (
      <>
        {s.id && <button className="btn danger left" onClick={async () => { if (confirmAction(t('Are you sure?')) && await run(() => api.del(`/songs/${s.id}`))) onSaved(); }}><Icon name="trash" />{t('Delete')}</button>}
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !hasAnyText(s.title) || !refsOk} onClick={save}>{t('Save')}</button>
      </>
    ) : undefined}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <Field label={t('Title')}><L10nInput value={s.title} onChange={(v) => set('title', v)} /></Field>
        <div className="form-grid">
          <Field label={t('Author')}><input value={s.author ?? ''} onChange={(e) => set('author', e.target.value)} /></Field>
          <Field label={t('Composer')}><input value={s.composer ?? ''} onChange={(e) => set('composer', e.target.value)} /></Field>
          <Field label={t('Tune')}><input value={s.tune ?? ''} onChange={(e) => set('tune', e.target.value)} /></Field>
          <Field label={t('Meter')}><input value={s.meter ?? ''} onChange={(e) => set('meter', e.target.value)} /></Field>
          <Field label={t('Year')}><input type="number" value={s.year ?? ''} onChange={(e) => set('year', e.target.value ? Number(e.target.value) : null)} /></Field>
          <Field label={t('Category')}>
            <select value={s.category} onChange={(e) => set('category', e.target.value as SongCategory)}>
              {SONG_CATS.map((c) => <option key={c} value={c}>{lt(SONG_CAT_LABEL[c])}</option>)}
            </select>
          </Field>
          {s.category === 'psalm' && <Field label="Psalm #"><input type="number" min={1} max={150} value={s.psalm ?? ''} onChange={(e) => set('psalm', e.target.value ? Number(e.target.value) : null)} /></Field>}
          <Field label={t('Tags')}><input value={(s.tags ?? []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></Field>
        </div>

        <div>
          <div className="row" style={{ marginBottom: 6 }}>
            <h3>{t('Hymnal numbers')}</h3>
            <div className="grow" />
            {canEdit && unused.length > 0 && (
              <button className="btn sm" onClick={() => setRefs([...refs, { hymnal_id: unused[0].id, number: '' }])}><Icon name="plus" />{t('Add number')}</button>
            )}
          </div>
          {!hymnals.length && <div className="field-hint">{t('Add your hymnals in Library → Hymnals to record hymn numbers.')}</div>}
          <div className="stack tight">
            {refs.map((r, i) => (
              <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
                <select value={r.hymnal_id} style={{ maxWidth: 280 }} aria-label={t('Hymnal')} onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, hymnal_id: Number(e.target.value) } : x)))}>
                  {hymnals.filter((h) => h.id === r.hymnal_id || !refs.some((x) => x.hymnal_id === h.id)).map((h) => <option key={h.id} value={h.id}>{h.abbr} · {lt(h.name)}</option>)}
                </select>
                <input style={{ width: 110 }} value={r.number} placeholder="123" aria-label={t('Number')} maxLength={12} onChange={(e) => setRefs(refs.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} />
                <button className="btn sm ghost icon danger" onClick={() => setRefs(refs.filter((_, j) => j !== i))} aria-label={t('Delete')}><Icon name="trash" /></button>
              </div>
            ))}
          </div>
        </div>

        <div className="row">
          <label className="check"><input type="checkbox" checked={!!s.public_domain} onChange={(e) => set('public_domain', e.target.checked)} />{t('Public domain')}</label>
          <label className="check"><input type="checkbox" checked={!!s.refrain_after_each} onChange={(e) => set('refrain_after_each', e.target.checked)} />{t('Refrain after each stanza')}</label>
        </div>
        {!s.public_domain && (
          <div className="form-grid">
            <Field label={t('Copyright')}><input value={s.copyright ?? ''} onChange={(e) => set('copyright', e.target.value)} placeholder="© 2001 Thankyou Music" /></Field>
            <Field label={t('CCLI song #')}><input value={s.ccli ?? ''} onChange={(e) => set('ccli', e.target.value)} /></Field>
          </div>
        )}
        <h3>{t('Stanzas')}</h3>
        <div className="field-hint">{lt({ en: "Use label R for a refrain. Paste the Chinese words beside the English so bulletins and slides show both.", zh: '副歌标签请用 R。中英文并排输入，次序单与投影即可双语显示。' })}</div>
        {stanzas.map((st, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <Field label={t('Label')}><input style={{ width: 70 }} value={st.label} onChange={(e) => setStanza(i, { ...st, label: e.target.value })} /></Field>
              <div className="grow" />
              <button className="btn sm ghost icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up"><Icon name="chevronDown" style={{ transform: 'rotate(180deg)' }} /></button>
              <button className="btn sm ghost icon" disabled={i === stanzas.length - 1} onClick={() => move(i, 1)} aria-label="Down"><Icon name="chevronDown" /></button>
              <button className="btn sm ghost icon danger" onClick={() => set('stanzas', stanzas.filter((_, j) => j !== i))} aria-label={t('Delete')}><Icon name="trash" /></button>
            </div>
            <L10nInput multiline serif rows={4} value={st.text} onChange={(v) => setStanza(i, { ...st, text: v })} />
          </div>
        ))}
        <div><button className="btn" onClick={() => set('stanzas', [...stanzas, { label: String(stanzas.filter((x) => /^\d+$/.test(x.label)).length + 1), text: {} }])}><Icon name="plus" />{t('Add stanza')}</button></div>
        <Field label={t('Notes')}><textarea rows={2} value={s.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </fieldset>
    </Modal>
  );
}

// ------------------------------------------------------------------ hymnals

function Hymnals() {
  const { t } = useI18n();
  const { canEdit } = useSession();
  const { data: list, reload } = useApi<HymnalRow[]>('/hymnals');
  const [sel, setSel] = useState<number | null>(null);
  const [edit, setEdit] = useState<Partial<Hymnal> | null>(null);
  const current = list?.find((h) => h.id === sel) ?? list?.[0];
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="small muted grow">{t('Printed hymnbooks your church sings from. A song can have a number in several hymnals.')}</div>
        {canEdit && <button className="btn primary" onClick={() => setEdit({ name: {}, abbr: '', sort: (list?.length ?? 0) + 1 })}><Icon name="plus" />{t('New hymnal')}</button>}
      </div>
      {!list ? <Loading /> : !list.length ? (
        <Empty title={t('No hymnals yet')}>{t('e.g. Hymns of Praise 赞美诗 (HP), Trinity Hymnal (TH)')}</Empty>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(200px, 260px) minmax(0, 1fr)', alignItems: 'start' }}>
          <div className="stack tight">
            {list.map((h) => (
              <button key={h.id} className="card" onClick={() => setSel(h.id)} style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: '10px 12px', borderColor: current?.id === h.id ? 'var(--reed)' : undefined }}>
                <div className="row between" style={{ flexWrap: 'nowrap' }}>
                  <strong className="serif"><Bi v={h.name} /></strong>
                  <span className="badge reed">{h.abbr}</span>
                </div>
                <div className="small muted">{[h.publisher, h.year].filter(Boolean).join(' · ')}{h.publisher || h.year ? ' · ' : ''}{h.song_count} {t('songs')}</div>
              </button>
            ))}
          </div>
          {current && <HymnalDetail key={current.id} hymnal={current} canEdit={canEdit} onEdit={() => setEdit(current)} onChanged={reload} />}
        </div>
      )}
      {edit && <HymnalEditor hymnal={edit} canEdit={canEdit} onClose={() => setEdit(null)} onSaved={(h) => { setEdit(null); if (h) setSel(h.id); reload(); }} />}
    </>
  );
}

function HymnalDetail({ hymnal, canEdit, onEdit, onChanged }: { hymnal: HymnalRow; canEdit: boolean; onEdit: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const { data: songs, reload } = useApi<(Song & { number: string })[]>(`/hymnals/${hymnal.id}/songs`);
  const { data: hymnals } = useApi<HymnalRow[]>('/hymnals');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Song | null>(null);
  const ql = q.trim().toLowerCase();
  const rows = (songs ?? []).filter((s) => !ql || s.number.toLowerCase() === ql.replace(/^#/, '') || songMatches(s, q));
  const refresh = () => { reload(); onChanged(); };
  return (
    <div className="stack">
      <div className="row">
        <h3 className="serif" style={{ margin: 0 }}><Bi v={hymnal.name} /> <span className="badge reed">{hymnal.abbr}</span></h3>
        <div className="grow" />
        <CsvTools entity="hymnal_index" label={`${t('Hymnal index')} · ${hymnal.abbr}`} params={{ hymnal_id: hymnal.id }} onImported={refresh} />
        {canEdit && <button className="btn sm ghost" onClick={onEdit}><Icon name="edit" />{t('Edit')}</button>}
      </div>
      {hymnal.notes && <div className="small muted">{hymnal.notes}</div>}
      <div style={{ maxWidth: 320 }}><SearchBox value={q} onChange={setQ} placeholder={t('Number or title')} /></div>
      {!songs ? <Loading /> : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead><tr><th style={{ width: 70 }}>{t('Number')}</th><th>{t('Title')}</th><th>{t('Author')}</th><th></th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="click" onClick={() => setEdit(s)}>
                  <td className="nowrap" style={{ color: 'var(--reed-ink)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.number}</td>
                  <td><strong className="serif"><Bi v={s.title} /></strong></td>
                  <td className="small">{s.author}</td>
                  <td className="right nowrap">
                    {!s.stanzas.length ? <span className="badge warn">{t('No words yet')}</span> : <LangBadges present={langsIn(s.stanzas.map((x) => x.text))} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty title={songs.length ? '—' : t('No songs in this hymnal yet')}>{!songs.length && t('Add numbers in a song, or import the hymnal index from a CSV file.')}</Empty>}
        </div>
      )}
      {edit && <SongEditor song={edit} hymnals={hymnals ?? []} canEdit={canEdit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); refresh(); }} />}
    </div>
  );
}

function HymnalEditor({ hymnal, canEdit, onClose, onSaved }: { hymnal: Partial<Hymnal>; canEdit: boolean; onClose: () => void; onSaved: (h?: Hymnal) => void }) {
  const { t, lt } = useI18n();
  const { run, busy } = useAction();
  const [h, setH] = useState(hymnal);
  const set = <K extends keyof Hymnal>(k: K, v: Hymnal[K]) => setH((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const { id, ...rest } = h as Hymnal & { song_count?: number };
    const body = { name: rest.name, abbr: rest.abbr?.trim(), publisher: rest.publisher || null, year: rest.year ?? null, notes: rest.notes || null, sort: rest.sort ?? 0 };
    const r = id ? await run(() => api.patch<Hymnal>(`/hymnals/${id}`, body), t('Saved.')) : await run(() => api.post<Hymnal>('/hymnals', body), t('Saved.'));
    if (r) onSaved(r);
  };
  return (
    <Modal title={h.id ? lt(h.name) : t('New hymnal')} onClose={onClose} footer={canEdit ? (
      <>
        {h.id && <button className="btn danger left" onClick={async () => {
          if (confirmAction(t('Delete this hymnal? Songs stay in the library; only their numbers in this hymnal are removed.')) && await run(() => api.del(`/hymnals/${h.id}`))) onSaved();
        }}><Icon name="trash" />{t('Delete')}</button>}
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !hasAnyText(h.name) || !h.abbr?.trim()} onClick={save}>{t('Save')}</button>
      </>
    ) : undefined}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <Field label={t('Name')}><L10nInput value={h.name} onChange={(v) => set('name', v)} placeholder={{ en: 'Hymns of Praise', zh: '赞美诗', 'zh-Hant': '讚美詩' }} /></Field>
        <div className="form-grid">
          <Field label={t('Abbreviation')} hint={t('Shown before numbers, e.g. HP 123')}><input value={h.abbr ?? ''} maxLength={12} onChange={(e) => set('abbr', e.target.value)} placeholder="HP" /></Field>
          <Field label={t('Publisher')}><input value={h.publisher ?? ''} onChange={(e) => set('publisher', e.target.value)} /></Field>
          <Field label={t('Year')}><input type="number" value={h.year ?? ''} onChange={(e) => set('year', e.target.value ? Number(e.target.value) : null)} /></Field>
          <Field label={t('Order')} hint={t('The first hymnal is the default for numbers')}><input type="number" value={h.sort ?? 0} onChange={(e) => set('sort', Number(e.target.value) || 0)} /></Field>
        </div>
        <Field label={t('Notes')}><textarea rows={2} value={h.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      </fieldset>
    </Modal>
  );
}

// ------------------------------------------------------------------ texts

function Texts() {
  const { t, lt } = useI18n();
  const { canEdit, isAdmin } = useSession();
  const { run, busy } = useAction();
  const { data, reload } = useApi<LiturgyText[]>('/texts');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Partial<LiturgyText> | null>(null);
  const ql = q.trim().toLowerCase();
  const grouped = useMemo(() => {
    const rows = (data ?? []).filter((x) => !ql || JSON.stringify([x.title, x.body, x.tags, x.source]).toLowerCase().includes(ql));
    return TEXT_CATS.map((c) => [c, rows.filter((x) => x.category === c)] as const).filter(([, xs]) => xs.length);
  }, [data, ql]);
  const missingStandards = !!data && STANDARD_KEYS.some((k) => !data.some((x) => x.key === k));
  const importStandards = async () => {
    const r = await run(() => api.post<{ key: string; parts: number; action: string }[]>('/library/import-standards', {}));
    if (r) {
      reload();
      run(async () => r, `${t('Imported')}: ${r.map((x) => `${x.key.toUpperCase()} (${x.parts})`).join(', ')}`);
    }
  };
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="grow" style={{ maxWidth: 360 }}><SearchBox value={q} onChange={setQ} /></div>
        <div className="grow" />
        <CsvTools entity="texts" label={t('Liturgical texts')} onImported={reload} />
        {canEdit && <button className="btn primary" onClick={() => setEdit({ category: 'prayer', title: {}, body: {}, tags: [], public_domain: false, parts: null })}><Icon name="plus" />{t('New text')}</button>}
      </div>
      {missingStandards && isAdmin && (
        <div className="callout row" style={{ marginBottom: 12 }}>
          <div className="grow small">
            <strong>{t('Westminster Standards')}</strong> — {t('the Shorter Catechism (107 questions), Larger Catechism (196) and Confession of Faith (33 chapters), public domain, English. Use any questions or sections in a service.')}
          </div>
          <button className="btn sm primary" disabled={busy} onClick={importStandards}><Icon name="download" />{t('Import Westminster Standards')}</button>
        </div>
      )}
      {!data ? <Loading /> : (
        <div className="stack">
          {grouped.map(([cat, xs]) => (
            <div key={cat}>
              <div className="eyebrow" style={{ margin: '6px 0 6px' }}>{lt(TEXT_CAT_LABEL[cat])}</div>
              <div className="grid cols-3" style={{ gap: 8 }}>
                {xs.map((x) => (
                  <button key={x.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: '12px 14px' }} onClick={() => setEdit(x)}>
                    <div className="row between" style={{ flexWrap: 'nowrap' }}>
                      <strong className="serif"><Bi v={x.title} /></strong>
                      <LangBadges present={langsIn([x.body, ...(x.parts ?? []).map((p) => p.body)])} />
                    </div>
                    <div className="small muted" style={{ marginTop: 4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {(lt(x.body) || lt(x.parts?.[0]?.body)).replace(/^[LCA]:\s?/gm, '')}
                    </div>
                    <div className="row small" style={{ marginTop: 4, gap: 6 }}>
                      {x.parts?.length ? <span className="badge reed">{x.parts.length} {t('parts')}</span> : null}
                      {x.source && <span style={{ color: 'var(--reed-ink)' }}>{x.source}</span>}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <TextEditor text={edit} canEdit={canEdit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function TextEditor({ text, canEdit, onClose, onSaved }: { text: Partial<LiturgyText>; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const { t, lt } = useI18n();
  const { run, busy } = useAction();
  const [x, setX] = useState(text);
  const set = <K extends keyof LiturgyText>(k: K, v: LiturgyText[K]) => setX((o) => ({ ...o, [k]: v }));
  const hasParts = Array.isArray(x.parts);
  const partsOk = !hasParts || (x.parts!.every((p) => p.label.trim()) && new Set(x.parts!.map((p) => p.label.trim())).size === x.parts!.length);
  const save = async () => {
    const { id, ...body } = x;
    if (body.parts) body.parts = body.parts.map((p) => ({ ...p, label: p.label.trim() }));
    const r = id ? await run(() => api.patch(`/texts/${id}`, body), t('Saved.')) : await run(() => api.post('/texts', body), t('Saved.'));
    if (r) onSaved();
  };
  return (
    <Modal title={x.id ? lt(x.title) : t('New text')} onClose={onClose} size="lg" footer={canEdit ? (
      <>
        {x.id && <button className="btn danger left" onClick={async () => { if (confirmAction(t('Are you sure?')) && await run(() => api.del(`/texts/${x.id}`))) onSaved(); }}><Icon name="trash" />{t('Delete')}</button>}
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !hasAnyText(x.title) || !partsOk} onClick={save}>{t('Save')}</button>
      </>
    ) : undefined}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="form-grid">
          <Field label={t('Category')}>
            <select value={x.category} onChange={(e) => set('category', e.target.value as TextCategory)}>
              {TEXT_CATS.map((c) => <option key={c} value={c}>{lt(TEXT_CAT_LABEL[c])}</option>)}
            </select>
          </Field>
          <Field label={t('Source')}><input value={x.source ?? ''} onChange={(e) => set('source', e.target.value)} /></Field>
          <Field label={t('Tags')}><input value={(x.tags ?? []).join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))} /></Field>
        </div>
        <Field label={t('Title')}><L10nInput value={x.title} onChange={(v) => set('title', v)} /></Field>
        <Field label={hasParts ? t('Introduction (optional)') : t('Body')} hint={t('Responsive format: start a line with L: (leader), C: (congregation) or A: (all). Blank line = new paragraph / slide.')}>
          <L10nInput multiline serif rows={hasParts ? 3 : 14} value={x.body} onChange={(v) => set('body', v)} />
        </Field>
        {hasParts ? (
          <PartsEditor parts={x.parts!} catechism={x.category === 'catechism'} onChange={(p) => set('parts', p)} />
        ) : canEdit && (
          <div className="row">
            <button className="btn sm" onClick={() => set('parts', [{ label: '1', body: {} }])}><Icon name="list" />{t('Use numbered parts')}</button>
            <span className="small muted">{t('For catechisms and confessions: each question or section is a part that services can pick.')}</span>
          </div>
        )}
        <label className="check"><input type="checkbox" checked={!!x.public_domain} onChange={(e) => set('public_domain', e.target.checked)} />{t('Public domain')}</label>
      </fieldset>
    </Modal>
  );
}

/** The label after `l`: "7" → "8", "I.3" → "I.4", otherwise "". */
const nextLabel = (l: string | undefined) => {
  const m = l?.match(/^(.*?)(\d+)$/);
  return m ? `${m[1]}${Number(m[2]) + 1}` : '';
};

/** Editor for many numbered parts: a collapsed, searchable list; one part is edited at a time. */
function PartsEditor({ parts, catechism, onChange }: { parts: TextPart[]; catechism: boolean; onChange: (p: TextPart[]) => void }) {
  const { t, lt } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(parts.length === 1 ? 0 : null);
  const ql = q.trim().toLowerCase().replace(/^q\.?\s*/, '');
  const shown = parts.map((p, i) => [p, i] as const).filter(([p]) => !ql || p.label.toLowerCase() === ql || JSON.stringify([p.title, p.body]).toLowerCase().includes(ql));
  const setPart = (i: number, p: TextPart) => onChange(parts.map((x, j) => (j === i ? p : x)));
  const move = (i: number, d: number) => {
    const a = [...parts];
    const [x] = a.splice(i, 1);
    a.splice(i + d, 0, x);
    onChange(a);
    setOpen(i + d);
  };
  const add = () => {
    const at = open ?? parts.length - 1;
    const prev = parts[at];
    const a = [...parts];
    a.splice(at + 1, 0, { label: nextLabel(prev?.label) || String(parts.length + 1), title: prev?.title ? { ...prev.title } : undefined, body: catechism ? { en: 'L: \nC: ' } : {} });
    onChange(a);
    setOpen(at + 1);
    setQ('');
  };
  const dupes = new Set(parts.map((p) => p.label.trim()).filter((l, i, all) => all.indexOf(l) !== i));
  const firstLine = (p: TextPart) => (lt(p.body).split('\n').find((l) => l.trim()) ?? '').replace(/^[LCA][:：]\s?/, '');
  return (
    <div className="stack tight">
      <div className="row">
        <h3>{t('Parts')} <span className="badge reed">{parts.length}</span></h3>
        <div className="grow" />
        <div style={{ width: 240 }}><SearchBox value={q} onChange={setQ} placeholder={t('Number or words')} /></div>
        <button className="btn sm" onClick={add}><Icon name="plus" />{t('Add part')}</button>
      </div>
      <div className="field-hint">{catechism ? t('Each part is one question: "L: question" on the first line, "C: answer" on the next, so the minister asks and the congregation answers.') : t('Each part is one section; a part title (e.g. the chapter) is printed when it changes.')}</div>
      <div className="card flush" style={{ maxHeight: 460, overflowY: 'auto' }}>
        {shown.map(([p, i]) => (
          <div key={i} style={{ borderBottom: '1px solid var(--rule)' }}>
            <div className="lib-item" style={{ borderRadius: 0, margin: 0, alignItems: 'center' }} onClick={() => setOpen(open === i ? null : i)}>
              <span className={`badge ${dupes.has(p.label.trim()) || !p.label.trim() ? 'warn' : 'reed'}`} style={{ minWidth: 44, justifyContent: 'center' }}>{p.label || '?'}</span>
              <div className="grow" style={{ minWidth: 0 }}>
                {hasAnyText(p.title) && <div className="s">{lt(p.title)}</div>}
                <div className="t" style={{ fontWeight: 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{firstLine(p) || <span className="muted">—</span>}</div>
              </div>
              <LangBadges present={langsIn([p.body])} />
              <Icon name="chevronDown" width={14} height={14} style={{ transform: open === i ? 'rotate(180deg)' : undefined, flex: 'none' }} />
            </div>
            {open === i && (
              <div className="stack tight" style={{ padding: '8px 12px 12px', background: 'var(--paper)' }}>
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <Field label={t('Label')}><input style={{ width: 90 }} value={p.label} maxLength={20} onChange={(e) => setPart(i, { ...p, label: e.target.value })} /></Field>
                  <div className="grow" />
                  <button className="btn sm ghost icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Up"><Icon name="chevronDown" style={{ transform: 'rotate(180deg)' }} /></button>
                  <button className="btn sm ghost icon" disabled={i === parts.length - 1} onClick={() => move(i, 1)} aria-label="Down"><Icon name="chevronDown" /></button>
                  <button className="btn sm ghost icon danger" onClick={() => { onChange(parts.filter((_, j) => j !== i)); setOpen(null); }} aria-label={t('Delete')}><Icon name="trash" /></button>
                </div>
                <Field label={t('Part title (optional)')}><L10nInput value={p.title} onChange={(v) => setPart(i, { ...p, title: hasAnyText(v) ? v : undefined })} /></Field>
                <Field label={t('Text')}><L10nInput multiline serif rows={5} value={p.body} onChange={(v) => setPart(i, { ...p, body: v })} /></Field>
              </div>
            )}
          </div>
        ))}
        {!shown.length && <div className="empty small" style={{ padding: 12 }}>—</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ bible

interface Passage { ref: string; translation: string; verses: { book: number; chapter: number; verse: number; text: string }[] }
/** One column of the lookup: a language and a version ('' = the church default for that language). */
interface BibleCol { lang: Lang; code: string }

function Bible() {
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

/** Languages that have text in any of the given localised values. */
const langsIn = (vs: (L10n | undefined)[]) => [...new Set(vs.flatMap((v) => Object.keys(v ?? {}).filter((k) => v?.[k]?.trim())))];

/** One badge per church language: filled when text exists, warning "?" when missing. */
function LangBadges({ present }: { present: string[] }) {
  const langs = useContentLangs();
  const chinese = present.some((l) => l === 'zh' || l === 'zh-Hant');
  return (
    <span className="row" style={{ gap: 3, flexWrap: 'nowrap' }}>
      {langs.map((l) => {
        const ok = present.includes(l) || ((l === 'zh' || l === 'zh-Hant') && chinese);
        return <span key={l} className={`badge ${ok ? 'lapis' : 'warn'}`} title={langInfo(l).name}>{langInfo(l).short}{ok ? '' : ' ?'}</span>;
      })}
    </span>
  );
}

