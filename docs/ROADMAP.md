# Roadmap

What is planned for Canon after v0.10.0. Plans change: each release is scoped in detail when work on it starts, and the user guide describes only what has shipped.

| Version | Theme |
|---|---|
| 0.10.0 | Reporting — done |
| 0.11.0 | Hardening: archiving, storage, privacy; custom member fields |
| 0.12.0 | Meetings, Sunday school and the church calendar |
| 0.13.0 | Lending library |
| 0.14.0 | Asset register |
| 0.15.0 | Roles and permissions, second hardening round |
| 0.16.0 | Book-keeping |
| 0.16.1 | Claim forms |
| 0.17.0 | UI/UX audit |

**Scope:** Canon stays focused on worship and church records — planning services, the library, the rota, service records and the church's own administration. It is not meant to become a full church CRM: there is no per-person giving (pledges, envelopes, giving statements), and churches that use a CRM can bring their member list in by CSV.

Roles and permissions come before the finance modules, because book-keeping and claims need roles such as treasurer and claims approver. Until then, each new module gets its own on/off permission within the current administrator / editor / read-only roles.

## 0.10.0 — Reporting (done)

- A **Reports** page: pick a period and a congregation; print or export to CSV.
- **Attendance**: trends with a moving average, the same period last year, children and online.
- **Offerings**: by fund and month, by payment method, cash counts still waiting to be verified, and a monthly summary for the treasurer.
- **New visitors**: who was followed up, who came back, who joined the church.
- **Serving**: how often each person serves, who has not been rostered for a while, and roles that are hard to fill.
- **Songs and Scripture**: how often songs are sung, songs never used, a usage list for copyright licensing, and which books of the Bible have been read and preached.
- **Membership**: numbers by status, age band and congregation, and new members.
- **AI agents (MCP)**: service records become a module of their own, with **contributions** (offerings and cash counts) as a separate permission nested inside it. Both are off until an administrator turns them on.

## 0.11.0 — Hardening: archiving, storage, privacy

- **Archive** data older than five years (service records, offerings, the change log, the MCP activity log, and later library loans) into a separate read-only archive file per period. Archived data is kept, not deleted: charities usually have to keep financial records for years.
- Administrators can **open an archive** in Canon, read-only. Archive files are included in backups.
- The archive age is **set per kind of data**. Visitors' contact details have their own, shorter setting and are erased rather than archived (personal data is kept only as long as it is needed).
- A **Storage** panel in Settings: database size, what uses the space, how fast it grows, and an early warning.
- **Custom fields on members**: the church adds its own fields (text, date, yes/no, a choice from a list), shown on the member page, usable in filters and CSV import/export. A field can be marked sensitive: then read-only accounts and AI agents don't see it unless personal data is shared.
- **Read-only accounts no longer see members' contact details or pastoral notes** (phone, e-mail, address, notes) — in screens, searches and exports. Birthdays show the day and month only, without the year.
- A **log of who viewed member records**, and a **security checklist** in Settings: disk encryption, backup encryption, where backups are kept, and the retention settings.
- **Release discipline**: tests, type checking and the production build in CI on every push; versioned releases with upgrade notes; a supported-runtime list.
- **Safe updates**: a version-aware update on Windows that always rebuilds the web app with the server (no old screens with a new server); upgrade tests from older database versions; restore tested against older backups.
- **Editing conflicts**: two people saving the same service or record at once get a clear "changed by someone else" message instead of silently overwriting each other.
- **Refactoring long files** (no change in behaviour; tests first, then split by workflow): the service editor (about 1,500 lines: order of service, team & roster, slides), the presentation screens and the bulletin and slide outputs (900+ each), the Word export, the members page, the settings page (each tab in its own file), the records and reports pages (list, editor, declaration and signature pad; one file per report and shared charts), the sign-in / AI connection code, the API routes (records, reports, services and AI administration into their own route files, as the others already are) and the database migrations (one file per version).
- **Content rights**: Bible versions and hymn texts list their source, edition and where they may be used, instead of a blanket "public domain".

## 0.12.0 — Meetings, Sunday school and the church calendar

- **Meetings**: fellowship meetings, cell groups, prayer meetings and Sunday school classes become a lighter kind of service, linked to their group: date, time, place, the person chairing, topic or passage. An order of service, bulletin and slides stay optional. The planner shows services and meetings apart.
- **Records like service records**: a headcount, new visitors with their follow-up, notes for the leaders (the chair notes any absence worth following up), and offerings with the same cash count, declaration and signing.
- **Sunday school**: classes are groups (teachers lead, pupils are members, with an age range); each session is a meeting with its record.
- **Recurring meetings**: created ahead from the group's meeting pattern (for example every Friday at 8 pm), so the chair just opens tonight's meeting.
- **Reports** per group and kind of meeting: attendance trends, visitors, offerings.
- **Church calendar**: services, meetings and other church events in one month / week / list view, by congregation and group.
- AI agents see meetings and their records under the same Service records and Offerings permissions.

## 0.13.0 — Lending library

A library for the church's books, DVDs and curricula, lent to members. It will be called **Lending library**, separate from the existing **Library** of songs, liturgy and Bibles. Catalogue (title, author, ISBN, category, language, shelf), numbered copies with QR labels, loans with due dates, renewals and returns, an overdue list, CSV import, and a librarian permission.

## 0.14.0 — Asset register

The church's equipment and property: what it is, where it is, who looks after it, when it was bought and for how much, its condition, and maintenance due. Shares item numbers and QR labels with the lending library.

## 0.15.0 — Roles and permissions, second hardening round

Roles reorganised around what churches actually do (for example treasurer, librarian, claims approver), with permissions per module and per field, before the finance modules arrive — one permission model shared by the web app and AI agents. This includes:
- finer control over who sees which member details, beyond the read-only rule added in 0.11;
- deciding whether congregations should also limit what people can see (today they are filters, not walls);
- for signatures and approvals, telling apart "two people signed on one device" from "two people each approved from their own account" before claims rely on it;
- approved, dated versions of a service's bulletin and slides.

Plus a second round of hardening.

## 0.16.0 — Book-keeping

Simple accounts for the church, plus **project accounts** for special events (a camp, a building fund, a conference). Verified offerings from service records can flow in as income, so nothing is typed twice.

## 0.16.1 — Claim forms

Expense claims with receipts, approval and on-screen signatures; approved claims become expenses in the main or a project account.

## 0.17.0 — UI/UX audit

A review of the whole app for clarity, consistency, accessibility and use on phones and tablets.

## Later

- **Child check-in and pick-up** for Sunday school: name labels and a collection code for the guardian.
