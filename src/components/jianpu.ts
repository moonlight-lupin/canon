// Numbered notation (jianpu, 0.21.0): a song's melody typed in jpFun's notation (https://github.com/madderscientist/jpFun),
// drawn in the browser. jpFun runs in a worker (jianpu-worker.ts) with a time limit: a melody that takes too long is
// stopped, and the page stays usable. The worker loads on first use, so pages without a melody don't download jpFun.
// What happens around jpFun (Chinese-keyboard punctuation, limits, new lines, words left over) is shared/jianpu-prep.ts.
import type { MelodyProblem, MelodyResult } from '../../shared/jianpu-prep.ts';

export type JianpuProblem = MelodyProblem;
export interface JianpuResult { pages: SVGSVGElement[]; problems: JianpuProblem[]; changed: string[]; autoBreaks: number }

/** How long one melody may take to draw. */
export const DRAW_TIME_LIMIT_MS = 6000;

let worker: Worker | null = null;
let seq = 0;
// one melody at a time: its time limit starts when the worker takes it
let queue: Promise<unknown> = Promise.resolve();

const newWorker = () => new Worker(new URL('./jianpu-worker.ts', import.meta.url), { type: 'module' });

function draw(source: string): Promise<MelodyResult> {
  const id = ++seq;
  return new Promise((resolve) => {
    const w = (worker ??= newWorker());
    const done = (r: MelodyResult) => {
      clearTimeout(timer);
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      resolve(r);
    };
    const failed = (code: string, message = ''): MelodyResult => ({ svgs: [], problems: [{ code, error: true, line: 1, column: 1, message }], changed: [], autoBreaks: 0, lineCount: 0 });
    const onMessage = (e: MessageEvent<{ id: number; result: MelodyResult }>) => { if (e.data.id === id) done(e.data.result); };
    const onError = (e: ErrorEvent) => { worker = null; w.terminate(); done(failed('E_BUG', e.message)); };
    // too long (or out of memory): end this worker; the next melody gets a new one
    const timer = setTimeout(() => { worker = null; w.terminate(); done(failed('C_TOO_SLOW')); }, DRAW_TIME_LIMIT_MS);
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, source });
  });
}

/** Draw a melody: one SVG per page (none when it can't be drawn), and its problems by line and column. */
export function renderJianpu(source: string): Promise<JianpuResult> {
  const next = queue.then(() => draw(source));
  queue = next.catch(() => undefined);
  return next.then((r) => ({
    pages: r.svgs.map(cleanSvg).filter((x): x is SVGSVGElement => !!x),
    problems: r.problems,
    changed: r.changed,
    autoBreaks: r.autoBreaks,
  }));
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
