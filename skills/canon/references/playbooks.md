# Canon playbooks

The same playbooks the Canon MCP server offers as prompts. If the client lists the prompt, prefer it: it is already adapted to your access level and the church's languages. With read-only access to a module, skip its write steps and present the proposal for a staff member to enter.

Every playbook that plans or checks a service starts by **checking past services**: the church's earlier services are its precedent (order, usual hymns, durations, who serves). Name the past services you based a proposal on.

## plan_service — plan a Lord's Day service

Inputs: date (default next Sunday), template, sermon_ref, sermon_title, preacher.

1. `canon_find_services {"from": date, "to": date}`. If found, `canon_get_service {"id"}`. If not, `canon_get_templates` and pick the usual Lord's Day template — but don't create the service until the plan is confirmed.
2. **Check past services**: `canon_find_services {"similar_to": <id>}` (or `{"like": {"date", "sermon_ref"}}` when the service doesn't exist yet). Study the same Sunday last year, the same season and the same sermon book: order, usual hymns per slot, durations, who served (`roster_summary`).
3. Read the sermon text with `canon_bible {"ref"}`; note its themes and the liturgical season of the date.
4. For each song slot, `canon_search_library {"q", "type":"songs", "before": date}` with theme words in each church language, plus category searches (psalm, hymn, doxology); open candidates with `canon_get_library_item {"type":"song","id"}`. Avoid songs whose `last_used` is within ~4 weeks unless the church clearly repeats them; prefer songs the congregation knows; prefer words in all service languages; show hymnal numbers; offer 2–3 options per slot with a reason; fit the slot (praise / response to the sermon / closing).
5. Readings: sermon_ref on the service and a scripture item (`scripture_ref`); other readings as the template has them.
6. Liturgy: call to worship, confession, assurance, creed, benediction filled as in the past services; catechism items carry part labels in `stanzas`, continuing from `next_suggested_label`.
7. Roster: `canon_get_rota {"from": date, "to": date}` — list unfilled roles and warnings, compared with who served in similar weeks (don't change them here).
8. Summarise as a table, name the past services you followed, and ask "Shall I apply this?".
9. After yes: `canon_create_service {"date","template_id",…}` (or `copy_from` the closest past service) if needed, else `canon_update_service {"id","patch"}` (announcements or a pastor's note the user gives go in `"bulletin_content"`); then ONE `canon_edit_order` batch (`update` existing slots, `add` only missing items). Confirm with `canon_get_service` and report warnings. Leave it `draft`. Offer `canon_get_service {"id","format":"downloads"}` (slides as PowerPoint, bulletin as Word) — links need no sign-in, so give them only to the user.

## suggest_hymns — hymns for a theme or passage

1. **Check past services**: `canon_find_services {"like": {"date", "sermon_ref"}}` shows what the church sang on similar Sundays; song results of `canon_search_library` carry `last_used` / `times_12m` (pass `"before": <service date>`); `"sort": "least_recent"` finds familiar hymns not sung for a while.
2. For a reference, read it with `canon_bible` and note 3–5 themes.
3. Search from several angles (`canon_search_library` with theme words in every language, synonyms, the reference, category psalm).
4. Check candidates with `canon_get_library_item`: words fit, languages present, copyright / CCLI.
5. Rank by faithfulness to the text and Reformed theology, singability (known to the congregation, hymnal number, not sung in the last ~4 weeks), languages available.
6. Answer: title per language, hymnal numbers, when last sung, suggested stanzas, languages, where it fits, one-line reason. Only songs in the library; list important missing hymns separately as "not in your library" without their words. No writes.

## roster_check — gaps, conflicts and fairness

1. **Check past weeks**: `canon_get_rota {"from": today − 8 weeks, "to": yesterday}` for who served recently; `canon_find_services {"similar_to": <id>}` gives `roster_summary` for similar weeks (same Sunday last year, Communion Sundays).
2. `canon_get_rota {"from": today, "to": today + weeks}`.
3. Gaps: roles below the number needed, declines without replacement, services without a roster.
4. Conflicts: assigned while unavailable, double-booked, not qualified.
5. Fairness: turns per person per team over the past and coming weeks; overused, several weeks in a row, never-used qualified people.
6. Propose a table (date → role → current → proposed → reason); mention `autofill`.
7. After yes: ONE `canon_update_rota` batch (`assign`, `set_status`, `unassign` only on request, `autofill`); report the returned warnings. Away dates: `canon_set_unavailability`. Names only; reminders are sent by staff.

## proofread_service — before printing

1. `canon_get_service {"id", "include_text": true, "include_similar": true}` (find it with `canon_find_services` by date).
2. **Compare with past services**: against the closest service in `similar_past` (more with `canon_find_services {"similar_to": <id>}`), flag usual elements that are missing or moved ("the creed is usually here, after the assurance of pardon"), unusual durations, and hymns sung in the last ~4 weeks.
3. Check: empty slots; preacher / sermon title in every language / sermon_ref; missing translations; scripture errors and licence notices; catechism ranges continue the series (`next_suggested_label` in `canon_get_library_item`); `in_bulletin` / `bulletin_text` / `on_slides` choices; the weekly bulletin sections (`bulletin_content`: announcements, pastor's note) are filled for this week; copyright lines and CCLI on non-public-domain songs; posture; items with a role but no leader; roster warnings; status.
4. Report Must fix / Should check / For information, citing positions and the past service you compared with.
5. Offer the simple fixes as one `canon_edit_order` batch after confirmation.

## catechism_series — questions across coming services

1. `canon_search_library {"q":"Westminster Shorter Catechism","type":"texts","category":"catechism"}` (key `wsc`, 107 Q; Larger `wlc`, 196 Q). Missing → an admin imports the Westminster Standards in the Library.
2. **Check past services**: `canon_get_library_item {"type":"text","id","parts":"index"}` gives the labels plus `history` (questions used per earlier and planned service) and `next_suggested_label` — continue from there unless the user gave a start (then point out gaps or repeats). Note the usual pace and place in the order. A range like `"parts":"4-6"` gives the wording.
3. `canon_find_services {"from": today}` for the next N Lord's Day services.
4. Group related questions (never split a question from its follow-up or a commandment / petition); keep the church's usual pace (often 1–3 a week).
5. Show date → questions → topic → position in the order (as in past services); ask.
6. After yes: one `canon_edit_order` per service — `update` the catechism item's `stanzas`, or `add` `{"kind":"text","ref_id":<id>,"stanzas":["4","5","6"]}`.

## convert_existing — bring in an existing bulletin or slides

1. Read the files the user shares (PDF, Word, photos, PowerPoint); list in order: items (kind, titles per language, leader), hymns (title, hymnal + number), readings, liturgy, sermon, announcements, QR / giving details, languages.
2. Match first: closest past services / templates (`canon_find_services`, `canon_get_templates`); hymns by number or title and texts by first words (`canon_search_library`); references via `canon_bible`.
3. Show printed item → Canon item (existing / new / plain title) and anything unreadable; ask.
4. After yes: missing library items with `canon_save_song` (title + `hymnal_numbers`; words only if public domain or the church confirms a licence) and `canon_save_text`; tag `imported`.
5. `canon_create_service` (closest template or `copy_from`) + ONE `canon_edit_order`; announcements → `bulletin_content` (`canon_update_service`); leave `draft`; `canon_save_service_as_template` if asked.
6. No tool edits bulletin / slide templates: write a settings sheet following the editor steps (bulletin: paper & languages, what to print, cover & order, page layout; slides: colours & background as hex, fonts & size, lines per slide, 16:9 or 4:3, footer). Per-item pictures: user uploads to Library → QR codes & notes, then `slide_bg` via `canon_edit_order`.
7. Report what was created, what needs a person, and the sheet. Roster names only match existing people — never create people from a bulletin.

## check_library — languages that drift apart, duplicates

1. `canon_search_library {"type":"checks"}` (optional `q`): issues with kind, level (`check` / `note`), item, detail.
2. Group: missing languages, lines / paragraphs / speakers that don't line up, duplicates, Bible versions; explain each in plain words.
3. Look closer with `canon_get_library_item`; a translation may rightly have a different line count.
4. Duplicates: compare, suggest which to keep; merging needs the user's yes, deleting is done by a person.
5. Missing words: only public-domain or church-owned texts (as translate_library); never copyrighted hymn words.
6. Bible: fewer verses usually means different numbering or a missing book.
7. End with a short to-do list.

## translate_library — fill missing languages

1. Eligible: public-domain texts, or texts the church wrote (confirm). Never copyrighted hymns; never fabricate a translation of a hymn that has an established one — point to the hymnal. Quote scripture from the church's Bible via `canon_bible`. Prefer official wordings of creeds and catechisms.
2. If the other Chinese script has text, nothing to do.
3. Candidates: `canon_search_library {"type"}` then `canon_get_library_item` for missing languages.
4. At most 5 at a time, drafts side by side with the source; keep `L:` / `C:` / `A:` markers and part labels.
5. After yes: `canon_save_song` (send only the new language for each stanza label — updates merge by language and the other languages stay) or `canon_save_text` (likewise for title, body and parts); `tags` is a plain list, so send the existing tags plus `translation-draft`. Tell the user which items need review.

## member_care — birthdays and visitors

Only when members is readable and the administrator exposes personal data.

1. `canon_find_people {"view":"birthdays","days"}`.
2. `canon_find_people {"status":["visitor"]}`; ask which visitors to follow up; `canon_get_person` only for those.
3. Suggest who follows up: `canon_list_coworkers` (elders, deacons, pastors), cell-group leaders via `canon_find_groups`.
4. Answer name → occasion → suggested person. No phone numbers, addresses, ages or birth years unless asked; nothing copied elsewhere; no messages sent.

## monthly_report — a month for the leaders

1. `canon_attendance_report {"from","to"}` (average, same month last year, per congregation, visitors' follow-up) and `canon_list_service_records` for services with nothing recorded — list gaps, don't guess.
2. If allowed: `canon_offerings_report` (totals by fund and method in cents ÷ 100; other currencies separately; unverified counts), `canon_serving_report` (short roles, overload, idle team members), `canon_scripture_report` (chapters read and preached), `canon_song_report` (songs under copyright), `canon_membership_stats` (joined, baptised).
3. Write a short report: headline numbers, one section per topic, 2–4 points to pray about or act on. Totals only for money; visitors by name only. Changes nothing.

## group_overview — groups and committees

1. `canon_find_groups {"kind"}`, then `canon_find_groups {"id"}` per group.
2. Report sizes, leaders, groups without a leader, terms ending within three months, people on many groups, small or inactive groups. For committees, cross-check `canon_list_coworkers`.
3. Changes only after yes: `canon_update_group_members` (end terms with `end_date`, don't remove), `canon_save_group` (`active=false` retires a group).
