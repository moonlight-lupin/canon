// The service planner — the heart of Canon. The order of worship runs down a "measuring reed"
// with clock times; items are reordered by drag, filled from the library panel, and edited inline.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hasAnyText } from '../../shared/labels.ts';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, useApi } from '../api.ts';
import { both, useContentLangs, useI18n } from '../i18n.tsx';
import {
  Bi, Field, L10nInput, Loading, ErrorBox, Modal, PageHead, SearchBox, Seg, confirmAction, fmtDate, useAction, useDebounced, useSession, useToast,
} from '../components/ui.tsx';
import { Icon, type IconName } from '../components/icons.tsx';
import { MAX_SERVICE_LANGS, langInfo } from '../../shared/languages.ts';
import { partsLabel, postureLabel, speakerLabel } from '../../shared/labels.ts';
import { matchesHymnNumber, parsePartSelection, partRuns, shiftBlock } from '../../shared/parts.ts';
import ShareButton from '../outputs/ShareButton.tsx';
import { SEASON_KEYS, SeasonChip } from '../components/brand.tsx';
import { SEASONS, seasonOf } from '../../shared/season.ts';
import type {
  ItemKind, L10n, Lang, LiturgyText, Posture, ServiceFull, ServiceItem, Song, TeamWithRoles, RosterWarning,
} from '../types-client.ts';
import type { Hymnal, TextPart } from '../types-client.ts';
import { BulletinChoice, BulletinTemplateField, SlideThemeField } from './presentation-pickers.tsx';
import { SlideBlocksPicker } from './Blocks.tsx';
import { SlideBackgroundPicker } from './Backgrounds.tsx';
import { InfoTip } from '../components/InfoTip.tsx';
import { Combo, type ComboOption } from '../components/Combo.tsx';
import { CongregationField } from '../components/Congregations.tsx';
import { ServiceBulletinTab } from './ServiceBulletinTab.tsx';
import type { BulletinBlock } from '../../shared/presentation.ts';
import { BibleSelect, useBibles, useChurchBible } from '../components/BibleTools.tsx';

export const KIND_ICON: Record<ItemKind, IconName> = {
  section: 'section', song: 'music', scripture: 'scroll', text: 'text', sermon: 'mic', prayer: 'pray',
  sacrament: 'cup', offering: 'gift', announcements: 'megaphone', music: 'music', other: 'dots',
};
export const KIND_LABEL: Record<ItemKind, L10n> = {
  section: { en: 'Section', zh: '段落' },
  song: { en: 'Hymn', zh: '诗歌' },
  scripture: { en: 'Scripture Reading', zh: '读经' },
  text: { en: 'Liturgy', zh: '礼文' },
  sermon: { en: 'Sermon', zh: '讲道' },
  prayer: { en: 'Prayer', zh: '祷告' },
  sacrament: { en: 'Sacrament', zh: '圣礼' },
  offering: { en: 'Offering', zh: '奉献' },
  announcements: { en: 'Announcements', zh: '报告' },
  music: { en: 'Music', zh: '音乐' },
  other: { en: 'Item', zh: '项目' },
};
const KINDS = Object.keys(KIND_LABEL) as ItemKind[];

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

type Assignment = ServiceFull['assignments'][number] & { email?: string | null };

