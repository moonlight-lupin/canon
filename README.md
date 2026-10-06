# Canon

*"Let all things be done decently and in order."* — 1 Corinthians 14:40
*凡事都要规规矩矩地按着次序行。* — 哥林多前书 14:40

**Canon** is a local-first, multilingual system for running a church: plan the service, print the bulletin, project the slides, and keep the registers and records. It runs on an office PC, a server or any Docker host, with no cloud account, so the church's data stays under the church's control. Staff use it in a browser, and AI assistants such as Claude can connect through a permission-controlled MCP server.

It was designed with a bilingual (English / 中文) Reformed and Presbyterian congregation in mind, but its languages, liturgies and templates are all configurable. The name comes from the Greek *κανών*: a measuring reed, a rule (Ezek 40:3; Gal 6:16).

[![CI](https://github.com/moonlight-lupin/canon/actions/workflows/ci.yml/badge.svg)](https://github.com/moonlight-lupin/canon/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![Node 24+](https://img.shields.io/badge/node-%E2%89%A524-417e38)

## Features

- **Service planner:** build the order of worship from templates, with drag-and-drop, clock times, roles and postures.
- **Library:** hymns (with hymnal numbers), responsive liturgy, catechisms in numbered parts, and Bibles. KJV and 和合本 are built in; other Bibles download in one click or can be uploaded under your own licence.
- **From one plan:**
  - a printed bulletin, folded into a booklet automatically;
  - projector slides with a presenter view;
  - PowerPoint, Word and FreeShow files;
  - a run sheet and a read-only share link.
  - Bulletin and slide templates set the look.
- **People:**
  - congregations;
  - members and households;
  - co-workers;
  - groups and committees, Sunday school classes, with custom member fields;
  - a volunteer rota with e-mail reminders.
- **Meetings and the calendar:**
  - fellowship meetings, cell groups, Sunday school and one-off meetings, each with its own leader and a record (an offering only when one is taken);
  - leaders can record their own meetings with their own accounts;
  - recurring meetings created ahead;
  - a church calendar of services, meetings and events.
- **Records:**
  - attendance and new visitors, with a visitor form on their phones;
  - offerings, with a cash count signed on paper or on screen;
  - reports to print or export to Excel.
- **Everywhere:**
  - worship languages side by side (Chinese Simplified ↔ Traditional automatic); the interface is in English, 简体 and 繁體;
  - Excel import and export;
  - a change log;
  - backups and archives;
  - roles a church can adjust, congregation walls and optional modules;
  - an audit-logged MCP server for AI agents, following the same roles.

The [user guide](docs/guide/en.md) describes all of it.

## Quick start

**Windows office PC**
1. Install **Node.js 24 or newer** (LTS) from <https://nodejs.org>.
2. Download or clone this repository, then double-click **`start-canon.bat`**. The first run installs and builds everything.
3. Open <http://localhost:3000>. Setup asks for your church's languages and creates the administrator account. Other computers on the office network open `http://<office-pc-name>:3000`.

Keep the "Canon server" window open while Canon is in use.

**Docker** (server, NAS or cloud VM): run `docker compose up -d`. See [docs/DOCKER.md](docs/DOCKER.md).

**Updating:** replace the files and start Canon again. It keeps a copy of the database before upgrading it. See [docs/UPGRADING.md](docs/UPGRADING.md).

## Documentation

| | |
|---|---|
| **User guide** | [English](docs/guide/en.md) · [简体中文](docs/guide/zh.md) · [繁體中文](docs/guide/zh-Hant.md). Also built into the app: **Guide**, at the bottom of the sidebar. |
| **Running Canon** | [docs/ADMINISTRATION.md](docs/ADMINISTRATION.md): configuration, backups, connecting Claude |
| **Updating** | [docs/UPGRADING.md](docs/UPGRADING.md) · [CHANGELOG.md](CHANGELOG.md) · [docs/ROADMAP.md](docs/ROADMAP.md) |
| **Docker** | [docs/DOCKER.md](docs/DOCKER.md) |
| **AI agents** | [docs/AGENT-PLAYBOOKS.md](docs/AGENT-PLAYBOOKS.md) · [Claude skill](skills/README.md) |
| **Before first use** | [docs/CONTENT-REVIEW.md](docs/CONTENT-REVIEW.md): wordings to check against your church's practice |
| **Contributing** | [CONTRIBUTING.md](CONTRIBUTING.md) |

## Privacy

- Member data stays in your own database (`data/`, never in the repository).
- Read-only accounts see members' names, not their contact details or notes, and see birthdays as day and month only. Custom fields marked sensitive are hidden from read-only accounts too (editors and administrators see them).
- AI agents see personal details only if an administrator allows it, and never when acting for a read-only user.
- **Settings → Security & privacy** has a checklist, a log of who opened which member, how long visitors' details are kept, and yearly archives. Administrators can export or erase a member's personal data on request.
- Sign-in attempts are limited; two-step sign-in can be required for administrators; backups can be encrypted with a password.
- The database is an ordinary file: protect the computer it is on with disk encryption, and an account for each person.

## Content and copyright

- **Bundled texts are public domain in most countries** (the first administrator chooses which to add):
  - KJV (1769) and 和合本 (1919), from [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases);
  - the Westminster Standards, from [NonlinearFruit/Creeds.json](https://github.com/NonlinearFruit/Creeds.json);
  - historic creeds;
  - about 380 hymns whose words were published by 1930 and whose authors and translators died by 1955 (English words; a few with Chinese).
- **The rules differ by country:**
  - in the United Kingdom, the KJV is under the Crown's perpetual rights;
  - where copyright lasts 70 years after the author's death, an older hymn's words, translation or arrangement may still be in copyright.
- **What your church adds** keeps its owners' copyright. Use it under your own licences, such as CCLI. Each song records its copyright and CCLI number, and the *Songs sung* report lists what was used, for licence returns.

## License

[MIT](LICENSE) © 2026 moonlight-lupin. Third-party content keeps its own licence, as listed above and in the app under *About Canon*.
