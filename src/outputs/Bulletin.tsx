// The printed order of service. Content is laid out as a flow of small blocks, measured in a hidden
// container at the page width, paginated into fixed page boxes and — for booklets — imposed onto
// landscape sheets for duplex printing (fold in half to read).
//
// The bulletin template's page layout decides the shape: an ordered list of sections (cover or banner, the order
// as a list or a three-column table, full texts, the weekly announcements, a pastor's note, fixed texts, serving
// tables, QR codes …) with page breaks and a back-cover group that always lands on the last page.
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { ErrorBox, Loading, Seg } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import type { Lang, PaperSize, RenderedItem, RenderedService } from '../types-client.ts';
import { ApprovedBanner, useApproved } from './approved.tsx';
import { Bi, langOptions, langsFor, modeFor, type LangMode, type Layout } from './content.tsx';
import {
  DEFAULT_BULLETIN_OPTIONS, bulletinDecision, padBooklet, type BulletinBlock, type BulletinFull, type BulletinOptions,
  type BulletinTemplate,
} from '../../shared/presentation.ts';
import './outputs.css';
import './bulletin-layout.css';
import { buildBulletin, COVER_LABEL, COVER_STYLES, type CoverStyle, NotesPage } from './bulletin-build.tsx';
import type { ItemShow } from './bulletin-order.tsx';
import { type Block, FOOT_MM, impose, type PageSpec, paginate, PAPER_ORDER, PAPERS, type PaperSpec, PX_PER_MM } from './bulletin-paper.tsx';
import { withRights } from '../../shared/bible-rights.ts';

// ---------------------------------------------------------------- paper geometry (mm)

