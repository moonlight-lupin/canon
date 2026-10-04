# Canon playbooks

The same playbooks the Canon MCP server offers as prompts. If the client lists the prompt, prefer it: it is already adapted to your access level and the church's languages. With read-only access to a module, skip its write steps and present the proposal for a staff member to enter.

## plan_service — plan a Lord's Day service

Inputs: date (default next Sunday), template, sermon_ref, sermon_title, preacher.

1. `canon_find_services {"from": date, "to": date}`. If found, `canon_get_service {"id"}`. If not, `canon_get_templates` and pick the usual Lord's Day template — but don't create the service until the plan is confirmed.
2. Read the sermon text with `canon_bible {"ref"}`; note its themes and the liturgical season of the date.
3. For each song slot, `canon_search_library {"q", "type":"songs"}` with theme words in each church language, plus category searches (psalm, hymn, doxology); open candidates with `canon_get_library_item {"type":"song","id"}`. Prefer songs with words in all service languages; show hymnal numbers; offer 2–3 options per slot with a reason; fit the slot (praise / response to the sermon / closing); avoid hymns sung in the last few weeks.
4. Readings: sermon_ref on the service and a scripture item (`scripture_ref`); other readings as the template has them.
5. Liturgy: call to worship, confession, assurance, creed, benediction filled; catechism items carry part labels in `stanzas`.
6. Roster: `canon_get_rota {"from": date, "to": date}` — list unfilled roles and warnings (don't change them here).
7. Summarise as a table and ask "Shall I apply this?".
8. After yes: `canon_create_service {"date","template_id",…}` if needed, else `canon_update_service {"id","patch"}`; then ONE `canon_edit_order` batch (`update` existing slots, `add` only missing items). Confirm with `canon_get_service` and report warnings. Leave it `draft`.

## suggest_hymns — hymns for a theme or passage

1. For a reference, read it with `canon_bible` and note 3–5 themes.
2. Search from several angles (`canon_search_library` with theme words in every language, synonyms, the reference, category psalm).
3. Check candidates with `canon_get_library_item`: words fit, languages present, copyright / CCLI.
4. Rank by faithfulness to the text and Reformed theology, singability (hymnal number, known tune), languages available.
5. Answer: title per language, hymnal numbers, suggested stanzas, languages, where it fits, one-line reason. Only songs in the library; list important missing hymns separately as "not in your library" without their words. No writes.

## roster_check — gaps, conflicts and fairness

1. `canon_get_rota {"from": today, "to": today + weeks}`.
2. Gaps: roles below the number needed, declines without replacement, services without a roster.
3. Conflicts: assigned while unavailable, double-booked, not qualified.
4. Fairness: turns per person per team; overused and never-used qualified people.
5. Propose a table (date → role → current → proposed → reason); mention `autofill`.
6. After yes: ONE `canon_update_rota` batch (`assign`, `set_status`, `unassign` only on request, `autofill`); report the returned warnings. Away dates: `canon_set_unavailability`. Names only; reminders are sent by staff.

## proofread_service — before printing

1. `canon_get_service {"id", "include_text": true}` (find it with `canon_find_services` by date).
2. Check: empty slots; preacher / sermon title in every language / sermon_ref; missing translations; scripture errors and licence notices; catechism ranges continue the series; `in_bulletin` / `bulletin_text` / `on_slides` choices; copyright lines and CCLI on non-public-domain songs; posture; items with a role but no leader; roster warnings; status.
3. Report Must fix / Should check / For information, citing positions.
4. Offer the simple fixes as one `canon_edit_order` batch after confirmation.

## catechism_series — questions across coming services

1. `canon_search_library {"q":"Westminster Shorter Catechism","type":"texts","category":"catechism"}` (key `wsc`, 107 Q; Larger `wlc`, 196 Q). Missing → an admin imports the Westminster Standards in the Library.
2. `canon_get_library_item {"type":"text","id","parts":"index"}` for the labels; a range like `"parts":"4-6"` for wording.
3. `canon_find_services {"from": today}` for the next N Lord's Day services.
4. Group related questions (never split a question from its follow-up or a commandment / petition); keep an even pace (1–3 a week).
5. Show date → questions → topic → position in the order; ask.
6. After yes: one `canon_edit_order` per service — `update` the catechism item's `stanzas`, or `add` `{"kind":"text","ref_id":<id>,"stanzas":["4","5","6"]}`.

## translate_library — fill missing languages

1. Eligible: public-domain texts, or texts the church wrote (confirm). Never copyrighted hymns; never fabricate a translation of a hymn that has an established one — point to the hymnal. Quote scripture from the church's Bible via `canon_bible`. Prefer official wordings of creeds and catechisms.
2. If the other Chinese script has text, nothing to do.
3. Candidates: `canon_search_library {"type"}` then `canon_get_library_item` for missing languages.
4. At most 5 at a time, drafts side by side with the source; keep `L:` / `C:` / `A:` markers and part labels.
5. After yes: `canon_save_song` (stanzas replace the whole list — include every existing language) or `canon_save_text` (body replaces the stored object — include every language); add the tag `translation-draft`. Tell the user which items need review.

## member_care — birthdays and visitors

Only when members is readable and the administrator exposes personal data.

1. `canon_find_people {"view":"birthdays","days"}`.
2. `canon_find_people {"status":["visitor"]}`; ask which visitors to follow up; `canon_get_person` only for those.
3. Suggest who follows up: `canon_list_coworkers` (elders, deacons, pastors), cell-group leaders via `canon_find_groups`.
4. Answer name → occasion → suggested person. No phone numbers, addresses, ages or birth years unless asked; nothing copied elsewhere; no messages sent.

## group_overview — groups and committees

1. `canon_find_groups {"kind"}`, then `canon_find_groups {"id"}` per group.
2. Report sizes, leaders, groups without a leader, terms ending within three months, people on many groups, small or inactive groups. For committees, cross-check `canon_list_coworkers`.
3. Changes only after yes: `canon_update_group_members` (end terms with `end_date`, don't remove), `canon_save_group` (`active=false` retires a group).
