# Canon

*"Let all things be done decently and in order."* — 1 Corinthians 14:40
*凡事都要规规矩矩地按着次序行。* — 哥林多前书 14:40

**Canon** is a local-first, multilingual system for running a church: plan the service, print the bulletin, project the slides, keep the registers and records, and keep the church's books. It runs on an office PC, a server or any Docker host, with no cloud account, so the church's data stays under the church's control. Staff use it in a browser, and AI assistants such as Claude can connect through a permission-controlled MCP server.

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
- **Resources** (optional):
  - a lending library of books, DVDs and curricula: ISBN lookup, numbered copies with QR labels, loans, overdue lists and e-mail reminders;
  - an asset register of the church's equipment: where it is, who looks after it, photos and receipts, maintenance.
- **Meetings and the calendar:**
  - fellowship meetings, cell groups, Sunday school and one-off meetings, each with its own leader and a record (an offering only when one is taken);
  - leaders can record their own meetings with their own accounts;
  - recurring meetings created ahead;
  - a church calendar of services, meetings and events.
- **Records:**
  - attendance and new visitors, with a visitor form on their phones;
  - offerings, with a cash count signed on paper or on screen;
  - reports to print or export to Excel.
- **Book-keeping** (optional):
  - double-entry books kept by fund (General, Missions, Building …), starting from a church chart of accounts, with projects, ministries and congregations;
  - verified offerings drafted into the books, PayNow and transfers included;
  - bank statements imported from the bank's CSV or Excel file and reconciled, several lines to one entry when the totals agree;
  - journals numbered when posted and never changed afterwards (corrected by a reversal), months closed, every change in the audit trail;
  - reports: income and expenditure, balance sheet, fund movements, trial balance, ledgers, and an export for the accountant.
- **Expense claims:**
  - members claim on their phones, with a photo of each receipt, and sign on screen;
  - named approvers approve, two above an amount if the church wants, never their own claims;
  - approval and payment are drafted into the books.
- **Everywhere:**
  - worship languages side by side (Chinese Simplified ↔ Traditional automatic); the interface is in English, 简体 and 繁體;
  - Excel import and export;
  - a change log;
  - backups (encrypted, also to Google Drive) and archives;
  - roles a church can adjust, congregation walls and optional modules;
  - an audit-logged MCP server for AI agents, following the same roles. Claude can read the books and draft journals and expense claims (from photos of receipts); a person always posts and approves.

The [user guide](docs/guide/en.md) describes all of it.

## Quick start

**Windows office PC**
1. Install **Node.js 24 or newer** (LTS) from <https://nodejs.org>.
2. Download or clone this repository, then double-click **`start-canon.bat`**. The first run installs and builds everything.
3. Open <http://localhost:3000>. Setup asks for your church's languages and creates the administrator account. Other computers on the office network open the address the Canon window shows, e.g. `http://192.168.1.20:3000`.

Keep the "Canon server" window open while Canon is in use, or run Canon in the background, starting with Windows, with an icon by the clock showing its address: see [docs/ADMINISTRATION.md](docs/ADMINISTRATION.md#in-the-background-on-windows).

**Mac**
1. Install **Node.js 24 or newer** (LTS) from <https://nodejs.org>.
2. Download or clone this repository. The first time, **right-click** **`start-canon.command`** and choose **Open** (macOS asks once about a file from the internet); after that, double-click it. Choose **Allow** when macOS asks whether Node may accept incoming connections, so other computers can reach Canon.
3. Open <http://localhost:3000>. The Terminal window shows the address for other computers and keeps the Mac awake while Canon runs.

**Docker** (server, NAS or cloud VM): run `docker compose up -d`. See [docs/DOCKER.md](docs/DOCKER.md), which also explains a test copy of the church's data that sends no e-mail.

**Updating:** from 0.19.4, an administrator updates Canon from **About Canon → Updates** (it makes a backup, gets the new version from GitHub and restarts; Docker: `docker compose pull`). By hand: replace the files and start Canon again. It keeps a copy of the database before upgrading it. See [docs/UPGRADING.md](docs/UPGRADING.md).

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
| **Translating** | [CONTRIBUTING-TRANSLATIONS.md](CONTRIBUTING-TRANSLATIONS.md): add or improve a language — no code needed |

## Privacy

- Member data stays in your own database (`data/`, never in the repository).
- Read-only accounts see members' names, not their contact details or notes, and see birthdays as day and month only. Custom fields marked sensitive are hidden from read-only accounts too (editors and administrators see them).
- AI agents see personal details only if an administrator allows it, and never when acting for a read-only user.
- Where to repay a claimant is seen only by the claimant and whoever keeps the books: not by approvers, read-only accounts or AI agents.
- **Settings → Security & privacy** has a checklist, a log of who opened which member, how long visitors' details are kept, and yearly archives. Administrators can export or erase a member's personal data on request.
- Passwords are hashed with scrypt at OWASP's level (older hashes are upgraded at the next sign-in). Sign-in attempts are limited per account (a wait that grows, which doesn't hold up a browser the account signed in with before) and per address (wrong two-step codes too), and so are the endpoints AI assistants connect through; every "too many" says when to try again. A two-step code works once; two-step secrets are kept encrypted; recovery codes are long and salted, and using one is notified. Changing a password or two-step sign-in signs the account out everywhere else; a password an administrator chose must be changed at the next sign-in. A new Canon is set up only with the setup code it prints. Two-step sign-in can be required for administrators or for everyone, AI access included.
- **The data is encrypted on disk** (from 0.19.0): the database, its copies and the archived years with one key, backups with another (each backup one file holding the database and every archived year, from 0.19.3). The keys open by themselves through the Windows account Canon runs as (the macOS keychain; in Docker, a key file kept outside the data volume), so Canon still starts with the computer; a **recovery key**, printed at setup, opens the data on a new computer and restores any backup. Where the keys are protected only by the file's permissions (Docker without a key file), whoever can copy the whole data folder can read it — keep disk encryption on too, and an account for each person.

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
