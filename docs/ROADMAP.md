# Roadmap

What is planned for Canon after v0.17. Plans change: each release is scoped in detail when work on it starts, and the user guide describes only what has shipped.

| Version | Theme |
|---|---|
| 0.10.0 | Reporting — done |
| 0.11.0 | Hardening: archiving, storage, privacy; custom member fields — done |
| 0.12.0 | Meetings, Sunday school and the church calendar — done |
| 0.13.0 | Roles and permissions, optional modules, second hardening round — done |
| 0.14.0 | UI/UX audit of the core (worship and records) — done |
| 0.15.0 | Lending library and asset register (two optional modules, one release) — done |
| 0.15.1 | AI access: personal-data switches beside the data they protect (members' contact details; visitors) — done |
| 0.15.2 | Slide numbers on the cue sheet, a bulletin link for attendees, sheet music, links that phones can open, a role menu — done |
| 0.15.4 | Church spaces and double bookings (with a report); notes under the announcements on the bulletin — done |
| 0.15.5 | Sheet music from a phone (upload link, also from AI assistants) and in bulk; phone-sized menus — done |
| 0.15.6–0.15.10 | Export data and the library by section, QR placement, a log file, cover and closing slides, leaders only from the rota, a size per language — done |
| 0.16.0 | Languages anyone can add (translations in `locales/`), Simplified ⇄ Traditional Chinese everywhere — done |
| 0.16.1 | Backups to the church's own Google Drive — done |
| 0.17.0 | Book-keeping: double-entry accounts (optional module) — done |
| 0.17.1 | Claim forms — done |
| 0.17.2–0.17.3 | Excel exports with a title block, Excel imports, importing journals; reversals as drafts (also by AI assistants) — done |
| 0.17.4 | The v0.17.2 review's findings: bank re-imports, one offering per receipt, group matching, safe sample-data removal, congregation walls in the library and asset register, Excel 1904 dates — done |
| 0.18.0 | Third hardening round: three independent reviews of the books, claims, upgrades and Docker fixed with tests; Canon in the background on Windows with an icon by the clock; chart of accounts import; signing on a phone; a test-copy switch — done |
| 0.19.0 | Encryption: the database and its copies encrypted with their own key, backups with a separate key, a recovery key shown once at setup, Canon locked until it is given; Encrypt now for older installs; two independent security reviews fixed — done |
| 0.19.1 | Dependencies installed without compiling (the Docker image builds again) — done |
| 0.19.2 | The v0.19.1 review: sample data marks its own rows, an explicit key file fails closed, restoring by hand with encryption (npm run restore-backup) — done |
| 0.19.3 | A complete backup package: the database and the archived years in one file, sent to Google Drive whole, restored in the app and by hand — done |
| 0.19.4 | Updates from inside Canon (Windows and Mac; Docker checks only), a new launcher; claims follow congregations and approvers are told when the office typed in where to repay — done |
| 0.19.5 | Disaster recovery through Google Drive tested end to end; the Docker image built and started for every change — done |
| 0.19.6 | Flowcharts in the guide; a receipt viewer for claims; a compact roles table — done |
| 0.19.7 | A sample church that does everything (services, records, meetings, calendar, library, assets, books, claims), removed exactly — done |

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
- **Running Canon as a Windows service** is left for the third hardening round (0.18.0).

## 0.14.0 — UI/UX audit (done)

Shipped (see [CHANGELOG.md](../CHANGELOG.md) and [UI-AUDIT-0.14.md](UI-AUDIT-0.14.md)):
- contrast to WCAG AA;
- a grouped planner bar;
- the planner and dashboard on phones;
- a Planner section in the sidebar, with sections that fold;
- one language switch per section, with field tabs to hover;
- one ⋯ menu on the template pages;
- a profile tab and grouped tabs in Settings;
- landmarks, headings, labels and larger targets;
- a visitor form for meetings;
- the mark as one image file.

Still to do as screens are touched: inline layout styles moved to shared classes. Still to test: drag-and-drop in the planner on a real touch device.

The original plan: a review of the core — services, the library, members and groups, meetings, records and reports, settings — for clarity, consistency, accessibility and use on phones and tablets, while it is complete and before the optional modules add more screens. The patterns it settles (forms, lists, dialogs, phone layouts, wording in both languages) are what the lending library, asset register and book-keeping are then built with.

## 0.15.0 — Lending library and asset register (done)

Two separate optional modules, released together because they share item numbers and QR labels. Shipped with ISBN lookup, e-mail due-date reminders, photos and receipts, and a maintenance log. Not in this release (ideas for later): holds / reservations, a stocktake mode, lending equipment out, disposal records for assets.

- **Lending library**: a library for the church's books, DVDs and curricula, lent to members. It is called *Lending library*, separate from the existing **Library** of songs, liturgy and Bibles.
  - A catalogue: title, author, ISBN, category, language and shelf.
  - Numbered copies with QR labels.
  - Loans with due dates, renewals and returns, and an overdue list.
  - CSV import, and a librarian role.
- **Asset register**: the church's equipment and property.
  - What each item is, where it is and who looks after it.
  - When it was bought and for how much.
  - Its condition, and maintenance due.

## 0.15.1 — AI access: personal-data switches beside the data they protect (done)

In Settings → AI / MCP, the separate **Expose member contact details & birthdays** box goes; each kind of personal data gets a switch nested under its module, as **Offerings** sits under **Service records**:
- **Members register → Contact details & birthdays** (Off / Shared): members' phone, e-mail, address, birth dates, notes and reasons for absence; co-workers' phone and e-mail; household addresses. The PDPA notice becomes its "?" tip and one short line.
- **Service records → Visitors** (Off / Names & follow-up / With contact details):
  - Off: attendance numbers only (how many visitors, no names).
  - Names & follow-up: names, how they heard of the church, follow-up status; with Service records at Read & write, agents may record visitors and update follow-up.
  - With contact details: also phone, e-mail and prayer request (what the keep period erased stays gone).
- A nested switch is off whenever its parent module is off — stricter than today for co-workers' and visitors' details; say so in the changelog.
- Existing settings carry over: the old box on → Contact details on and Visitors with contact details (when Service records is on); off → Contact details off and Visitors names & follow-up.

## 0.15.2 — Cue sheet slide numbers, attendee bulletin link, sheet music, role menu (done)

- **Slide numbers on the run sheet (AV cues)**: each item gives its slide range and where each part starts, e.g. "Slides 7–14 · 1 → 7 · R → 8, 11, 14 · 2 → 10" (a refrain sung after each stanza lists every place it comes). Numbers are counted the way the deck is built (the service's slide template and languages), so they match the slide-number footer and **number + Enter** on the slides (which already works, in the slides window and the presenter view). The sheet says the numbers hold for the service as it is now: print it once the service is final.
- **Bulletin link for attendees, one per service**: a public, read-only, phone-friendly page — the order of service with full hymn words, readings and announcements, with a language switch — and no serving team, leaders' contact details or notes. Switched on per service, with its QR code printed on that week's bulletin and/or shown on a slide (0.15.3: its own slide straight after the title slide); needs the public https address. Separate from the team's **Share** link, which keeps showing who is serving.
- **Roles: a ⋯ menu as on templates**:
  - **Duplicate** any role (ready-made ones too) as a starting point for the church's own.
  - **Archive** a role no account uses: it leaves the role picker for accounts; **Restore** brings it back. A role still in use asks to move its accounts first; Administrator can't be archived.
  - **Delete** stays for the church's own roles that were never used.
  - **Edit** moves into the same menu.
- **Sheet music** (added while building): scans or photos (or a PDF) kept with each song in the Library; **Outputs → Sheet music** in the planner, beside the run sheet, shows the service's songs in order with theirs.
- **Links other people open** (added while building): share links, the bulletin link, the visitor form, team e-mails and QR labels use the public address, else this computer's network address — never "localhost" or the computer's name.

## 0.17.0 — Book-keeping

An optional module, **Accounts**, where the treasurer keeps the church's books. Decided with the church (2026-10-07):

- **Canon is the main books**, with clean exports: Excel/CSV reports and a journal export that an accountant can import into other accounting software (Xero, QuickBooks, Odoo).
- **Double-entry.** Every entry balances (debits equal credits). Day to day it is on a cash basis (receipts and payments); manual journals allow accruals such as payables, prepayments and depreciation where a church needs them.
- **Every line is tagged with a fund:** unrestricted, restricted, designated or endowment. Lines may also carry a **project** (camp, building works), a **congregation** and a **ministry / department**. Statements can be drawn per fund, per project, per congregation and per ministry. Moving money between funds is a journal.
- **Chart of accounts:** a church template to start from (editable; also importable from CSV). The books start on a chosen date with **opening balances** per account and fund, entered as one opening journal that must balance.
- **Posting:** a treasurer drafts and posts. Posted entries are never edited: a mistake is corrected by a reversing entry. Months and years can be **closed and locked**. The year-end close moves the year's surplus into each fund's balance. Every action is in the audit trail.
- **Offerings flow in.** When a cash count is verified, Canon drafts a journal for that service, by fund and payment method: cash to cash-in-hand, PayNow or transfer to the bank. The treasurer reviews the drafts and posts them.
- **Other currencies:** the books are in the church's currency. A foreign amount is booked at its converted value, with the original amount and rate kept on the line. Foreign cash waiting to be exchanged has its own account.
- **Bank reconciliation:** import the bank's CSV statement. The column layout is remembered per bank account. Canon suggests matches to the books; an unmatched line (bank charges, interest) becomes a new entry. Each statement gets a reconciliation report.
- **Reports**, generic charity format, printable and exportable:
  - trial balance and general ledger;
  - income and expenditure, by fund;
  - balance sheet, with fund balances;
  - fund movements;
  - project, congregation and ministry statements.
- **AI assistants** may read the books and create **draft** journals (e.g. from a pasted statement or receipts) for the treasurer to review. They never post, and never change a posted entry.

## 0.17.1 — Claim forms

Part of the book-keeping module: expense claims with receipts, approval and on-screen signatures; approved claims become expenses in the main or a project account.

Decided (2026-10-08):
- **Who claims:** anyone, on their phone, by a link or QR code (signing in with a code e-mailed to their member record, like the lending library's self-service); account holders also inside Canon.
- **A claim has lines:** several receipts per claim, each line with its date, description, amount, receipt photos or PDFs, and a suggested expense account, fund, ministry or project.
- **Approvers are named people, not a role** (each account has one role): members listed in the claims settings, optionally for some ministries only, with an optional amount limit.
  - They approve on their phone the same way, or in Canon, with an on-screen signature.
  - Nobody approves their own claim. If the approver is also the person who pays, it is allowed but marked on the claim and in the report.
- **Large claims:** an optional amount above which two different approvers must approve (off by default).
- **The books:** approval drafts Dr expense / Cr 2100 Claims to repay; payment drafts Dr 2100 / Cr bank, matched on the bank statement. The treasurer posts both, as for every journal.
- **AI assistants:**
  - **Read:** claims and their status.
  - **Draft:** a claim from receipts the user shows them; they read the photos in the chat.
  - **Return a link:** a connector can't receive the photo itself, so the reply is the claim's link. The claimant opens it on a phone, checks the lines, attaches the receipts and signs.
  - **Never:** submit without the claimant's signature, approve or pay.

## 0.18.0 — Third hardening round (released)

After book-keeping, which adds financial records and approvals: a review of security, data integrity, upgrades and backups across the whole app, including the new modules (for example the accounts' audit trail and period close, and claim approvals). Also carried forward from 0.13: running Canon as a Windows service instead of a console window.

**Financial correctness first.** An external review of v0.17.2 (8 October 2026) confirmed these. They block calling Canon the church's main books, so they come before anything else:

1. **Stop data loss and duplicate money:**
   - **Bank re-imports:** overlapping imports must not drop a genuine second transaction (same date, amount and description). Use the bank's reference where there is one, and count occurrences where there isn't.
   - **One offering per receipt:** a bank receipt added to a service's offerings is added once only, however often the action is repeated.
   - **Sample data cleanup:** it never deletes what has gained real records (a verified cash count, posted journals). Sample rows carry a lasting marker, so a reused id can never delete a real member.
2. **Complete bank reconciliation:** group matching. Several statement lines can match one book line (PayNow gifts against one offering line), and one statement line can match several book lines (a deposit covering several services), when the totals agree.
3. **Close privacy and interchange gaps:**
   - Library loans and asset custodians respect congregation walls in every list, detail and export.
   - The Excel reader honours the 1904 date system.
4. **Validate the whole financial cycle** on a fictional reference church, with expected balances checked by a test: opening balances, offerings, claims (approval, expense, payment), bank clearance, corrections, a month locked and reopened, the year's end, and the accountant's export.
5. **Recovery and operation:** upgrade and restore with posted journals, claims and bank links; encrypted Drive upload and restore; the Windows service; signing on a phone.

Items 1 and 2 shipped in 0.17.4. Canon's books can now be a church's main books in a **supported pilot**: a named person who looks after the computer, a treasurer, a reconciled month and a restore drill done in front of them, before the existing books are retired.

**Done so far in 0.18.0:**
- the reference church's whole financial cycle as a test, against figures worked out by hand;
- an encrypted backup of the books restoring exactly;
- the chart of accounts and the funds importable from Excel or CSV;
- Canon in the background on Windows (a Task Scheduler task) with an icon by the clock, and a proper stop (the icon's Exit, Ctrl+C, `docker stop`);
- signing on a phone: one finger draws, the claimant's own name on the signature;
- three independent reviews (security, the books' integrity, upgrades / backups / Docker), each finding fixed with a test: see the changelog;
- a test copy switch (`CANON_TEST_COPY=1`) for trying new versions on the church's data, e.g. on a NAS.

**Found by the reviews, left for later:**
- ~~Archived years are not sent to Google Drive, and the in-app restore doesn't bring them back.~~ Done in 0.19.3: a backup of an encrypted Canon is one package with the database and every archived year, restored whole in the app and by `npm run restore-backup`.
- ~~Claims are church-wide.~~ Done in 0.19.4: claims follow the account's congregation; the journals, reports and approvers stay the whole church's (the books are one set).
- ~~When the office typed in where to repay, approvers aren't told.~~ Done in 0.19.4: the claim says so to approvers.
- ~~No test yet sends a real encrypted backup through "copy from Google Drive" and restores it.~~ Done in 0.19.5.
- ~~Ordinary changes don't build or start the Docker image.~~ Done in 0.19.5: every change builds it and starts it (amd64); release tags still build and publish amd64 and arm64.

Reports carry each year's surplus into its fund; there is no posted year-end closing journal (none is needed).

## 0.20.0 — Recovery and operational acceptance (next)

Before Canon is offered for unattended use or to replace a church's books outright (from the v0.19.1 review):
1. **Complete disaster recovery**: one backup package with the database, the archived years and what recovery needs; sent to Google Drive whole; restored in the app and by hand into a fresh computer, with nothing needed from the lost one. The package itself is done (0.19.3; a test restores one backup file alone onto an empty computer with the recovery key, and current and archived records read back). Through Google Drive too (0.19.5: a test sends the package to Drive, loses the office computer, and restores it on a new one — in the app and by hand — with the recovery key; members and the archived year read back). **Done.**
2. **Deployment acceptance**: the published image pulled and started on amd64 and arm64, backup and restore, `docker stop` during start-up and in normal use; on Windows a restart, the task's account, a lost Windows profile (recovery key), and the icon. *Done when* each has a written result. From 0.19.5 every change builds the image and checks on amd64: it starts and is healthy, a backup is made inside it, `docker stop` in normal use and during start-up exits cleanly, and the backup restores by hand. Still to write up on real machines: arm64 (a NAS), and the Windows items.
3. ~~**Congregation scope for claims** and approvers being told when the office typed the repayment details.~~ Done in 0.19.4.
4. **A pilot cycle** with a church: the weekly service, a month reconciled, a claim submitted, approved and paid, and a restore drill — with the church's operational owner. *Done when* written up with what was learned.

## Later

- **Child check-in and pick-up** for Sunday school: name labels and a collection code for the guardian.