export default function ServiceEditor() {
  const { id } = useParams();
  const sid = Number(id);
  const nav = useNavigate();
  const { t, lt, lang } = useI18n();
  const { canEdit, settings } = useSession();
  const toast = useToast();
  const { run } = useAction();
  const { data: svc, setData: setSvc, error, reload } = useApi<ServiceFull>(`/services/${sid}`);
  const { data: songs } = useApi<Song[]>('/songs');
  const { data: texts } = useApi<LiturgyText[]>('/texts');
  const { data: teams } = useApi<TeamWithRoles[]>('/teams');
  const [openId, setOpenId] = useState<number | null>(null);
  /** position where the quick-add card is open on the reed (null = closed) */
  const [insertAt, setInsertAt] = useState<number | null>(null);
  /** a library item being dragged from the panel, and the agenda item it would land before */
  const [libDrag, setLibDrag] = useState<{ label: string; item: Partial<ServiceItem> } | null>(null);
  const [dropBefore, setDropBefore] = useState<number | 'end' | null>(null);
  const [tab, setTab] = useState<'order' | 'team' | 'bulletin'>('order');
  const [showDetails, setShowDetails] = useState(false);
  const [dialog, setDialog] = useState<null | 'duplicate' | 'template'>(null);

  const songMap = useMemo(() => new Map((songs ?? []).map((s) => [s.id, s])), [songs]);
  const textMap = useMemo(() => new Map((texts ?? []).map((s) => [s.id, s])), [texts]);
  const roleMap = useMemo(() => new Map((teams ?? []).flatMap((tm) => tm.roles.map((r) => [r.id, r] as const))), [teams]);

  // ---- debounced item saves (typing in a field patches the item after a pause)
  const pending = useRef(new Map<number, { patch: Partial<ServiceItem>; timer: number }>());
  const flush = useCallback(async (itemId: number) => {
    const p = pending.current.get(itemId);
    if (!p) return;
    pending.current.delete(itemId);
    clearTimeout(p.timer);
    try {
      await api.patch(`/items/${itemId}`, p.patch);
    } catch (e) {
      toast((e as Error).message, true);
      reload();
    }
  }, [toast, reload]);
  useEffect(() => () => { for (const k of pending.current.keys()) flush(k); }, [flush]);

  const patchItem = useCallback((itemId: number, patch: Partial<ServiceItem>, immediate = false) => {
    setSvc((s) => (s ? { ...s, items: s.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) } : s));
    const cur = pending.current.get(itemId);
    if (cur) clearTimeout(cur.timer);
    const merged = { ...(cur?.patch ?? {}), ...patch };
    const timer = window.setTimeout(() => flush(itemId), immediate ? 0 : 600);
    pending.current.set(itemId, { patch: merged, timer });
  }, [setSvc, flush]);

  // the Bulletin tab saves the weekly sections itself; keep the loaded service in step
  const onBulletinContent = useCallback((c: ServiceFull['bulletin_content']) => setSvc((s) => (s ? { ...s, bulletin_content: c } : s)), [setSvc]);

  const patchService = useCallback(async (patch: Partial<ServiceFull>) => {
    setSvc((s) => (s ? { ...s, ...patch } : s));
    await run(() => api.patch(`/services/${sid}`, patch));
  }, [setSvc, run, sid]);

  // ---- add / remove / reorder
  const addItem = useCallback(async (item: Partial<ServiceItem>, at?: number) => {
    if (!svc) return;
    // Fill an empty song slot that is open (templates leave "Hymn of Praise" etc. empty) —
    // unless the item is being placed at an explicit position.
    const open = at === undefined ? svc.items.find((i) => i.id === openId) : undefined;
    if (open && open.kind === 'song' && item.kind === 'song' && !open.ref_id && item.ref_id) {
      patchItem(open.id, { ref_id: item.ref_id, stanzas: null }, true);
      return;
    }
    if (open && open.kind === 'scripture' && item.kind === 'scripture' && !open.scripture_ref && item.scripture_ref) {
      patchItem(open.id, { scripture_ref: item.scripture_ref }, true);
      return;
    }
    if (open && open.kind === 'text' && item.kind === 'text' && !open.ref_id && item.ref_id) {
      patchItem(open.id, { ref_id: item.ref_id }, true);
      return;
    }
    const position = at ?? (open ? open.position + 1 : undefined);
    const created = await run(() => api.post<ServiceItem>(`/services/${sid}/items`, { item, position }));
    if (created) {
      await reload();
      setInsertAt(null);
      setOpenId(created.id);
    }
  }, [svc, openId, patchItem, run, sid, reload]);

  const removeItem = async (itemId: number) => {
    if (!confirmAction(t('Are you sure?'))) return;
    pending.current.delete(itemId);
    const ok = await run(() => api.del(`/items/${itemId}`));
    if (ok) {
      setSvc((s) => (s ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s));
      if (openId === itemId) setOpenId(null);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const moveItem = async (itemId: number, delta: number) => {
    if (!svc) return;
    const from = svc.items.findIndex((i) => i.id === itemId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= svc.items.length) return;
    const items = arrayMove(svc.items, from, to).map((it, i) => ({ ...it, position: i }));
    setSvc({ ...svc, items });
    await run(() => api.put(`/services/${sid}/order`, { item_ids: items.map((i) => i.id) }));
  };
  // Reordering snaps to the closest item; library items only drop when the pointer is over the agenda.
  const collision: CollisionDetection = (args) =>
    String(args.active.id).startsWith('lib-') ? pointerWithin(args) : closestCenter(args);
  const onDragStart = (e: DragStartEvent) => {
    const d = e.active.data.current as { lib?: { label: string; item: Partial<ServiceItem> } } | undefined;
    if (d?.lib) setLibDrag(d.lib);
  };
  const onDragOver = (e: DragOverEvent) => {
    if (!libDrag) return;
    setDropBefore(e.over ? (e.over.id === 'agenda-end' ? 'end' : Number(e.over.id)) : null);
  };
  const onDragEnd = async (e: DragEndEvent) => {
    if (libDrag) {
      const target = e.over?.id;
      setLibDrag(null);
      setDropBefore(null);
      if (!svc || target === undefined) return;
      const at = target === 'agenda-end' ? svc.items.length : svc.items.findIndex((i) => i.id === Number(target));
      if (at >= 0) await addItem(libDrag.item, at);
      return;
    }
    if (!svc || !e.over || e.active.id === e.over.id || typeof e.over.id !== 'number') return;
    const from = svc.items.findIndex((i) => i.id === e.active.id);
    const to = svc.items.findIndex((i) => i.id === e.over!.id);
    const items = arrayMove(svc.items, from, to).map((it, i) => ({ ...it, position: i }));
    setSvc({ ...svc, items });
    await run(() => api.put(`/services/${sid}/order`, { item_ids: items.map((i) => i.id) }));
  };

  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  if (!svc) return <Loading />;

  const start = toMin(svc.start_time);
  let acc = start;
  const times = svc.items.map((it) => {
    const s = acc;
    acc += it.duration_min;
    return s;
  });
  const total = acc - start;
  const langs = svc.languages;

  const subtitleOf = (it: ServiceItem): L10n => {
    if (it.kind === 'song' && it.ref_id) {
      const s = songMap.get(it.ref_id);
      // "HP 123 · Holy, Holy, Holy" — the item's hymnal, else the song's first
      const n = (it.hymnal_id && s?.hymnals?.find((h) => h.hymnal_id === it.hymnal_id)) || s?.hymnals?.[0];
      return s && n ? Object.fromEntries(Object.keys(s.title).map((k) => [k, `${n.abbr} ${n.number} · ${s.title[k]}`])) : s?.title ?? {};
    }
    if (it.kind === 'text' && it.ref_id) {
      const tx = textMap.get(it.ref_id);
      if (!tx) return {};
      // "Westminster Shorter Catechism Q.1–3"
      const all = (tx.parts ?? []).map((p) => p.label);
      const runs = all.length && it.stanzas ? partRuns(it.stanzas, all) : [];
      const full: L10n = runs.length
        ? Object.fromEntries(Object.keys(tx.title).map((k) => [k, `${tx.title[k]} ${partsLabel(runs, k, tx.category === 'catechism')}`]))
        : tx.title;
      if (!runs.length && tx.title.en === it.title.en) return {};
      // "Call to Worship: Psalm 95" under "Call to Worship" → just "Psalm 95"
      const strip = (full = '', head = '') => (head && full.startsWith(head) ? full.slice(head.length).replace(/^[\s:：—-]+/, '') : full);
      return Object.fromEntries(Object.keys(full).map((k) => [k, strip(full[k], it.title[k])]));
    }
    if (it.kind === 'scripture' && it.scripture_ref) return { en: it.scripture_ref };
    // a reading with no reference right before the sermon reads the sermon text
    if (it.kind === 'scripture' && svc.sermon_ref && svc.items[svc.items.indexOf(it) + 1]?.kind === 'sermon') return { en: `${svc.sermon_ref} · ${t('Sermon text')}` };
    if (it.kind === 'sermon') return svc.sermon_title.en || svc.sermon_title.zh ? svc.sermon_title : { en: svc.sermon_ref ?? '' };
    return {};
  };
  const leaderOf = (it: ServiceItem) => {
    if (it.role_id) {
      const names = svc.assignments.filter((a) => a.role_id === it.role_id && a.status !== 'declined').map((a) => a.person_name);
      if (names.length) return names.join(', ');
      const r = roleMap.get(it.role_id);
      return r ? lt(r.name) : null;
    }
    return it.leader || (it.kind === 'sermon' ? svc.preacher : null);
  };

  const emailTeam = () => {
    const emails = [...new Set((svc.assignments as Assignment[]).filter((a) => a.status !== 'declined' && a.email).map((a) => a.email!))];
    if (!emails.length) {
      toast('No e-mail addresses for the people serving in this service.', true);
      return;
    }
    const subject = `${both(svc.title, langs)} — ${svc.date}`;
    const lines = svc.items.filter((i) => i.kind !== 'section').map((it) => `${fmtMin(times[svc.items.indexOf(it)] ?? 0)}  ${both(it.title, langs)}${leaderOf(it) ? ` — ${leaderOf(it)}` : ''}`);
    const share = svc.share_token ? `\n\n${location.origin}/share/${svc.share_token}` : '';
    const body = `${subject}\n\n${lines.join('\n')}${share}`;
    location.href = `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
  };

  return (
    <div className="page wide">
      <PageHead
        eyebrow={<>{`${fmtDate(svc.date, lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · ${svc.start_time}–${fmtMin(start + total)}`}<SeasonChip date={svc.date} season={svc.season} color={settings?.season_colours !== false} /></>}
        title={<Bi v={svc.title} />}
        sub={
          <span className="row" style={{ gap: 10 }}>
            {svc.preacher && <span>{t('Preacher')}: {svc.preacher}</span>}
            {hasAnyText(svc.sermon_title) && <span className="serif">“{lt(svc.sermon_title)}”{svc.sermon_ref ? ` · ${svc.sermon_ref}` : ''}</span>}
            <span className="badge reed">{total} {t('min')}</span>
          </span>
        }
      >
        <Link to="/services" className="btn ghost"><Icon name="chevronLeft" />{t('Services')}</Link>
        {canEdit ? (
          <Seg value={svc.status} onChange={(v) => patchService({ status: v })} options={[{ value: 'draft', label: t('Draft') }, { value: 'final', label: t('Final') }]} />
        ) : (
          <span className={`badge ${svc.status === 'final' ? 'ok' : ''}`}>{t(svc.status === 'final' ? 'Final' : 'Draft')}</span>
        )}
      </PageHead>

      {/* Outputs */}
      <div className="card" style={{ padding: '10px 12px', marginBottom: 16 }}>
        <div className="row">
          <span className="eyebrow" style={{ margin: '0 6px 0 2px' }}>{t('Outputs')}</span>
          <Link className="btn sm" to={`/services/${sid}/bulletin`}><Icon name="print" />{t('Bulletin')}</Link>
          <Link className="btn sm" to={`/services/${sid}/slides`} target="_blank"><Icon name="monitor" />{t('Slides')}</Link>
          <Link className="btn sm" to={`/services/${sid}/runsheet`}><Icon name="list" />{t('Run sheet')}</Link>
          <a className="btn sm" href={`/api/services/${sid}/slides.pptx`} title={t('The slides as a PowerPoint file, styled by the slide template')}><Icon name="download" />{t('PowerPoint')}</a>
          <a className="btn sm" href={`/api/services/${sid}/export.docx`}><Icon name="file" />{t('Word document')}</a>
          <a className="btn sm" href={`/api/services/${sid}/freeshow.project`}><Icon name="download" />{t('FreeShow project')}</a>
          <button className="btn sm" onClick={emailTeam}><Icon name="mail" />{t('Email the team')}</button>
          <div className="grow" />
          {canEdit && <ShareButton serviceId={sid} shareToken={svc.share_token} onChange={(token) => setSvc({ ...svc, share_token: token })} />}
          {canEdit && (
            <>
              <button className="btn sm ghost" onClick={() => setDialog('duplicate')}><Icon name="copy" />{t('Duplicate')}</button>
              <button className="btn sm ghost" onClick={() => setDialog('template')}><Icon name="layout" />{t('Save as template')}</button>
              <button className="btn sm ghost danger" onClick={async () => {
                if (!confirmAction(t('Are you sure?'))) return;
                if (await run(() => api.del(`/services/${sid}`))) nav('/services');
              }}><Icon name="trash" /></button>
            </>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={tab === 'order' ? 'on' : ''} onClick={() => setTab('order')}>{t('Order of worship')}</button>
        <button className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}>
          {t('Team & roster')} <span className="badge" style={{ marginLeft: 4 }}>{svc.assignments.filter((a) => a.status !== 'declined').length}</span>
        </button>
        <button className={tab === 'bulletin' ? 'on' : ''} onClick={() => setTab('bulletin')}>{t('Bulletin')}</button>
        <div className="grow" />
        <button onClick={() => setShowDetails((s) => !s)}><Icon name="edit" style={{ width: 14, height: 14, verticalAlign: -2, marginRight: 4 }} />{t('Edit')}…</button>
      </div>

      {showDetails && <DetailsCard svc={svc} onSave={patchService} canEdit={canEdit} />}

      {tab === 'order' ? (
        <DndContext sensors={sensors} collisionDetection={collision} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setLibDrag(null); setDropBefore(null); }}>
        <div className="planner">
          <div>
              <SortableContext items={svc.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <div className="reed-list">
                  {svc.items.map((it, i) => (
                    <Fragment key={it.id}>
                    {canEdit && (insertAt === i ? (
                      <QuickAdd at={i} time={fmtMin(times[i])} date={svc.date} songs={songs ?? []} texts={texts ?? []} onAdd={addItem} onClose={() => setInsertAt(null)} />
                    ) : (
                      <InsertPoint active={dropBefore === it.id} onClick={() => { setInsertAt(i); setOpenId(null); }} label={`${t('Insert here')} · ${fmtMin(times[i])}`} />
                    ))}
                    <SortableItem id={it.id} disabled={!canEdit}>
                      {(handle) => (
                        <div className={`reed-item${it.kind === 'section' ? ' section' : ''}`}>
                          <div className="reed-time">{fmtMin(times[i])}</div>
                          <div className={`item-card${openId === it.id ? ' open' : ''}`}>
                            <div className="item-row" onClick={() => setOpenId(openId === it.id ? null : it.id)} style={{ cursor: 'pointer' }}>
                              {canEdit && <span className="grip" {...handle} onClick={(e) => e.stopPropagation()} aria-label={t('Drag to move')} title={t('Drag to move')}><Icon name="grip" width={16} height={16} /></span>}
                              {it.kind !== 'section' && <span className="kind" title={lt(KIND_LABEL[it.kind])}><Icon name={KIND_ICON[it.kind]} /></span>}
                              <div className="grow">
                                <div className="ttl">
                                  <Bi v={it.title} />
                                </div>
                                {it.kind !== 'section' && (
                                  <div className="subt">
                                    {lt(subtitleOf(it)) || (it.kind === 'song' && !it.ref_id ? <span className="badge warn">{t('Hymn')} ?</span> : it.kind === 'scripture' && !it.scripture_ref ? <span className="badge warn">{t('Reference')} ?</span> : null)}
                                  </div>
                                )}
                              </div>
                              {it.kind !== 'section' && (
                                <div className="meta">
                                  {leaderOf(it) && <span className="badge">{leaderOf(it)}</span>}
                                  {it.posture && <span className="small muted nowrap" title={t('Posture')}>{postureLabel(it.posture, lang)}</span>}
                                  {!it.on_slides && <span title={t('On slides')} style={{ opacity: 0.5 }}><Icon name="monitor" width={13} height={13} style={{ textDecoration: 'line-through' }} /></span>}
                                  {!!it.slide_blocks?.length && <span title={t('QR codes & notes on slides')} style={{ color: 'var(--reed-ink)', display: 'inline-flex' }}><Icon name="qr" width={14} height={14} /></span>}
                                  <span className="nowrap">{it.duration_min} {t('min')}</span>
                                </div>
                              )}
                            </div>
                            {openId === it.id && (
                              <ItemEditor
                                item={it}
                                langs={langs}
                                svcBibles={svc.bibles}
                                songs={songMap}
                                texts={textMap}
                                teams={teams ?? []}
                                canEdit={canEdit}
                                onPatch={(p, now) => patchItem(it.id, p, now)}
                                onDelete={() => removeItem(it.id)}
                                onMove={(d) => moveItem(it.id, d)}
                                isFirst={i === 0}
                                isLast={i === svc.items.length - 1}
                              />
                            )}
                          </div>
                        </div>
                      )}
                    </SortableItem>
                    </Fragment>
                  ))}
                  {canEdit && (insertAt === svc.items.length ? (
                    <QuickAdd at={svc.items.length} time={fmtMin(start + total)} date={svc.date} songs={songs ?? []} texts={texts ?? []} onAdd={addItem} onClose={() => setInsertAt(null)} />
                  ) : (
                    <AgendaEnd active={dropBefore === 'end'} empty={!svc.items.length} onAdd={() => { setInsertAt(svc.items.length); setOpenId(null); }} />
                  ))}
                  <div className="reed-item">
                    <div className="reed-time">{fmtMin(start + total)}</div>
                    <div className="muted small" style={{ padding: '10px 4px' }}>{t('Total')}: {total} {t('minutes')}</div>
                  </div>
                </div>
              </SortableContext>
          </div>
          {canEdit && (
            <LibraryPanel
              date={svc.date}
              songs={songs ?? []}
              texts={texts ?? []}
              openItem={svc.items.find((i) => i.id === openId) ?? null}
              onAdd={addItem}
            />
          )}
        </div>
        <DragOverlay dropAnimation={null}>
          {libDrag && <div className="drag-chip"><Icon name="plus" width={14} height={14} />{libDrag.label}</div>}
        </DragOverlay>
        </DndContext>
      ) : tab === 'bulletin' ? (
        <ServiceBulletinTab svc={svc} canEdit={canEdit} onContent={onBulletinContent} />
      ) : (
        <TeamTab svc={svc} teams={teams ?? []} canEdit={canEdit} onChange={reload} />
      )}

      {dialog === 'duplicate' && <DuplicateDialog svc={svc} onClose={() => setDialog(null)} />}
      {dialog === 'template' && <SaveTemplateDialog svc={svc} onClose={() => setDialog(null)} />}
    </div>
  );
}

function SortableItem({ id, disabled, children }: { id: number; disabled: boolean; children: (handle: Record<string, unknown>) => ReactNode }) {
  // Agenda items are sortable (drag the grip) and also drop targets for library items dragged from the panel.
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? 'item-dragging' : ''}>
      {children({ ...attributes, ...listeners })}
    </div>
  );
}

// ------------------------------------------------------------------ service details

type CoverStyle = NonNullable<ServiceFull['cover']['style']>;
const COVER_STYLES: CoverStyle[] = ['plain', 'cross', 'logo', 'verse'];
const COVER_LABEL: Record<CoverStyle, string> = { plain: 'Plain', cross: 'Cross', logo: 'Church logo', verse: 'Verse of the week' };

function DetailsCard({ svc, onSave, canEdit }: { svc: ServiceFull; onSave: (p: Partial<ServiceFull>) => Promise<void>; canEdit: boolean }) {
  const { t, lt } = useI18n();
  const { settings } = useSession();
  const churchLangs = [...new Set([...useContentLangs(), ...svc.languages])];
  const churchBible = useChurchBible();
  const [d, setD] = useState(svc);
  const set = <K extends keyof ServiceFull>(k: K, v: ServiceFull[K]) => setD((x) => ({ ...x, [k]: v }));
  const toggleLang = (l: Lang) => {
    const has = d.languages.includes(l);
    const next = churchLangs.filter((x) => (x === l ? !has : d.languages.includes(x)));
    if (next.length && next.length <= MAX_SERVICE_LANGS) set('languages', next);
  };
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
        <div className="form-grid">
          <Field label={t('Date')}><input type="date" value={d.date} onChange={(e) => set('date', e.target.value)} /></Field>
          <Field label={t('Start time')}><input type="time" value={d.start_time} onChange={(e) => set('start_time', e.target.value)} /></Field>
          <Field label={t('Preacher')}><input value={d.preacher ?? ''} onChange={(e) => set('preacher', e.target.value)} /></Field>
          <Field label={t('Sermon text')}><input value={d.sermon_ref ?? ''} placeholder="Isaiah 6:1-8" onChange={(e) => set('sermon_ref', e.target.value)} /></Field>
          <Field label={t('Languages')}>
            <div className="row">
              {churchLangs.map((l) => (
                <label key={l} className="check"><input type="checkbox" checked={d.languages.includes(l)} onChange={() => toggleLang(l)} />{langInfo(l).native}</label>
              ))}
            </div>
          </Field>
          <Field label={t('Bible versions')} hint={t('For every reading in this service; a reading can choose its own.')}>
            <div className="bible-pick">
              {d.languages.map((l) => (
                <label key={l}>
                  {langInfo(l).short}
                  <BibleSelect lang={l} value={d.bibles?.[l] ?? ''} inheritLabel={`${t('Church default')} (${churchBible(l) ?? '—'})`}
                    onChange={(c) => set('bibles', { ...(d.bibles ?? {}), [l]: c })} />
                </label>
              ))}
            </div>
          </Field>
          <CongregationField value={d.congregation_id} onChange={(v) => set('congregation_id', v)} />
          <Field label={t('Liturgical season')}>
            <select value={d.season ?? ''} onChange={(e) => set('season', (e.target.value || null) as ServiceFull['season'])}>
              <option value="">{t('Auto')} — {lt(SEASONS[seasonOf(d.date || svc.date)].name)}</option>
              {SEASON_KEYS.map((k) => <option key={k} value={k}>{lt(SEASONS[k].name)}</option>)}
            </select>
          </Field>
          <Field label={t('Bulletin cover')}>
            <select value={d.cover?.style ?? ''} onChange={(e) => set('cover', { ...d.cover, style: (e.target.value || undefined) as CoverStyle | undefined })}>
              <option value="">{t('Church default')} — {t(COVER_LABEL[settings?.bulletin_cover ?? 'cross'])}</option>
              {COVER_STYLES.map((c) => <option key={c} value={c}>{t(COVER_LABEL[c])}</option>)}
            </select>
          </Field>
          {(d.cover?.style ?? settings?.bulletin_cover) === 'verse' && (
            <Field label={t('Cover verse')} hint={t('Printed in every language of the service.')}>
              <input value={d.cover?.verse_ref ?? ''} placeholder="Psalm 95:6" onChange={(e) => set('cover', { ...d.cover, verse_ref: e.target.value || undefined })} />
            </Field>
          )}
          <BulletinTemplateField value={d.bulletin_template_id ?? null} onChange={(v) => set('bulletin_template_id', v)} />
          <SlideThemeField value={d.slide_theme_id ?? null} onChange={(v) => set('slide_theme_id', v)} />
        </div>
        <Field label={t('Title')}><L10nInput value={d.title} onChange={(v) => set('title', v)} /></Field>
        <Field label={t('Sermon title')}><L10nInput value={d.sermon_title} onChange={(v) => set('sermon_title', v)} /></Field>
        <Field label={t('Theme')}><L10nInput value={d.theme} onChange={(v) => set('theme', v)} /></Field>
        <Field label={t('Notes')}><textarea rows={2} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="row end">
          <button className="btn primary" onClick={() => onSave({
            date: d.date, start_time: d.start_time, preacher: d.preacher || null, sermon_ref: d.sermon_ref || null,
            languages: d.languages, title: d.title, sermon_title: d.sermon_title, theme: d.theme, notes: d.notes || null,
            season: d.season ?? null, cover: { style: d.cover?.style, verse_ref: d.cover?.verse_ref?.trim() || undefined },
            slide_theme_id: d.slide_theme_id ?? null, bulletin_template_id: d.bulletin_template_id ?? null, congregation_id: d.congregation_id ?? null,
            bibles: Object.fromEntries(Object.entries(d.bibles ?? {}).filter(([l, c]) => c && d.languages.includes(l))),
          })}>{t('Save')}</button>
        </div>
      </fieldset>
    </div>
  );
}

// ------------------------------------------------------------------ item editor

function ItemEditor({
  item, langs, songs, texts, teams, canEdit, onPatch, onDelete, onMove, isFirst, isLast, svcBibles,
}: {
  svcBibles?: Record<Lang, string>;
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
              <Field label={t('Leader')}>
                <input value={item.leader ?? ''} placeholder={item.role_id ? '(from roster)' : ''} onChange={(e) => onPatch({ leader: e.target.value || null })} />
              </Field>
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

function SongFields({ item, songs, langs, onPatch }: { item: ServiceItem; songs: Map<number, Song>; langs: Lang[]; onPatch: (p: Partial<ServiceItem>, immediate?: boolean) => void }) {
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

interface Passage { ref: string; translation: string; verses: { chapter: number; verse: number; text: string }[] }

function ScriptureFields({ item, langs, svcBibles, onPatch }: { item: ServiceItem; langs: Lang[]; svcBibles: Record<Lang, string>; onPatch: (p: Partial<ServiceItem>, immediate?: boolean) => void }) {
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
const MANY_PARTS = 12;
const WSC_SEED_KEY = 'westminster-shorter-catechism-1-4';

/** A part's text in a language (the other Chinese script as a fallback; the server converts it properly). */
const partText = (p: TextPart, l: Lang) => p.body[l] || (l === 'zh-Hant' ? p.body.zh : l === 'zh' ? p.body['zh-Hant'] : '') || '';

function TextFields({ item, texts, langs, onPatch }: { item: ServiceItem; texts: Map<number, LiturgyText>; langs: Lang[]; onPatch: (p: Partial<ServiceItem>, immediate?: boolean) => void }) {
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

/** A small "+" on the reed between two items; opens the quick-add card. Also shows where a dragged library item will land. */
function InsertPoint({ onClick, label, active }: { onClick: () => void; label: string; active?: boolean }) {
  return (
    <div className={`insert-point${active ? ' active' : ''}`}>
      <button type="button" onClick={onClick} aria-label={label} title={label}><Icon name="plus" /></button>
      <span className="insert-line" aria-hidden="true" />
    </div>
  );
}

/** End of the agenda: "Add item" button, and a drop zone for library items. */
function AgendaEnd({ onAdd, active, empty }: { onAdd: () => void; active: boolean; empty: boolean }) {
  const { t } = useI18n();
  const { setNodeRef } = useDroppable({ id: 'agenda-end' });
  return (
    <div ref={setNodeRef} className={`reed-item add-end${active ? ' active' : ''}`}>
      {empty && <div className="drop-hint" style={{ marginBottom: 8 }}>{t('Drag hymns, readings and liturgy here from the library, or press Add item.')}</div>}
      <button className="btn" onClick={onAdd}><Icon name="plus" />{t('Add item')}</button>
    </div>
  );
}

/** Wrap a library-panel entry so it can be dragged into the agenda (clicking still adds it). */
function LibDrag({ id, label, item, children }: { id: string; label: string; item: Partial<ServiceItem>; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id, data: { lib: { label, item } } });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} style={{ opacity: isDragging ? 0.4 : 1, touchAction: 'none' }}>
      {children}
    </div>
  );
}

const QUICK_KINDS: ItemKind[] = ['song', 'scripture', 'text', 'prayer', 'sermon', 'section', 'offering', 'sacrament', 'announcements', 'music', 'other'];

// ------------------------------------------------------------------ song usage ("last sung")

type SongUse = Record<number, { last_used: string; times_12m: number }>;
const RECENT_DAYS = 28;

/** When each song was last sung before the service date, and how often in the 12 months before it. */
const useSongUsage = (date: string) => useApi<SongUse>(`/songs/usage?before=${date}`).data ?? {};

/** "last sung 21 Sep" / "上次 9月21日" or "never sung"; warn colour when sung in the 4 weeks before the service. */
function UsageBadge({ use, date }: { use?: SongUse[number]; date: string }) {
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
function QuickAdd({ at, time, date, songs, texts, onAdd, onClose }: {
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

function LibraryPanel({ date, songs, texts, openItem, onAdd }: { date: string; songs: Song[]; texts: LiturgyText[]; openItem: ServiceItem | null; onAdd: (i: Partial<ServiceItem>) => void }) {
  const { t, lt } = useI18n();
  const usage = useSongUsage(date);
  const [tab, setTab] = useState<'songs' | 'texts' | 'scripture' | 'elements'>('songs');
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
          {(['songs', 'texts', 'scripture', 'elements'] as const).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {t({ songs: 'Hymns & psalms', texts: 'Creeds & liturgy', scripture: 'Scripture', elements: 'Elements' }[k])}
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

function TeamTab({ svc, teams, canEdit, onChange }: { svc: ServiceFull; teams: TeamWithRoles[]; canEdit: boolean; onChange: () => void }) {
  const { t, lt } = useI18n();
  const { run } = useAction();
  const [remind, setRemind] = useState(false);
  const { data: warnings, reload: reloadWarnings } = useApi<RosterWarning[]>(`/services/${svc.id}/warnings`);
  const { data: people } = useApi<{ rows: { id: number; first_name: string; last_name: string; preferred_name: string | null; native_name: string | null }[] }>('/people?status=member,regular&limit=2000');
  const { data: away } = useApi<{ person_id: number; start_date: string; end_date: string }[]>(`/unavailability?from=${svc.date}&to=${svc.date}`);
  const awaySet = new Set((away ?? []).map((a) => a.person_id));
  const nameOf = (p: { first_name: string; last_name: string; preferred_name: string | null; native_name: string | null }) =>
    `${p.preferred_name || p.first_name} ${p.last_name}${p.native_name ? ' ' + p.native_name : ''}`.trim();

  const refresh = () => {
    onChange();
    reloadWarnings();
  };
  const assign = async (roleId: number, personId: number) => {
    if (await run(() => api.post(`/services/${svc.id}/assignments`, { role_id: roleId, person_id: personId }))) refresh();
  };
  const cycle = async (a: ServiceFull['assignments'][number]) => {
    const next = a.status === 'scheduled' ? 'confirmed' : a.status === 'confirmed' ? 'declined' : 'scheduled';
    if (await run(() => api.patch(`/assignments/${a.id}`, { status: next }))) refresh();
  };
  const unassign = async (aid: number) => {
    if (await run(() => api.del(`/assignments/${aid}`))) refresh();
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 320px', alignItems: 'start' }}>
      <div className="stack">
        {canEdit && (
          <div className="row between">
            <span className="muted small">{t('E-mail each volunteer their role, items and times for this service.')}</span>
            <button className="btn sm" onClick={() => setRemind(true)}><Icon name="mail" />{t('Send reminders')}</button>
            {remind && <ReminderDialog svc={svc} onClose={() => setRemind(false)} />}
          </div>
        )}
        {teams.map((tm) => (
          <div key={tm.id} className="card flush">
            <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--rule)' }}>
              <span className="dot" style={{ background: tm.color }} />
              <h3><Bi v={tm.name} /></h3>
            </div>
            <table className="t">
              <tbody>
                {tm.roles.map((r) => {
                  const as = svc.assignments.filter((a) => a.role_id === r.id);
                  const active = as.filter((a) => a.status !== 'declined').length;
                  const qualified = new Set(r.members.map((m) => m.person_id));
                  return (
                    <tr key={r.id}>
                      <td style={{ width: 200 }}>
                        <Bi v={r.name} />
                        {r.needed > 0 && <div className={`small ${active < r.needed ? '' : 'muted'}`} style={{ color: active < r.needed ? 'var(--warn)' : undefined }}>{active}/{r.needed}</div>}
                      </td>
                      <td>
                        {as.map((a) => (
                          <span key={a.id} className={`chip ${a.status}${awaySet.has(a.person_id) ? ' warn' : ''}`}>
                            <span onClick={() => canEdit && cycle(a)} style={{ cursor: canEdit ? 'pointer' : undefined }} title={t(a.status[0].toUpperCase() + a.status.slice(1))}>
                              {a.status === 'confirmed' && '✓ '}{a.person_name}
                            </span>
                            {canEdit && <button onClick={() => unassign(a.id)} aria-label={t('Delete')}>×</button>}
                          </span>
                        ))}
                        {canEdit && (
                          <span style={{ display: 'inline-block', width: 170, marginLeft: 4 }}>
                            <Combo
                              className="cell-add"
                              value=""
                              placeholder={`+ ${t('Add')}`}
                              ariaLabel={t('Add')}
                              options={[
                                ...r.members.filter((m) => !as.some((a) => a.person_id === m.person_id)).map((m) => ({ value: String(m.person_id), label: m.name, hint: awaySet.has(m.person_id) ? t('away') : undefined, group: t('Qualified for') })),
                                ...(people?.rows ?? []).filter((p) => !qualified.has(p.id) && !as.some((a) => a.person_id === p.id)).map((p) => ({ value: String(p.id), label: nameOf(p), hint: awaySet.has(p.id) ? t('away') : undefined, group: t('All') })),
                              ]}
                              onChange={(v) => v && assign(r.id, Number(v))}
                            />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
        {!teams.length && <div className="empty">{t('Teams')}: —  <Link to="/volunteers">{t('Volunteers')} →</Link></div>}
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 8 }}>{t('Warnings')}</h3>
        {warnings && warnings.length === 0 && <div className="muted small">{t('No warnings.')}</div>}
        <div className="stack tight">
          {(warnings ?? []).map((w, i) => (
            <div key={i} className="small row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
              <Icon name="alert" width={14} height={14} style={{ color: w.type === 'unfilled' ? 'var(--ink-3)' : 'var(--warn)', flex: 'none', marginTop: 2 }} />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
        <hr />
        <div className="small muted">{lt({ en: 'Click a name to cycle scheduled → confirmed → declined.', zh: '点击姓名切换：已安排 → 已确认 → 已婉拒。' })}</div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dialogs

function DuplicateDialog({ svc, onClose }: { svc: ServiceFull; onClose: () => void }) {
  const { t } = useI18n();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const next = new Date(svc.date + 'T00:00:00');
  next.setDate(next.getDate() + 7);
  const [date, setDate] = useState(next.toISOString().slice(0, 10));
  const [roster, setRoster] = useState(false);
  return (
    <Modal title={t('Duplicate')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy} onClick={async () => {
          const s = await run(() => api.post<ServiceFull>(`/services/${svc.id}/duplicate`, { date, with_roster: roster }));
          if (s) {
            onClose();
            nav(`/services/${s.id}`);
          }
        }}>{t('Duplicate')}</button>
      </>
    }>
      <div className="stack">
        <Field label={t('Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <label className="check"><input type="checkbox" checked={roster} onChange={(e) => setRoster(e.target.checked)} />{t('Team & roster')}</label>
      </div>
    </Modal>
  );
}

function SaveTemplateDialog({ svc, onClose }: { svc: ServiceFull; onClose: () => void }) {
  const { t } = useI18n();
  const { run, busy } = useAction();
  const [name, setName] = useState<L10n>(svc.title);
  return (
    <Modal title={t('Save as template')} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" disabled={busy || !hasAnyText(name)} onClick={async () => {
          if (await run(() => api.post(`/services/${svc.id}/save-as-template`, { name }), t('Saved.'))) onClose();
        }}>{t('Save')}</button>
      </>
    }>
      <Field label={t('Name')}><L10nInput value={name} onChange={setName} /></Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ volunteer reminder e-mails (manual send only)

type ReminderRecipient = {
  person_id: number;
  name: string;
  has_email: boolean;
  preferred_lang: string | null;
  langs: Lang[];
  roles: { role_id: number; name: L10n; team: L10n; status: string }[];
  items: { id: number; title: L10n; start: string; end: string }[];
  subject: string;
  text: string;
  html: string;
  last_sent: { at: string; ok: boolean; error: string | null } | null;
};
type ReminderPreview = { smtp_configured: boolean; share_url: string | null; default_note: L10n; recipients: ReminderRecipient[] };
type ReminderResult = { sent: number; failed: number; skipped: number; results: { person_id: number; name: string; ok: boolean; skipped?: boolean; code?: string; error?: string }[] };

const sentAt = (s: string, lang: Lang) => {
  const d = new Date(/T/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(lang === 'zh' ? 'zh-CN' : lang === 'zh-Hant' ? 'zh-TW' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function ReminderDialog({ svc, onClose }: { svc: ServiceFull; onClose: () => void }) {
  const { t, lt, lang } = useI18n();
  const { isAdmin } = useSession();
  const [note, setNote] = useState('');
  const dNote = useDebounced(note.trim(), 400);
  const { data, error, loading, reload } = useApi<ReminderPreview>(`/services/${svc.id}/reminders/preview${dNote ? `?note=${encodeURIComponent(dNote)}` : ''}`);
  const [sel, setSel] = useState<Set<number> | null>(null);
  const [step, setStep] = useState<'pick' | 'confirm' | 'done'>('pick');
  const [result, setResult] = useState<ReminderResult | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [view, setView] = useState<'html' | 'text'>('html');

  const recips = data?.recipients ?? [];
  const withEmail = recips.filter((r) => r.has_email);
  const selected = sel ?? new Set(withEmail.map((r) => r.person_id));
  const chosen = withEmail.filter((r) => selected.has(r.person_id));
  const pool = chosen.length ? chosen : withEmail.length ? withEmail : recips;
  const combos = [...new Set(pool.map((r) => r.langs.join('+')))];
  const key = combos.includes(previewKey) ? previewKey : combos[0] ?? '';
  const sample = pool.find((r) => r.langs.join('+') === key);
  const comboLabel = (k: string) => k.split('+').map((l) => langInfo(l).native).join(' + ');
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSel(next);
  };

  const send = async () => {
    setSending(true);
    setSendError(null);
    try {
      const r = await api.post<ReminderResult>(`/services/${svc.id}/reminders`, { person_ids: chosen.map((x) => x.person_id), note: note.trim() || undefined });
      setResult(r);
      setStep('done');
      reload();
    } catch (e) {
      setSendError((e as Error).message);
      setStep('pick');
    } finally {
      setSending(false);
    }
  };

  const footer = step === 'done' ? (
    <button className="btn primary" onClick={onClose}>{t('Done')}</button>
  ) : step === 'confirm' ? (
    <>
      <button className="btn" onClick={() => setStep('pick')} disabled={sending}>{t('Back')}</button>
      <button className="btn primary" onClick={send} disabled={sending}><Icon name="mail" />{sending ? t('Sending…') : t('Send now')}</button>
    </>
  ) : (
    <>
      <button className="btn" onClick={onClose}>{t('Cancel')}</button>
      <button className="btn primary" disabled={!data?.smtp_configured || !chosen.length} onClick={() => setStep('confirm')}>
        <Icon name="mail" />{t('Send to')} {chosen.length}
      </button>
    </>
  );

  return (
    <Modal title={t('Send reminders')} onClose={sending ? () => {} : onClose} size="lg" footer={footer}>
      {error && <ErrorBox error={error} />}
      {!data && loading && <Loading />}
      {data && !data.smtp_configured && step !== 'done' && (
        <div className="callout warn" style={{ marginBottom: 12 }}>
          <strong>{t('E-mail is not set up yet.')}</strong>{' '}
          {isAdmin
            ? <>{t('Add the church’s SMTP server under')} <Link to="/settings" onClick={onClose}>{t('Settings')} → {t('E-mail')}</Link>.</>
            : t('Ask an administrator to add the SMTP server under Settings → E-mail.')}
        </div>
      )}
      {sendError && <div className="callout warn" style={{ marginBottom: 12 }}>{sendError}</div>}

      {step === 'done' && result && (
        <div className="stack">
          <div className={`callout ${result.failed ? 'warn' : 'lapis'}`}>
            {t('Sent')}: <strong>{result.sent}</strong> · {t('Failed')}: <strong>{result.failed}</strong> · {t('Not sent')}: <strong>{result.skipped}</strong>
          </div>
          <table className="t">
            <tbody>
              {result.results.map((r) => (
                <tr key={r.person_id}>
                  <td className="nowrap">{r.name}</td>
                  <td>
                    {r.ok ? <span className="badge ok">{t('Sent')}</span>
                      : r.skipped ? <span className="badge">{r.code === 'no_email' ? t('no e-mail') : t('Not sent')}</span>
                      : <span className="badge danger">{t('Failed')}</span>}
                    {!r.ok && r.error && r.code !== 'no_email' && <div className="small" style={{ color: 'var(--danger)' }}>{r.error}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {step === 'confirm' && (
        <div className="stack">
          <p>{t('Send reminder e-mails now to')} <strong>{chosen.length}</strong> {chosen.length === 1 ? t('person') : t('people')}?</p>
          <div className="small muted">{chosen.map((r) => r.name).join(', ')}</div>
          <div className="small muted">{t('E-mails cannot be recalled once sent.')}</div>
        </div>
      )}

      {step === 'pick' && data && (
        <div className="stack">
          {!recips.length ? (
            <div className="empty">{t('No one is scheduled for this service yet.')}</div>
          ) : (
            <div>
              <div className="row between" style={{ marginBottom: 4 }}>
                <strong>{t('Recipients')}</strong>
                <span className="row small">
                  <button className="btn ghost sm" onClick={() => setSel(new Set(withEmail.map((r) => r.person_id)))}>{t('All')}</button>
                  <button className="btn ghost sm" onClick={() => setSel(new Set())}>{t('None')}</button>
                </span>
              </div>
              <table className="t">
                <tbody>
                  {recips.map((r) => (
                    <tr key={r.person_id} style={r.has_email ? undefined : { opacity: 0.6 }}>
                      <td style={{ width: 28 }}>
                        <input type="checkbox" checked={r.has_email && selected.has(r.person_id)} disabled={!r.has_email} onChange={() => toggle(r.person_id)} aria-label={r.name} />
                      </td>
                      <td>
                        <div>
                          {r.name}{' '}
                          {r.langs.map((l) => <span key={l} className="badge" style={{ marginLeft: 2 }} title={langInfo(l).name}>{langInfo(l).short}</span>)}
                          {!r.has_email && (
                            <> <span className="badge warn">{t('no e-mail')}</span> <Link className="small" to={`/members?person=${r.person_id}`}>{t('Add address')} →</Link></>
                          )}
                        </div>
                        <div className="small muted">
                          {r.roles.map((x) => lt(x.name)).join(', ')}
                          {r.items.length > 0 && <> · {r.items.map((it) => `${it.start} ${lt(it.title)}`).join(', ')}</>}
                        </div>
                      </td>
                      <td className="nowrap small right">
                        {r.last_sent
                          ? r.last_sent.ok
                            ? <span className="muted" title={t('Last sent')}>✓ {sentAt(r.last_sent.at, lang)}</span>
                            : <span style={{ color: 'var(--danger)' }} title={r.last_sent.error ?? ''}>{t('Failed')} {sentAt(r.last_sent.at, lang)}</span>
                          : <span className="muted">{t('Not sent yet')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Field label={t('Note')} hint={t('Replaces the standard arrival note. Leave empty to keep it.')}>
            <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder={lt(data.default_note)} />
          </Field>
          {!data.share_url && <div className="small muted">{t('Tip: turn on the share link to include the order of service in the e-mail.')}</div>}

          {sample && (
            <div>
              <div className="row between" style={{ marginBottom: 6 }}>
                <strong>{t('Preview')}</strong>
                <span className="row">
                  {combos.length > 1 && <Seg<string> value={key} onChange={setPreviewKey} options={combos.map((k) => ({ value: k, label: comboLabel(k) }))} />}
                  <Seg<'html' | 'text'> value={view} onChange={setView} options={[{ value: 'html', label: t('Formatted') }, { value: 'text', label: t('Plain text') }]} />
                </span>
              </div>
              <div className="small muted" style={{ marginBottom: 4 }}>{t('To')}: {sample.name} · {t('Subject')}: <strong>{sample.subject}</strong></div>
              {view === 'html' ? (
                <iframe title={t('Preview')} sandbox="" srcDoc={sample.html} style={{ width: '100%', height: 380, border: '1px solid var(--rule)', borderRadius: 6, background: '#F3EEE2' }} />
              ) : (
                <pre className="serif" style={{ whiteSpace: 'pre-wrap', maxHeight: 380, overflow: 'auto', border: '1px solid var(--rule)', borderRadius: 6, padding: 12, margin: 0 }}>{sample.text}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
