# Canon

*"Let all things be done decently and in order."* — 1 Corinthians 14:40
*凡事都要规规矩矩地按着次序行。* — 哥林多前书 14:40

**Canon** is a local-first, multilingual system for running a church: plan the service, print the bulletin, project the slides, and keep the registers. It is self-hosted — on an office PC, a server, a NAS or any Docker host — with no cloud account, so the church's data stays under the church's control. Staff use it in a browser. AI assistants such as Claude can connect through a permission-controlled MCP server.

It was designed with a bilingual (English / 中文) Reformed and Presbyterian congregation in mind, but its languages, liturgies and templates are all configurable.

The name comes from the Greek *κανών*: a measuring reed, a rule (Ezek 40:3; Gal 6:16).

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![Node 22.18+](https://img.shields.io/badge/node-%E2%89%A522.18-417e38)

---

## Features

**Worship**
- **Service planner.** Start from a template. Insert hymns, psalms, readings, creeds, catechism questions and prayers anywhere in the order, then reorder by dragging. Clock times run down a timeline. Each item has a leader or role and a posture (stand / sit), and you can use empty slots to fill in later.
- **Library.**
  - **Hymns** with hymnal numbers: one song can be in several hymnbooks.
  - **Liturgical texts** in responsive format: leader / congregation / all.
  - **Long texts in numbered parts:** e.g. the Westminster Shorter Catechism, so a service can use "Q1–3".
  - **Bibles:** KJV and the Chinese Union Version 和合本 are built in, and other public-domain Bibles download in one click. You can also upload Bibles you hold a licence for, and choose the version per service or per reading.
- **Outputs, all from one plan:**
  - **Printed bulletin.** A4 landscape folded into an A5 booklet, with the pages arranged for folding automatically; other paper sizes too. **Bulletin templates** decide what prints for each kind of item (full words, first verse, or title only), plus covers, rosters, announcements and QR codes.
  - **Projector slides** with a presenter view. **Slide themes** cover colours, background, fonts per script and custom CSS, with a live preview.
  - **Timed run sheet** for the team, a **read-only share link**, a **Word document**, and a **FreeShow** project.
- **Liturgical calendar:** season colours (optional) and the four styles of bulletin cover.

**People**
- **Groups:** committees (with roles and terms), fellowships, cell groups and ministries.
- **Members:** households, membership, baptism, profession of faith, and titles such as 弟兄 / 姐妹 / Bro. / Sis.
- **Co-workers:** pastors, elders, deacons and staff, tagged with their committees.
- **Volunteer rota:** teams and members, roles, away dates, fair auto-fill, warnings, and manual e-mail reminders through your own SMTP server.

**Everywhere**
- **Languages.** The church chooses its worship languages, primary first: English, 简体中文, 繁體中文, Bahasa Melayu, Bahasa Indonesia, Tamil and more. Each service shows up to three side by side. Simplified and Traditional Chinese convert automatically, and the interface is in English, 简体 and 繁體.
- **Excel import and export** (CSV) for every register and library section. It comes with downloadable templates, a preview before saving, and automatic handling of files Excel saved in a Chinese encoding.
- **AI / MCP.** An OAuth 2.1 MCP server that claude.ai can connect to. Administrators set each module to *off / read / read & write*, for example hiding the member register for PDPA. Every call is audit-logged.

## Quick start

### Windows office PC
1. Install **Node.js 22.18 or newer** (LTS) from <https://nodejs.org>.
2. Download or clone this repository, then double-click **`start-canon.bat`**. The first run installs dependencies and builds the app.
3. Open <http://localhost:3000>. Setup asks for your church's languages and creates the administrator account. Then onboarding offers the public-domain Bibles for those languages.
4. Other computers on the office network open `http://<office-pc-name>:3000`.

Keep the "Canon server" window open while Canon is in use. To start Canon automatically, add `start-canon.bat` to Windows Task Scheduler with the trigger "At log on".

### Docker (server, NAS or cloud VM)
```bash
docker compose up -d
```
See [docs/DOCKER.md](docs/DOCKER.md). It covers updates, backups and restore, plus an optional Cloudflare Tunnel for a public address.

### From source
```bash
npm install
npm run dev          # API on :3000, web app on :5173 (proxied)
```

## Documentation

- **User guide** for church office staff: [English](docs/guide/en.md) · [简体中文](docs/guide/zh.md) · [繁體中文](docs/guide/zh-Hant.md). It is also built into the app: **Guide**, at the bottom of the sidebar.
- **Agent handbook** for Claude and other MCP agents: [docs/AGENT-PLAYBOOKS.md](docs/AGENT-PLAYBOOKS.md). The MCP server serves it as the resource `canon://guide/agents`, and offers its playbooks as prompts (`plan_service`, `suggest_hymns`, `roster_check`, `proofread_service`, `catechism_series`, `translate_library`, `member_care`, `group_overview`).
- **Claude skill**: [skills/](skills/README.md) — upload `skills/canon` to claude.ai or copy it into Claude Code.
- **Docker**: [docs/DOCKER.md](docs/DOCKER.md) · **Content to review before first use**: [docs/CONTENT-REVIEW.md](docs/CONTENT-REVIEW.md).

## Using Canon

- **Plan a service:** Services → New service → pick a template. Then:
  - use the **＋** between items to insert anything;
  - open an item to choose the hymn, verses, reading, version or catechism questions;
  - use the **Team & roster** tab to assign people.
- **Print and project:** the planner's *Outputs* bar has Bulletin, Slides, Run sheet, Word and FreeShow. Bulletin and slide looks are set under **Service Planner → Bulletin templates / Slide templates**; QR codes and notes for both live in **Library → QR codes & notes**.
- **Import from Excel:** each register and library screen has **Download template · Export · Import CSV…** buttons.
  - Save from Excel as **CSV UTF-8**; Chinese-encoded files are detected anyway.
  - The import shows a preview and saves nothing until you confirm. It is all-or-nothing unless you choose to skip bad rows.
  - Rows are matched to existing records: members by id or name + birth date, hymns and texts by key or title. Importing the same file again is therefore safe.
- **Bibles:** Settings → Languages. Download public-domain versions with one click, or use **Add a Bible** to upload a version your church holds the licence for (ESV, 和合本修订版, 新译本, Alkitab…).
  - **CSV:** one verse per row, `book,chapter,verse,text`. Books can be numbers 1–66, English names or abbreviations (`Gen`, `1 Cor`) or Chinese names (`创世记`, `林前`, `創`). Use numbers for other languages. `reference,text` rows (`John 3:16`) also work.
  - **JSON:** the scrollmapper format is also accepted.
  - The upload previews missing books and unreadable rows before importing, and there is a downloadable template.
  - In the planner, choose versions in the service details (per language) or on an individual reading. Library → Bible compares up to four versions side by side.
  - Some publishers limit how many verses may be printed or projected; Canon reminds you.
- **E-mail reminders:** configure SMTP under Settings → E-mail. Then in the planner, use *Team & roster → Send reminders*, which previews each person's message in their preferred language before sending. Nothing is ever sent automatically.

## Connecting Claude (MCP)

1. **Settings → AI / MCP:** enable the server and choose each module's access. By default, members are hidden and contact details are redacted.
2. claude.ai needs a public **https** address. Run a tunnel, e.g. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared tunnel --url http://localhost:3000`). Paste its address into **Settings → AI / MCP → Public address**, press **Check**, then **Save**.
3. In claude.ai, go to **Settings → Connectors → Add custom connector** and paste `https://<your-host>/mcp`. Leave the client ID blank, then sign in with a Canon account and approve.
4. Connected agents and the activity log are listed under Settings → AI / MCP, where each one can be revoked.

For each module, access is the most restrictive of three things:
- the admin's module setting;
- the token's scope (`canon:read` or `canon:write`);
- the user's current role (a viewer only ever gets read access).

Tools an agent isn't allowed never appear in its tool list. There are 25 tools in all. Batch tools (`canon_edit_order`, `canon_update_rota`, …) apply all-or-nothing. Agents can't send e-mail, delete people, or see accounts, settings or OAuth data.

## Configuration

Everything a church office needs is in **Settings**. Environment variables are only optional overrides for IT administrators:

| Variable | Default | Purpose |
|---|---|---|
| `CANON_PORT` | `3000` | HTTP port |
| `CANON_HOST` | `0.0.0.0` | Interface to listen on. The default lets the office LAN reach Canon. |
| `CANON_DB` | `data/canon.db` | SQLite database file |
| `CANON_PUBLIC_URL` | — | Forces the public address. Normally set in Settings → AI / MCP instead. |
| `CANON_TRUST_PROXY` | — | Honours `X-Forwarded-*`. This is automatic once a public address is set. |

## Backups

**Settings → Backups** (administrators): **Back up now**, automatic daily or weekly backups that keep the newest N, a backup folder you can point at a USB drive or a synced folder (with **Check**), and download / delete. From the command line:

```bash
npm run backup                      # → backups/canon-YYYY-MM-DD-HHMM.db (safe while running)
npm run backup -- D:\CanonBackups   # to a USB drive or synced folder
```

To restore, stop Canon and copy a backup over `data/canon.db`, deleting any `canon.db-wal` / `canon.db-shm` next to it. Docker users: see [docs/DOCKER.md](docs/DOCKER.md).

## Development

```bash
npm install
npm run dev            # API (watch) + Vite
npm test               # node:test — OAuth/MCP, CSV, groups, e-mail, presentation, Bible uploads
npm run typecheck
npm run build          # regenerates the Traditional Chinese UI dictionary, then builds the web app
```

- **Stack:** Node 24 runs the TypeScript server directly (type stripping, no build step), with Express 5 and `node:sqlite`. The web app is React 19 + Vite + dnd-kit, styled with hand-written CSS (no UI framework).
- **Layout:**

  | Path | Contents |
  |---|---|
  | `server/repo/*` | business logic |
  | `server/routes/*`, `server/api.ts` | REST |
  | `server/mcp.ts`, `server/mcp-tools/*` | the MCP server and tool table |
  | `server/oauth.ts` | the OAuth authorization server |
  | `server/repo/render.ts` | turns a service into one fully resolved multilingual structure that every output uses |
  | `server/csv/*` | import/export specifications |
  | `shared/*` | types, schemas, language registry, Bible references, liturgical calendar |
  | `src/*` | the web app |

- **Database:** migrations are appended to `server/db.ts`; never edit a shipped one.
- **Translations:** the English UI text is the key. Simplified Chinese lives in `src/i18n/*.ts`, and Traditional Chinese is generated by `npm run i18n`.
- **Conventions:**
  - Server files use `.ts` import extensions and `import type`.
  - No enums or namespaces, so Node's type stripping works.
  - Put scratch files in `_workings/` (git-ignored).

Contributions are welcome. Every change that users or AI agents can see must also update the guide (`docs/guide/en.md` and `zh.md`) and the agent playbooks (`docs/AGENT-PLAYBOOKS.md`, `skills/canon/`). `tests/docs-coverage.test.ts` checks the basics. Please open an issue to discuss larger changes first, and keep `npm test` and `npm run typecheck` green.

## Content and copyright

- **Bundled texts are all public domain:**
  - the KJV (1769) and the Chinese Union Version 和合本 (1919), from [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases);
  - the Westminster Confession and Catechisms (1647), from [NonlinearFruit/Creeds.json](https://github.com/NonlinearFruit/Creeds.json);
  - historic creeds;
  - hymns written before 1929.
- **Material your church adds** stays under its owners' copyright: hymns from licensed hymnals, Bible versions such as ESV or 和合本修订版, logos and images. Use it under your own licences, e.g. CCLI. Some Bible publishers limit how much may be printed or projected.
- **Review before use:** [docs/CONTENT-REVIEW.md](docs/CONTENT-REVIEW.md) lists wordings a church should check against its own practice.

## Privacy

- Member data stays in your own database (`data/`, git-ignored). Never commit it.
- Share links show names and the order of service, never contact details.
- AI agents see member contact details and birthdays only if an administrator explicitly allows it. The audit log stores argument names, not the personal data itself.
- Read-only accounts can't export personal data.

## License

[MIT](LICENSE) © 2026 moonlight-lupin. Third-party content keeps its own licence, as listed above and in the app under *About Canon*.
