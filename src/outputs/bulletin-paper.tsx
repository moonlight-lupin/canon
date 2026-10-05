// Bulletin: paper sizes, and laying blocks out into pages (and booklet imposition).
import type { ReactNode } from 'react';
import type { PaperSize } from '../types-client.ts';
import type { Piece } from './content.tsx';
import './outputs.css';
import './bulletin-layout.css';

export const IN = 25.4;

export const PX_PER_MM = 96 / 25.4;

export const FOOT_MM = 7;

export interface PaperSpec {
  page: [number, number];
  margin: number;
  /** landscape sheet that two pages are imposed on (booklets only) */
  sheet?: [number, number];
  css: string;
  font: number;
  label: string;
}

export const PAPERS: Record<PaperSize, PaperSpec> = {
  'a4-booklet': { page: [148.5, 210], margin: 12, sheet: [297, 210], css: 'A4 landscape', font: 9.5, label: 'A4 landscape, folded (A5 booklet)' },
  a4: { page: [210, 297], margin: 18, css: 'A4 portrait', font: 11, label: 'A4 portrait' },
  a5: { page: [148, 210], margin: 12, css: 'A5 portrait', font: 9.5, label: 'A5 single pages' },
  'letter-booklet': { page: [5.5 * IN, 8.5 * IN], margin: 0.5 * IN, sheet: [11 * IN, 8.5 * IN], css: 'letter landscape', font: 9.5, label: 'US Letter, folded (booklet)' },
  letter: { page: [8.5 * IN, 11 * IN], margin: 0.75 * IN, css: 'letter portrait', font: 11, label: 'US Letter portrait' },
};

export const PAPER_ORDER: PaperSize[] = ['a4-booklet', 'a4', 'a5', 'letter-booklet', 'letter'];

// ---------------------------------------------------------------- blocks

export interface Block {
  key: string;
  node: ReactNode;
  /** keep with the following block (headings, a section kept together) */
  keep?: boolean;
  /** start a new page with this block (a page break, or a section that starts a new page) */
  breakBefore?: boolean;
  split?: () => Block[];
  /** a whole page on its own: the cover page or a ruled sermon-notes page */
  page?: 'cover' | 'notes';
  /** the page holding this block has no page number (the banner on page 1) */
  nonum?: boolean;
}

export type PageSpec =
  | { kind: 'flow'; keys: string[] }
  | { kind: 'blank'; notes: boolean };

/** Sheets for saddle-stitch imposition: front = [N-2k, 2k+1], back = [2k+2, N-2k-1] (1-based). */
export function impose(n: number): { side: 'front' | 'back'; pages: [number, number] }[] {
  const out: { side: 'front' | 'back'; pages: [number, number] }[] = [];
  for (let k = 0; k < n / 4; k++) {
    out.push({ side: 'front', pages: [n - 2 * k, 2 * k + 1] });
    out.push({ side: 'back', pages: [2 * k + 2, n - 2 * k - 1] });
  }
  return out;
}

/** Greedy pagination with keep-with-next chains, forced page breaks and whole-page blocks. Returns groups of block indices. */
export function paginate(heights: number[], keep: boolean[], cap: number, brk: boolean[] = [], whole: boolean[] = []): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  for (let i = 0; i < heights.length; i++) {
    if (whole[i]) {
      if (cur.length) pages.push(cur);
      pages.push([i]);
      cur = [];
      used = 0;
      continue;
    }
    let need = heights[i];
    for (let j = i; keep[j] && j + 1 < heights.length && !whole[j + 1] && !brk[j + 1]; j++) need += heights[j + 1];
    if (need > cap) need = heights[i];
    if (cur.length && (brk[i] || used + need > cap)) {
      pages.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(i);
    used += heights[i];
  }
  if (cur.length) pages.push(cur);
  return pages;
}

export function pieceBlock(p: Piece, prefix: string): Block {
  return {
    key: prefix + p.key,
    node: <div className="ic">{p.node}</div>,
    split: p.split ? () => p.split!().map((q) => pieceBlock(q, prefix)) : undefined,
  };
}
