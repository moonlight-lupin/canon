// A claim's receipts in one viewer (0.19.6): thumbnails of every file, each labelled with the claim line it belongs
// to (or none: e.g. the signed paper form), and the chosen one shown inside a bounded frame — fitted to it, or at its
// actual size scrolled within it — with previous / next and a link to open it on its own. A large photo never spills
// out of the dialog. Used by Book-keeping → Claims and by the claim page approvers and claimants open on a phone.
// PDFs are opened in a new tab (they are served sandboxed, which a browser's PDF viewer won't show inline).
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n.tsx';
import { Icon } from './icons.tsx';
import type { ClaimFile } from '../../shared/bookkeeping.ts';

export function ReceiptViewer({ files, lines, load }: {
  files: ClaimFile[];
  /** the claim's lines, in order (a file's line_id points at one) */
  lines: { id?: number; description: string }[];
  /** the file's address: a plain URL, or a blob URL fetched with a token (revoked when the viewer goes) */
  load: (f: ClaimFile) => Promise<string>;
}) {
  const { t } = useI18n();
  // receipts in the order of their lines, then those on no line
  const lineNo = new Map(lines.map((l, i) => [l.id, i + 1]));
  const ordered = [...files].sort((a, b) => (lineNo.get(a.line_id ?? undefined) ?? 999) - (lineNo.get(b.line_id ?? undefined) ?? 999) || a.id - b.id);
  const [at, setAt] = useState(0);
  const [actual, setActual] = useState(false);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const made = useRef<string[]>([]);

  useEffect(() => {
    let live = true;
    for (const f of ordered) {
      if (urls[f.id]) continue;
      load(f).then((u) => {
        if (u.startsWith('blob:')) made.current.push(u);
        if (live) setUrls((m) => ({ ...m, [f.id]: u }));
      }).catch(() => undefined);
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.map((f) => f.id).join(',')]);
  useEffect(() => () => { for (const u of made.current) URL.revokeObjectURL(u); }, []);

  if (!ordered.length) return <p className="small muted">{t('No receipts attached.')}</p>;
  const i = Math.min(at, ordered.length - 1);
  const f = ordered[i];
  const url = urls[f.id];
  const pdf = f.mime === 'application/pdf';
  const label = (x: ClaimFile) => {
    const n = lineNo.get(x.line_id ?? undefined);
    return n ? `${t('Line {n}').replace('{n}', String(n))} · ${lines[n - 1].description}` : t('Not on a line (e.g. the signed form)');
  };
  const go = (d: number) => {
    setAt((i + d + ordered.length) % ordered.length);
    setActual(false);
  };

  return (
    <div className="rv">
      <div className="rv-bar">
        {ordered.length > 1 && <button className="btn ghost sm icon" onClick={() => go(-1)} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>}
        <span className="small"><strong>{t('Receipt {n} of {total}').replace('{n}', String(i + 1)).replace('{total}', String(ordered.length))}</strong> · {label(f)}</span>
        {ordered.length > 1 && <button className="btn ghost sm icon" onClick={() => go(1)} aria-label={t('Next')}><Icon name="chevronRight" /></button>}
        <div className="grow" />
        {!pdf && <button className="btn ghost sm" onClick={() => setActual((v) => !v)}>{actual ? t('Fit') : t('Actual size')}</button>}
        {url && <a className="btn ghost sm" href={url} target="_blank" rel="noreferrer">{t('Open in a new tab')}</a>}
      </div>
      <div className={`rv-stage${actual ? ' actual' : ''}`}>
        {pdf
          ? <a className="claim-pdf" href={url ?? '#'} target="_blank" rel="noreferrer"><Icon name="file" />{t('Open the PDF')}: {f.name}</a>
          : url ? <img src={url} alt={f.name} onClick={() => setActual((v) => !v)} /> : <span className="muted small">…</span>}
      </div>
      {ordered.length > 1 && (
        <div className="rv-thumbs" role="tablist">
          {ordered.map((x, j) => (
            <button key={x.id} role="tab" aria-selected={j === i} className={`rv-thumb${j === i ? ' on' : ''}`} title={`${label(x)} — ${x.name}`} onClick={() => { setAt(j); setActual(false); }}>
              {x.mime === 'application/pdf' || !urls[x.id] ? <Icon name="file" /> : <img src={urls[x.id]} alt="" />}
              <span>{lineNo.get(x.line_id ?? undefined) ?? '·'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