export default function Bulletin() {
  const { id } = useParams();
  const { t, lt } = useI18n();
  // an approved version (?approved=…) is drawn from the copy kept when it was approved
  const { approvedId, approval, error: apError } = useApproved(id);
  // printed: a Bible version whose licence doesn't allow printing gives the reference only
  const live = useApi<RenderedService>(approvedId ? null : `/services/${id}/render?for=print`);
  const liveTemplates = useApi<BulletinTemplate[]>(approvedId ? null : '/bulletin-templates');
  const liveBlocks = useApi<BulletinBlock[]>(approvedId ? null : '/bulletin-blocks');
  const r = approvedId ? (approval ? withRights(approval.snapshot.render, 'print') : undefined) : live.data;
  const error = apError ?? live.error;
  const templates = approvedId ? (approval ? (approval.snapshot.bulletin_template ? [approval.snapshot.bulletin_template] : []) : undefined) : liveTemplates.data;
  const blockList = approvedId ? approval?.snapshot.blocks : liveBlocks.data;

  // The bulletin template sets everything below (service → church default → "Full words booklet"). Another template
  // can be picked here for this printout, and each toolbar control is a one-off override on top of it.
  const [tplSel, setTplSel] = useState<number | null>(null);
  const [ov, setOv] = useState<Overrides>({});
  const [showSheets, setShowSheets] = useState(false);
  const picked = tplSel != null ? templates?.find((x) => x.id === tplSel) : undefined;
  const o: BulletinOptions = picked?.options ?? r?.bulletin.options ?? DEFAULT_BULLETIN_OPTIONS;
  const set = (p: Overrides) => setOv((x) => ({ ...x, ...p }));

  const paper: PaperSize = ov.paper ?? (PAPERS[o.paper] ? o.paper : 'a4-booklet');
  const spec = PAPERS[paper];
  const booklet = !!spec.sheet;
  const pt = ov.pt ?? o.font_pt ?? spec.font;
  const svcLangs = useMemo(() => r?.languages ?? ['en'], [r]);
  const mode: LangMode = ov.mode ?? (o.languages === 'primary' ? svcLangs[0] : modeFor(svcLangs));
  const langs = useMemo(() => langsFor(mode, svcLangs), [mode, svcLangs]);
  // Three languages side by side only fit on a full portrait page; on A5 they are stacked.
  const wide = paper === 'a4' || paper === 'letter';
  const canParallel = langs.length > 1 && (langs.length < 3 || wide);
  const layout: Layout = canParallel ? ov.layout ?? (langs.length > 2 ? 'stacked' : o.layout) : 'stacked';
  const cover: CoverStyle = ov.cover ?? (picked && picked.options.cover !== 'default' ? picked.options.cover : r?.cover.style ?? 'plain');
  const roster = ov.roster ?? true;
  const notes = ov.notes ?? true;
  // Per item: the item's own choice beats the template's rule for its kind (computed by the server for the
  // service's template; recomputed here when another template is picked).
  const decide = useMemo(
    () => (it: RenderedItem): BulletinFull => (picked ? bulletinDecision(it.kind, it.bulletin_text, picked.options) : it.bulletin_full ?? true),
    [picked],
  );
  const show = useMemo<ItemShow>(() => ({ leaders: o.show_leaders, times: o.show_times, posture: o.show_posture }), [o.show_leaders, o.show_times, o.show_posture]);
  const L = o.page_layout ?? [];
  const hasServing = L.some((s) => s.type === 'serving_this_week' || s.type === 'serving_next_week');
  const hasAnn = L.some((s) => s.type === 'announcements' || s.type === 'service_notes');

  if (error) return <div className="out-page"><ErrorBox error={error} /></div>;
  if (!r) return <Loading />;

  const currentTpl = tplSel ?? r.bulletin.template_id;
  return (
    <div className="out bl">
      {approval && <ApprovedBanner approval={approval} />}
      <div className="out-bar no-print">
        <Link to={`/services/${id}`} className="btn ghost sm"><Icon name="chevronLeft" />{t('Back')}</Link>
        <div className="out-bar-title"><Bi v={r.title} langs={langs} /> <span className="muted">· {t('Bulletin')}</span></div>
        <label className="out-ctl" title={t('Bulletin templates decide which items print their full words. Manage them in Planner → Bulletin templates.')}>
          <span>{t('Template')}</span>
          {templates?.length && currentTpl != null ? (
            <select value={currentTpl} onChange={(e) => { const v = Number(e.target.value); setTplSel(v === r.bulletin.template_id ? null : v); setOv({}); }}>
              {templates.filter((x) => !x.hidden || x.id === currentTpl || x.id === r.bulletin.template_id).map((x) => <option key={x.id} value={x.id}>{lt(x.name)}{x.id === r.bulletin.template_id ? ' ✓' : ''}</option>)}
            </select>
          ) : (
            <strong>{lt(r.bulletin.name)}</strong>
          )}
        </label>
        <label className="out-ctl">
          <span>{t('Paper')}</span>
          <select value={paper} onChange={(e) => set({ paper: e.target.value as PaperSize, pt: undefined })}>
            {PAPER_ORDER.map((p) => <option key={p} value={p}>{t(PAPERS[p].label)}</option>)}
          </select>
        </label>
        {r.languages.length > 1 && <Seg<LangMode> value={mode} onChange={(m) => set({ mode: m })} options={langOptions(r.languages, t)} />}
        {canParallel && (
          <Seg<Layout> value={layout} onChange={(v) => set({ layout: v })} options={[{ value: 'parallel', label: t('Side by side') }, { value: 'stacked', label: t('Stacked') }]} />
        )}
        <label className="out-ctl">
          <span>{t('Font size')} {pt}pt</span>
          <input type="range" min={7} max={16} step={0.5} value={pt} onChange={(e) => set({ pt: Number(e.target.value) })} />
        </label>
        <label className="out-ctl">
          <span>{t('Cover')}</span>
          <select value={cover} onChange={(e) => set({ cover: e.target.value as CoverStyle })} title={t('For this printout only')}>
            {COVER_STYLES.map((c) => <option key={c} value={c}>{t(COVER_LABEL[c])}{c === r.cover.style ? ' ✓' : ''}</option>)}
          </select>
        </label>
        {hasServing && <label className="check"><input type="checkbox" checked={roster} onChange={(e) => set({ roster: e.target.checked })} />{t('Roster')}</label>}
        {hasAnn && <label className="check"><input type="checkbox" checked={notes} onChange={(e) => set({ notes: e.target.checked })} />{t('Announcements')}</label>}
        {booklet && <label className="check"><input type="checkbox" checked={showSheets} onChange={(e) => setShowSheets(e.target.checked)} />{t('Show print sheets')}</label>}
        <button className="btn primary sm" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
      </div>
      <BulletinPages
        r={r}
        spec={spec}
        langs={langs}
        layout={layout}
        cover={cover}
        pt={pt}
        decide={decide}
        show={show}
        options={o}
        blocks={blockList ?? []}
        include={{ serving: roster, announcements: notes }}
        showSheets={booklet && showSheets}
      />
    </div>
  );
}

/** One-off toolbar changes on top of the bulletin template (undefined = follow the template). */
interface Overrides {
  paper?: PaperSize;
  pt?: number;
  mode?: LangMode;
  layout?: Layout;
  cover?: CoverStyle;
  roster?: boolean;
  notes?: boolean;
}

