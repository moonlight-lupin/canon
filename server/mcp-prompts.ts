// MCP prompts (agent playbooks) and resources (the agent handbook and the user guide).
//
// A prompt is a ready-made, step-by-step playbook that an MCP client (e.g. claude.ai's "+" menu) can insert into the
// conversation. Like tools, each prompt declares the modules and access it needs and is only registered when the
// connection's effective access allows it, so agents never see playbooks they couldn't carry out. Write steps inside
// a playbook adapt to the access level: with read-only access the agent proposes changes for a person to make.
//
// The playbook texts only name tools that exist in TOOLS (tests/mcp-prompts.test.ts checks every canon_* name).
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import type { Lang, ModuleAccess, ModuleKey } from '../shared/types.ts';
import { langInfo } from '../shared/languages.ts';
import { SEASONS, seasonOf } from '../shared/season.ts';

export interface PromptCtx {
  levels: Record<ModuleKey, ModuleAccess>;
  /** the administrator exposes member contact details / birthdays */
  pii: boolean;
  languages: Lang[];
  /** YYYY-MM-DD */
  today: string;
}

type PromptArgs = Record<string, string | undefined>;

export interface PromptDef {
  name: string;
  title: string;
  description: string;
  /** every listed module must be at least this level */
  needs: Partial<Record<ModuleKey, 'read' | 'write'>>;
  /** only offered when the administrator exposes member personal data */
  requiresPii?: boolean;
  /** argument name → description; every argument is an optional string */
  args: Record<string, string>;
  build: (a: PromptArgs, c: PromptCtx) => string;
}

// ---------------------------------------------------------------- helpers

const can = (c: PromptCtx, m: ModuleKey, lvl: 'read' | 'write') =>
  lvl === 'read' ? c.levels[m] !== 'off' : c.levels[m] === 'write';

