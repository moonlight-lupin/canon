// A small, safe Markdown renderer for the in-app Guide.
//
// Supports what the guide uses: headings, paragraphs, ordered / unordered lists (one nested level), **bold**,
// *italic*, `code`, [links](/path), blockquotes (tips), simple pipe tables, horizontal rules, fenced code and flow charts
// (a fenced block marked `flow`, below).
// Everything is rendered as React elements from plain strings — React escapes all text, raw HTML in the source is
// shown as text (never interpreted) and nothing uses dangerouslySetInnerHTML. Link targets are limited to app paths,
// in-page anchors, http(s) and mailto; anything else (e.g. javascript:) is rendered as plain text.
//
// Plain .ts with createElement (no JSX) so node:test can run it directly.
import { createElement as h, Fragment, type ReactNode } from 'react';

// ---------------------------------------------------------------- block model

export type Block =
  | { type: 'heading'; level: number; text: string; id: string }
  | { type: 'para'; text: string }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'table'; head: string[]; rows: string[][] }
  | { type: 'code'; text: string }
  | { type: 'flow'; steps: FlowStep[] }
  | { type: 'hr' };

/**
 * A flow chart (0.19.6): a fenced block marked `flow`, one step per line, top to bottom with arrows between.
 *   [Who] What happens                              a step; "[Who]" (optional) names who does it
 *   [Approver] Approves | Sends it back | Rejects   boxes side by side: the ways it can go
 * Inline markup works in the text. Read as plain text (AI assistants reading the guide), it is still the steps in order.
 */
export interface FlowStep { boxes: { who: string | null; text: string }[] }

const parseFlow = (body: string[]): FlowStep[] => body.filter((l) => l.trim()).map((l) => ({
  boxes: l.split(/\s+\|\s+/).map((part) => {
    const m = /^\s*\[([^\]]{1,40})\]\s*(.*)$/.exec(part);
    return m ? { who: m[1].trim(), text: m[2].trim() } : { who: null, text: part.trim() };
  }),
}));

export interface ListItem {
  text: string;
  children?: Block[];
}

/** A heading with the blocks that follow it, up to the next heading of level ≤ 3. */
export interface Section {
  heading: Extract<Block, { type: 'heading' }> | null;
  /** the h2 this section belongs to (for an h3), for context in search results */
  parent: string | null;
  blocks: Block[];
  /** lower-cased plain text of the heading and body, for search */
  haystack: string;
}

