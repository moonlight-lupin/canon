// Resolve a service into a fully expanded, bilingual structure used by every output
// (bulletin, slides, run sheet, docx, share page, MCP).
import type { L10n, Lang, LiturgyText, Person, ServiceFull } from '../../shared/types.ts';
import type { Paras, RenderedItem, RenderedService, RenderedSlideBlock } from '../../shared/render-types.ts';
import { formatRef, parseRef } from '../../shared/bible.ts';
import { partsLabel } from '../../shared/labels.ts';
import { partRuns } from '../../shared/parts.ts';
import { passage, pickTranslation } from './bible.ts';
import { hymnals, selectParts, singingOrder, songs, texts } from './library.ts';
import { getServiceFull, itemTimes } from './services.ts';
import { getSettings } from './settings.ts';
import { roles, serviceAssignments, teams } from './volunteers.ts';
import { people } from './registers.ts';
import { personL10n } from '../../shared/people-names.ts';
import { complete, pick } from '../lib/chinese.ts';
import { seasonInfo } from '../../shared/season.ts';
import { all, get } from '../db.ts';
import { listBlocks, resolveBulletinTemplate, resolveSlideThemeId, type ResolvedBulletin } from './presentation.ts';
import type { BulletinBlock } from '../../shared/presentation.ts';
import { ANNOUNCEMENTS_KEY, bulletinDecision, layoutBlockIds } from '../../shared/presentation.ts';

/** Split a liturgical body into paragraphs of (speaker, text) lines. */
export function parseParas(body: string | undefined): Paras {
  if (!body) return [];
  return body
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((para) =>
      para
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => {
          const m = l.match(/^\s*([LCA])[:：]\s?(.*)$/);
          return m ? { who: m[1] as 'L' | 'C' | 'A', text: m[2] } : { who: null, text: l.trim() };
        }),
    )
    .filter((p) => p.length);
}

const hasText = (l?: L10n) => !!l && Object.values(l).some((v) => v?.trim());

function refL10n(ref: string | null | undefined, langs: Lang[]): { ref: L10n; error?: string } {
  if (!ref) return { ref: {} };
  const all = [...new Set(['en', ...langs])];
  try {
    const segs = parseRef(ref);
    return { ref: Object.fromEntries(all.map((l) => [l, formatRef(segs, l)])) };
  } catch (e) {
    return { ref: Object.fromEntries(all.map((l) => [l, ref])), error: (e as Error).message };
  }
}

/**
 * Body text per language for the selected parts of a long text (catechism, confession). Each part becomes
 * a paragraph that carries the part number ("Q.1", "第1问", "I.1") and a confession part starts
 * with its chapter title when the chapter changes. The introduction (`body`) is kept only when all parts are used.
 */
function partsBody(t: LiturgyText, labels: string[] | null, langs: Lang[]): L10n {
  const catechism = t.category === 'catechism';
  const sel = selectParts(t, labels);
  const out: L10n = {};
  for (const lang of langs) {
    const paras: string[] = [];
    const intro = !labels ? pick(t.body, lang) : undefined;
    if (intro?.trim()) paras.push(intro.trim());
    let prevTitle = '';
    for (const p of sel) {
      const body = pick(p.body, lang)?.replace(/\r/g, '').trim();
      if (!body) continue;
      const num = catechism ? partsLabel([p.label], lang, true) : p.label;
      const lines = body.split('\n');
      const first = lines.findIndex((l) => l.trim());
      const m = lines[first].match(/^\s*([LCA])[:：]\s?(.*)$/);
      // A question carries its number ("Q.1 What is…"); a confession section gets its number ("I.2") on a line
      // of its own, so slide line-breaking at punctuation never splits "I." from "2".
      if (catechism) lines[first] = m ? `${m[1]}: ${num} ${m[2]}` : `${num} ${lines[first].trim()}`;
      else lines.splice(first, 0, num);
      const title = pick(p.title, lang) ?? p.title?.en ?? '';
      if (title && title !== prevTitle) {
        const chapter = p.label.match(/^(.*)[.:][^.:]+$/)?.[1];
        lines.unshift(chapter ? `${chapter}. ${title}` : title);
      }
      prevTitle = title;
      // a blank line inside a part would start a new paragraph: keep each part together
      paras.push(lines.filter((l) => l.trim()).join('\n'));
    }
    if (paras.length) out[lang] = paras.join('\n\n');
  }
  return out;
}