const DAY = 86400_000;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
/** The next Sunday on or after `d`. */
const nextSunday = (d: string) => addDays(d, (7 - new Date(d + 'T00:00:00Z').getUTCDay()) % 7);
const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) && !Number.isNaN(Date.parse(s.trim()));
const posInt = (s: string | undefined, def: number, max: number) => {
  const n = Number.parseInt(s ?? '', 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : def;
};
/** Quote a user-supplied argument for inclusion in the playbook text. */
const q = (s: string | undefined) => JSON.stringify((s ?? '').trim().slice(0, 200));

const langList = (c: PromptCtx) => c.languages.map((l) => `${l} (${langInfo(l).name})`).join(', ');

function header(title: string, c: PromptCtx) {
  return [
    `# Canon playbook: ${title}`,
    '',
    `Today is ${c.today}. The church's languages are ${langList(c)}, primary first. Localised fields are L10n objects {"<lang>": "text"}; Simplified and Traditional Chinese convert automatically, so fill only one Chinese script.`,
    'The full rules (worship order, privacy, copyright, batch semantics) are in the resource canon://guide/agents — read it first if you have not yet.',
  ];
}

/** The common closing rules: confirmation etiquette. */
const ETIQUETTE = [
  '',
  '## Ground rules',
  '- Summarise what you intend to change and wait for a clear "yes" before any write. Never bulk-delete; never remove items or people unless the user asked for that specific removal.',
  '- Batch tools (canon_edit_order, canon_update_rota, canon_update_team_members, canon_update_group_members) are all-or-nothing: if one op fails, nothing is applied and you get per-op errors — fix them and resend the whole batch.',
  '- Never invent hymn words, Bible text or personal data. Say so when something is missing from the library.',
];

const readOnlyNote = (module: string) =>
  `You have READ-ONLY access to ${module} on this connection: do not attempt writes. Present the proposed changes clearly so a staff member can make them in Canon (or ask the administrator to grant write access in Settings → AI / MCP).`;

const lines = (...xs: (string | false | null | undefined)[]) => xs.filter((x): x is string => typeof x === 'string').join('\n');

// ---------------------------------------------------------------- playbooks

export const PROMPTS: PromptDef[] = [
  {
    name: 'plan_service',
    title: 'Plan a service',
    description: 'Plan a Lord\'s Day service: learn from similar past services first, find or create it, suggest hymns that fit the sermon text and season, set the readings, check the roster — and confirm with you before writing.',
    needs: { services: 'read', library: 'read' },
    args: {
      date: 'Service date YYYY-MM-DD (default: next Sunday)',
      template: 'Service template name or id, if a new service is needed',
      sermon_ref: 'Sermon text, e.g. "Romans 8:28-39"',
      sermon_title: 'Sermon title',
      preacher: 'Preacher',
    },
    build: (a, c) => {
      const date = isDate(a.date) ? a.date!.trim() : nextSunday(c.today);
      const season = SEASONS[seasonOf(date)];
      const write = can(c, 'services', 'write');
      return lines(
        ...header(`plan the service on ${date}`, c),
        '',
        '## Inputs',
        `- Date: ${date} — in Canon's liturgical calendar this falls in ${season.name.en} (${season.liturgical}).`,
        a.template ? `- Template: ${q(a.template)}` : '- Template: the church\'s usual Lord\'s Day template (ask if there are several).',
        a.sermon_ref ? `- Sermon text: ${q(a.sermon_ref)}` : '- Sermon text: not given — ask the user, or check whether the service already has one.',
        a.sermon_title ? `- Sermon title: ${q(a.sermon_title)}` : null,
        a.preacher ? `- Preacher: ${q(a.preacher)}` : null,
        '',
        '## Steps',
        `1. Find the service: canon_find_services {"from":"${date}","to":"${date}"}. If it exists, read it with canon_get_service {"id":…}.`,
        `   If none exists: canon_get_templates to choose the template${write ? ' — but do not create the service yet; creating it is part of the confirmed plan (step 9)' : ''}.`,
        `2. Check past services FIRST — they are the church's precedent: canon_find_services {"similar_to":<service id>} if the service exists, otherwise canon_find_services {"like":{"date":"${date}"${a.sermon_ref ? `,"sermon_ref":${q(a.sermon_ref)}` : ''}}}. Look at the same Sunday last year, the same season and the same sermon book: their order, usual hymns and slots, durations and who served. Follow that pattern unless the user wants something different, and name the services you based your plan on.`,
        '3. Read the sermon text with canon_bible {"ref":…} to grasp its themes (do not paste the whole passage back to the user). Note the season too.',
        `4. Hymns: for every song slot (kind "song", empty or to be chosen), search with canon_search_library {"q":…,"type":"songs","before":"${date}"} using several theme words in each church language, and also by category (psalm, hymn, doxology). Open promising candidates with canon_get_library_item {"type":"song","id":…}.`,
        '   - Each song result carries last_used and times_12m: avoid hymns sung in the last ~4 weeks unless the church clearly repeats them (e.g. a weekly doxology); prefer hymns the congregation knows (sung before) for congregational singing.',
        '   - Prefer songs with words in ALL of the service\'s languages; say when a language is missing.',
        '   - Fit the slot: opening hymn of praise; hymn of response after the sermon (tied to the text); closing hymn / doxology.',
        '   - Show hymnal numbers (abbr + number) so the congregation can find them; offer 2–3 options per slot with a one-line reason, and suggest stanzas if the hymn is long.',
        '5. Readings: the sermon text goes in the service\'s sermon_ref and in a scripture item (scripture_ref "Romans 8:28-39"); add an Old / New Testament reading or Law reading if the template has a slot. Bible text fills in automatically; the service\'s Bible versions apply unless the user wants a different one (canon_bible with no arguments lists versions).',
        '6. Liturgy: check that call to worship, confession of sin, assurance of pardon, creed and benediction are filled (canon_search_library {"type":"texts","category":…}), as in the similar past services. Catechism items need part labels in stanzas, e.g. ["1","2","3"]; continue from next_suggested_label (canon_get_library_item {"type":"text","id":…,"parts":"index"}).',
        can(c, 'volunteers', 'read')
          ? `7. Roster: canon_get_rota {"from":"${date}","to":"${date}"} — list unfilled roles, declines and warnings, and compare with who served in the similar past services (roster_summary). Do not change the rota in this playbook unless the user asks (see the roster_check playbook).`
          : '7. Roster: the volunteers module is not available on this connection — remind the user to check the Team & roster tab.',
        '8. Summarise BEFORE writing: which past services you followed, then a table of position → item → your choice (hymnal number, stanzas, last sung, languages available) plus the service details (preacher, sermon title in each language, sermon_ref) and any open questions. Ask "Shall I apply this?"',
        write
          ? lines(
              '9. After a clear yes:',
              `   - if the service does not exist: canon_create_service {"date":"${date}","template_id":…,"preacher":…,"sermon_title":{…},"sermon_ref":…} (or {"date":"${date}","copy_from":<the closest past service>} when it is a better starting point);`,
              '   - otherwise canon_update_service {"id":…,"patch":{…}} for the details;',
              '   - announcements (家讯) or a pastor’s note the user gives go in the weekly bulletin sections: canon_update_service {"id":…,"patch":{"bulletin_content":{"announcements":{…},"pastor_note":{…}}}} — keys come from the page layout of the bulletin template; sections and languages merge, so send only what changes;',
              '   - then ONE canon_edit_order batch: "update" ops for existing slots (ref_id, stanzas, hymnal_id, scripture_ref) and "add" ops only for missing items. If the batch fails nothing was applied — fix the listed ops and resend the whole batch.',
              '10. Confirm with canon_get_service and report any notices or roster warnings. Leave the status as "draft" unless the user asks to mark it final. Offer the files (canon_get_service with format "downloads": slides as PowerPoint, bulletin as Word) — the links need no sign-in, so give them only to the user.',
            )
          : `9. ${readOnlyNote('services')}`,
        ...ETIQUETTE,
      );
    },
  },

  {
    name: 'suggest_hymns',
    title: 'Suggest hymns',
    description: 'Suggest hymns and psalms from the church\'s library for a theme or Bible passage, with hymnal numbers and the languages available.',
    needs: { library: 'read' },
    args: {
      theme_or_ref: 'A theme ("assurance", "the Lord\'s Supper") or a Bible reference ("Psalm 23")',
      count: 'How many suggestions (default 5)',
    },
    build: (a, c) => {
      const count = posInt(a.count, 5, 15);
      return lines(
        ...header('suggest hymns', c),
        '',
        `Theme or passage: ${a.theme_or_ref ? q(a.theme_or_ref) : '(not given — ask the user)'}; suggestions wanted: ${count}.`,
        '',
        '## Steps',
        can(c, 'services', 'read')
          ? `1. Check past services FIRST: canon_find_services {"like":{"date":"<service date>","sermon_ref":<the passage, if any>}} (or {"similar_to":<service id>} when the service exists) shows what the church sang on the same Sunday last year, in this season and on the same book — its usual hymns for each slot. Hymn history comes with every song result of canon_search_library (last_used, times_12m); pass "before":"<service date>". Avoid hymns sung in the last ~4 weeks unless the church clearly repeats them; canon_search_library {"type":"songs","sort":"least_recent"} finds familiar hymns not sung for a while.`
          : '1. Past services are not available on this connection (services module off), so you cannot check what was sung recently — say so, and ask the user which hymns were sung in the last few weeks.',
        '2. If it is a Bible reference, read it with canon_bible {"ref":…} and note 3–5 themes (God\'s attributes, the gospel promise, the response asked of us).',
        '3. Search the library from several angles: canon_search_library {"q":…,"type":"songs"} with theme words in each church language (e.g. English and Chinese), synonyms, and the reference itself; also search {"category":"psalm"} for metrical psalms.',
        '4. Open the best candidates with canon_get_library_item {"type":"song","id":…} to check the words actually fit, which languages have words, and public_domain / copyright / CCLI.',
        '5. Rank by: faithfulness to the passage and Reformed theology (God-centred, scriptural); suitability for a congregation (known tune, sung before, hymnal number, not sung in the last ~4 weeks); words available in every service language.',
        `6. Answer with ${count} suggestions: title (in each language), hymnal numbers (abbr + number), when it was last sung, suggested stanzas, languages with words, where it fits (opening / response / closing / Lord's Supper), and a one-line reason. Mention the past services you looked at.`,
        '',
        '## Rules',
        '- Suggest only songs that are in the library. If an important hymn is missing, mention it separately as "not in your library" — never write out the words of a copyrighted hymn.',
        '- This playbook makes no changes. To put a hymn into a service, use the plan_service playbook or canon_edit_order after the user confirms.',
      );
    },
  },

  {
    name: 'roster_check',
    title: 'Check the volunteer rota',
    description: 'Check the coming weeks of the volunteer rota for gaps, conflicts and fairness, and propose changes — applied only after you approve.',
    needs: { volunteers: 'read' },
    args: { weeks: 'How many weeks ahead to check (default 4)' },
    build: (a, c) => {
      const weeks = posInt(a.weeks, 4, 26);
      const to = addDays(c.today, weeks * 7);
      const write = can(c, 'volunteers', 'write');
      return lines(
        ...header(`check the rota for the next ${weeks} weeks`, c),
        '',
        '## Steps',
        can(c, 'services', 'read')
          ? `1. Check past services FIRST: canon_get_rota {"from":"${addDays(c.today, -56)}","to":"${addDays(c.today, -1)}"} shows who served in the last 8 weeks, and canon_find_services {"similar_to":<service id>} gives roster_summary for similar past weeks (same Sunday last year, same season, special services such as the Lord's Supper). Use them for fairness and for the church's usual pattern (e.g. who normally leads on Communion Sundays).`
          : `1. Check past weeks FIRST: canon_get_rota {"from":"${addDays(c.today, -56)}","to":"${addDays(c.today, -1)}"} shows who served in the last 8 weeks — use it for fairness.`,
        `2. canon_get_rota {"from":"${c.today}","to":"${to}"}: services with assignments, teams with roles (how many needed, who is qualified), team rosters and unavailability.`,
        '3. Gaps: roles with fewer people than needed; assignments with status "declined" that have no replacement; services with no roster at all.',
        '4. Conflicts: someone assigned while marked unavailable; double-booked in one service; assigned to a role they are not qualified for.',
        '5. Fairness: count turns per person per team over the past weeks and the period. Flag anyone serving much more often than others, someone serving several weeks in a row, and qualified people who are never used.',
        '6. Propose fixes as a table: date → role → current → proposed person (qualified, available, fewest recent turns) → reason. Mention that autofill can fill empty slots fairly.',
        write
          ? lines(
              '7. Ask before applying. After a clear yes, send ONE canon_update_rota batch: assign {service_id, role_id, person_id}, set_status {assignment_id, status}, unassign {assignment_id} (only if the user asked; prefer set_status "declined"), or autofill {service_ids}. Report the roster warnings it returns.',
              '8. For someone travelling, canon_set_unavailability {person_id, start_date, end_date, reason} — again only after confirmation.',
            )
          : `7. ${readOnlyNote('the rota')}`,
        '',
        '## Notes',
        '- Names only: the rota tools never return contact details, and you should not ask for them.',
        '- Agents cannot send e-mail. Reminders are sent by staff from the service\'s Team & roster tab (Send reminders), after a preview.',
        ...ETIQUETTE,
      );
    },
  },

  {
    name: 'proofread_service',
    title: 'Proofread a service',
    description: 'Check a service before printing: empty slots, missing references and translations, catechism ranges, bulletin choices, copyright, posture and leaders.',
    needs: { services: 'read' },
    args: {
      service_id: 'Service id (from canon_find_services)',
      date: 'Or the service date YYYY-MM-DD (default: next Sunday)',
    },
    build: (a, c) => {
      const id = posInt(a.service_id, 0, Number.MAX_SAFE_INTEGER);
      const date = isDate(a.date) ? a.date!.trim() : nextSunday(c.today);
      const write = can(c, 'services', 'write');
      return lines(
        ...header('proofread a service', c),
        '',
        '## Steps',
        id
          ? `1. canon_get_service {"id":${id},"include_text":true,"include_similar":true}.`
          : `1. canon_find_services {"from":"${date}","to":"${date}"} (pick the main service if there are several), then canon_get_service {"id":…,"include_text":true,"include_similar":true}.`,
        `2. Compare with past services FIRST: similar_past (or canon_find_services {"similar_to":<service id>} for more) lists the closest earlier services with their outlines. Against the closest one, flag usual elements that are missing or out of their usual place (e.g. "the creed is usually here, after the assurance of pardon"), unusual durations, and a hymn that was also sung in the last ~4 weeks${can(c, 'library', 'read') ? ' (canon_search_library {"q":<title>,"type":"songs","before":<service date>} shows last_used)' : ' (compare with the outlines of the last few services)'}.`,
        '3. Check, item by item (cite the position and title):',
        '   - Empty slots: song items without ref_id, scripture items without scripture_ref, text items without ref_id, leftover placeholder titles.',
        '   - Service details: preacher, sermon title (in every service language), sermon_ref, start time, and whether the end time is sensible.',
        '   - Missing translations: every item, hymn stanza, reading and liturgy should have text in each of the service\'s languages (Chinese scripts convert automatically — only flag when neither script exists).',
        '   - Scripture: references parse (no error), the version per language is intended, and any notices about print / projection limits for licensed versions.',
        `   - Catechism and confession parts: the stanzas hold part labels (e.g. ["4","5","6"]) and the range continues the series from previous weeks${can(c, 'library', 'read') ? ' (canon_get_library_item {"type":"text","id":<ref_id>,"parts":"index"} gives history and next_suggested_label)' : ' (compare with the previous services)'}.`,
        '   - Bulletin choices: in_bulletin / on_slides are deliberate; long texts print in full or title only (bulletin_text) as the church expects.',
        '   - Weekly bulletin sections: bulletin_content (announcements 家讯, a pastor’s note …) is filled for THIS week in each service language and is not last week’s text; an empty announcements section prints nothing.',
        '   - Copyright: songs that are not public domain should carry a copyright line and CCLI number; licensed Bible versions are within their quotation limits.',
        '   - Posture: stand / sit set where the church expects it (typically stand for hymns, creed and benediction).',
        '   - Leaders and roster: items with a role but nobody assigned; the roster warnings returned by canon_get_service.',
        '   - Status: still "draft"?',
        '4. Report a punch list grouped as Must fix / Should check / For information, and name the past service you compared with. Once it is clean, offer canon_get_service with format "downloads" for the slides (PowerPoint) and bulletin (Word).',
        write
          ? '5. Offer to fix the straightforward items. After a clear yes, apply them in ONE canon_edit_order batch (and canon_update_service for service details). Do not mark the service final unless asked.'
          : `5. ${readOnlyNote('services')}`,
        ...ETIQUETTE,
      );
    },
  },

  {
    name: 'catechism_series',
    title: 'Plan a catechism series',
    description: 'Plan Westminster Shorter or Larger Catechism questions across the coming services and, after confirmation, add them to each order of worship.',
    needs: { services: 'read', library: 'read' },
    args: {
      standard: '"wsc" (Shorter Catechism, 107 Q) or "wlc" (Larger Catechism, 196 Q); default wsc',
      start_q: 'First question number (default: continue after the last question used)',
      weeks: 'How many services to plan (default 8)',
    },
    build: (a, c) => {
      const std = (a.standard ?? '').trim().toLowerCase() === 'wlc' ? 'wlc' : 'wsc';
      const name = std === 'wlc' ? 'Westminster Larger Catechism' : 'Westminster Shorter Catechism';
      const total = std === 'wlc' ? 196 : 107;
      const given = posInt(a.start_q, 0, total);
      const start = given || 1;
      const weeks = posInt(a.weeks, 8, 52);
      const write = can(c, 'services', 'write');
      return lines(
        ...header(`${name} series`, c),
        '',
        `Plan: ${name} (key "${std}", ${total} questions) ${given ? `from Q${given}` : 'continuing after the last question used (Q1 if the series has not started)'}, over ${weeks} services.`,
        '',
        '## Steps',
        `1. Find the text: canon_search_library {"q":"${name}","type":"texts","category":"catechism"} (its key is "${std}"). If it is missing, tell the user an administrator can import the Westminster Standards under Library → Liturgical texts, and stop.`,
        `2. Check past services FIRST: canon_get_library_item {"type":"text","id":…,"parts":"index"} lists the question labels and first lines, plus history (which questions each earlier and already-planned service used) and next_suggested_label (where the series continues). ${given ? `The user asked to start at Q${given}: if that skips or repeats questions compared with the history, point it out and ask.` : 'Start from next_suggested_label.'} Note the usual pace (questions per week) and the usual place of the catechism in the order from the history (canon_get_service {"id":<a recent service_id from the history>} or canon_find_services {"similar_to":…}). Read a range with "parts":"${start}-${Math.min(start + 9, total)}" when you need the wording.`,
        `3. Upcoming services: canon_find_services {"from":"${c.today}"} — take the next ${weeks} Lord's Day services (ask about evening or special services). Note sermon texts: a question that fits the sermon is a bonus, not a requirement.`,
        '4. Divide the questions: keep related questions together (e.g. WSC 1–3 introduction, 4–6 God, 7–8 decrees; never split a question from its follow-up), keep the pace even (usually 1–3 per week), and avoid splitting the Ten Commandments or the Lord\'s Prayer sections mid-commandment / mid-petition.',
        '5. Show the plan as a table: date → questions (e.g. "Q4–6") → topic → where it goes in the order (the church\'s usual place in the past services, often after the creed or before the pastoral prayer). Say which past services the pace and placement follow.',
        write
          ? lines(
              '6. After a clear yes, for each service send ONE canon_edit_order call: "update" an existing catechism item\'s stanzas, or "add" {"kind":"text","ref_id":<catechism id>,"stanzas":["4","5","6"]} at the chosen position. Stanzas are ALWAYS part labels as strings.',
              '7. Report what was added per service; services that do not exist yet are listed for the user (create them with the plan_service playbook first).',
            )
          : `6. ${readOnlyNote('services')}`,
        ...ETIQUETTE,
      );
    },
  },

  {
    name: 'check_library',
    title: 'Check the library for drift and duplicates',
    description: 'Find songs and liturgical texts whose languages have drifted apart (a verse or part missing in one language, different line counts, Leader / People lines that do not match), likely duplicates, and Bible versions with missing chapters — then explain and propose fixes.',
    needs: { library: 'read' },
    args: { focus: 'Optional: "songs", "texts", "duplicates" or "bibles" (default everything)' },
    build: (a, c) => {
      const focus = (a.focus ?? '').trim().toLowerCase();
      const write = can(c, 'library', 'write');
      return lines(
        ...header('check the library for languages that drift apart and duplicates', c),
        '',
        focus ? `Focus: ${focus}.` : 'Look at everything.',
        '',
        '## Steps',
        '1. Get the report: canon_search_library {"type":"checks"} (add "q" to narrow, e.g. a title). Each issue has kind, level ("check" = probably needs fixing, "note" = may be fine), the item and a detail.',
        '2. Group what you found: missing languages (song_verses, text_parts), lines or paragraphs that do not line up (song_lines, text_paragraphs, text_speakers), duplicates (duplicate_title, duplicate_number) and Bible versions (bible_verses). Explain each group in plain words and how many there are.',
        '3. Look closer before suggesting anything: canon_get_library_item {"type":"song"|"text","id":…} for the items. A translation can rightly have a different number of lines; say so when that is likely.',
        '4. Duplicates: compare both items (titles in every language, hymnal numbers, words, usage via canon_search_library last_used). Suggest which one to keep; merging (moving numbers or words across) needs the user to agree, and deleting is done by a person in the Library.',
        write
          ? '5. Missing words: only for public-domain or church-owned texts (or songs the church is licensed for), offer to fill them as the translate_library playbook describes — updates merge by language, so send only the missing language. Never type copyrighted hymn words.'
          : `5. ${readOnlyNote('the library')}`,
        '6. Bible versions with fewer verses usually number verses differently (e.g. Malachi 4, Joel 2–3) or leave a book out (say which); an uploaded Bible missing a book can be uploaded again with it.',
        '7. Finish with a short to-do list for the staff, most important first.',
        ...ETIQUETTE,
      );
    },
  },

  {
    name: 'translate_library',
    title: 'Fill missing translations',
    description: 'Fill missing languages in songs or liturgical texts — only public-domain or church-owned texts, as drafts marked for human review.',
    needs: { library: 'write' },
    args: {
      type: '"songs" or "texts" (default texts)',
      lang: 'Language code to fill, e.g. "zh", "en", "ms"',
    },
    build: (a, c) => {
      const type = (a.type ?? '').trim().toLowerCase() === 'songs' ? 'songs' : 'texts';
      const lang = (a.lang ?? '').trim();
      const known = lang && c.languages.includes(lang as Lang);
      const target = lang ? `${lang} (${langInfo(lang).name})` : '(not given — ask which language)';
      return lines(
        ...header(`fill missing ${type} translations`, c),
        '',
        `Target language: ${target}.${lang && !known ? ` Warning: ${q(lang)} is not one of the church's languages — confirm with the user first.` : ''}`,
        lang === 'zh-Hant' || lang === 'zh'
          ? 'Chinese: if the other Chinese script already has text, there is nothing to do — Canon converts Simplified ⇄ Traditional automatically.'
          : null,
        '',
        '## Eligibility (strict)',
        '- ONLY public-domain texts (public_domain = true) or texts the church wrote and owns (ask the user to confirm ownership).',
        '- NEVER translate or "reconstruct" a copyrighted hymn, and never fabricate a translation of a hymn that already has an established translation in a hymnal: tell the user which hymnal to consult instead.',
        '- Scripture quoted inside liturgy: take it from the church\'s Bible in that language with canon_bible {"ref":…,"lang":"…"} rather than translating it yourself.',
        '- Creeds, confessions and catechisms usually have established translations; prefer the church\'s official wording and ask before drafting your own.',
        '',
        '## Steps',
        `1. List candidates: canon_search_library {"type":"${type}"} (page with q / category), then canon_get_library_item {"type":"${type === 'songs' ? 'song' : 'text'}","id":…} for each to see which languages are missing and whether it is public domain.`,
        '2. Work in small batches (at most 5). Show each draft side by side with the source, and note anything uncertain.',
        type === 'songs'
          ? '3. A singable hymn translation must fit the meter and tune — say plainly that drafts need checking by a musician before singing.'
          : '3. Keep responsive markers: lines start "L: " (leader), "C: " (congregation) or "A: " (all); blank lines separate paragraphs / slides. Keep part labels unchanged for texts in parts.',
        type === 'songs'
          ? '4. After a clear yes, save with canon_save_song {"id":…,"fields":{"stanzas":[…],"tags":[…existing,"translation-draft"]}}. Updates merge by language: send only the new language for each stanza label; the existing languages stay. tags is a plain list: send the existing tags plus translation-draft.'
          : '4. After a clear yes, save with canon_save_text {"id":…,"fields":{"body":{"<lang>":"draft"},"tags":[…existing,"translation-draft"]}}. title, body and parts merge by language (send only the new language); tags is a plain list: send the existing tags plus translation-draft.',
        '5. Tell the user which items now carry the "translation-draft" tag so a pastor or translator can review them in the Library and remove the tag when approved.',
        ...ETIQUETTE,
      );
    },
  },

  {
    name: 'convert_existing',
    title: 'Bring in an existing bulletin or slides',
    description: 'Turn a bulletin (PDF, Word, photo) or a slide deck (PowerPoint, PDF, photos) the church already uses into Canon: the order of service, missing library items, and the settings for a matching bulletin / slide template.',
    needs: { services: 'read', library: 'read' },
    args: {
      source: 'What the user is sharing: "bulletin", "slides" or "both" (default both)',
      date: 'Service date to create in Canon, YYYY-MM-DD (default: the date printed on the bulletin)',
      as_template: '"yes" to also save the order as a reusable service template',
    },
    build: (a, c) => {
      const source = ['bulletin', 'slides'].includes((a.source ?? '').trim().toLowerCase()) ? (a.source ?? '').trim().toLowerCase() : 'both';
      const date = isDate(a.date) ? a.date!.trim() : null;
      const writeServices = can(c, 'services', 'write');
      const writeLibrary = can(c, 'library', 'write');
      const asTemplate = /^(y|yes|true|1)$/i.test((a.as_template ?? '').trim());
      return lines(
        ...header('bring an existing bulletin or slide deck into Canon', c),
        '',
        `Source: ${source === 'both' ? 'a bulletin and / or slides' : source}. ${date ? `Create the service on ${date}.` : 'Use the date printed on the bulletin (ask if there is none).'}`,
        '',
        '## Privacy and copyright first',
        '- The files stay in this conversation. Do not send their contents anywhere else.',
        '- Names on a roster are personal data: use them only to match people already in Canon, never to create people records.',
        '- Hymn words: bring in titles and hymnal numbers. Copy the words only for public-domain hymns, or when the user confirms the church holds a licence (e.g. CCLI) — then set public_domain=false with the copyright line and CCLI number. Never type words from a scan of a copyrighted hymn otherwise.',
        '',
        '## Steps',
        '1. Read the files the user shares (PDF, Word, photos, PowerPoint). List what you found in order: each item of the service (kind, title in each language, who leads it), hymns (title, hymnal and number), Bible readings (references), liturgy (call to worship, confession, creed, catechism questions, prayers), sermon (title, text, preacher), announcements and other weekly texts, QR codes / giving details, and which languages are used.',
        '2. Match against Canon before adding anything:',
        '   - the closest past services and templates: canon_find_services {"like":{"date":…}} or {"similar_to":…}, canon_get_templates — follow the church\'s usual order and item names;',
        '   - hymns by number or title: canon_search_library {"q":"HP 123"} / {"q":"title","type":"songs"};',
        '   - liturgy and catechisms by first words: canon_search_library {"q":…,"type":"texts"}; Westminster questions by part label (canon_get_library_item {"parts":"index"});',
        '   - readings: check each reference with canon_bible {"ref":…}.',
        '3. Show the user a table: printed item → what it becomes in Canon (existing library item, new item, or plain item with a title), plus anything you could not read. Ask before writing.',
        writeLibrary
          ? '4. After a clear yes, add what is missing to the Library: canon_save_song (title, hymnal_numbers; words only as allowed above) and canon_save_text for liturgy the church wrote (responsive lines "L: ", "C: ", "A: "; blank lines between paragraphs). Tag them "imported" so they can be reviewed.'
          : `4. ${readOnlyNote('the library')} List the songs and texts to add.`,
        writeServices
          ? `5. Build the service: canon_create_service {"date":…} (from the closest template, or copy_from a similar past service), then ONE canon_edit_order batch for the items in order (songs with ref_id and stanzas, readings with scripture_ref, liturgy with ref_id, posture where printed, leaders). Weekly texts and announcements go in bulletin_content with canon_update_service. Leave the status as "draft".${asTemplate ? ' Then save the order as a reusable template: canon_save_service_as_template.' : ''}`
          : `5. ${readOnlyNote('services')}`,
        '6. The look: no tool changes bulletin or slide templates, so write a short settings sheet the user can follow in Service Planner → Bulletin templates / Slide templates (make a copy of the closest built-in template, then):',
        source !== 'slides'
          ? '   - Bulletin: 1 Paper and languages (paper size and fold, languages side by side or one after the other); 2 What to print (hymn words, readings, liturgy: all the words / first verse / title only); 3 Cover and order of service (cover or banner and its colours, list or table, hymn numbers, posture, leaders, times); 4 Page layout (the sections in printed order, where new pages start, what is on the back cover).'
          : null,
        source !== 'bulletin'
          ? '   - Slides: 1 Colours and background (background, words, titles and accent colours as hex codes; whether there is a background picture); 2 Fonts and text size; 3 How much on each slide (lines per language you see on a typical slide); 4 Screen shape (16:9 or 4:3, from the deck\'s page size) and footer. Items that have their own background picture in the deck: the user adds the pictures in Library → QR codes & notes, then you can set slide_bg on those items with canon_edit_order.'
          : null,
        '7. Finish with: what was created (with links from canon_get_service {"id":…,"format":"downloads"} if the user wants files), what still needs a person (copyrighted words, unreadable parts, pictures to upload), and the settings sheet.',
        ...ETIQUETTE,
      );
    },
  },

  {
    name: 'member_care',
    title: 'Member care follow-up',
    description: 'Upcoming birthdays and visitors to follow up, for pastoral care — with privacy reminders. Only offered when the administrator exposes member details.',
    needs: { members: 'read' },
    requiresPii: true,
    args: { days: 'Look-ahead in days for birthdays (default 14, max 60)' },
    build: (a, c) => {
      const days = posInt(a.days, 14, 60);
      return lines(
        ...header('member care follow-up', c),
        '',
        '## Privacy first (PDPA)',
        '- The administrator has allowed member details on this connection for pastoral care. Use the minimum: names and dates for this task, not phone numbers or addresses unless the user asks for one specific person.',
        '- Do not copy personal data into other tools, documents or messages the user did not ask for; do not include ages or years of birth unless asked.',
        '- You cannot send messages from Canon. Draft greetings only if asked, without other people\'s personal details.',
        '',
        '## Steps',
        `1. Birthdays: canon_find_people {"view":"birthdays","days":${days}}.`,
        '2. Visitors: canon_find_people {"status":["visitor"]} — ask the user which recent visitors to follow up (canon_get_person {"id":…} for one person\'s details when needed).',
        '3. Also worth noting: canon_find_people {"status":["regular"]} for regular attenders who might be ready for membership classes — only if the user wants it.',
        can(c, 'coworkers', 'read') ? '4. Suggest who could follow up: canon_list_coworkers for elders / deacons / pastors.' : null,
        can(c, 'groups', 'read') ? `${can(c, 'coworkers', 'read') ? '5' : '4'}. If people belong to a cell group or fellowship, canon_find_groups {"id":…} shows its leaders — they are often the natural people to follow up.` : null,
        '',
        'Answer with a short list: name → occasion (birthday on <day month> / visitor) → suggested follow-up person → note. Ask before recording anything (canon_save_person needs write access and a clear request).',
        ...ETIQUETTE,
      );
    },
  },

  {
    name: 'group_overview',
    title: 'Groups overview',
    description: 'An overview of committees, fellowships, cell groups and ministries: sizes, leaders, terms ending soon and gaps.',
    needs: { groups: 'read' },
    args: { kind: 'committee, fellowship, cell_group, ministry or other (default: all)' },
    build: (a, c) => {
      const kinds = ['committee', 'fellowship', 'cell_group', 'ministry', 'other'];
      const kind = kinds.includes((a.kind ?? '').trim()) ? a.kind!.trim() : '';
      const soon = addDays(c.today, 90);
      return lines(
        ...header('groups overview', c),
        '',
        '## Steps',
        `1. canon_find_groups ${kind ? `{"kind":"${kind}"}` : '{}'} — each group with its member count and leaders.`,
        '2. For each group, canon_find_groups {"id":…} for members, roles and term dates.',
        `3. Report per kind: groups, sizes and leaders; groups without a leader or chair; terms ending before ${soon}; members on many groups (possible overload); very small or inactive groups.`,
        can(c, 'coworkers', 'read') ? '4. For committees, cross-check against canon_list_coworkers (e.g. elders on the Session, deacons on the Board of Deacons).' : null,
        can(c, 'groups', 'write')
          ? '5. Suggest changes only. After a clear yes, canon_update_group_members — end a term by setting end_date (keep the history) rather than removing; canon_save_group for group details (active=false retires a group).'
          : `5. ${readOnlyNote('groups')}`,
        '',
        'Names and roles only; the groups tools return no contact details.',
        ...ETIQUETTE,
      );
    },
  },
  {
    name: 'monthly_report',
    title: 'Monthly report for the leaders',
    description: 'A short report on a month (or another period) for the pastor, elders or church council: attendance and new visitors, and — where this connection may see them — offerings, serving, songs and Scripture, membership.',
    needs: { records: 'read' },
    args: { month: 'The month, YYYY-MM (default: last month)', compare: '"yes" to compare with the same month last year (default yes)' },
    build: (a, c) => {
      const m = /^\d{4}-\d{2}$/.test((a.month ?? '').trim()) ? a.month!.trim() : (() => {
        const d = new Date(c.today + 'T00:00:00');
        d.setDate(1);
        d.setMonth(d.getMonth() - 1);
        return d.toISOString().slice(0, 7);
      })();
      const last = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
      const from = `${m}-01`;
      const to = `${m}-${String(last).padStart(2, '0')}`;
      const period = `{"from":"${from}","to":"${to}"}`;
      let n = 1;
      const step = (s: string) => `${n++}. ${s}`;
      return lines(
        ...header(`write the report for ${m}`, c),
        '',
        '## Steps',
        step(`canon_attendance_report ${period}: average, highest, children and online, the same month last year (\`previous\`), per-congregation averages, and the new visitors' follow-up (new → contacted → came back → joined).`),
        step(`canon_list_service_records ${period} for services with no attendance recorded — list them as gaps rather than guessing.`),
        can(c, 'contributions', 'read')
          ? step(`canon_offerings_report ${period}: total by fund and payment method (amounts are in cents — divide by 100), other currencies separately (never add them to the total), and cash counts still not verified. Report totals only; do not single out services or people.`)
          : null,
        can(c, 'volunteers', 'read') ? step(`canon_serving_report ${period}: roles that were short of people, people serving very often, and team members not rostered.`) : null,
        can(c, 'services', 'read') ? step(`canon_songs_scripture_report ${period}: books read and preached, and how many songs under copyright were sung (for the licence report).`) : null,
        can(c, 'members', 'read') ? step(`canon_membership_stats ${period}: who joined or was baptised this month.`) : null,
        step('Write the report: a few headline numbers, then one short section per topic, then 2–4 points for the leaders to pray about or act on (e.g. visitors waiting for follow-up, a role that keeps being short). Plain language; no charts unless asked.'),
        step('Offer the user the report to copy. Staff can print the full figures from Records → Reports (and the treasurer the monthly offerings summary).'),
        '',
        '## Notes',
        '- Visitors are listed by name only; never ask for or add their contact details.',
        '- Read only: this playbook changes nothing.',
        ...ETIQUETTE,
      );
    },
  },
];

// ---------------------------------------------------------------- exposure control

export function allowedPrompts(levels: Record<ModuleKey, ModuleAccess>, pii: boolean): PromptDef[] {
  return PROMPTS.filter((p) => {
    for (const [m, need] of Object.entries(p.needs) as [ModuleKey, 'read' | 'write'][]) {
      const lvl = levels[m];
      if (lvl === 'off' || (need === 'write' && lvl !== 'write')) return false;
    }
    return !p.requiresPii || pii;
  });
}

export function registerPrompts(server: McpServer, ctx: PromptCtx) {
  const prompts = allowedPrompts(ctx.levels, ctx.pii);
  for (const p of prompts) {
    const argsSchema = Object.fromEntries(Object.entries(p.args).map(([k, d]) => [k, z.string().max(200).optional().describe(d)]));
    server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema }, (args: PromptArgs): GetPromptResult => ({
      description: p.title,
      messages: [{ role: 'user', content: { type: 'text', text: p.build(args ?? {}, ctx) } }],
    }));
  }
  return prompts;
}

// ---------------------------------------------------------------- resources

const DOCS = path.resolve(import.meta.dirname, '../docs');

export const RESOURCES = [
  {
    name: 'agent-handbook',
    uri: 'canon://guide/agents',
    title: 'Canon agent handbook',
    description: 'How to work in Canon as an AI agent: data model, languages, worship order, tools, batches, confirmation, privacy, copyright and playbooks.',
    file: 'AGENT-PLAYBOOKS.md',
  },
  {
    name: 'user-guide',
    uri: 'canon://guide/user',
    title: 'Canon user guide',
    description: 'The guide for church office staff (English): the weekly routine, library, templates, people, settings and troubleshooting. Useful for answering "how do I…" questions about the Canon web app.',
    file: 'guide/en.md',
  },
] as const;

function readDoc(file: string): string {
  try {
    return fs.readFileSync(path.join(DOCS, file), 'utf8');
  } catch {
    return `# Not available\n\nThis Canon installation does not include docs/${file}.`;
  }
}

export function registerResources(server: McpServer) {
  for (const r of RESOURCES) {
    server.registerResource(r.name, r.uri, { title: r.title, description: r.description, mimeType: 'text/markdown' }, (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readDoc(r.file) }],
    }));
  }
}
