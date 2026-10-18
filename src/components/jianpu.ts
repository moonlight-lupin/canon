// Numbered notation (jianpu, 0.21.0): a song's melody typed in jpFun's notation (https://github.com/madderscientist/jpFun),
// drawn in the browser. This is the only file that imports jpFun (it is still 0.x: an API change touches only this),
// and it loads on first use, so pages without a melody don't download it.

type JpFun = typeof import('jpfun');
let engine: Promise<JpFun> | null = null;
export const loadJianpu = () => (engine ??= import('jpfun'));

export interface JianpuProblem { message: string; line: number; column: number; error: boolean }
export interface JianpuResult { pages: SVGSVGElement[]; problems: JianpuProblem[] }

let measurer: InstanceType<JpFun['CanvasTextMeasurer']> | null = null;

/** Draw a melody: one SVG per page (empty when it can't be drawn), and what jpFun found wrong, by line and column. */
export async function renderJianpu(source: string): Promise<JianpuResult> {
  const jp = await loadJianpu();
  // measured with the browser's own fonts, so lyrics and notes are spaced as they are drawn
  if (!measurer) {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) measurer = new jp.CanvasTextMeasurer(ctx);
  }
  const lineStarts = [0, ...[...source.matchAll(/\n/g)].map((m) => m.index! + 1)];
  const problem = (d: { message: string; span: { start: number } }, error: boolean): JianpuProblem => {
    const at = jp.Diagnostic.offsetToLineCol(d.span?.start ?? 0, lineStarts);
    return { message: d.message, line: at.line, column: at.column, error };
  };
  try {
    const r = jp.compileScore(source, measurer ? { textMeasurer: measurer } : {});
    const problems = [...r.diagnostics, ...r.layout.diagnostics].map((d) => problem(d, d instanceof jp.ErrorDiagnostic));
    return { pages: jp.renderLayoutPagesToSvg(r.layout, { background: '#fff' }).map(cleanSvg).filter((x): x is SVGSVGElement => !!x), problems };
  } catch (e) {
    // jpFun stops at the first error it can't get past, and throws it
    const d = e as { message?: string; span?: { start: number } };
    return { pages: [], problems: [problem({ message: d.message ?? String(e), span: d.span ?? { start: 0 } }, true)] };
  }
}

// What a drawn melody may contain. jpFun escapes the text it writes; this keeps anything else out all the same.
const TAGS = new Set(['svg', 'g', 'path', 'line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon', 'text', 'tspan', 'title', 'defs']);

/** Parse jpFun's SVG and keep only drawing: no scripts, event handlers, links or embedded documents. */
function cleanSvg(svg: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      if (!TAGS.has(child.localName)) child.remove();
      else walk(child);
    }
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || /href$/i.test(a.name) || /url\s*\(|javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  };
  walk(root);
  // scales to the width it is given (jpFun draws an A4-wide page)
  root.removeAttribute('width');
  root.removeAttribute('height');
  return document.importNode(root, true) as unknown as SVGSVGElement;
}