/** "5 pages — 3 blank pages will be added to make a folded booklet (8 pages)." */
export function paddingWarning(t: (s: string) => string, total: number, blanks: number): string {
  return t(blanks === 1
    ? '{content} pages — 1 blank page will be added to make a folded booklet ({total} pages).'
    : '{content} pages — {n} blank pages will be added to make a folded booklet ({total} pages).')
    .replace('{content}', String(total - blanks))
    .replace('{n}', String(blanks))
    .replace('{total}', String(total));
}

/**
 * The bulletin's pages. `variant` 'print' (the bulletin screen: page previews plus the print sheets) or 'sample'
 * (the template editor: pages only, drawn at `scale`).
 */
export function BulletinPages({
  r, spec, langs, layout, cover, pt, decide, show, options, blocks, include, showSheets = false, variant = 'print', scale = 1,
}: {
  r: RenderedService; spec: PaperSpec; langs: Lang[]; layout: Layout; cover: CoverStyle; pt: number;
  decide: (it: RenderedItem) => BulletinFull; show: ItemShow; options: BulletinOptions; blocks: BulletinBlock[];
  include?: { serving: boolean; announcements: boolean }; showSheets?: boolean; variant?: 'print' | 'sample'; scale?: number;
}) {
  const { t } = useI18n();
  const booklet = !!spec.sheet;
  const [pw, ph] = spec.page;
  const bodyW = pw - 2 * spec.margin;
  const capPx = (ph - 2 * spec.margin - FOOT_MM) * PX_PER_MM * 0.985;

  const [splitKeys, setSplitKeys] = useState<Set<string>>(() => new Set());
  const [fontTick, setFontTick] = useState(0);
  useEffect(() => {
    document.fonts?.ready.then(() => setFontTick((n) => n + 1)).catch(() => {});
  }, []);

  const { main, back, spareNotes } = useMemo(() => {
    const expand = (bs: Block[]): Block[] => bs.flatMap((b) => (splitKeys.has(b.key) && b.split ? expand(b.split()).map((x, i) => (i === 0 ? { ...x, breakBefore: b.breakBefore } : x)) : [b]));
    const built = buildBulletin({ r, langs, layout, decide, show, options, cover, blocks, include });
    return { main: expand(built.main), back: expand(built.back), spareNotes: built.spareNotes };
  }, [r, langs, layout, decide, show, options, cover, blocks, include?.serving, include?.announcements, splitKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => [...main, ...back], [main, back]);
  const byKey = useMemo(() => new Map(all.map((b) => [b.key, b])), [all]);

  const measureRef = useRef<HTMLDivElement>(null);
  const [plan, setPlan] = useState<{ pages: PageSpec[]; oversize: boolean; blanks: number } | null>(null);
  const hasSermon = spareNotes && r.items.some((i) => i.kind === 'sermon');

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const hs = Array.from(el.children).map((c) => (c as HTMLElement).getBoundingClientRect().height);
    const tooTall = all.filter((b, i) => hs[i] > capPx && b.split);
    if (tooTall.length) {
      setSplitKeys((s) => new Set([...s, ...tooTall.map((b) => b.key)]));
      return;
    }
    const oversize = hs.some((h, i) => h > capPx && !all[i].page);
    const keep = all.map((b) => !!b.keep);
    const brk = all.map((b) => !!b.breakBefore);
    const whole = all.map((b) => !!b.page);
    const nm = main.length;
    const toPages = (idx: number[][], offset: number): PageSpec[] => idx.map((p) => ({ kind: 'flow' as const, keys: p.map((i) => all[i + offset].key) }));
    const combined = toPages(paginate(hs, keep, capPx, brk, whole), 0);
    let pages = combined;
    let blanks = 0;
    if (booklet) {
      const mainPages = toPages(paginate(hs.slice(0, nm), keep.slice(0, nm), capPx, brk.slice(0, nm), whole.slice(0, nm)), 0);
      const backPages = back.length ? toPages(paginate(hs.slice(nm), keep.slice(nm), capPx, brk.slice(nm), whole.slice(nm)), nm) : [];
      // spare pages go before the back cover; the first one carries the sermon notes when the layout asks for it
      const padded = padBooklet<PageSpec>(mainPages, backPages, (i) => ({ kind: 'blank', notes: i === 0 && hasSermon }), { strict: !!back[0]?.breakBefore || !!back[0]?.page, combined });
      pages = padded.pages;
      blanks = padded.added - (padded.added > 0 && hasSermon ? 1 : 0);
    }
    setPlan({ pages, oversize, blanks });
  }, [all, main.length, back, capPx, booklet, hasSermon, fontTick, pt, bodyW]);

  // Season colour (when turned on) accents the cover rule and section headings; ink stays the text colour.
  const docStyle = {
    fontSize: `${pt}pt`,
    ...(r.season.color ? { '--bl-accent': r.season.color, '--bl-accent-text': r.season.color } : {}),
  } as CSSProperties;
  const renderPage = (n: number, key: string) => {
    const p = plan!.pages[n - 1];
    const blocksOn = p.kind === 'flow' ? p.keys.map((k) => byKey.get(k)).filter((b): b is Block => !!b) : [];
    const coverPage = blocksOn.length === 1 && blocksOn[0].page === 'cover';
    const numbered = !coverPage && !blocksOn.some((b) => b.nonum);
    return (
      <div key={key} className={`bl-page${coverPage ? ' cover' : ''}`} style={{ width: `${pw}mm`, height: `${ph}mm`, padding: `${spec.margin}mm ${spec.margin}mm 0` }}>
        <div className="bl-body" style={{ height: `${ph - 2 * spec.margin - FOOT_MM}mm` }}>
          {p.kind === 'blank' && p.notes && <NotesPage langs={langs} />}
          {blocksOn.map((b) => <div key={b.key} className={b.page ? 'bb bb-page' : 'bb'}>{b.node}</div>)}
        </div>
        <div className="bl-foot" style={{ height: `${FOOT_MM + spec.margin}mm` }}>{numbered && n}</div>
      </div>
    );
  };

  const sheets = plan && booklet ? impose(plan.pages.length) : [];
  const [sw, sh] = spec.sheet ?? spec.page;
  const printCss = `
@page { size: ${spec.css}; margin: 0; }
@media print {
  html, body, #root { height: auto !important; background: #fff !important; }
  body { margin: 0; }
  .bl-print { display: block !important; }
  .bl-screen, .out-bar { display: none !important; }
}`;
  const info = plan && (
    <div className="bl-info">
      {booklet && plan.blanks > 0 ? (
        <span className="badge warn bl-padwarn">{paddingWarning(t, plan.pages.length, plan.blanks)}</span>
      ) : (
        <>{plan.pages.length} {t('pages')}</>
      )}
      {booklet && variant === 'print' && <> · {plan.pages.length / 4} {t(plan.pages.length === 4 ? 'sheet' : 'sheets')} · {t('Print double-sided, flip on short edge, then fold.')}</>}
      {plan.oversize && <span className="badge warn" style={{ marginLeft: 8 }}>{t('Some content is taller than a page — reduce the font size.')}</span>}
    </div>
  );

  const measure = (
    // hidden measuring column at the page body width (whole-page blocks are measured as nothing)
    <div ref={measureRef} className="bl-doc bl-measure" style={{ ...docStyle, width: `${bodyW}mm` }} aria-hidden="true">
      {all.map((b) => <div key={b.key} className="bb">{b.page ? null : b.node}</div>)}
    </div>
  );

  if (variant === 'sample') {
    return (
      <div className="bl-sample">
        {measure}
        {!plan ? <Loading /> : (
          <>
            {info}
            <div className="bl-doc bl-sample-pages" style={{ ...docStyle, zoom: scale } as CSSProperties}>
              {plan.pages.map((_, i) => renderPage(i + 1, `p${i + 1}`))}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      <style>{printCss}</style>
      {measure}
      {!plan ? (
        <Loading />
      ) : (
        <>
          <div className="bl-screen no-print">
            {info}
            <div className="bl-doc bl-preview" style={docStyle}>
              {showSheets
                ? sheets.map((s, i) => (
                    <div key={i} className="bl-sheet-wrap">
                      <div className="bl-sheet-label">
                        {t('Sheet')} {Math.floor(i / 2) + 1} · {t(s.side === 'front' ? 'front' : 'back')} · {s.pages.join(' | ')}
                      </div>
                      <div className="bl-sheet" style={{ width: `${sw}mm`, height: `${sh}mm` }}>
                        {s.pages.map((n) => renderPage(n, `p${n}`))}
                      </div>
                    </div>
                  ))
                : plan.pages.map((_, i) => renderPage(i + 1, `p${i + 1}`))}
            </div>
          </div>
          <div className="bl-doc bl-print" style={docStyle}>
            {booklet
              ? sheets.map((s, i) => (
                  <div key={i} className="bl-sheet" style={{ width: `${sw}mm`, height: `${sh}mm` }}>
                    {s.pages.map((n) => renderPage(n, `p${n}`))}
                  </div>
                ))
              : plan.pages.map((_, i) => (
                  <Fragment key={i}>
                    <div className="bl-sheet" style={{ width: `${pw}mm`, height: `${ph}mm` }}>{renderPage(i + 1, 'p')}</div>
                  </Fragment>
                ))}
          </div>
        </>
      )}
    </>
  );
}
