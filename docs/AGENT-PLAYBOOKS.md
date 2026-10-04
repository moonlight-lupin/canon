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
  - every item: `title`, `duration_min`, `role_id` / `leader`, `posture` (`stand | sit | kneel`), `in_bulletin`, `bulletin_text` (`full | title`), `on_slides`, `notes`.
- **Service templates**: reusable orders; a new service starts from a template or as a copy of another service.
- **Library**: songs (hymns, psalms, doxologies, responses) with stanzas, copyright and hymnal numbers; **hymnals** (hymnbooks with numbers — one song can be in several); **liturgical texts** (calls to worship, confessions, creeds, prayers, benedictions…), including long texts in numbered **parts** (Westminster Shorter Catechism `wsc` Q1–107, Larger `wlc` Q1–196, Confession `wcf` parts `I.1` = chapter.section); **Bibles** (built-in public-domain versions plus church uploads).
- **Volunteers**: teams (AV, ushers, music…) with roles (how many needed per service), the people qualified for each role, team rosters and leaders; the **rota** = assignments of people to roles per service (status `scheduled | confirmed | declined`); **unavailability** (away dates).
- **Registers**: members (people, households, membership status, baptism and membership dates), co-workers (pastors, elders, deacons, staff — with their committees), **groups** (committees, fellowships 团契, cell groups 小组, ministries) with members, roles and terms.

## 3. Language rules

- Localised fields are **L10n objects**: `{"en": "Amazing Grace", "zh": "奇异恩典"}`. Language codes: `en`, `zh` (Simplified Chinese), `zh-Hant` (Traditional Chinese), `ms`, `id`, `ta`…
- The church's languages are listed in the server instructions, primary first. Fill each of them when you can; never hard-code just English and Chinese.
- **Simplified and Traditional Chinese convert automatically.** If `zh` has text, do not fill `zh-Hant` (and vice versa) — Canon converts on output.
- A service shows up to three languages side by side. When text is missing in one language, say so rather than inventing it.
- When writing an L10n field, send every language you want to keep: a field you send replaces the stored object.

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

## 5. Tool catalogue

Read tools are safe to call freely. Write tools change church data: confirm first (section 7).

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
- Dates are `YYYY-MM-DD`, times `HH:MM` (24h). Results are `{"ok":true,"data":…}` or `{"ok":false,"error":…,"errors":[…]}`.

## 6. Batch semantics (all-or-nothing)

`canon_edit_order`, `canon_update_rota`, `canon_update_team_members` and `canon_update_group_members` take a list of operations and apply them in one transaction, in order.

- If **any** operation fails, **nothing** is applied, and the result lists the errors per operation (`index`, `op`, `error`). Fix those and resend the **whole** batch.
- Prefer one batch over many single calls: the user sees one coherent change, and a failure never leaves a half-edited service.
- Positions in `canon_edit_order` are 0-based and apply in sequence (an `add` shifts later items).
- Up to 50 operations per call.

## 7. Confirmation etiquette

- **Always summarise and ask before writing.** Show what will change (a short table is best) and wait for a clear "yes". A request such as "plan Sunday's service" is permission to prepare a plan, not to write it unannounced.
- **Never bulk-delete.** Remove items, assignments or group members only when the user asked for that specific removal. To end a group term, set `end_date`; when a volunteer declines, use `set_status: "declined"` rather than removing the assignment.
- Do not mark a service `final` unless asked: final means "ready to print and project".
- After writing, report the result, including any warnings the tool returns (roster warnings, missing library items, scripture notices).
- With read-only access, present the proposed changes so a staff member can make them in Canon.

## 8. Privacy (PDPA)

- Member contact details, addresses, birth dates and notes are returned **only** if the administrator has turned on "Expose member contact details & birthdays". Otherwise they are withheld: do not try to obtain or infer them.
- Even when exposed, use the minimum: names and dates for the task at hand. Don't copy personal data into chats, documents or other tools unless the user asked for it. Don't include ages or birth years unless asked.
- Rota, group and service tools return names only, never contact details.
- Agents cannot send e-mail. Volunteer reminders are sent by staff from the service's **Team & roster** tab after a preview.
- Every tool call is written to an audit log the administrator can read (argument names only for the registers).

