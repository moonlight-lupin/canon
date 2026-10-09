// The service planner: editing one item of the order of worship (hymn, Scripture, liturgy, posture…).
import { useEffect, useMemo, useState } from 'react';
import { hasAnyText } from '../../../shared/labels.ts';
import { api, useApi } from '../../api.ts';
import { both, useI18n } from '../../i18n.tsx';
import { Field, L10nInput, SearchBox, useDebounced } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { langInfo } from '../../../shared/languages.ts';
import { partsLabel, postureLabel, speakerLabel } from '../../../shared/labels.ts';
import { parsePartSelection, partRuns, shiftBlock } from '../../../shared/parts.ts';
import type { ItemKind, Lang, LiturgyText, Posture, ServiceItem, Song, TeamWithRoles } from '../../types-client.ts';
import type { Hymnal, TextPart } from '../../types-client.ts';
import { BulletinChoice } from '../presentation-pickers.tsx';
import { MultiPick } from '../../components/MultiPick.tsx';
import { itemLeaders, leaderPool, type RotaEntry } from '../../../shared/leaders.ts';
import { SlideBlocksPicker } from '../Blocks.tsx';
import { SlideBackgroundPicker } from '../Backgrounds.tsx';
import { SlideImagesPicker } from '../Images.tsx';
import { InfoTip } from '../../components/InfoTip.tsx';
import { Combo, type ComboOption } from '../../components/Combo.tsx';
import type { BulletinBlock } from '../../../shared/presentation.ts';
import { BibleSelect, useBibles, useChurchBible } from '../../components/BibleTools.tsx';
import { KIND_LABEL, KINDS } from './common.ts';

/**
 * Who leads the item (0.15.10): people on the service's rota only — the role's (all ticked unless the planner unticks
 * some), or, for an item without a role, anyone on the rota. A name typed before is shown, flagged, with Remove.
 */
function LeaderField({ item, rota, onPatch }: { item: ServiceItem; rota: RotaEntry[]; onPatch: (p: Partial<ServiceItem>, immediate?: boolean) => void }) {
  const { t } = useI18n();
  const pool = leaderPool(item, rota);
  const shown = itemLeaders(item, rota).map((a) => a.person_id);
  const set = (ids: number[]) => {
    // a role's whole rota is the default (null), so people added to the rota later are included
    const all = item.role_id && ids.length === pool.length;
    onPatch({ leader_people: all ? null : ids }, true);
  };
  const typed = item.leader?.trim();
  return (
    <Field
      label={t('Leader')}
      hint={
        <>
          {!pool.length && (item.role_id ? t('Nobody is on the rota for this role yet — add them in Team & roster.') : t('Nobody is on this service’s rota yet — add them in Team & roster.'))}
          {typed && (
            <span className="warn-text">
              {' '}{(shown.length ? t('Typed earlier: “{name}” — not on the rota, not printed.') : t('Typed earlier: “{name}” — not on the rota; printed until someone on the rota is chosen.')).replace('{name}', typed)}{' '}
              <button type="button" className="btn ghost sm" onClick={() => onPatch({ leader: null }, true)}>{t('Remove')}</button>
            </span>
          )}
        </>
      }
    >
      <MultiPick
        value={shown}
        options={pool.map((a) => ({ value: a.person_id, label: a.person_name }))}
        onChange={set}
        disabled={!pool.length}
        ariaLabel={t('Leader')}
        placeholder={item.role_id ? t('(from the rota)') : t('Nobody')}
      />
    </Field>
  );
}