/** "Westminster Shorter Catechism Q.1–3" / "威斯敏斯德小要理问答 第1–3问" for the selected parts. */
function partsSubtitle(t: LiturgyText, labels: string[], langs: Lang[]): L10n {
  const all = (t.parts ?? []).map((p) => p.label);
  const runs = partRuns(labels, all);
  if (!runs.length) return {};
  const title = complete(t.title, langs);
  const out: L10n = {};
  for (const l of [...new Set([...langs, 'en'])]) {
    const head = title[l] ?? title.en ?? Object.values(title).find(Boolean) ?? '';
    out[l] = `${head} ${partsLabel(runs, l, t.category === 'catechism')}`.trim();
  }
  return out;
}

export function renderService(svcOrId: number | ServiceFull): RenderedService {
  const svc = typeof svcOrId === 'number' ? getServiceFull(svcOrId) : svcOrId;
  const settings = getSettings();
  const bulletin = resolveBulletinTemplate(svc);
  const langs = svc.languages.length ? svc.languages : settings.default_languages;
  const times = itemTimes(svc, svc.items);
  const active = svc.assignments.filter((a) => a.status !== 'declined');
  const namesForRole = (roleId: number | null) =>
    roleId ? active.filter((a) => a.role_id === roleId).map((a) => a.person_name) : [];
  // names per language with honorifics ("陈以诺传道" / "Ps. Chen Yi Nuo") for the bulletin and Word export
  const nextSvc = nextService(svc);
  const nextActive = nextSvc ? serviceAssignments(nextSvc.id).filter((a) => a.status !== 'declined') : [];
  const persons = personsById([...active, ...nextActive].map((a) => a.person_id));
  const nameL10n = (a: { person_id: number; person_name: string }): L10n => {
    const p = persons.get(a.person_id);
    return p ? personL10n({ ...p, honorific: p.honorific ? complete(p.honorific, langs) : null }, langs) : Object.fromEntries(langs.map((l) => [l, a.person_name]));
  };
  const l10nForRole = (roleId: number | null, from = active) => (roleId ? from.filter((a) => a.role_id === roleId).map(nameL10n) : []);
  const joinL10n = (names: L10n[]): L10n =>
    Object.fromEntries(langs.map((l) => [l, names.map((n) => n[l] ?? '').filter(Boolean).join(/^(zh|ja|ko)/.test(l) ? '、' : ', ')]));
  const notices = new Set<string>();
  const hymnalById = new Map(hymnals.list().map((h) => [h.id, h]));
  // QR codes / pictures / notes for the slides: loaded once, only when some item uses them
  const blockById = svc.items.some((it) => it.slide_blocks?.length || it.slide_bg) ? new Map(listBlocks().map((b) => [b.id, b])) : new Map<number, BulletinBlock>();
  const slideBlocks = (ids: number[] | undefined): RenderedSlideBlock[] =>
    [...new Set(ids ?? [])].flatMap((bid) => {
      const b = blockById.get(bid);
      return b ? [slideBlock(b, langs)] : [];
    });

  const slideBackground = (bid: number | null | undefined): RenderedItem['slide_bg'] => {
    const b = bid ? blockById.get(bid) : undefined;
    if (!b || b.kind !== 'image') return null;
    const r = slideBlock(b, langs);
    return r.has_image ? { id: b.id, v: r.v } : null;
  };

  const items: RenderedItem[] = svc.items.map((it, i) => {
    const role = it.role_id ? roles.find(it.role_id) : undefined;
    const assigned = namesForRole(it.role_id);
    let leader = assigned.length ? assigned.join(', ') : it.leader;
    if (!leader && it.kind === 'sermon') leader = svc.preacher;
    const out: RenderedItem = {
      id: it.id,
      kind: it.kind,
      title: it.title,
      subtitle: {},
      start: times[i].start,
      end: times[i].end,
      duration_min: it.duration_min,
      role_name: role?.name ?? null,
      leader: leader ?? null,
      leader_l10n: assigned.length ? joinL10n(l10nForRole(it.role_id)) : leader ? Object.fromEntries(langs.map((l) => [l, leader!])) : undefined,
      posture: it.posture ?? null,
      notes: it.notes,
      in_bulletin: it.in_bulletin,
      bulletin_text: it.bulletin_text ?? null,
      bulletin_full: bulletinDecision(it.kind, it.bulletin_text, bulletin.options),
      on_slides: it.on_slides,
      slide_blocks: slideBlocks(it.slide_blocks),
      slide_bg: slideBackground(it.slide_bg),
    };

    if (it.kind === 'song' && it.ref_id) {
      const s = songs.find(it.ref_id);
      if (s) {
        out.subtitle = s.title;
        const ref = (it.hymnal_id && s.hymnals?.find((h) => h.hymnal_id === it.hymnal_id)) || s.hymnals?.[0];
        const hymnal = ref ? hymnalById.get(ref.hymnal_id) : undefined;
        out.song = {
          id: s.id,
          title: s.title,
          author: s.author,
          composer: s.composer,
          tune: s.tune,
          meter: s.meter,
          public_domain: s.public_domain,
          copyright: s.copyright,
          ccli: s.ccli,
          number: ref && hymnal ? { abbr: ref.abbr, number: ref.number, hymnal: complete(hymnal.name, langs) } : undefined,
          stanzas: singingOrder(s, it.stanzas),
        };
        // a stub from a hymnal index has no words to print, so it needs no licence notice
        if (!s.public_domain && s.stanzas.length) {
          notices.add(
            `${s.title.en ?? s.title.zh}${s.copyright ? ` — ${s.copyright}` : ''}${s.ccli ? `. CCLI Song #${s.ccli}` : ''}`,
          );
        }
      }
    }

    // A reading with no reference directly before the sermon reads the sermon text (证道经文).
    const nextKind = svc.items[i + 1]?.kind;
    const ref = !it.scripture_ref && (it.kind === 'sermon' || (it.kind === 'scripture' && nextKind === 'sermon')) ? svc.sermon_ref : it.scripture_ref;
    if (ref && (it.kind === 'scripture' || it.kind === 'sermon' || it.kind === 'text' || it.kind === 'other')) {
      const r = refL10n(ref, langs);
      out.subtitle = it.kind === 'sermon' && hasText(svc.sermon_title) ? svc.sermon_title : r.ref;
      if (it.kind === 'scripture') {
        out.scripture = { ref: r.ref, passages: {}, error: r.error };
        if (!r.error) {
          for (const lang of langs) {
            // A pasted body for a language overrides the bundled Bible (e.g. ESV under licence)
            if (it.body?.[lang]?.trim()) continue;
            try {
              const p = passage(ref, lang, pickTranslation(lang, it.bibles?.[lang], svc.bibles?.[lang]));
              out.scripture.passages[lang] = { translation: p.translation, verses: p.verses.map(({ chapter, verse, text }) => ({ chapter, verse, text })) };
            } catch (e) {
              out.scripture.error = (e as Error).message;
            }
          }
        }
      }
    }
    if (it.kind === 'sermon' && hasText(svc.sermon_title)) out.subtitle = svc.sermon_title;

    // Liturgical text: item body overrides the library text per language.
    // A text in parts (catechism, confession) contributes only the parts the item selects.
    let body: L10n = { ...(it.body ?? {}) };
    if (it.kind === 'text' && it.ref_id) {
      const t = texts.find(it.ref_id);
      if (t) {
        out.text_title = t.title;
        const base = t.parts?.length ? partsBody(t, it.stanzas, langs) : t.body;
        body = { ...base, ...Object.fromEntries(Object.entries(it.body ?? {}).filter(([, v]) => v?.trim())) };
        if (t.parts?.length && it.stanzas && !hasText(out.subtitle)) out.subtitle = partsSubtitle(t, it.stanzas, langs);
        if (!hasText(out.subtitle) && Object.keys(t.title).some((k) => t.title[k] !== it.title[k])) {
          // "Benediction: 2 Cor 13:14" under the item "Benediction" → just "2 Cor 13:14"
          const strip = (full = '', head = '') => (head && full.startsWith(head) ? full.slice(head.length).replace(/^[\s:：—-]+/, '') : full);
          out.subtitle = Object.fromEntries(Object.keys(t.title).map((k) => [k, strip(t.title[k], it.title[k])]));
        }
      }
    }
    body = complete(body, langs);
    if (hasText(body)) {
      out.paras = {};
      for (const lang of langs) if (body[lang]?.trim()) out.paras[lang] = parseParas(body[lang]);
    }
    return out;
  });

  const teamList = teams.list('', [], 'sort, id');
  const roleList = roles.list('', [], 'sort, id');
  const roster = roleList
    .map((r) => ({
      team: complete(teamList.find((t) => t.id === r.team_id)?.name ?? {}, langs),
      role: complete(r.name, langs),
      people: namesForRole(r.id),
      people_l10n: l10nForRole(r.id),
      sort: teamList.findIndex((t) => t.id === r.team_id),
    }))
    .filter((r) => r.people.length)
    .sort((a, b) => a.sort - b.sort)
    .map(({ sort: _s, ...r }) => r);

  // Fill in Traditional ⇄ Simplified Chinese where only one script was entered.
  const c = (v: L10n) => complete(v, langs);
  for (const it of items) {
    it.title = c(it.title);
    it.subtitle = c(it.subtitle);
    if (it.role_name) it.role_name = c(it.role_name);
    if (it.text_title) it.text_title = c(it.text_title);
    if (it.song) {
      it.song.title = c(it.song.title);
      it.song.stanzas = it.song.stanzas.map((st) => ({ ...st, text: c(st.text) }));
      // "HP 123 · Holy, Holy, Holy" in every language
      const n = it.song.number;
      if (n) {
        const t = it.song.title;
        const fallback = t.en ?? Object.values(t).find((v) => v?.trim()) ?? '';
        it.subtitle = Object.fromEntries(
          [...new Set([...langs, ...Object.keys(t)])].map((l) => [l, `${n.abbr} ${n.number} · ${t[l]?.trim() || fallback}`]),
        );
      }
    }
    if (it.scripture) it.scripture.ref = c(it.scripture.ref);
  }

  const total = svc.items.reduce((a, it) => a + it.duration_min, 0);
  return {
    id: svc.id,
    date: svc.date,
    start_time: svc.start_time,
    end_time: itemTimes(svc, [{ duration_min: total }])[0].end,
    title: complete(svc.title, langs),
    theme: complete(svc.theme, langs),
    preacher: svc.preacher,
    sermon_title: complete(svc.sermon_title, langs),
    sermon_ref: refL10n(svc.sermon_ref, langs).ref,
    languages: langs,
    layout: settings.bilingual_layout,
    status: svc.status,
    church: {
      name: complete(settings.church_name, langs),
      address: settings.church_address,
      contact: settings.church_contact,
      ccli_license: settings.ccli_license,
    },
    items,
    roster,
    next_roster: nextSvc
      ? {
          service_id: nextSvc.id,
          date: nextSvc.date,
          roles: roleList
            .map((r) => ({ role: complete(r.name, langs), people: l10nForRole(r.id, nextActive) }))
            .filter((r) => r.people.length),
        }
      : null,
    role_names: roleList.map((r) => complete(r.name, langs)),
    notices: [...notices],
    notes: svc.notes,
    season: (() => {
      const si = seasonInfo(svc.date, svc.season);
      return { key: si.key, name: complete(si.name, langs), color: settings.season_colours ? si.color : null };
    })(),
    cover: (() => {
      const tplCover = bulletin.options.cover;
      // a banner template has no cover page at all, so it wins over the service's cover ornament
      const style = tplCover === 'banner' ? 'banner' : (svc.cover?.style ?? (tplCover !== 'default' ? tplCover : settings.bulletin_cover));
      const out: RenderedService['cover'] = { ...svc.cover, style };
      if (style === 'verse' && svc.cover?.verse_ref) {
        const ref = refL10n(svc.cover.verse_ref, langs);
        const text: L10n = {};
        if (!ref.error) {
          for (const l of langs) {
            try {
              text[l] = passage(svc.cover.verse_ref, l).verses.map((v) => v.text).join(' ');
            } catch {
              /* reference error already reported */
            }
          }
        }
        out.verse = { ref: ref.ref, text };
      }
      return out;
    })(),
    has_logo: !!get('SELECT 1 FROM assets WHERE key = ?', 'logo'),
    bulletin: bulletinPart(svc, bulletin, langs),
    slide_theme_id: resolveSlideThemeId(svc),
  };
}

