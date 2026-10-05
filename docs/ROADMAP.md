# Roadmap

What is planned for Canon after v0.11.0. Plans change: each release is scoped in detail when work on it starts, and the user guide describes only what has shipped.

| Version | Theme |
|---|---|
| 0.10.0 | Reporting — done |
| 0.11.0 | Hardening: archiving, storage, privacy; custom member fields — done |
| 0.12.0 | Meetings, Sunday school and the church calendar |
| 0.13.0 | Roles and permissions, optional modules, second hardening round |
| 0.14.0 | Lending library and asset register (two optional modules, one release) |
| 0.15.0 | Book-keeping: double-entry accounts (optional module) |
| 0.15.1 | Claim forms |
| 0.16.0 | UI/UX audit |

**Scope:** Canon stays focused on worship and church records — planning services, the library, the rota, service records and the church's own administration. It is not meant to become a full church CRM: there is no per-person giving (pledges, envelopes, giving statements), and churches that use a CRM can bring their member list in by CSV.

**Optional modules:** the lending library, the asset register and book-keeping (with claim forms) are optional. A church turns each on or off during onboarding or later in Settings. A module that is off is hidden from the sidebar, refused by the server and absent from AI agents' tools. Turning it off keeps its data, so turning it on again brings everything back.

**Order:** roles and permissions come before the new modules, so that each module (librarian, equipment keeper, treasurer, claims approver) plugs into one permission model instead of adding its own on/off switch to be reworked later.

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

## 0.12.0 — Meetings, Sunday school and the church calendar

- **Meetings**: fellowship meetings, cell groups, prayer meetings and Sunday school classes become a lighter kind of service, linked to their group: date, time, place, the person chairing, topic or passage. An order of service, bulletin and slides stay optional. The planner shows services and meetings apart.
- **Records like service records**: a headcount, new visitors with their follow-up, and notes for the leaders (the chair notes any absence worth following up).
- **Offerings are optional**, set on each meeting:
  - A new meeting copies the setting from the group's previous meeting (as duplicating does), so it is usually set once and then carried forward.
  - With an offering, the record has the same cash count, declaration and signing as a service.
  - Without one, the record shows no offering section, and the meeting stays out of the offerings reports and the cash counts waiting to be verified.
- **Group leaders record their own meetings**: a group's leaders can open and record that group's meetings without being editors. They don't see other groups' records or the rest of the register. This is the first piece of the 0.13 permission model.
- **On a phone**: the meeting record and its cash count work on a phone, so the chair can fill them in on the night.
- **Sunday school**: classes are groups (teachers lead, pupils are members, with an age range); each session is a meeting with its record.
- **Recurring meetings**: created ahead from the group's meeting pattern (for example every Friday at 8 pm), each copying the previous meeting's details (place, chair, offering or not), so the chair just opens tonight's meeting.
- **Reports** per group and kind of meeting: attendance trends, visitors, offerings.
- **Church calendar**: services, meetings and other church events in one month / week / list view, by congregation and group.
- AI agents see meetings and their records under the same Service records and Offerings permissions.

## 0.13.0 — Roles and permissions, optional modules, second hardening round

Roles reorganised around what churches actually do (for example treasurer, librarian, equipment keeper, claims approver, group leader), with permissions per module and per field — one permission model shared by the web app and AI agents. This includes:
- finer control over who sees which member details, beyond the read-only rule added in 0.11;
- deciding whether congregations should also limit what people can see (today they are filters, not walls);
- for signatures and approvals, telling apart "two people signed on one device" from "two people each approved from their own account" before claims rely on it;
- approved, dated versions of a service's bulletin and slides;
- **optional modules**: turning modules on and off in onboarding and Settings, ready for 0.14 and 0.15.

The second round of hardening includes:
- **encrypted backups**;
- what was carried forward from 0.11: archive ages per kind of data, and per-item content rights.

Candidates to decide when the round is scoped:
- running Canon as a Windows service instead of a console window;
- two-factor sign-in for administrators;
- limits on repeated sign-in attempts;
- letting a member's own data be exported or erased on request (PDPA).

## 0.14.0 — Lending library and asset register

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

## 0.15.0 — Book-keeping

An optional module of proper **double-entry** accounts, the kind charity accounts and auditors expect:
- **Chart of accounts:** assets, liabilities, funds, income and expenses, starting from a simple church template that the treasurer can adjust.
- **Journal:** every transaction is a balanced journal entry (debits equal credits). Posted entries are never edited: a mistake is corrected by a reversing entry, so the books keep their history.
- **Funds and projects:** restricted and unrestricted funds, and **project accounts** for special events (a camp, a building fund, a conference).
- **Offerings flow in:** verified offerings from service records become journal entries, by fund and payment method, so nothing is typed twice.
- **Bank reconciliation** against statements.
- **Period close:** a closed month or year can't be changed.
- **Reports:** trial balance, income and expenditure, balance sheet, and fund and project statements, printable and exportable to Excel.

## 0.15.1 — Claim forms

Part of the book-keeping module: expense claims with receipts, approval and on-screen signatures; approved claims become expenses in the main or a project account.

## 0.16.0 — UI/UX audit

A review of the whole app for clarity, consistency, accessibility and use on phones and tablets.

## Later

- **Child check-in and pick-up** for Sunday school: name labels and a collection code for the guardian.