/** A URL-fragment id for a heading: letters (any script) and digits joined by '-'. */
export function slugify(text: string): string {
  const s = stripInline(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'section';
}

/** Inline markup removed: "**Save** the `file`" → "Save the file". */
export function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1');
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const isBlank = (l: string) => !l.trim();
const isComment = (l: string) => /^\s*<!--.*-->\s*$/.test(l);
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const splitRow = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

export function parse(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const ids = new Map<string, number>();
  const uniqueId = (text: string) => {
    const base = slugify(text);
    const n = ids.get(base) ?? 0;
    ids.set(base, n + 1);
    return n ? `${base}-${n + 1}` : base;
  };
  return parseLines(lines, uniqueId);
}

function parseLines(lines: string[], uniqueId: (t: string) => string): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line) || isComment(line)) {
      i++;
      continue;
    }
    // fenced code
    if (/^\s*```/.test(line)) {
      const info = /^\s*```\s*(\w*)/.exec(line)![1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(info === 'flow' ? { type: 'flow', steps: parseFlow(body) } : { type: 'code', text: body.join('\n') });
      continue;
    }
    const hm = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (hm) {
      // an explicit anchor "## Slide templates {#slide-templates}" keeps in-app help links working in every language
      const anchor = /^(.*?)\s*\{#([a-z0-9-]+)\}$/.exec(hm[2]);
      const text = anchor ? anchor[1] : hm[2];
      out.push({ type: 'heading', level: hm[1].length, text, id: anchor ? uniqueId(anchor[2]) : uniqueId(text) });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ type: 'hr' });
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push({ type: 'quote', blocks: parseLines(inner, uniqueId) });
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]));
      out.push({ type: 'table', head, rows });
      continue;
    }
    const lm = LIST_RE.exec(line);
    if (lm) {
      i = parseList(lines, i, out, uniqueId);
      continue;
    }
    // paragraph: until a blank line or the start of another block
    const para: string[] = [];
    while (
      i < lines.length && !isBlank(lines[i]) && !isComment(lines[i]) && !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) && !/^\s*```/.test(lines[i]) && !LIST_RE.test(lines[i]) && !isTableRow(lines[i])
    ) para.push(lines[i++].trim());
    out.push({ type: 'para', text: para.join(' ') });
  }
  return out;
}

/** Parse a list starting at line i; returns the index after it. Indented lines belong to the current item. */
function parseList(lines: string[], i: number, out: Block[], uniqueId: (t: string) => string): number {
  const first = LIST_RE.exec(lines[i])!;
  const indent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const list: Extract<Block, { type: 'list' }> = { type: 'list', ordered, start: ordered ? Number.parseInt(first[2], 10) : 1, items: [] };
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (!m || m[1].length !== indent || /\d/.test(m[2]) !== ordered) break;
    const text = [m[3].trim()];
    const nested: string[] = [];
    i++;
    // continuation lines (more indented) and nested lists
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) {
        // a blank line ends the item unless the next line is still indented under it
        const next = lines[i + 1];
        if (next !== undefined && /^\s+/.test(next) && (next.length - next.trimStart().length) > indent) {
          i++;
          continue;
        }
        break;
      }
      const lead = l.length - l.trimStart().length;
      if (lead <= indent) break;
      if (LIST_RE.test(l) || nested.length) nested.push(l.slice(Math.min(lead, indent + 2)));
      else text.push(l.trim());
      i++;
    }
    list.items.push({ text: text.join(' '), children: nested.length ? parseLines(nested, uniqueId) : undefined });
    // allow one blank line between items of the same list
    if (i < lines.length && isBlank(lines[i])) {
      const next = lines[i + 1];
      const nm = next !== undefined ? LIST_RE.exec(next) : null;
      if (nm && nm[1].length === indent && /\d/.test(nm[2]) === ordered) i++;
    }
  }
  out.push(list);
  return i;
}

// ---------------------------------------------------------------- sections (table of contents, search)

function blockText(b: Block): string {
  switch (b.type) {
    case 'heading':
    case 'para':
    case 'code':
      return stripInline(b.text);
    case 'list':
      return b.items.map((it) => [stripInline(it.text), ...(it.children ?? []).map(blockText)].join(' ')).join(' ');
    case 'quote':
      return b.blocks.map(blockText).join(' ');
    case 'table':
      return [b.head, ...b.rows].map((r) => r.map(stripInline).join(' ')).join(' ');
    case 'flow':
      return b.steps.map((st) => st.boxes.map((x) => [x.who, stripInline(x.text)].filter(Boolean).join(' ')).join(' ')).join(' ');
    case 'hr':
      return '';
  }
}

/** Split blocks into sections at h2 / h3 headings. Content before the first such heading is a section without one. */
export function sections(blocks: Block[]): Section[] {
  const out: Section[] = [];
  let cur: Section = { heading: null, parent: null, blocks: [], haystack: '' };
  let h2: string | null = null;
  for (const b of blocks) {
    if (b.type === 'heading' && (b.level === 2 || b.level === 3)) {
      if (cur.heading || cur.blocks.length) out.push(cur);
      if (b.level === 2) h2 = b.text;
      cur = { heading: b, parent: b.level === 3 ? h2 : null, blocks: [], haystack: '' };
    } else {
      cur.blocks.push(b);
    }
  }
  if (cur.heading || cur.blocks.length) out.push(cur);
  for (const s of out) s.haystack = [s.heading ? stripInline(s.heading.text) : '', ...s.blocks.map(blockText)].join(' ').toLowerCase();
  return out;
}

// ---------------------------------------------------------------- inline

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong' | 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] };

/** Only app paths, in-page anchors, http(s) and mailto are allowed as link targets. */
export function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)/.test(h) || h.startsWith('#')) return h;
  if (/^(https?:|mailto:)/i.test(h)) return h;
  return null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length && /[\\`*_[\]()#>|-]/.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i) {
        flush();
        out.push({ type: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if ((c === '*' || c === '_') && src[i + 1] === c) {
      const end = src.indexOf(c + c, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: 'strong', children: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (c === '*' || (c === '_' && !/\w/.test(src[i - 1] ?? ''))) {
      const end = src.indexOf(c, i + 1);
      if (end > i + 1 && src[i + 1] !== ' ' && (c === '*' || !/\w/.test(src[end + 1] ?? ''))) {
        flush();
        out.push({ type: 'em', children: parseInline(src.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m) {
        flush();
        const href = safeHref(m[2]);
        if (href) out.push({ type: 'link', href, children: parseInline(m[1]) });
        else out.push(...parseInline(m[1]));
        i += m[0].length;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------- React rendering

export interface RenderOptions {
  /** render an app-internal link (e.g. a react-router <Link>); default: a plain <a> */
  internalLink?: (href: string, children: ReactNode, key: string) => ReactNode;
  /** called for in-page '#anchor' links; default: a plain <a href="#…"> */
  anchorLink?: (id: string, children: ReactNode, key: string) => ReactNode;
  /** highlight occurrences of this text (search) */
  highlight?: string;
}

function highlightText(text: string, q: string | undefined, key: string): ReactNode {
  if (!q) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(q, from);
  if (at < 0) return text;
  let n = 0;
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(h('mark', { key: `${key}m${n++}` }, text.slice(at, at + q.length)));
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return h(Fragment, { key }, ...parts);
}

export function renderInline(nodes: Inline[], opts: RenderOptions = {}, key = 'i'): ReactNode[] {
  const q = opts.highlight?.trim().toLowerCase() || undefined;
  return nodes.map((n, idx) => {
    const k = `${key}.${idx}`;
    switch (n.type) {
      case 'text':
        return highlightText(n.text, q, k);
      case 'code':
        return h('code', { key: k }, n.text);
      case 'strong':
        return h('strong', { key: k }, ...renderInline(n.children, opts, k));
      case 'em':
        return h('em', { key: k }, ...renderInline(n.children, opts, k));
      case 'link': {
        const children = h(Fragment, null, ...renderInline(n.children, opts, k));
        if (n.href.startsWith('#')) return opts.anchorLink ? opts.anchorLink(n.href.slice(1), children, k) : h('a', { key: k, href: n.href }, children);
        if (n.href.startsWith('/')) return opts.internalLink ? opts.internalLink(n.href, children, k) : h('a', { key: k, href: n.href }, children);
        return h('a', { key: k, href: n.href, target: '_blank', rel: 'noreferrer noopener' }, children);
      }
    }
  });
}

const inline = (text: string, opts: RenderOptions, key: string) => renderInline(parseInline(text), opts, key);

export function renderBlocks(blocks: Block[], opts: RenderOptions = {}, key = 'b'): ReactNode[] {
  return blocks.map((b, idx) => {
    const k = `${key}.${idx}`;
    switch (b.type) {
      case 'heading':
        return h(`h${Math.min(6, Math.max(1, b.level))}`, { key: k, id: b.id }, ...inline(b.text, opts, k));
      case 'para':
        return h('p', { key: k }, ...inline(b.text, opts, k));
      case 'list':
        return h(
          b.ordered ? 'ol' : 'ul',
          { key: k, start: b.ordered && b.start !== 1 ? b.start : undefined },
          ...b.items.map((it, j) =>
            h('li', { key: `${k}.${j}` }, ...inline(it.text, opts, `${k}.${j}`), ...(it.children ? renderBlocks(it.children, opts, `${k}.${j}c`) : [])),
          ),
        );
      case 'quote':
        return h('blockquote', { key: k }, ...renderBlocks(b.blocks, opts, k));
      case 'table':
        return h(
          'div',
          { key: k, className: 'table-wrap' },
          h(
            'table',
            { className: 't' },
            h('thead', null, h('tr', null, ...b.head.map((c, j) => h('th', { key: j }, ...inline(c, opts, `${k}h${j}`))))),
            h('tbody', null, ...b.rows.map((r, j) => h('tr', { key: j }, ...r.map((c, x) => h('td', { key: x }, ...inline(c, opts, `${k}r${j}.${x}`)))))),
          ),
        );
      case 'code':
        return h('pre', { key: k }, h('code', null, b.text));
      case 'flow':
        return h(
          'div',
          { key: k, className: 'flow', role: 'list' },
          ...b.steps.flatMap((st, j) => [
            ...(j ? [h('div', { key: `${k}a${j}`, className: 'flow-arrow', 'aria-hidden': true }, '↓')] : []),
            h(
              'div',
              { key: `${k}s${j}`, className: st.boxes.length > 1 ? 'flow-step flow-branch' : 'flow-step', role: 'listitem' },
              ...st.boxes.map((x, n) => h(
                'div',
                { key: n, className: 'flow-box' },
                ...(x.who ? [h('span', { key: 'w', className: 'flow-who' }, x.who)] : []),
                h('span', { key: 't' }, ...inline(x.text, opts, `${k}s${j}.${n}`)),
              )),
            ),
          ]),
        );
      case 'hr':
        return h('hr', { key: k });
    }
  });
}

/** Convenience: Markdown source → React nodes. */
export function renderMarkdown(src: string, opts: RenderOptions = {}): ReactNode[] {
  return renderBlocks(parse(src), opts);
}