/**
 * The bulletin template in effect with what its page layout prints: headings and fixed texts, the weekly texts
 * (service.bulletin_content) and the blocks, all completed for the service languages. Services written before
 * weekly sections existed keep their announcements in the Announcements item's body: that text is used when the
 * weekly announcements are empty.
 */
function bulletinPart(svc: ServiceFull, b: ResolvedBulletin, langs: Lang[]): RenderedService['bulletin'] {
  const c = (v: L10n | undefined) => complete(v ?? {}, langs);
  const page_layout = b.options.page_layout.map((s) => ({ ...s, ...(s.heading ? { heading: c(s.heading) } : {}), ...(s.text ? { text: c(s.text) } : {}) }));
  const content: Record<string, L10n> = {};
  for (const [k, v] of Object.entries(svc.bulletin_content ?? {})) if (hasText(v)) content[k] = c(v);
  let fromItem = false;
  if (!hasText(content[ANNOUNCEMENTS_KEY])) {
    const it = svc.items.find((x) => x.kind === 'announcements' && hasText(x.body ?? undefined));
    if (it) {
      content[ANNOUNCEMENTS_KEY] = c(it.body ?? {});
      fromItem = true;
    }
  }
  const want = layoutBlockIds(page_layout);
  const blocks = want.length
    ? listBlocks()
        .filter((x) => want.includes(x.id))
        .map((x) => ({ ...x, data: { ...x.data, ...(x.data.caption ? { caption: c(x.data.caption) } : {}), ...(x.data.text ? { text: c(x.data.text) } : {}) } }))
    : [];
  return {
    template_id: b.template_id,
    name: c(b.name),
    options: { ...b.options, page_layout },
    content,
    ...(fromItem ? { announcements_from_item: true } : {}),
    blocks,
  };
}

