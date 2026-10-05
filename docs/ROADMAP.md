# Roadmap

What is planned for Canon after v0.13.0. Plans change: each release is scoped in detail when work on it starts, and the user guide describes only what has shipped.

| Version | Theme |
|---|---|
| 0.10.0 | Reporting — done |
| 0.11.0 | Hardening: archiving, storage, privacy; custom member fields — done |
| 0.12.0 | Meetings, Sunday school and the church calendar — done |
| 0.13.0 | Roles and permissions, optional modules, second hardening round — done |
| 0.14.0 | UI/UX audit of the core (worship and records) |
| 0.15.0 | Lending library and asset register (two optional modules, one release) |
| 0.16.0 | Book-keeping: double-entry accounts (optional module) |
| 0.16.1 | Claim forms |
| 0.17.0 | Third hardening round |

**Scope:** Canon stays focused on worship and church records — planning services, the library, the rota, service records and the church's own administration. It is not meant to become a full church CRM: there is no per-person giving (pledges, envelopes, giving statements), and churches that use a CRM can bring their member list in by CSV.

**Optional modules:** the lending library, the asset register and book-keeping (with claim forms) are optional. A church turns each on or off during onboarding or later in Settings. A module that is off is hidden from the sidebar, refused by the server and absent from AI agents' tools. Turning it off keeps its data, so turning it on again brings everything back.

**Order:** roles and permissions come before the new modules, so that each module (librarian, equipment keeper, treasurer, claims approver) plugs into one permission model instead of adding its own on/off switch to be reworked later. The UI/UX audit follows straight after, while the core (worship and records) is complete and before the optional modules add more screens; those modules are built to the audited patterns. After book-keeping comes a third round of hardening rather than another audit.

## 0.10.0 — Reporting (done)

- A **Reports** page: pick a period and a congregation; print or export to CSV.
- **Attendance**: trends with a moving average, the same period last year, children and online.
- **Offerings**: by fund and month, by payment method, cash counts still waiting to be verified, and a monthly summary for the treasurer.
- **New visitors**: who was followed up, who came back, who joined the church.
- **Serving**: how often each person serves, who has not been rostered for a while, and roles that are hard to fill.
- **Songs and Scripture**: how often songs are sung, songs never used, a usage list for copyright licensing, and which books of the Bible have been read and preached.
- **Membership**: numbers by status, age band and congregation, and new members.
- **AI agents (MCP)**: service records become a module of their own, with **contributions** (offerings and cash counts) as a separate permission nested inside it. Both are off until an administrator turns them on.

## 0.11.0 — Hardening: archiving, storage, privacy (done)

Shipped as planned (see [CHANGELOG.md](../CHANGELOG.md)):
- archiving into one read-only file per year, viewable in Canon and copied with backups;
- erasing visitors' contact details after a set time;
- the Storage panel;
- custom member fields with a sensitive flag;
- read-only accounts without members' contact details or notes, and birthdays as day and month only;
- the member-view log and security checklist;
- CI on Windows and Linux;
- safe updates (a pre-upgrade copy, a newer-database guard, a start check that rebuilds what changed);
- upgrade and restore tests;
- edit-conflict protection;
- long files split into smaller modules.

