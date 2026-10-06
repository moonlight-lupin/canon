// Library → Upload sheet music (0.15.5): which hymn and page a scan is, from its file name — "HP 178.jpg",
// "HP178-2.png", "hp_178 p2.pdf", "178 (3).jpg", "HP 178 The Church's One Foundation.jpg". The hymnal abbreviation
// is optional (then the church's first hymnal that has the number); the page is 1 unless the name says otherwise.

export interface ScoreName { abbr: string | null; number: string; page: number }

export function parseScoreName(file: string): ScoreName | null {
  const base = file.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
  const m = base.match(/^([A-Za-z]{1,8})?[\s_#.-]*0*(\d{1,4})(?![\d])(.*)$/);
  if (!m) return null;
  const rest = m[3] ?? '';
  // a page number straight after the hymn number: "-2", "_2", " p2", " page 2", " (2)", ".2"
  const p = rest.match(/^\s*(?:[-_.(]|\s)\s*(?:p(?:age|g)?\.?\s*)?(\d{1,2})\)?(?=$|[\s_.)-])/i);
  return { abbr: m[1] ? m[1].toUpperCase() : null, number: m[2], page: p ? Math.max(1, Number(p[1])) : 1 };
}

export interface NumberedSong { song_id: number; abbr: string; number: string }

/** The song a parsed name means, among the church's hymnal numbers (in hymnal order). */
export function matchScoreName(n: ScoreName | null, numbered: NumberedSong[]): number | null {
  if (!n) return null;
  const hit = numbered.find((x) => x.number.replace(/^0+/, '') === n.number && (!n.abbr || x.abbr.toUpperCase() === n.abbr));
  return hit?.song_id ?? null;
}
