// The service planner: the library panel and quick add, with when each hymn was last sung.
import { useEffect, useState, type ReactNode } from 'react';
import { PicturesPanel } from '../Images.tsx';
import { useDraggable } from '@dnd-kit/core';
import { useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Bi, Field, SearchBox, fmtDate } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { langInfo } from '../../../shared/languages.ts';
import { matchesHymnNumber } from '../../../shared/parts.ts';
import type { ItemKind, L10n, LiturgyText, ServiceItem, Song } from '../../types-client.ts';
import { KIND_ICON, KIND_LABEL, KINDS } from './common.ts';

/** Wrap a library-panel entry so it can be dragged into the agenda (clicking still adds it). */
export function LibDrag({ id, label, item, children }: { id: string; label: string; item: Partial<ServiceItem>; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { lib: { label, item } } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.4 : 1, touchAction: 'none' }}>
      {children}
    </div>
  );
}

export const QUICK_KINDS: ItemKind[] = ['song', 'scripture', 'text', 'prayer', 'sermon', 'section', 'offering', 'sacrament', 'announcements', 'music', 'other'];

// ------------------------------------------------------------------ song usage ("last sung")

export type SongUse = Record<number, { last_used: string; times_12m: number }>;

export const RECENT_DAYS = 28;

/** When each song was last sung before the service date, and how often in the 12 months before it. */
export const useSongUsage = (date: string) => useApi<SongUse>(`/songs/usage?before=${date}`).data ?? {};

/** "last sung 21 Sep" / "上次 9月21日" or "never sung"; warn colour when sung in the 4 weeks before the service. */
export function UsageBadge({ use, date }: { use?: SongUse[number]; date: string }) {
  const { t, lang } = useI18n();
  if (!use) return <span className="badge" style={{ marginLeft: 6, opacity: 0.75 }}>{t('never sung')}</span>;
  const days = (Date.parse(date) - Date.parse(use.last_used)) / 86400_000;
  const opts: Intl.DateTimeFormatOptions = use.last_used.slice(0, 4) === date.slice(0, 4) ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' };
  return (
    <span className={`badge${days <= RECENT_DAYS ? ' warn' : ''}`} style={{ marginLeft: 6 }} title={`${use.times_12m} × ${t('in the 12 months before this service')}`}>
      {t('last sung')} {fmtDate(use.last_used, lang, opts)}
    </span>
  );
}