Differences from the plan, carried forward to the second hardening round (0.13):
- **Archive age per kind of data:** 0.11 has one age for service records and logs, plus a separate setting for visitors' contact details.
- **Backup encryption:** the checklist says plainly that backups are not encrypted yet.
- **Content rights per item:** 0.11 states that public-domain status depends on the country (the KJV's Crown rights in the UK, hymns under life + 70). Recording each Bible version's edition and where it may be used is still to do.
- **Migrations:** they moved into one file of their own (`server/migrations.ts`) rather than one file per version.

## 0.12.0 — Meetings, Sunday school and the church calendar (done)

Shipped (see [CHANGELOG.md](../CHANGELOG.md)):
- meetings of groups and one-off meetings, each with its own leader, and records like a service's;
- an offering on or off for each meeting, carried forward;
- group leaders recording their own meetings with any account linked to them;
- Sunday school classes;
- recurring meetings from a group's pattern, created ahead;
- the church calendar with events;
- reports by services or meetings;
- record screens that work on a phone.

Changed from the plan, at the church's request:
- a meeting need not belong to a group (one-off meetings);
- each meeting has its own leader;
- the offering is chosen per meeting, not per group.

## 0.13.0 — Roles and permissions, optional modules, second hardening round (done)

Shipped (see [CHANGELOG.md](../CHANGELOG.md)):
- ready-made roles a church can adjust (administrator, pastor, editor, planner, treasurer, secretary, read-only), with access per module and per kind of member detail, shared by the web app and AI agents;
- congregation walls for accounts limited to one congregation;
- approvals from counters' own accounts, told apart from signatures on one device;
- approved, dated versions of the bulletin and slides;
- optional modules in onboarding and Settings (meetings and calendar, volunteers and rota, the visitor form);
- sign-in limits, two-step sign-in (requirable for administrators);
- encrypted backups;
- export and erasure of a member's personal data (PDPA);
- archive ages per kind (records, logs);
- Bible version licences: edition, licence and allowed uses (print, project, online), enforced on the outputs.

Differences from the plan:
- **Roles for the new modules** (librarian, equipment keeper, claims approver) come with those modules (0.15, 0.16); the permission model they plug into is in place. Group leaders keep the leader mark from 0.12.
- **Content rights** cover Bible versions; songs keep their public-domain flag and copyright line.
- **Running Canon as a Windows service** is left for the third hardening round (0.17).

## 0.14.0 — UI/UX audit

A review of the core — services, the library, members and groups, meetings, records and reports, settings — for clarity, consistency, accessibility and use on phones and tablets, while it is complete and before the optional modules add more screens. The patterns it settles (forms, lists, dialogs, phone layouts, wording in both languages) are what the lending library, asset register and book-keeping are then built with.

## 0.15.0 — Lending library and asset register

Two separate optional modules, released together because they share item numbers and QR labels.

- **Lending library**: a library for the church's books, DVDs and curricula, lent to members. It is called *Lending library*, separate from the existing **Library** of songs, liturgy and Bibles.
  - A catalogue: title, author, ISBN, category, language and shelf.
  - Numbered copies with QR labels.
  - Loans with due dates, renewals and returns, and an overdue list.
  - CSV import, and a librarian role.
- **Asset register**: the church's equipment and property.
  - What each item is, where it is and who looks after it.
  - When it was bought and for how much.
  - Its condition, and maintenance due.

## 0.16.0 — Book-keeping

An optional module of proper **double-entry** accounts, the kind charity accounts and auditors expect:
- **Chart of accounts:** assets, liabilities, funds, income and expenses, starting from a simple church template that the treasurer can adjust.
- **Journal:** every transaction is a balanced journal entry (debits equal credits). Posted entries are never edited: a mistake is corrected by a reversing entry, so the books keep their history.
- **Funds and projects:** restricted and unrestricted funds, and **project accounts** for special events (a camp, a building fund, a conference).
- **Offerings flow in:** verified offerings from service records become journal entries, by fund and payment method, so nothing is typed twice.
- **Bank reconciliation** against statements.
- **Period close:** a closed month or year can't be changed.
- **Reports:** trial balance, income and expenditure, balance sheet, and fund and project statements, printable and exportable to Excel.

## 0.16.1 — Claim forms

Part of the book-keeping module: expense claims with receipts, approval and on-screen signatures; approved claims become expenses in the main or a project account.

## 0.17.0 — Third hardening round

After book-keeping, which adds financial records and approvals: a review of security, data integrity, upgrades and backups across the whole app, including the new modules (for example the accounts' audit trail and period close, and claim approvals). Also carried forward from 0.13: running Canon as a Windows service instead of a console window.

## Later

- **Child check-in and pick-up** for Sunday school: name labels and a collection code for the guardian.