## 9. Copyright

- **Hymn words**: many hymns are under copyright. Never invent, reconstruct or "translate" the words of a copyrighted hymn. Songs that are not public domain must carry a copyright line and CCLI number; the church projects and prints them under its own licence (e.g. CCLI).
- **Bible versions**: KJV and the Chinese Union Version 和合本 are public domain. Versions the church uploads (ESV, 和合本修订版, 新译本…) are licensed: quote them through `canon_bible` and keep within publishers' limits; Canon shows notices when a service exceeds them.
- **Translations**: fill missing languages only for public-domain or church-owned texts, mark drafts for human review (tag `translation-draft`), and use the church's Bible for quoted scripture.
- **Westminster Standards** (1647) and historic creeds are public domain.

## 10. Playbooks

The MCP server offers these as prompts; each is offered only when your access allows it.

- **plan_service** `{date?, template?, sermon_ref?, sermon_title?, preacher?}` — find the service (`canon_find_services`) or choose a template (`canon_get_templates`); read the sermon text (`canon_bible`); for each hymn slot search the library (`canon_search_library`, `canon_get_library_item`) for 2–3 options that fit the text and season, preferring songs with words in all the service's languages and showing hymnal numbers; set the readings; check the liturgy slots; check roster gaps (`canon_get_rota`); **summarise for confirmation before writing**; then `canon_create_service` or `canon_update_service` and one `canon_edit_order` batch.
- **suggest_hymns** `{theme_or_ref, count?}` — read the passage, search from several angles in every language, open candidates, rank by faithfulness to the text, singability and languages available; suggest only songs in the library.
- **roster_check** `{weeks?}` — `canon_get_rota` for the period; find gaps (unfilled roles, declines), conflicts (away, double-booked, unqualified) and fairness problems (turns per person); propose changes as a table; after a yes, one `canon_update_rota` batch (or `autofill`).
- **proofread_service** `{service_id or date}` — `canon_get_service` with `include_text`; check empty slots, missing references, missing translations, scripture errors and notices, catechism ranges against the series, bulletin choices, copyright lines, posture, leaders and roster warnings, status; report Must fix / Should check / For information; offer one `canon_edit_order` batch for the simple fixes.
- **catechism_series** `{standard: wsc|wlc, start_q, weeks}` — find the catechism (`canon_search_library`, `canon_get_library_item` with `parts: "index"`); take the coming services (`canon_find_services`); divide the questions in topical groups at an even pace; show the plan; after a yes, one `canon_edit_order` per service (update the catechism item's `stanzas` or add one).
- **translate_library** `{type: songs|texts, lang}` — only public-domain or church-owned texts; never copyrighted hymns; small batches shown side by side; after a yes, `canon_save_song` / `canon_save_text` including every existing language, tagged `translation-draft` for review.
- **member_care** `{days?}` — only with members readable and personal data exposed: birthdays (`canon_find_people` view `birthdays`) and visitors to follow up, with suggested follow-up people (`canon_list_coworkers`, `canon_find_groups`) and privacy reminders.
- **group_overview** `{kind?}` — `canon_find_groups` for each kind and each group; sizes, leaders, terms ending soon, groups without a leader, people on many groups; propose changes only.

## 11. Troubleshooting

- **A tool or playbook is missing**: the administrator has set that module to off or read-only in Settings → AI / MCP, your connection was approved with read-only scope, or the signed-in user is a viewer. Ask the user to check with the administrator; don't work around it.
- **member_care is missing**: members is off, or "Expose member contact details & birthdays" is off (the default).
- **"N of M operations failed — nothing was applied"**: read the per-op errors, fix them, resend the whole batch.
- **"No Bible is set up for language …"**: the church has no Bible for that language; an administrator adds one under Settings → Languages.
- **A catechism is not in the library**: an administrator imports the Westminster Standards in the Library.
- **Unauthorised / connection lost**: the token expired or was revoked under Settings → AI / MCP → Connected agents; reconnect the connector.