/** A bulletin block as projected on a slide: captions / note completed for the service languages. */
function slideBlock(b: BulletinBlock, langs: Lang[]): RenderedSlideBlock {
  const out: RenderedSlideBlock = { id: b.id, kind: b.kind, caption: complete(b.data.caption ?? {}, langs), has_image: !!b.data.image, v: b.updated_at };
  if (b.kind === 'qr') out.value = b.data.value ?? '';
  if (b.kind === 'image' && b.data.image) out.v = b.data.image;
  if (b.kind === 'text') {
    out.text = complete(b.data.text ?? {}, langs);
    out.bold = b.data.bold !== false;
  }
  return out;
}

/** The next service after this one by date and time: the same service type when there is one, else any. */
export function nextService(svc: Pick<ServiceFull, 'id' | 'date' | 'start_time' | 'service_type'>): { id: number; date: string } | null {
  const rows = all<{ id: number; date: string; service_type: string }>(
    `SELECT id, date, service_type FROM services
     WHERE id != ? AND (date > ? OR (date = ? AND start_time > ?))
     ORDER BY date, start_time, id LIMIT 60`,
    svc.id, svc.date, svc.date, svc.start_time,
  );
  const r = rows.find((x) => x.service_type === svc.service_type) ?? rows[0];
  return r ? { id: r.id, date: r.date } : null;
}

function personsById(ids: number[]): Map<number, Person> {
  const uniq = [...new Set(ids)];
  if (!uniq.length) return new Map();
  return new Map(people.list(`id IN (${uniq.map(() => '?').join(',')})`, uniq).map((p) => [p.id, p]));
}

/** Plain-text order of service (used by MCP and e-mail). */
export function serviceAsText(r: RenderedService, lang: Lang = 'en'): string {
  const L = (x: L10n) => x[lang] || x.en || x.zh || '';
  const lines = [`${L(r.title)} — ${r.date} ${r.start_time}–${r.end_time}`];
  if (r.preacher) lines.push(`Preacher: ${r.preacher}${hasText(r.sermon_title) ? ` — "${L(r.sermon_title)}"` : ''}`);
  lines.push('');
  for (const it of r.items) {
    if (it.kind === 'section') {
      lines.push('', `== ${L(it.title)} ==`);
      continue;
    }
    const sub = L(it.subtitle);
    lines.push(`${it.start}  ${L(it.title)}${sub ? ` — ${sub}` : ''}${it.leader ? `  [${it.leader}]` : ''}  (${it.duration_min} min)`);
  }
  return lines.join('\n');
}
