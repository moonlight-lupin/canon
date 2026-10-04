# Canon tools, data and conventions

## Tools by module

Whether a tool appears depends on the administrator's module settings (off / read / read & write), the connection's scope and the user's role.

| Module | Read | Write |
|---|---|---|
| services | `canon_find_services`, `canon_get_service` | `canon_create_service`, `canon_update_service`, `canon_edit_order` (batch) |
| templates | `canon_get_templates` | `canon_save_service_as_template` |
| library | `canon_search_library`, `canon_get_library_item`, `canon_bible` | `canon_save_song`, `canon_save_text` |
| volunteers | `canon_get_rota` | `canon_update_rota` (batch), `canon_update_team_members` (batch), `canon_set_unavailability` |
| members | `canon_find_people`, `canon_get_person` | `canon_save_person`, `canon_save_household` |
| coworkers | `canon_list_coworkers` | `canon_save_coworker` |
| groups | `canon_find_groups` | `canon_save_group`, `canon_update_group_members` (batch) |

- `find_*` / `search_*` → summaries; `get_*` → detail. `canon_get_service` returns words and Bible text only with `include_text: true`; `format: "text"` returns a run sheet.
- `save_*`: no `id` = create; `id` + fields = update only those fields.
- Multilingual fields merge by language on update: send only the language you add or change (`""` removes one). Song stanzas and text parts merge by `label`; `replace_stanzas` / `replace_parts: true` replace the whole list.
- `canon_search_library` finds songs by hymnal number (`"HP 123"`), and `type: "hymnals"` lists hymnbooks.
- `canon_get_library_item` `parts`: `"index"` or a selection such as `"1-3"`, `"1,4,7-9"`, `"I.1-3"` (WCF chapter.section).
- `canon_get_service` with `format: "downloads"`: short-lived links (24 h default, max 72) for `slides_pptx` (PowerPoint, styled by the slide template), `bulletin_docx` (Word), `freeshow`, `run_sheet`; `open_in_canon` links the print-ready bulletin (Print → PDF), slide show and run sheet for a signed-in user. Links work without signing in — give them only to the user who asked.
- `canon_get_templates`: `church_default: true` marks the template the church normally starts from.
- `canon_bible`: `ref` → passage; `q` → search; neither → installed versions (codes usable in a service's or reading's `bibles`).

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
- all: `title` (L10n), `duration_min`, `role_id` / `leader`, `posture` stand | sit | kneel, `in_bulletin`, `bulletin_text` full | title, `on_slides`, `notes`, `slide_blocks` [block ids], `slide_bg` (picture block id behind this item's slides; `null` = template background).

## Weekly bulletin sections

A service's `bulletin_content` is `{section_key: L10n}`: `announcements` (家讯) plus the weekly texts that the bulletin template's page layout defines (e.g. `pastor_note`). `canon_get_service` shows it; `canon_update_service {"id", "patch": {"bulletin_content": {"announcements": {"zh": "1. …\n2. …"}, "pastor_note": {"en": "…"}}}}` sets it — sections and languages merge, so send only what changes (`{}` clears a section, `""` removes one language). Numbered lines print as a list. The Announcements item stays in the order as a timed item; its words print from this section. Fixed texts (welcome, giving details) belong to the template, not the service.

`canon_edit_order` ops: `add {item, position?}`, `update {item_id, item}`, `move {item_id, position}`, `remove {item_id}` — positions 0-based, applied in order, up to 50 ops, all-or-nothing.

## A Reformed order of worship

Call to Worship → Invocation → Hymn of praise (stand) → Reading of the Law / Confession of Sin → Assurance of Pardon → Creed (stand) → Catechism → Pastoral Prayer → Scripture Reading → Sermon → Hymn of response → Offering → Doxology (stand) → Benediction (stand). The Lord's Supper and baptism are `sacrament` items. The church's own templates (`canon_get_templates`) show its actual practice.

## Troubleshooting

- Tool or prompt missing → module off or read-only in Settings → AI / MCP, a read-only connection, or a viewer account.
- `member_care` missing → members off, or member details not exposed (the default).
- "N of M operations failed — nothing was applied" → fix the per-op errors, resend the whole batch.
- "No Bible is set up for language …" → an administrator adds one in Settings → Languages.
- Unauthorised → the connection expired or was revoked; reconnect the connector.