/** Inline card for inserting an item at a position: pick a kind, then (for hymns / texts / scripture) what. */
export function QuickAdd({ at, time, date, songs, texts, onAdd, onClose }: {
  at: number; time: string; date: string; songs: Song[]; texts: LiturgyText[];
  onAdd: (item: Partial<ServiceItem>, at?: number) => void; onClose: () => void;
}) {
  const { t, lt } = useI18n();
  const usage = useSongUsage(date);
  const [mode, setMode] = useState<'menu' | 'song' | 'text' | 'scripture'>('menu');
  const [q, setQ] = useState('');
  const [ref, setRef] = useState('');
  const ql = q.trim().toLowerCase();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const add = (item: Partial<ServiceItem>) => onAdd(item, at);
  const pickKind = (k: ItemKind) => {
    if (k === 'song' || k === 'text' || k === 'scripture') return setMode(k);
    add({ kind: k, title: KIND_LABEL[k], duration_min: k === 'section' ? 0 : k === 'sermon' ? 35 : 3 });
  };
  const songHits = songs.filter((s) => !ql || matchesHymnNumber(s.hymnals, ql) || JSON.stringify([s.title, s.author, s.tags, s.psalm, s.hymnals]).toLowerCase().includes(ql)).sort((a, b) => Number(!matchesHymnNumber(a.hymnals, ql)) - Number(!matchesHymnNumber(b.hymnals, ql))).slice(0, 8);
  const textHits = texts.filter((x) => !ql || JSON.stringify([x.title, x.category, x.tags]).toLowerCase().includes(ql)).slice(0, 8);
  return (
    <div className="reed-item quick-add-wrap">
      <div className="reed-time">{time}</div>
      <div className="quick-add card">
        <div className="row between" style={{ marginBottom: 8 }}>
          <strong className="small">{mode === 'menu' ? t('Insert here') : lt(KIND_LABEL[mode])}</strong>
          <div className="row" style={{ gap: 4 }}>
            {mode !== 'menu' && <button className="btn sm ghost" onClick={() => { setMode('menu'); setQ(''); }}><Icon name="chevronLeft" />{t('Back')}</button>}
            <button className="btn sm ghost icon" onClick={onClose} aria-label={t('Close')}><Icon name="x" /></button>
          </div>
        </div>
        {mode === 'menu' && (
          <div className="quick-kinds">
            {QUICK_KINDS.map((k) => (
              <button key={k} className="btn" onClick={() => pickKind(k)} autoFocus={k === 'song'}>
                <Icon name={KIND_ICON[k]} />{lt(KIND_LABEL[k])}
              </button>
            ))}
          </div>
        )}
        {(mode === 'song' || mode === 'text') && (
          <div className="stack tight">
            <SearchBox value={q} onChange={setQ} autoFocus />
            <div className="lib-list" style={{ maxHeight: 280, margin: 0 }}>
              {mode === 'song' && songHits.map((s) => (
                <div key={s.id} className="lib-item" onClick={() => add({ kind: 'song', ref_id: s.id, title: s.category === 'psalm' ? { en: 'Psalm', zh: '诗篇' } : s.category === 'doxology' ? { en: 'Doxology', zh: '三一颂' } : KIND_LABEL.song, duration_min: 4 })}>
                  <Icon name="music" width={15} height={15} style={{ marginTop: 2, color: 'var(--reed)' }} />
                  <div className="grow"><div className="t"><Bi v={s.title} /></div><div className="s">{[(s.hymnals ?? []).map((h) => `${h.abbr} ${h.number}`).join(', '), s.author, s.tune].filter(Boolean).join(' · ')}<UsageBadge use={usage[s.id]} date={date} /></div></div>
                </div>
              ))}
              {mode === 'text' && textHits.map((x) => (
                <div key={x.id} className="lib-item" onClick={() => add({ kind: 'text', ref_id: x.id, duration_min: 2 })}>
                  <Icon name="text" width={15} height={15} style={{ marginTop: 2, color: 'var(--reed)' }} />
                  <div className="grow"><div className="t"><Bi v={x.title} /></div><div className="s">{x.category.replace(/_/g, ' ')}</div></div>
                </div>
              ))}
            </div>
            <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => add(mode === 'song' ? { kind: 'song', title: KIND_LABEL.song, duration_min: 4 } : { kind: 'text', title: KIND_LABEL.text, duration_min: 2 })}>
              {t('Add an empty slot to fill later')}
            </button>
          </div>
        )}
        {mode === 'scripture' && (
          <form className="row" onSubmit={(e) => { e.preventDefault(); add({ kind: 'scripture', scripture_ref: ref.trim() || null, duration_min: 3 }); }}>
            <input className="grow" style={{ width: 'auto' }} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Romans 8:28-39 · 约 3:16" autoFocus />
            <button className="btn primary" type="submit"><Icon name="plus" />{t('Add')}</button>
          </form>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ library panel

export function LibraryPanel({ date, songs, texts, openItem, onAdd }: { date: string; songs: Song[]; texts: LiturgyText[]; openItem: ServiceItem | null; onAdd: (i: Partial<ServiceItem>) => void }) {
  const { t, lt } = useI18n();
  const usage = useSongUsage(date);
  const [tab, setTab] = useState<'songs' | 'texts' | 'scripture' | 'pictures' | 'elements'>('songs');
  const [q, setQ] = useState('');
  const [ref, setRef] = useState('');
  const ql = q.trim().toLowerCase();
  const match = (o: object) => !ql || JSON.stringify(o).toLowerCase().includes(ql);
  // title matches first, then everything else that matched (words, tags, author)
  const rank = <T,>(xs: T[], title: (x: T) => L10n) =>
    ql ? [...xs].sort((a, b) => Number(!JSON.stringify(title(a)).toLowerCase().includes(ql)) - Number(!JSON.stringify(title(b)).toLowerCase().includes(ql))) : xs;
  const fillSlot = !!openItem && ((!openItem.ref_id && ((openItem.kind === 'song' && tab === 'songs') || (openItem.kind === 'text' && tab === 'texts'))) || (openItem.kind === 'scripture' && !openItem.scripture_ref && tab === 'scripture'));

  return (
    <div className="panel">
      <div className="card">
        <div className="tabs" style={{ marginBottom: 10 }}>
          {(['songs', 'texts', 'scripture', 'pictures', 'elements'] as const).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {t({ songs: 'Hymns & psalms', texts: 'Creeds & liturgy', scripture: 'Scripture', pictures: 'Pictures', elements: 'Elements' }[k])}
            </button>
          ))}
        </div>
        {fillSlot && <div className="callout small" style={{ marginBottom: 8 }}>↳ {lt(openItem!.title)}</div>}
        {openItem && !fillSlot && <div className="small muted" style={{ marginBottom: 8 }}>+ ↓ {lt(openItem.title)}</div>}

        {(tab === 'songs' || tab === 'texts') && <SearchBox value={q} onChange={setQ} />}
        {tab === 'songs' && (
          <div className="lib-list" style={{ marginTop: 8 }}>
            {rank(songs.filter((s) => matchesHymnNumber(s.hymnals, ql) || match({ t: s.title, a: s.author, tg: s.tags, tu: s.tune, p: s.psalm, f: s.stanzas[0]?.text })), (s) => s.title).sort((a, b) => Number(!matchesHymnNumber(a.hymnals, ql)) - Number(!matchesHymnNumber(b.hymnals, ql))).map((s) => (
              <LibDrag key={s.id} id={`lib-song-${s.id}`} label={lt(s.title)} item={{ kind: 'song', ref_id: s.id, title: s.category === 'psalm' ? { en: 'Psalm', zh: '诗篇' } : s.category === 'doxology' ? { en: 'Doxology', zh: '三一颂' } : { en: 'Hymn', zh: '诗歌' }, duration_min: 4 }}><div className="lib-item" onClick={() => onAdd({ kind: 'song', ref_id: s.id, title: s.category === 'psalm' ? { en: 'Psalm', zh: '诗篇' } : s.category === 'doxology' ? { en: 'Doxology', zh: '三一颂' } : { en: 'Hymn', zh: '诗歌' }, duration_min: 4 })}>
                <Icon name="music" width={15} height={15} style={{ marginTop: 2, color: 'var(--reed)' }} />
                <div className="grow">
                  <div className="t"><Bi v={s.title} /></div>
                  <div className="s">{[(s.hymnals ?? []).map((h) => `${h.abbr} ${h.number}`).join(', '), s.author, s.tune, ...(s.tags ?? []).slice(0, 3)].filter(Boolean).join(' · ')}<UsageBadge use={usage[s.id]} date={date} /></div>
                </div>
                <span className="btn sm icon add" aria-label={t('Add')}><Icon name="plus" /></span>
              </div></LibDrag>
            ))}
          </div>
        )}
        {tab === 'texts' && (
          <div className="lib-list" style={{ marginTop: 8 }}>
            {rank(texts.filter((x) => match({ t: x.title, c: x.category, tg: x.tags, s: x.source })), (x) => x.title).map((x) => (
              <LibDrag key={x.id} id={`lib-text-${x.id}`} label={lt(x.title)} item={{ kind: 'text', ref_id: x.id, duration_min: x.category === 'creed' ? 2 : 2 }}><div className="lib-item" onClick={() => onAdd({ kind: 'text', ref_id: x.id, duration_min: x.category === 'creed' ? 2 : 2 })}>
                <Icon name="text" width={15} height={15} style={{ marginTop: 2, color: 'var(--reed)' }} />
                <div className="grow">
                  <div className="t"><Bi v={x.title} /></div>
                  <div className="s">{x.category.replace(/_/g, ' ')} · {Object.keys(x.body).filter((k) => x.body[k]?.trim()).map((k) => langInfo(k).short).join(' ')}{x.parts?.length ? ` · ${x.parts.length} §` : ''}</div>
                </div>
                <span className="btn sm icon add" aria-label={t('Add')}><Icon name="plus" /></span>
              </div></LibDrag>
            ))}
          </div>
        )}
        {tab === 'scripture' && (
          <form className="stack" onSubmit={(e) => {
            e.preventDefault();
            if (!ref.trim()) return;
            onAdd({ kind: 'scripture', scripture_ref: ref.trim(), duration_min: 3 });
            setRef('');
          }}>
            <Field label={t('Reference')} hint="Romans 8:28-39 · Ps 23 · 约翰福音 3:16">
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Isaiah 6:1-8" />
            </Field>
            <button className="btn primary" type="submit"><Icon name="plus" />{t('Add to service')}</button>
          </form>
        )}
        {tab === 'pictures' && <PicturesPanel onAdd={onAdd} />}
        {tab === 'elements' && (
          <div className="palette">
            {KINDS.filter((k) => k !== 'song' && k !== 'text').map((k) => (
              <button key={k} className="btn" onClick={() => onAdd({ kind: k, title: KIND_LABEL[k], duration_min: k === 'section' ? 0 : k === 'sermon' ? 35 : 3 })}>
                <Icon name={KIND_ICON[k]} />{lt(KIND_LABEL[k])}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ team tab
