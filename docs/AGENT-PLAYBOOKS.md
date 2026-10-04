# Canon agent handbook

How to work in Canon as an AI agent (Claude or any other MCP client). This file is also served by the Canon MCP server as the resource `canon://guide/agents`. The user guide for church staff is `canon://guide/user` (docs/guide/en.md).

## 1. What Canon is

Canon is a local-first church system for a Reformed / Presbyterian congregation (and others). Church staff use it in a browser to plan services, print bulletins, project slides and keep the registers. You reach it through the Canon MCP connector, which exposes up to 25 tools named `canon_*`, eight prompts (playbooks) and two resources.

What you can do depends on the church administrator, who sets each module to **off**, **read** or **read & write** in Settings → AI / MCP. Your effective access is the most restrictive of: that setting, your token's scope (`canon:read` / `canon:write`) and the signed-in user's role (a viewer only ever gets read). Tools and playbooks you are not allowed never appear in your lists.

## 2. The data model in brief

- **Services** (orders of worship): a date, start time, title, preacher, sermon title and text, theme, languages (up to three), season, status `draft` / `final`, Bible version per language, and an ordered list of **items**.
- **Items**: kind `section | song | scripture | text | sermon | prayer | sacrament | offering | announcements | music | other`.
  - song: `ref_id` = song id, optional `stanzas` (`["1","3","R"]`), `hymnal_id` (which hymnal's number shows);
  - scripture: `scripture_ref` such as `"Romans 8:28-39"` — the Bible text fills in automatically; optional `bibles` `{lang: code}` overrides the version for one reading;
  - text (liturgy): `ref_id` = liturgical text id; for a catechism or confession in parts, `stanzas` holds the part labels (`["1","2","3"]`);
  - every item: `title`, `duration_min`, `role_id` / `leader`, `posture` (`stand | sit | kneel`), `in_bulletin`, `bulletin_text` (`full | title`), `on_slides`, `notes`, `slide_blocks` (QR codes / notes projected after the item), `slide_bg` (a picture block id shown behind this item's slides; `null` = the slide template's background).
- **Weekly bulletin sections**: a service's `bulletin_content` is `{section_key: L10n}` — `announcements` (家讯) plus any weekly texts the bulletin template's page layout defines (e.g. `pastor_note`). `canon_get_service` shows it; `canon_update_service {"id", "patch": {"bulletin_content": {…}}}` sets it; sections and languages merge (send only what changes; `{}` clears a section, `""` removes one language). The Announcements item stays in the order as a timed item; its words print from the announcements section. Fixed texts (welcome, giving details) live in the template, not the service.
- **Service templates**: reusable orders; a new service starts from a template or as a copy of another service.
- **Library**: songs (hymns, psalms, doxologies, responses) with stanzas, copyright and hymnal numbers; **hymnals** (hymnbooks with numbers — one song can be in several); **liturgical texts** (calls to worship, confessions, creeds, prayers, benedictions…), including long texts in numbered **parts** (Westminster Shorter Catechism `wsc` Q1–107, Larger `wlc` Q1–196, Confession `wcf` parts `I.1` = chapter.section); **Bibles** (built-in public-domain versions plus church uploads).
- **Volunteers**: teams (AV, ushers, music…) with roles (how many needed per service), the people qualified for each role, team rosters and leaders; the **rota** = assignments of people to roles per service (status `scheduled | confirmed | declined`); **unavailability** (away dates).
- **Registers**: members (people, households, membership status, baptism and membership dates), co-workers (pastors, elders, deacons, staff — with their committees), **groups** (committees, fellowships 团契, cell groups 小组, ministries) with members, roles and terms.

## 3. Language rules

- Localised fields are **L10n objects**: `{"en": "Amazing Grace", "zh": "奇异恩典"}`. Language codes: `en`, `zh` (Simplified Chinese), `zh-Hant` (Traditional Chinese), `ms`, `id`, `ta`…
- The church's languages are listed in the server instructions, primary first. Fill each of them when you can; never hard-code just English and Chinese.
- **Simplified and Traditional Chinese convert automatically.** If `zh` has text, do not fill `zh-Hant` (and vice versa) — Canon converts on output.
- A service shows up to three languages side by side. When text is missing in one language, say so rather than inventing it.
- **Updates merge by language.** When updating (an `id` is given), send only the languages you are adding or changing: the others are kept. `""` removes one language. Song stanzas and text parts merge by `label` the same way; `replace_stanzas` / `replace_parts: true` replace the whole list (to remove or reorder). When creating, send every language you have.

## 4. The Reformed order of worship

A typical Lord's Day morning service, and where items go:

| Part | Item kind | Notes |
|---|---|---|
| Call to Worship | text (`call_to_worship`) or scripture | often a psalm verse |
| Invocation / Prayer of Invocation | text (`invocation`) or prayer | |
| Hymn of praise | song | stand |
| Reading of the Law / Confession of Sin | text (`confession`) or scripture | Exodus 20, Matthew 22:37–40 |
| Assurance of Pardon | text (`assurance`) or scripture | |
| Creed | text (`creed`) | Apostles' or Nicene Creed; stand |
| Catechism | text (`catechism`) with part labels | e.g. WSC Q4–6 |
| Pastoral Prayer | prayer | |
| Scripture Reading | scripture | the sermon text |
| Sermon | sermon | title and text from the service details |
| Hymn of response | song | tied to the sermon |
| Offering | offering | |
| Doxology | song (`doxology`) | stand |
| Benediction | text (`benediction`) | stand |

The Lord's Supper and baptism are `sacrament` items. Respect the church's own templates: they are the best guide to its practice. Liturgical seasons (Advent, Christmastide, Epiphany, Lent, Holy Week, Eastertide, Pentecost, Ordinary Time) are calculated from the date and can be overridden per service.

## 5. Precedent first: learn from past services

The church's past services are its real practice, better than any textbook order. **Before you propose or write a plan, always look at similar past services and at hymn history**, and say which services you based your proposal on.

**Why.** Every congregation has habits a template doesn't capture: where the creed and the catechism go, which doxology it always sings, how long the pastoral prayer is, what changes on a Communion Sunday, what it did last Christmas, who usually reads or plays. Following them makes a plan feel right to the people who will use it; repeating last month's hymns or skipping a catechism question makes it feel wrong.

**How.**

| Need | Call | You get |
|---|---|---|
| Services like one that exists | `canon_find_services {"similar_to": 42}` | the most similar *earlier* services, best first, each with `score`, `reasons`, `outline` and `roster_summary` |
| Services like one not created yet | `canon_find_services {"like": {"date": "2026-12-20", "sermon_ref": "Luke 2:1-20"}}` | the same, from criteria (`date`, `sermon_ref`, `service_type`, `template_id`, `title`, `song_ids`, `text_ids`) |
| Precedent while reading a service | `canon_get_service {"id": 42, "include_similar": true}` | `similar_past`: the top 3 with reasons and one-line outlines |
| Hymn history | `canon_search_library {"q": "grace", "type": "songs", "before": "2026-12-20"}` | every song with `last_used` and `times_12m` (the 12 months before `before`, default today) |
| Familiar hymns not sung for a while | `canon_search_library {"type": "songs", "sort": "least_recent", "before": "2026-12-20"}` | songs sung before, longest ago first (never-sung last); `"sort": "most_used"` gives the church's favourites |
| Where a catechism series is | `canon_get_library_item {"type": "text", "id": 7, "parts": "index"}` | `history` (parts used per service, planned ones marked) and `next_suggested_label` |

**What "similar" means.** Only services dated *before* the target count. Points for: the same service type and template; the same liturgical season; the same point of the church year in an earlier year (the same Sunday last year, Christmas Eve; Easter-cycle dates such as Palm Sunday, Easter Day and Pentecost are matched by their distance from Easter, not the calendar); a sermon in the same book, the same chapter or overlapping verses; the same title; shared hymns and liturgical texts; and a little for recency. `reasons` says why, e.g. `"same Sunday last year"`, `"same sermon book (James)"`, `"2 shared hymns"`.

**Use it like this.**
- Take the order, the usual hymns per slot, durations and who serves from the closest past services; depart from them only for a reason you can name.
- Avoid a hymn sung in the last ~4 weeks unless the church clearly repeats it (a weekly doxology or Gloria Patri). For congregational singing, prefer hymns the congregation has sung before.
- Continue catechism and confession series from `next_suggested_label`; point out gaps or repeats.
- For the rota, look at who served in the past weeks and in similar weeks (`roster_summary`, `canon_get_rota` with past dates) for fairness and the usual pattern.
- In your summary, name the precedent: *"Based on the fourth Sunday of Advent last year (21 Dec) and the Luke series in September: same order, creed after the assurance of pardon; EH 101 not sung since August."*

Example (fictional) result of `canon_find_services {"similar_to": 42}`:

```json
{"similar":[{"id":17,"date":"2025-12-21","title":"Lord's Day Worship / 主日崇拜","season":"advent","sermon_ref":"Luke 1:26-38",
  "score":9.5,"reasons":["same Sunday last year","same season (advent)","same sermon book (Luke)"],
  "outline":[{"kind":"text","title":"Call to Worship / 宣召","subtitle":"Psalm 24:7-10","min":2},
             {"kind":"song","title":"Hymn / 诗歌","subtitle":"EH 101 Hymn of the Morning Light","min":4},
             {"kind":"text","title":"Catechism / 要理问答","subtitle":"Example Catechism Q4–6","min":3}],
  "roster_summary":"Pianist: Grace Wong; Usher: Daniel Ong"}]}
```

## 6. Tool catalogue

Read tools are safe to call freely. Write tools change church data: confirm first (section 8).

| Module | Read | Write |
|---|---|---|
| services | `canon_find_services`, `canon_get_service` | `canon_create_service`, `canon_update_service`, `canon_edit_order` (batch) |
| templates | `canon_get_templates` | `canon_save_service_as_template` |
| library | `canon_search_library`, `canon_get_library_item`, `canon_bible` | `canon_save_song`, `canon_save_text` |
| volunteers | `canon_get_rota` | `canon_update_rota` (batch), `canon_update_team_members` (batch), `canon_set_unavailability` |
| members | `canon_find_people`, `canon_get_person` | `canon_save_person`, `canon_save_household` |
| coworkers | `canon_list_coworkers` | `canon_save_coworker` |
| groups | `canon_find_groups` | `canon_save_group`, `canon_update_group_members` (batch) |

Patterns:
- `find_*` / `search_*` return summaries; `get_*` returns detail. `canon_get_service` returns hymn words, Bible text and liturgy only with `include_text: true`; `format: "text"` gives a plain-text run sheet.
- `save_*` creates (no `id`) or updates (`id` + only the fields to change).
- `canon_search_library` also finds songs by hymnal number (`"HP 123"`, `"#123"`) and lists hymnals (`type: "hymnals"`).
- `canon_get_library_item` with `parts: "index"` lists a long text's parts; `parts: "1-3"` or `"I.1-3"` returns a selection.
- `canon_bible` with `ref` returns a passage, with `q` searches, and with neither lists the installed versions.
- `canon_get_service {"id", "format": "downloads", "files"?, "hours"?, "langs"?}` returns short-lived links (default 24 h, max 72) for the slides as **PowerPoint** (`slides_pptx`), the bulletin as **Word** (`bulletin_docx`), a **FreeShow** project and the **run sheet**, plus `open_in_canon` pages for a signed-in user (the print-ready bulletin → Print → PDF, the slide show, the run sheet). Anyone holding a link can download that file without signing in: give links only to the user who asked, never post them publicly. Mention when the service is still a draft.
- `canon_get_templates` marks the church's usual template with `church_default: true`; start from it unless the user or the precedent says otherwise.
- Precedent (section 5): `canon_find_services` with `similar_to` / `like`, `canon_get_service` with `include_similar`, song usage (`last_used`, `times_12m`, `sort`) in `canon_search_library`, and catechism `history` / `next_suggested_label` in `canon_get_library_item`.
- Dates are `YYYY-MM-DD`, times `HH:MM` (24h). Results are `{"ok":true,"data":…}` or `{"ok":false,"error":…,"errors":[…]}`.

## 7. Batch semantics (all-or-nothing)

`canon_edit_order`, `canon_update_rota`, `canon_update_team_members` and `canon_update_group_members` take a list of operations and apply them in one transaction, in order.

- If **any** operation fails, **nothing** is applied, and the result lists the errors per operation (`index`, `op`, `error`). Fix those and resend the **whole** batch.
- Prefer one batch over many single calls: the user sees one coherent change, and a failure never leaves a half-edited service.
- Positions in `canon_edit_order` are 0-based and apply in sequence (an `add` shifts later items).
- Up to 50 operations per call.

## 8. Confirmation etiquette

- **Always summarise and ask before writing.** Show what will change (a short table is best) and wait for a clear "yes". A request such as "plan Sunday's service" is permission to prepare a plan, not to write it unannounced.
- **Never bulk-delete.** Remove items, assignments or group members only when the user asked for that specific removal. To end a group term, set `end_date`; when a volunteer declines, use `set_status: "declined"` rather than removing the assignment.
- Do not mark a service `final` unless asked: final means "ready to print and project".
- After writing, report the result, including any warnings the tool returns (roster warnings, missing library items, scripture notices).
- With read-only access, present the proposed changes so a staff member can make them in Canon.

## 9. Privacy (PDPA)

- Member contact details, addresses, birth dates and notes are returned **only** if the administrator has turned on "Expose member contact details & birthdays". Otherwise they are withheld: do not try to obtain or infer them.
- Even when exposed, use the minimum: names and dates for the task at hand. Don't copy personal data into chats, documents or other tools unless the user asked for it. Don't include ages or birth years unless asked.
- Rota, group and service tools return names only, never contact details.
- Agents cannot send e-mail. Volunteer reminders are sent by staff from the service's **Team & roster** tab after a preview.
- Every tool call is written to an audit log the administrator can read (argument names only for the registers).

## 10. Copyright

- **Hymn words**: many hymns are under copyright. Never invent, reconstruct or "translate" the words of a copyrighted hymn. Songs that are not public domain must carry a copyright line and CCLI number; the church projects and prints them under its own licence (e.g. CCLI).
- **Bible versions**: KJV and the Chinese Union Version 和合本 are public domain. Versions the church uploads (ESV, 和合本修订版, 新译本…) are licensed: quote them through `canon_bible` and keep within publishers' limits; Canon shows notices when a service exceeds them.
- **Translations**: fill missing languages only for public-domain or church-owned texts, mark drafts for human review (tag `translation-draft`), and use the church's Bible for quoted scripture.
- **Westminster Standards** (1647) and historic creeds are public domain.

## 11. Playbooks

The MCP server offers these as prompts; each is offered only when your access allows it.

- **plan_service** `{date?, template?, sermon_ref?, sermon_title?, preacher?}` — find the service (`canon_find_services`) or choose a template (`canon_get_templates`); **check past services first**: `canon_find_services {"similar_to": <id>}` or `{"like": {"date", "sermon_ref"}}` for the order, usual hymns, durations and who served; read the sermon text (`canon_bible`); for each hymn slot search the library (`canon_search_library`, `canon_get_library_item`) for 2–3 options that fit the text and season, avoiding hymns sung in the last ~4 weeks (`last_used`, with `"before": <date>`), preferring songs with words in all the service's languages and showing hymnal numbers; set the readings; check the liturgy slots; check roster gaps (`canon_get_rota`); **summarise for confirmation before writing**, naming the past services you followed; then `canon_create_service` or `canon_update_service` and one `canon_edit_order` batch; announcements or a pastor's note the user gives go in `bulletin_content` (`canon_update_service`).
- **suggest_hymns** `{theme_or_ref, count?}` — **check past services first** (`canon_find_services {"like": {"date", "sermon_ref"}}` for what was sung on similar Sundays; `canon_search_library` `last_used` / `times_12m`, `"sort": "least_recent"`); read the passage, search from several angles in every language, open candidates, rank by faithfulness to the text, singability (known to the congregation, not sung in the last ~4 weeks) and languages available; suggest only songs in the library.
- **roster_check** `{weeks?}` — **check past weeks first**: `canon_get_rota` for the last 8 weeks and `canon_find_services {"similar_to": <id>}` (`roster_summary`) for who served in similar weeks; then `canon_get_rota` for the period; find gaps (unfilled roles, declines), conflicts (away, double-booked, unqualified) and fairness problems (turns per person); propose changes as a table; after a yes, one `canon_update_rota` batch (or `autofill`).
- **proofread_service** `{service_id or date}` — `canon_get_service` with `include_text` and `include_similar`; **compare with the closest past service first** and flag usual elements that are missing or moved ("the creed is usually here") and hymns sung in the last ~4 weeks; check empty slots, missing references, missing translations, scripture errors and notices, catechism ranges against the series (`next_suggested_label`), bulletin choices, the weekly bulletin sections (`bulletin_content`: announcements, pastor's note filled for this week), copyright lines, posture, leaders and roster warnings, status; report Must fix / Should check / For information; offer one `canon_edit_order` batch for the simple fixes.
- **catechism_series** `{standard: wsc|wlc, start_q?, weeks}` — find the catechism (`canon_search_library`); **check past services first**: `canon_get_library_item` with `parts: "index"` gives `history` and `next_suggested_label` — continue from there (default) at the church's usual pace and place in the order; take the coming services (`canon_find_services`); divide the questions in topical groups at an even pace; show the plan; after a yes, one `canon_edit_order` per service (update the catechism item's `stanzas` or add one).
- **convert_existing** `{source: bulletin|slides|both, date?, as_template?}` — read the bulletin (PDF, Word, photo) or slide deck the user shares; list the items in order, hymns (title, hymnal number), readings, liturgy, sermon, announcements and languages; **match against Canon first** (closest past services and templates, `canon_search_library` by number / title / first words, `canon_bible` for references); show printed item → Canon item and ask; then add missing library items (`canon_save_song` titles and numbers — words only when public domain or licensed; `canon_save_text`; tag `imported`), build the service (`canon_create_service` + one `canon_edit_order`, announcements in `bulletin_content`, status draft; optionally `canon_save_service_as_template`); finish with a settings sheet for the bulletin / slide template editor steps (no tool edits those templates) and what still needs a person. Roster names only match people already in Canon.
- **translate_library** `{type: songs|texts, lang}` — only public-domain or church-owned texts; never copyrighted hymns; small batches shown side by side; after a yes, `canon_save_song` / `canon_save_text` with only the new language (updates merge by language — the existing languages are kept), tagged `translation-draft` for review.
- **member_care** `{days?}` — only with members readable and personal data exposed: birthdays (`canon_find_people` view `birthdays`) and visitors to follow up, with suggested follow-up people (`canon_list_coworkers`, `canon_find_groups`) and privacy reminders.
- **group_overview** `{kind?}` — `canon_find_groups` for each kind and each group; sizes, leaders, terms ending soon, groups without a leader, people on many groups; propose changes only.

## 12. Troubleshooting

- **A tool or playbook is missing**: the administrator has set that module to off or read-only in Settings → AI / MCP, your connection was approved with read-only scope, or the signed-in user is a viewer. Ask the user to check with the administrator; don't work around it.
- **member_care is missing**: members is off, or "Expose member contact details & birthdays" is off (the default).
- **"N of M operations failed — nothing was applied"**: read the per-op errors, fix them, resend the whole batch.
- **"No Bible is set up for language …"**: the church has no Bible for that language; an administrator adds one under Settings → Languages.
- **A catechism is not in the library**: an administrator imports the Westminster Standards in the Library.
- **Unauthorised / connection lost**: the token expired or was revoked under Settings → AI / MCP → Connected agents; reconnect the connector.