export function ItemEditor({
  item, langs, songs, texts, teams, canEdit, onPatch, onDelete, onMove, isFirst, isLast, svcBibles, rota = [],
}: {
  svcBibles?: Record<Lang, string>;
  /** the service's rota: the only people an item's Leader can name (0.15.10) */
  rota?: RotaEntry[];
  item: ServiceItem; langs: Lang[]; songs: Map<number, Song>; texts: Map<number, LiturgyText>; teams: TeamWithRoles[];
  canEdit: boolean; onPatch: (p: Partial<ServiceItem>, immediate?: boolean) => void; onDelete: () => void;
  onMove: (delta: number) => void; isFirst: boolean; isLast: boolean;
}) {
  const { t, lt } = useI18n();
  const { data: blocks } = useApi<BulletinBlock[]>(item.kind !== 'section' ? '/bulletin-blocks' : null);
  return (
    <div className="item-body">
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <Field label={t('Item')} className="grow">
            <select value={item.kind} onChange={(e) => onPatch({ kind: e.target.value as ItemKind, ref_id: null }, true)}>
              {KINDS.map((k) => <option key={k} value={k}>{both(KIND_LABEL[k])}</option>)}
            </select>
          </Field>
          {item.kind !== 'section' && (
            <>
              <Field label={`${t('Duration')} (${t('min')})`}>
                <input type="number" min={0} max={240} step={0.5} style={{ width: 90 }} value={item.duration_min} onChange={(e) => onPatch({ duration_min: Number(e.target.value) || 0 })} />
              </Field>
              <Field label={t('Role')}>
                <Combo
                  value={item.role_id ? String(item.role_id) : ''}
                  noneLabel="—"
                  ariaLabel={t('Role')}
                  options={teams.flatMap((tm) => tm.roles.map((r) => ({ value: String(r.id), label: both(r.name), group: lt(tm.name), search: Object.values(r.name ?? {}).join(' ') })))}
                  onChange={(v) => onPatch({ role_id: v ? Number(v) : null }, true)}
                />
              </Field>
              <LeaderField item={item} rota={rota} onPatch={onPatch} />
              <PostureField value={item.posture ?? null} langs={langs} onChange={(p) => onPatch({ posture: p }, true)} />
            </>
          )}
        </div>
        <Field label={t('Title')}><L10nInput value={item.title} onChange={(v) => onPatch({ title: v })} /></Field>

        {item.kind === 'song' && <SongFields item={item} songs={songs} langs={langs} onPatch={onPatch} />}
        {item.kind === 'scripture' && <ScriptureFields item={item} langs={langs} svcBibles={svcBibles ?? {}} onPatch={onPatch} />}
        {item.kind === 'text' && <TextFields item={item} texts={texts} langs={langs} onPatch={onPatch} />}
        {!['song', 'scripture', 'text', 'section'].includes(item.kind) && (
          <Field label={t('Custom text')} hint={t('Responsive format: start a line with L: (leader), C: (congregation) or A: (all). Blank line = new paragraph / slide.')}>
            <L10nInput multiline serif rows={3} value={item.body} onChange={(v) => onPatch({ body: v })} />
          </Field>
        )}

        {item.kind !== 'section' && (
          <Field label={t('Run-sheet notes (AV, cues)')}>
            <input value={item.notes ?? ''} onChange={(e) => onPatch({ notes: e.target.value || null })} />
          </Field>
        )}
        {item.kind !== 'section' && (
          <div className="field">
            <span>{t('QR codes & notes on slides')}</span>
            <SlideBlocksPicker value={item.slide_blocks ?? []} blocks={blocks} keyOf={(b) => b.id} onChange={(v) => onPatch({ slide_blocks: v }, true)} />
            {!!item.slide_blocks?.length && (
              <span className="field-hint">{item.on_slides ? t('Shown together on one slide after this item.') : t('Shown on a slide of their own, even though this item has no slides.')}</span>
            )}
          </div>
        )}
        {item.kind !== 'section' && (
          <div className="field">
            <span>{t('Pictures on slides')} <InfoTip text={t('Pictures from Library → Images, each on a slide of its own after this item’s slides (an item that is not on the slides shows only its pictures). Not printed.')} /></span>
            <SlideImagesPicker value={item.slide_images ?? []} onChange={(v) => onPatch({ slide_images: v }, true)} />
          </div>
        )}
        {(item.on_slides || !!item.slide_blocks?.length) && (
          <div className="field">
            <span>{t('Slide background')} <InfoTip text={t('A picture behind this item’s slides only, e.g. bread and cup for the Lord’s Supper. It is faded with the slide template’s background colour so the words stay readable. Pictures live in Library → Slide backgrounds.')} /></span>
            <SlideBackgroundPicker value={item.slide_background_id ?? null} onChange={(v) => onPatch({ slide_background_id: v }, true)} />
          </div>
        )}
        <div className="row between">
          <div className="row">
            <BulletinChoice item={item} onPatch={onPatch} />
            <label className="check"><input type="checkbox" checked={item.on_slides} onChange={(e) => onPatch({ on_slides: e.target.checked }, true)} />{t('On slides')}</label>
            {/* a cover slide (the item's title and who leads it) instead of the words, or before them */}
            {item.on_slides && item.kind !== 'section' && item.kind !== 'sermon' && (
              <label className="bulletin-choice" title={t('The cover shows the item’s title and who leads it, e.g. just “Threefold Amen” instead of the three amens.')}>
                <span>{t('Slides')}</span>
                <select value={item.slide_cover ?? ''} onChange={(e) => onPatch({ slide_cover: (e.target.value || null) as ServiceItem['slide_cover'] }, true)}>
                  <option value="">{t('Content only')}</option>
                  <option value="cover">{t('Cover only')}</option>
                  <option value="both">{t('Cover, then content')}</option>
                </select>
              </label>
            )}
          </div>
          {canEdit && (
            <div className="row" style={{ gap: 4 }}>
              <button className="btn sm" onClick={() => onMove(-1)} disabled={isFirst}><Icon name="chevronDown" style={{ transform: 'rotate(180deg)' }} />{t('Move up')}</button>
              <button className="btn sm" onClick={() => onMove(1)} disabled={isLast}><Icon name="chevronDown" />{t('Move down')}</button>
              <button className="btn sm danger" onClick={onDelete}><Icon name="trash" />{t('Delete')}</button>
            </div>
          )}
        </div>
      </fieldset>
    </div>
  );
}

