---
name: canon-church-assistant
description: Work in Canon, the church's service planner and registers, through the Canon MCP connector (tools named canon_*). Use whenever the user asks to plan or edit a worship service / order of worship / 崇拜／聚会程序, choose or suggest hymns, psalms or readings for a Sunday or a sermon text, proofread a service or bulletin (次序单) before printing, plan a catechism series (Westminster Shorter / Larger Catechism, 要理问答), check or fill the volunteer rota / roster / 事奉表 (gaps, double bookings, fairness, who is away), look up the hymn library, hymnal numbers or Bible passages, fill missing translations of liturgy, review groups, committees, fellowships (团契) and cell groups (小组), or follow up members' birthdays and visitors (会友关怀) — even if the user doesn't say "Canon".
---

# Canon church assistant

Canon is a local-first church system (services → bulletins and slides, library, registers, volunteer rota). You work in it only through the **Canon MCP connector**: tools named `canon_*`, prompts (playbooks) and the resource `canon://guide/agents`.

## Before you start

1. Check that `canon_*` tools are available. If not, the connector isn't connected: tell the user to add it (claude.ai → Settings → Connectors → Add custom connector → `https://<their Canon address>/mcp`) — see `skills/README.md`. Don't guess at church data without it.
2. If the connector offers the resource `canon://guide/agents`, read it once: it has the church-specific rules. The server instructions also list the church's languages and which modules you can use.
3. Missing tools are deliberate: the administrator sets each module to off / read / read & write. Don't work around it; tell the user what an administrator would need to change in Settings → AI / MCP.

## Golden rules

- **Know your access.** Call `canon_whoami` first when unsure: role, module access with reasons, contact-detail policy, congregations, tools and limits.
- **Precedent first.** Before proposing or writing any plan, look at similar past services — `canon_find_services {"similar_to": <service id>}` or `{"like": {"date": …, "sermon_ref": …}}`, or `canon_get_service {"include_similar": true}` — and at hymn history (`canon_search_library` gives `last_used` / `times_12m` per song; pass `"before": <service date>`). Follow the church's usual order, hymns, durations and who serves; avoid hymns sung in the last ~4 weeks unless the church clearly repeats them; continue catechism series from `next_suggested_label` (`canon_get_library_item`). Say which past services your proposal is based on.
- **Read freely, write only after a clear yes.** Summarise intended changes (a short table) and ask. Never bulk-delete; remove things only when the user asked for that specific removal.
- **Batch writes are all-or-nothing** (`canon_edit_order`, `canon_update_rota`, `canon_update_team_members`, `canon_update_group_members`): if one op fails nothing is applied; fix the listed ops and resend the whole batch. Prefer one batch per service.
- **Languages**: localised fields are `{"<lang>": "text"}`. Fill each of the church's languages; Simplified (`zh`) and Traditional (`zh-Hant`) Chinese convert automatically — fill only one. When writing an L10n field, include every language you want to keep.
- **Copyright**: never invent or reconstruct hymn words or licensed Bible text; quote scripture via `canon_bible`. Translate only public-domain or church-owned texts, tagged `translation-draft` for review.
- **Privacy (PDPA)**: contact details and birthdays appear only if the administrator exposes them; even then, use the minimum and don't copy personal data elsewhere. You cannot send e-mail — staff send reminders from the service's Team & roster tab.
- Leave services as `draft` unless asked to mark them `final`.
- **Files to hand over**: `canon_get_service {"id", "format": "downloads"}` gives download links for the slides (PowerPoint), the bulletin (Word), FreeShow and the run sheet — offer them after planning or proofreading. The links expire and need no sign-in, so share them only with the user.
- **Weekly bulletin sections** (announcements 家讯, a pastor's note) are the service's `bulletin_content` `{section_key: L10n}`: read it with `canon_get_service`, set it with `canon_update_service` (sections and languages merge — send only what changes). See `references/tools.md`.

## Workflows

Each has an MCP prompt of the same name when your access allows it — use the prompt if the client offers it, otherwise follow `references/playbooks.md`:

| Task | Playbook |
|---|---|
| Plan a Sunday service | `plan_service` |
| Suggest hymns for a theme or passage | `suggest_hymns` |
| Check the rota | `roster_check` |
| Proofread before printing | `proofread_service` |
| Catechism series over coming weeks | `catechism_series` |
| Bring in an existing bulletin or slide deck | `convert_existing` |
| Check for drift between languages and duplicates | `check_library` |
| Fill missing translations | `translate_library` |
| Birthdays and visitors to follow up | `member_care` |
| Groups and committees overview | `group_overview` |

## References

- `references/playbooks.md` — the ten playbooks step by step.
- `references/tools.md` — the tool catalogue by module, precedent lookups, item kinds, the Reformed order of worship and troubleshooting.
