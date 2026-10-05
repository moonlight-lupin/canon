// The service planner — the heart of Canon. The order of worship runs down a "measuring reed"
// with clock times; items are reordered by drag, filled from the library panel, and edited inline.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hasAnyText } from '../../shared/labels.ts';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, pointerWithin, useDroppable, useSensor,
  useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, useApi } from '../api.ts';
import { both, useI18n } from '../i18n.tsx';
import { Bi, Loading, ErrorBox, PageHead, Seg, confirmAction, fmtDate, useAction, useSession, useToast } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { partsLabel, postureLabel } from '../../shared/labels.ts';
import { partRuns } from '../../shared/parts.ts';
import ShareButton from '../outputs/ShareButton.tsx';
import { SeasonChip } from '../components/brand.tsx';
import type { L10n, LiturgyText, ServiceFull, ServiceItem, Song, TeamWithRoles } from '../types-client.ts';
import { ServiceBulletinTab } from './ServiceBulletinTab.tsx';
import { VisitorFormPanel } from './VisitorForm.tsx';
import { DetailsCard } from './service/DetailsCard.tsx';
import { ItemEditor } from './service/ItemEditor.tsx';
import { LibraryPanel, QuickAdd } from './service/LibraryPanel.tsx';
import { DuplicateDialog, SaveTemplateDialog } from './service/ServiceDialogs.tsx';
import { TeamTab } from './service/TeamTab.tsx';
import { ApprovalsButton } from './service/Approvals.tsx';
import { type Assignment, fmtMin, KIND_ICON, KIND_LABEL, toMin } from './service/common.ts';

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
  const [tab, setTab] = useState<'order' | 'team' | 'bulletin' | 'visitors'>('order');
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
  const onBulletinContent = useCallback((c: ServiceFull['bulletin_content'], revision?: number) => {
    if (revision != null) version.current = String(revision);
    setSvc((s) => (s ? { ...s, bulletin_content: c, ...(revision != null ? { revision } : {}) } : s));
  }, [setSvc]);

  // the revision of the service's details this page has; own saves move it on, so only someone else's change
  // conflicts (editing items, the team or the share link does not change it)
  const version = useRef<string | null>(null);
  useEffect(() => {
    if (svc?.revision != null && version.current == null) version.current = String(svc.revision);
  }, [svc?.revision]);
  const patchService = useCallback(async (patch: Partial<ServiceFull>, check = false) => {
    const r = await run(() => api.patch<ServiceFull>(`/services/${sid}`, patch, check ? version.current : null));
    if (r) {
      version.current = String(r.revision ?? '');
      setSvc((s) => (s ? { ...s, ...patch, updated_at: r.updated_at, revision: r.revision } : s));
    }
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
        {svc.kind === 'meeting'
          ? <Link to={`/meetings/${sid}`} className="btn ghost"><Icon name="chevronLeft" />{t('Meeting')}</Link>
          : <Link to="/services" className="btn ghost"><Icon name="chevronLeft" />{t('Services')}</Link>}
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
          <ApprovalsButton sid={sid} canEdit={canEdit} />
          {canEdit && <ShareButton serviceId={sid} shareToken={svc.share_token} onChange={(token) => setSvc({ ...svc, share_token: token })} />}
          {canEdit && (
            <>
              <button className="btn sm ghost" onClick={() => setDialog('duplicate')}><Icon name="copy" />{t('Duplicate')}</button>
              <button className="btn sm ghost" onClick={() => setDialog('template')}><Icon name="layout" />{t('Save as template')}</button>
              <button className="btn sm ghost danger" onClick={async () => {
                if (!confirmAction(t('Are you sure?'))) return;
                if (await run(() => api.del(`/services/${sid}`))) nav(svc.kind === 'meeting' ? '/meetings' : '/services');
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
        <button className={tab === 'visitors' ? 'on' : ''} onClick={() => setTab('visitors')}>{t('Visitor form')}</button>
        <div className="grow" />
        <button onClick={() => setShowDetails((s) => !s)}><Icon name="edit" style={{ width: 14, height: 14, verticalAlign: -2, marginRight: 4 }} />{t('Edit')}…</button>
      </div>

      {showDetails && <DetailsCard svc={svc} onSave={(p) => patchService(p, true)} canEdit={canEdit} />}

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
      ) : tab === 'visitors' ? (
        <VisitorFormPanel serviceId={svc.id} canEdit={canEdit} />
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