/** What the congregation does: none / stand 众立 / sit 众坐 / kneel, labelled in the UI language and the church's languages. */
export function PostureField({ value, langs, onChange }: { value: Posture | null; langs: Lang[]; onChange: (p: Posture | null) => void }) {
  const { t, lang } = useI18n();
  const label = (p: Posture) => [...new Set([postureLabel(p, lang), ...langs.map((l) => postureLabel(p, l))])].join(' · ');
  return (
    <Field label={t('Posture')}>
      <select value={value ?? ''} onChange={(e) => onChange((e.target.value || null) as Posture | null)} style={{ width: 130 }}>
        <option value="">{t('None')}</option>
        {(['stand', 'sit', 'kneel'] as const).map((p) => <option key={p} value={p}>{label(p)}</option>)}
      </select>
    </Field>
  );
}

export function SongFields({ item, songs, langs, onPatch }: { item: ServiceItem; songs: Map<number, Song>; langs: Lang[]; onPatch: (p: Partial<ServiceItem>, immediate?: boolean) => void }) {
  const { t, lt } = useI18n();
  const song = item.ref_id ? songs.get(item.ref_id) : undefined;
  const sorted = useMemo(() => [...songs.values()].sort((a, b) => lt(a.title).localeCompare(lt(b.title))), [songs, lt]);
  // search by title in any language, the first line of each verse, hymnal number ("HP 123", "123") or psalm number
  const songOptions = useMemo((): ComboOption[] => sorted.map((s) => ({
    value: String(s.id),
    label: `${both(s.title)}${s.psalm ? ` (Ps ${s.psalm})` : ''}`,
    hint: s.hymnals?.map((h) => `${h.abbr} ${h.number}`).join(', ') || undefined,
    keys: (s.hymnals ?? []).flatMap((h) => [`${h.abbr} ${h.number}`, h.number, `#${h.number}`]).concat(s.psalm ? [`ps ${s.psalm}`, `psalm ${s.psalm}`] : []),
    search: [
      ...Object.values(s.title ?? {}),
      ...(s.hymnals ?? []).flatMap((h) => [`${h.abbr} ${h.number}`, `${h.abbr}${h.number}`, `#${h.number}`, h.number]),
      ...s.stanzas.flatMap((st) => Object.values(st.text ?? {}).map((x) => (x ?? '').split('\n')[0])),
      s.psalm ? `psalm ${s.psalm} ps ${s.psalm} 诗篇 ${s.psalm}` : '',
      ...(s.tags ?? []),
    ].join(' '),
  })), [sorted]);
  const { data: hymnals } = useApi<Hymnal[]>(song && (song.hymnals?.length ?? 0) > 1 ? '/hymnals' : null);
  const shownNumber = (item.hymnal_id && song?.hymnals?.find((h) => h.hymnal_id === item.hymnal_id)) || song?.hymnals?.[0];
  const verses = song?.stanzas.filter((s) => s.label !== 'R' && s.label !== 'C') ?? [];
  const selected = item.stanzas ?? verses.map((s) => s.label);
  const toggle = (label: string) => {
    const next = selected.includes(label) ? selected.filter((l) => l !== label) : [...selected, label];
    const ordered = verses.map((v) => v.label).filter((l) => next.includes(l));
    onPatch({ stanzas: ordered.length === verses.length ? null : ordered }, true);
  };
  return (
    <>
      <Field label={t('Hymn')}>
        <Combo
          value={item.ref_id ? String(item.ref_id) : ''}
          options={songOptions}
          noneLabel={`— ${t('Hymns & psalms')} —`}
          placeholder={t('Type a title, first line or number (HP 123)…')}
          ariaLabel={t('Hymn')}
          onChange={(v) => onPatch({ ref_id: v ? Number(v) : null, stanzas: null, hymnal_id: null }, true)}
        />
      </Field>
      {song && (song.hymnals?.length ?? 0) > 1 && (
        <Field label={t('Hymnal')} hint={t('Which hymnal number is printed and projected')}>
          <select value={shownNumber?.hymnal_id ?? ''} onChange={(e) => onPatch({ hymnal_id: Number(e.target.value) || null }, true)}>
            {song.hymnals!.map((h) => (
              <option key={h.hymnal_id} value={h.hymnal_id}>{h.abbr} {h.number}{hymnals ? ` — ${lt(hymnals.find((x) => x.id === h.hymnal_id)?.name)}` : ''}</option>
            ))}
          </select>
        </Field>
      )}
      {song && song.hymnals?.length === 1 && <div className="small muted">{t('Hymnal')}: <span className="badge reed">{song.hymnals[0].abbr} {song.hymnals[0].number}</span></div>}
      {song && !song.stanzas.length && <div className="callout small">{t('This song has no words yet (it came from a hymnal index). Add the words you are licensed to use in the Library, or the bulletin shows the number and title only.')}</div>}
      {song && (
        <>
          {verses.length > 1 && (
            <div className="row">
              <span className="small muted">{t('Stanzas')}:</span>
              {verses.map((v) => (
                <label key={v.label} className="check"><input type="checkbox" checked={selected.includes(v.label)} onChange={() => toggle(v.label)} />{v.label}</label>
              ))}
            </div>
          )}
          <div className={langs.length > 1 ? 'pair' : ''}>
            {langs.map((l) => (
              <div key={l} className="preview">
                {!song.stanzas.some((s) => s.text[l]) ? (
                  <span className="muted small">{langInfo(l).native}: {t('No words in this language yet — add them in the Library.')}</span>
                ) : song.stanzas.filter((s) => selected.includes(s.label) || s.label === 'R' || s.label === 'C').map((s) => (
                  <div key={s.label} style={{ marginBottom: 8, fontStyle: s.label === 'R' || s.label === 'C' ? 'italic' : undefined }}>
                    <span className="who">{s.label}</span>{s.text[l] || <span className="muted">—</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="small muted">
            {[song.author, song.tune, song.meter].filter(Boolean).join(' · ')}
            {!song.public_domain && <span className="badge warn" style={{ marginLeft: 6 }}>© {song.ccli ? `CCLI ${song.ccli}` : t('Copyright')}</span>}
          </div>
        </>
      )}
    </>
  );
}

export interface Passage { ref: string; translation: string; verses: { chapter: number; verse: number; text: string }[] }

export function ScriptureFields({ item, langs, svcBibles, onPatch }: { item: ServiceItem; langs: Lang[]; svcBibles: Record<Lang, string>; onPatch: (p: Partial<ServiceItem>, immediate?: boolean) => void }) {
  const { t } = useI18n();
  const ref = useDebounced(item.scripture_ref ?? '', 400);
  const [passages, setPassages] = useState<Partial<Record<Lang, Passage | string>>>({});
  const installed = useBibles();
  const churchBible = useChurchBible();
  const has = (code: string | undefined) => !!code && !!installed?.some((b) => b.code === code);
  // The version each column reads: this reading's choice, else the service's, else the church default (server side).
  const chosen = (l: Lang) => [item.bibles?.[l], svcBibles[l]].find(has) ?? '';
  const versionKey = langs.map(chosen).join('|');
  useEffect(() => {
    if (!ref.trim()) {
      setPassages({});
      return;
    }
    let live = true;
    Promise.all(langs.map((l) => api.get<Passage>(`/bible/passage?ref=${encodeURIComponent(ref)}&lang=${l}${chosen(l) ? `&translation=${encodeURIComponent(chosen(l))}` : ''}`).then((p) => [l, p] as const).catch((e) => [l, (e as Error).message] as const)))
      .then((rs) => live && setPassages(Object.fromEntries(rs)));
    return () => {
      live = false;
    };
  }, [ref, langs, versionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const setVersion = (l: Lang, code: string) => {
    const next = { ...(item.bibles ?? {}) };
    if (code) next[l] = code;
    else delete next[l];
    onPatch({ bibles: next }, true);
  };
  return (
    <>
      <Field label={t('Reference')} hint="Romans 8:28-39 · Ps 23 · 约 3:16">
        <input value={item.scripture_ref ?? ''} onChange={(e) => onPatch({ scripture_ref: e.target.value || null })} placeholder="Romans 8:28-39" />
      </Field>
      <div className="bible-pick">
        <span className="small muted">{t('Bible version')}</span>
        {langs.map((l) => (
          <label key={l}>
            {langs.length > 1 && langInfo(l).short}
            <BibleSelect lang={l} value={item.bibles?.[l] ?? ''} onChange={(c) => setVersion(l, c)}
              inheritLabel={`${t('Service default')} (${(has(svcBibles[l]) ? svcBibles[l] : churchBible(l)) ?? '—'})`} />
          </label>
        ))}
      </div>
      {ref && (
        <div className={langs.length > 1 ? 'pair' : ''}>
          {langs.map((l) => {
            const p = passages[l];
            const pasted = item.body?.[l]?.trim();
            return (
              <div key={l} className="preview">
                {pasted ? <span className="muted small">{t('Custom text')} ✓</span> : typeof p === 'string' ? <span className="muted">{p}</span> : p ? (
                  <>
                    <div className="small muted" style={{ marginBottom: 4 }}>{p.ref}<span className="bible-tag" title={t('Bible version')}>{p.translation || '—'}</span></div>
                    {p.verses.length ? p.verses.map((v) => <span key={`${v.chapter}:${v.verse}`}><sup>{v.verse}</sup>{v.text} </span>) : <span className="muted">—</span>}
                  </>
                ) : '…'}
              </div>
            );
          })}
        </div>
      )}
      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>{t('Custom text')}</summary>
        <div className="stack tight" style={{ marginTop: 8 }}>
          <div className="field-hint">{t('Pasted text overrides the bundled Bible for that language (e.g. ESV under licence).')}</div>
          <L10nInput multiline serif rows={4} value={item.body} onChange={(v) => onPatch({ body: v })} />
        </div>
      </details>
    </>
  );
}

/** Texts with more parts than this (catechisms, confessions) are always used with an explicit selection. */
export const MANY_PARTS = 12;

export const WSC_SEED_KEY = 'westminster-shorter-catechism-1-4';

/** A part's text in a language (the other Chinese script as a fallback; the server converts it properly). */
export const partText = (p: TextPart, l: Lang) => p.body[l] || (l === 'zh-Hant' ? p.body.zh : l === 'zh' ? p.body['zh-Hant'] : '') || '';

export function TextFields({ item, texts, langs, onPatch }: { item: ServiceItem; texts: Map<number, LiturgyText>; langs: Lang[]; onPatch: (p: Partial<ServiceItem>, immediate?: boolean) => void }) {
  const { t, lt } = useI18n();
  const text = item.ref_id ? texts.get(item.ref_id) : undefined;
  const grouped = useMemo(() => {
    const g = new Map<string, LiturgyText[]>();
    for (const x of texts.values()) g.set(x.category, [...(g.get(x.category) ?? []), x]);
    return [...g.entries()];
  }, [texts]);
  const textOptions = useMemo((): ComboOption[] => grouped.flatMap(([cat, xs]) => xs.map((x) => ({
    value: String(x.id),
    label: both(x.title),
    hint: x.parts?.length ? `${x.parts.length}` : undefined,
    group: cat.replace(/_/g, ' '),
    search: [...Object.values(x.title ?? {}), ...Object.values(x.body ?? {}).map((b) => (b ?? '').replace(/^[LCA]:\s*/, '').slice(0, 160)), ...(x.tags ?? [])].join(' '),
  }))), [grouped]);
  const parts = text?.parts ?? [];
  const labels = useMemo(() => parts.map((p) => p.label), [parts]);
  const many = parts.length > MANY_PARTS;
  const catechism = text?.category === 'catechism';
  const selected = item.stanzas ?? labels;
  const fullWsc = text?.key === WSC_SEED_KEY ? [...texts.values()].find((x) => x.key === 'wsc') : undefined;

  const setStanzas = (ls: string[]) => onPatch({ stanzas: !many && ls.length === labels.length ? null : ls }, true);
  /** Switch text; the item title follows the text title unless it was changed by hand. */
  const chooseText = (next: LiturgyText | undefined, stanzas?: string[]) => {
    const n = next?.parts?.length ?? 0;
    const patch: Partial<ServiceItem> = { ref_id: next?.id ?? null, stanzas: stanzas ?? (n > MANY_PARTS ? next!.parts!.slice(0, 3).map((p) => p.label) : null) };
    const generic = !hasAnyText(item.title) || item.title.en === KIND_LABEL.text.en || (text && item.title.en === text.title.en);
    if (next && generic) patch.title = next.title;
    onPatch(patch, true);
  };
  // A long text must never print all of its parts by accident: pick the first block.
  useEffect(() => {
    if (text && many && item.stanzas == null) onPatch({ stanzas: labels.slice(0, 3) }, true);
  }, [text?.id, many, item.stanzas == null]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = partRuns(selected, labels).join(', ');
  const [range, setRange] = useState(current);
  useEffect(() => setRange(current), [current]);
  const parsed = useMemo(() => parsePartSelection(range, labels), [range, labels]);
  const applyRange = () => {
    if (parsed.labels.length && parsed.labels.join() !== selected.join()) setStanzas(parsed.labels);
  };
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase().replace(/^q\.?\s*/, '');
  const list = parts.filter((p) => !ql || p.label.toLowerCase() === ql || JSON.stringify([p.title, p.body]).toLowerCase().includes(ql));
  const toggle = (label: string) => {
    const next = selected.includes(label) ? selected.filter((l) => l !== label) : [...selected, label];
    if (next.length) setStanzas(labels.filter((l) => next.includes(l)));
  };
  const firstLine = (p: TextPart) => (lt(p.body).split('\n').find((l) => l.trim()) ?? '').replace(/^[LCA][:：]\s?/, '');
  const chosen = parts.filter((p) => selected.includes(p.label));

  const lineNode = (line: string, l: Lang, key: number) => {
    const m = line.match(/^([LCA])[:：]\s?(.*)$/);
    return (
      <div key={key} className={m && m[1] !== 'L' ? 'c' : ''} style={{ minHeight: '0.8em' }}>
        {m && <span className="who">{speakerLabel(m[1] as 'L' | 'C' | 'A', l)}</span>}
        {m ? m[2] : line}
      </div>
    );
  };

  return (
    <>
      <Field label={t('Liturgy')}>
        <Combo
          value={item.ref_id ? String(item.ref_id) : ''}
          options={textOptions}
          noneLabel={`— ${t('Creeds & liturgy')} —`}
          placeholder={t('Type a title or the first words…')}
          ariaLabel={t('Liturgy')}
          onChange={(v) => chooseText(v ? texts.get(Number(v)) : undefined)}
        />
      </Field>
      {text?.key === WSC_SEED_KEY && (
        <div className="callout small row">
          <span className="grow">{fullWsc ? t('The full Westminster Shorter Catechism (all 107 questions) is in the library: use it to pick any questions.') : t('Import the Westminster Standards in Library → Liturgical texts to use any of the 107 questions.')}</span>
          {fullWsc && <button className="btn sm" onClick={() => chooseText(fullWsc, ['1', '2', '3', '4'])}>{t('Use the full catechism')}</button>}
        </div>
      )}
      {text && parts.length > 0 && (
        <div className="stack tight">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label={catechism ? t('Questions') : t('Parts')} hint={catechism ? '1-3 · 1,4,7-9 · Q1-3' : '1-3 · I.1-3 · XXI'}>
              <input value={range} style={{ width: 200 }} onChange={(e) => setRange(e.target.value)} onBlur={applyRange} onKeyDown={(e) => e.key === 'Enter' && applyRange()} />
            </Field>
            <button className="btn sm" title={t('Previous block')} disabled={!selected.length || labels.indexOf(selected[0]) <= 0} onClick={() => setStanzas(shiftBlock(selected, labels, -1))}><Icon name="chevronLeft" />{t('Previous block')}</button>
            <button className="btn sm" title={t('Next block')} disabled={!selected.length || labels.indexOf(selected[selected.length - 1]) >= labels.length - 1} onClick={() => setStanzas(shiftBlock(selected, labels, 1))}>{t('Next block')}<Icon name="chevronRight" /></button>
            <span className="badge reed">{langs.map((l) => partsLabel(partRuns(selected, labels), l, catechism)).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}</span>
          </div>
          {parsed.unknown.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>{t('Not found')}: {parsed.unknown.join(', ')}</div>}
          <details open={!many || undefined}>
            <summary className="small muted" style={{ cursor: 'pointer' }}>{t('Choose from the list')} ({selected.length}/{parts.length})</summary>
            <div className="stack tight" style={{ marginTop: 6 }}>
              <SearchBox value={q} onChange={setQ} placeholder={t('Number or words')} />
              <div className="card flush" style={{ maxHeight: 240, overflowY: 'auto', padding: '4px 8px' }}>
                {list.map((p) => (
                  <label key={p.label} className="check" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '3px 0' }}>
                    <input type="checkbox" checked={selected.includes(p.label)} onChange={() => toggle(p.label)} />
                    <span className="badge reed" style={{ minWidth: 38, justifyContent: 'center' }}>{p.label}</span>
                    <span className="small">{hasAnyText(p.title) && <span className="muted">{lt(p.title)} — </span>}{firstLine(p)}</span>
                  </label>
                ))}
                {!list.length && <div className="small muted">—</div>}
              </div>
            </div>
          </details>
        </div>
      )}
      {text && (
        <div className={langs.length > 1 ? 'pair' : ''}>
          {langs.map((l) => {
            const custom = item.body?.[l]?.trim();
            if (custom || !parts.length) {
              const src = custom || text.body[l] || '';
              return (
                <div key={l} className="preview">
                  {src.split('\n').map((line, i) => lineNode(line, l, i))}
                  {!src && <span className="muted">—</span>}
                </div>
              );
            }
            const shown = chosen.filter((p) => partText(p, l).trim());
            return (
              <div key={l} className="preview">
                {!shown.length && <span className="muted small">{langInfo(l).native}: {t('No text in this language yet — add it in the Library.')}</span>}
                {shown.map((p, k) => {
                  const num = catechism ? partsLabel([p.label], l, true) : p.label;
                  const lines = partText(p, l).split('\n').filter((x) => x.trim());
                  const m = lines[0].match(/^([LCA])[:：]\s?(.*)$/);
                  if (catechism) lines[0] = m ? `${m[1]}: ${num} ${m[2]}` : `${num} ${lines[0]}`;
                  else lines.unshift(num);
                  const prevTitle = k > 0 ? shown[k - 1].title?.[l] ?? shown[k - 1].title?.en : '';
                  const title = p.title?.[l] ?? p.title?.en;
                  return (
                    <div key={p.label} style={{ marginBottom: 8 }}>
                      {title && title !== prevTitle && <div className="small muted" style={{ fontStyle: 'italic' }}>{title}</div>}
                      {lines.map((line, i) => lineNode(line, l, i))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
      {text && <div className="small muted">{text.source} · {lt(text.title)}</div>}
      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>{t('Custom text')}</summary>
        <div className="stack tight" style={{ marginTop: 8 }}>
          <div className="field-hint">{t('Responsive format: start a line with L: (leader), C: (congregation) or A: (all). Blank line = new paragraph / slide.')}</div>
          <L10nInput multiline serif rows={5} value={item.body} onChange={(v) => onPatch({ body: v })} />
        </div>
      </details>
    </>
  );
}

// ------------------------------------------------------------------ insertion points on the reed
