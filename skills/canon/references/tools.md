# Canon tools, data and conventions

`canon_whoami` (always available): who you act for, role, each module's access and why, contact-detail policy (members and `visitors`), languages, congregations, tools, playbooks, limits and instructions — call it first when unsure; `{"brief": true}` returns just the person, role, scopes and access levels. Item kinds, stanzas, posture, slide blocks and song-merging rules: the handbook's "Writing services and songs" (canon://guide/agents).

## Tools by module

Whether a tool appears depends on the administrator's module settings (off / read / read & write), the connection's scope and what the user's role allows in that module (none / read / edit).

| Module | Read | Write |
|---|---|---|
| services | `canon_find_services`, `canon_get_service`, `canon_get_calendar` (services, meetings and events by date) | `canon_create_service`, `canon_update_service`, `canon_edit_order` (batch) |
| templates | `canon_get_templates` | `canon_save_service_as_template` |
| library | `canon_search_library`, `canon_get_library_item`, `canon_bible` | `canon_save_song`, `canon_save_text` |
| volunteers | `canon_get_rota` | `canon_update_rota` (batch), `canon_update_team_members` (batch), `canon_set_unavailability` |
| members | `canon_find_people`, `canon_get_person` (+ the church's own fields in `custom`) | `canon_save_person` (`fields.custom` for own fields), `canon_save_household` |
| coworkers | `canon_list_coworkers` | `canon_save_coworker` |
| groups | `canon_find_groups` (kinds include `sunday_school`) | `canon_save_group`, `canon_update_group_members` (batch; `leads` = leads the group) |
| records | `canon_list_service_records`, `canon_get_service_record`, `canon_attendance_report` | `canon_save_service_record` (attendance, notes, visitors — never money) |
| contributions (inside records, read only) | `canon_offerings_report` (+ offerings in the record tools) | — |
| reports elsewhere | `canon_serving_report` (volunteers), `canon_song_report`, `canon_scripture_report` (services; chapters read and preached, by period or chosen `years`), `canon_membership_stats` (members) | — |
| lending (optional) | `canon_lending` (catalogue; a title's copies; `loans` open / overdue / returned; `isbn` lookup) | `canon_save_book` (titles and copies; not lending / returning) |
| equipment (optional) | `canon_equipment` (register; `due` maintenance; one item by id or `number`) | `canon_save_equipment` (items; `maintenance` done) |
| library → sheet music (only when shared) | `canon_sheet_music` (`service_id` or `song_id`; `pictures: true` returns image pages) | — |
| library (write) | — | `canon_sheet_music_upload_link` (`song_id` or `number` "HP 178"; the user adds pages from a phone) |
| admin (administrators only, when on) | `canon_admin_overview`, `canon_admin_accounts`, `canon_admin_change_log`, `canon_admin_record_views`, `canon_admin_settings` | `canon_admin_backup_now`, `canon_admin_run_checks` |

- Sheet music: read the pictures to answer about the music; never retype or pass it on (copyright). PDFs / very large scans aren't sent — give `open_in_canon`. You can't upload files: give `canon_sheet_music_upload_link`, or point to Library → Upload sheet music (files named "HP 178.jpg", "HP 178-2.jpg").
- Administration: never passwords or secrets; change-log values only when personal data is shared; ask before `canon_admin_backup_now`; accounts, roles and settings change only in Canon.
- Spaces: `space_id` on create / update service (a church space; administrators keep the list in Canon); calendar items carry `space`. Avoid double-booking a space.
- `find_*` / `search_*` → summaries; `get_*` → detail. `canon_get_service` returns words and Bible text only with `include_text: true`; `format: "text"` returns a run sheet.
- `save_*`: no `id` = create; `id` + fields = update only those fields.
- Multilingual fields merge by language on update: send only the language you add or change (`""` removes one). Song stanzas and text parts merge by `label`; `replace_stanzas` / `replace_parts: true` replace the whole list.
- `canon_search_library` finds songs by hymnal number (`"HP 123"`), and `type: "hymnals"` lists hymnbooks.
- `canon_get_library_item` `parts`: `"index"` or a selection such as `"1-3"`, `"1,4,7-9"`, `"I.1-3"` (WCF chapter.section).
- `canon_get_service` with `format: "downloads"`: short-lived links (24 h default, max 72) for `slides_pptx` (PowerPoint, styled by the slide template), `bulletin_docx` (Word), `freeshow`, `run_sheet`; `open_in_canon` links the print-ready bulletin (Print → PDF), slide show and run sheet for a signed-in user. Links work without signing in — give them only to the user who asked. A passage in a Bible version whose licence doesn't allow printing (Word, run sheet) or projection (PowerPoint, FreeShow) has its reference without the text in that file (an administrator sets this in Settings → Languages).
- Congregations: `congregation` (id / short label / name) filters `canon_find_services`, `canon_find_people`, `canon_find_groups`; `congregation_id` on create / update service (its languages are the default). An account limited to one congregation gets "not found" for other congregations' people, services and records in every tool, can't add their people to groups or the rota, can't move items to another congregation, and gets precedent only from its own congregation's and the whole church's services.
- Sensitive member fields (`custom` keys marked sensitive) only when personal data is exposed and the person's role sees sensitive fields; otherwise they are left out and can't be changed. Meetings follow the role in every service, order and record tool (read-only for roles that only read meetings) and don't exist for agents when Meetings is switched off.
- Service records: `records` and `contributions` are off by default; `contributions` needs `records` and is always read only (never change money, sign or verify; roles without offerings never get it). Amounts in cents of the church currency; other currencies apart, never converted. Visitor follow-up status `new` / `contacted` / `returning` / `joined`. Visitors follow the **Visitors** level (`canon_whoami` → `visitors`): off — records give only `new_visitors` (a count) with `visitors_withheld`, the attendance report has no `people`, and saving visitors is refused; names & follow-up (default) — no contact details, and contact sent with `add_visitors` is not stored; with contact details — also contact, notes, prayer and `about`, only for roles that see members' details. `canon_save_service_record` replaces notes — read first. Reports take `from`, `to` (default the last 12 months), `congregation_id`. Meetings of groups have records too: `canon_list_service_records` takes `kind` (`service` / `meeting`) and `group_id`, reports take `kind` (`service` default, `meeting`, `all`) and `group_id`; a meeting may take no offering (`offering: false`) and then has no money. An archived record comes back with `archived_year` / `read_only`: it can't be saved and reports leave its year out (say so; only an administrator can bring it back, in Canon).
- References (`ref`, e.g. `EN-001`, `CN-10pmService`): pass one wherever an id goes — `canon_get_service {"id":"EN-2026-12-25"}`, `canon_create_service {"template":"CN-10pmService"}`, `canon_update_service` with `slide_template` / `bulletin_template`; `canon_find_services` `q` matches them. A service template's slide / bulletin templates come with its new services.
- `canon_get_templates` (`kind`: service | slide | bulletin) lists active templates (archived ones are left out); `church_default: true` marks the template the church normally starts from. A service template's items can carry `stanzas`: the stanzas or catechism questions (e.g. `["1","2","3","4"]`) a service made from it starts with.
- `canon_bible`: `ref` → passage; `q` → search; neither → installed versions (codes usable in a service's or reading's `bibles`).
- Lending library (books, DVDs, curricula lent to members — not the song Library) and asset register: optional modules, off by default. `canon_lending` `q` matches title, author, ISBN or copy number (`B0012`); `loans: "overdue"` for follow-up; `isbn` looks a book up before adding. `canon_save_book`: search first, then add copies to an existing title rather than a duplicate; lending and returns happen in Canon. `canon_equipment` `due: true` = maintenance due within 14 days or overdue; `canon_save_equipment` `maintenance: {what, done_on?, cost?, done_by?}` moves the next date on by `maintenance_every_months`. Photos and receipts are added in Canon.

## Precedent: past services first

Look at precedent before proposing or writing any plan, and name the services you based it on.

- `canon_find_services {"similar_to": <service id>}` or `{"like": {"date", "sermon_ref", "service_type", "template_id", "title", "song_ids", "text_ids"}}` → the most similar *earlier* services with `score`, `reasons` (e.g. "same Sunday last year", "same sermon book (James)"), `outline` (kind, title, hymn with number / reading / text with parts, minutes) and `roster_summary`. Easter-cycle dates match by distance from Easter.
- `canon_get_service {"id", "include_similar": true}` → `similar_past`, the top 3 with one-line outlines.
- `canon_search_library` songs carry `last_used` and `times_12m` (before `before`, default today); `"sort": "least_recent"` (sung before, longest ago first) or `"most_used"`. Avoid hymns sung in the last ~4 weeks unless the church clearly repeats them.
- `canon_get_library_item` for a text in parts → `history` (parts used per service, planned ones marked) and `next_suggested_label` to continue a catechism / confession series.
- Dates `YYYY-MM-DD`, times `HH:MM`. Results: `{"ok":true,"data"}` or `{"ok":false,"error","errors":[{index,op,error}]}`.

## Service items

`kind`: section | song | scripture | text | sermon | prayer | sacrament | offering | announcements | music | other.

- song: `ref_id` (song id), `stanzas` `["1","3","R"]`, `hymnal_id`.
- scripture: `scripture_ref` `"Romans 8:28-39"`; optional `bibles` `{"en":"ESV"}` for this reading.
- text: `ref_id` (liturgical text id); catechism / confession parts in `stanzas` `["1","2","3"]`.
- all: `title` (L10n), `duration_min`, `role_id` / `leader`, `posture` stand | sit | kneel, `in_bulletin`, `bulletin_text` full | title, `on_slides`, `slide_cover` cover | both | null (a title-and-leader slide instead of / before the words), `notes`, `slide_blocks` [block ids], `slide_background_id` (picture from Library → Slide backgrounds behind this item's slides; `null` = template background).

## Weekly bulletin sections

A service's `bulletin_content` is `{section_key: L10n}`: `announcements` (家讯) plus the weekly texts that the bulletin template's page layout defines (e.g. `pastor_note`). `canon_get_service` shows it; `canon_update_service {"id", "patch": {"bulletin_content": {"announcements": {"zh": "1. …\n2. …"}, "pastor_note": {"en": "…"}}}}` sets it — sections and languages merge, so send only what changes (`{}` clears a section, `""` removes one language). Numbered lines print as a list. The Announcements item stays in the order as a timed item; its words print from this section. Fixed texts (welcome, giving details) belong to the template, not the service.

`canon_edit_order` ops: `add {item, position?}`, `update {item_id, item}`, `move {item_id, position}`, `remove {item_id}` — positions 0-based, applied in order, up to 50 ops, all-or-nothing.

## A Reformed order of worship

Call to Worship → Invocation → Hymn of praise (stand) → Reading of the Law / Confession of Sin → Assurance of Pardon → Creed (stand) → Catechism → Pastoral Prayer → Scripture Reading → Sermon → Hymn of response → Offering → Doxology (stand) → Benediction (stand). The Lord's Supper and baptism are `sacrament` items. The church's own templates (`canon_get_templates`) show its actual practice.

## Troubleshooting

- Tool or prompt missing → module off or read-only in Settings → AI / MCP, a read-only connection, the user's role doesn't allow it, or that part of Canon is switched off (Settings → Modules).
- `member_care` missing → members off, or member details not exposed (the default).
- "N of M operations failed — nothing was applied" → fix the per-op errors, resend the whole batch.
- "No Bible is set up for language …" → an administrator adds one in Settings → Languages.
- Unauthorised → the connection expired or was revoked; reconnect the connector.
