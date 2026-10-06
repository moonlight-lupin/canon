# Changelog

What changed in each version of Canon. How to update and how to go back: [docs/UPGRADING.md](docs/UPGRADING.md). What's planned next: [docs/ROADMAP.md](docs/ROADMAP.md).

"Database" lines say when a version upgrades the database. Canon does this by itself on start and keeps a copy of the database from before (from 0.11.0).

## 0.15.0 — Lending library and asset register

Two new optional parts of Canon, under **Resources** in the sidebar. Both start switched off: an administrator turns them on in **Settings → Modules**.

- **Lending library**: the church's books, DVDs and curricula, lent to members. It is separate from the Library of songs and liturgy.
  - **Catalogue**: type or scan an ISBN and **Look up** fills in the title, author, publisher, year and cover. It uses Open Library, else Google Books, and sends only the ISBN. Without internet, type the details. Each copy is numbered B0001 … with a QR label.
  - **Lend & return**: type or scan a copy's number. Lend to a member by name, with a due date from the loan rules; take it back or renew it. A copy's QR label opens the same card on a phone.
  - **On loan**: overdue first, with who has what. A member with something on loan can't be deleted or erased until it is back.
  - **Loan rules**: loan period, renewals, and e-mail reminders. Borrowers get a "due soon" e-mail once and an "overdue" e-mail weekly, in their language, sent with the daily housekeeping, or **Send now**.
- **Asset register**: the church's equipment and property. It records what each item is, its number (E0001 …), where it is, who looks after it, when it was bought and for how much, the warranty, its condition and status.
  - **Photos and receipts**: PNG, JPEG, WebP or PDF, up to 10 MB, kept in the database and so in backups.
  - **Maintenance**: a log, and the next maintenance date, which moves on with a regular interval. Maintenance due within two weeks is flagged and counted on the dashboard.
- **QR labels** for copies and items, on A4 sticker sheets (24, 21 or 65 to a page, starting part-way through a used sheet) or a 62 mm label printer. The QR code holds the office computer's network address even when Canon is opened as localhost.
- **CSV import and export** for the catalogue (one row per title, with its copies) and the register.
- **Roles**: new ready-made **Librarian** and **Asset keeper** roles. They choose borrowers and custodians by name, without the member register. The other ready-made roles get sensible access: for example, the Secretary edits the library, the Treasurer edits the register, and the External guest reads the register. A church's own roles start without access.
- **AI assistants**: `canon_lending`, `canon_save_book`, `canon_equipment`, `canon_save_equipment`. They are off for agents until the administrator allows them. Agents add books and equipment and record maintenance; lending and returns stay at the desk.
- **Dashboard**: what is on loan and overdue, and maintenance due, when the modules are on.
- **Members' personal data** (PDPA export) lists their loans and the equipment they look after. Erasing them keeps past loans anonymised and clears them as custodian.
- Database: version 26 adds the lending library and asset register tables, the two new roles, and every role's access to the new modules.

## 0.14.5 — accounts and the Settings page

- **Settings lists its sections down the left**, in four groups: **My account**, **Church** (church, languages, modules, offerings), **People and access** (users & access, member fields, visitor form) and **Canon** (security & privacy, backups, e-mail, AI / MCP, change log). On a phone it is a list at the top. The address follows the section (e.g. `/settings?tab=backups`), so a link opens it.
- **Every account belongs to a church member.** **Add user** asks for the **Member**, and an account can't be unlinked or given to a second account's member. The exceptions:
  - an **External guest (read-only)** account, a new built-in role for someone outside the church such as an auditor. It reads services, the library, service records and offerings, changes nothing and never sees members' contact details or notes. The church can let it read more, never change anything.
  - the administrator who set Canon up. Until they link their own account, a reminder sits above every page.

  Existing accounts without a member keep working; **Users & access** and the security checklist (**Accounts and members**) say which need one.
- **Two-step sign-in for everyone:** Security & privacy can now require it for every account, not only administrators. An account without it sees only the setup screen when it signs in (with its recovery codes before Canon opens), and can't turn it off while it is required.
- When two-step sign-in is required for administrators, an administrator without it now also sees the setup screen, instead of finding administrator pages refused.
- Database: adds the External guest role (version 25).

## 0.14.4 — Canon on a Mac; slides for Keynote

- **A Mac can run Canon:** double-click **start-canon.command**, the Mac twin of start-canon.bat.
  - It installs, builds and upgrades like the Windows launcher, and shows the address for other computers.
  - It keeps the Mac awake while Canon runs.
  - Settings such as the port go in `canon.local.sh`.

  The first time, right-click it and choose **Open**, and allow incoming connections when macOS asks. See `docs/ADMINISTRATION.md`. Canon's tests now also run on a Mac, where CI starts Canon with this launcher.
- **Files → PowerPoint for Keynote (Mac):** the same slides with fonts every Mac has (Songti, PingFang, Helvetica Neue …), to open in Keynote and save as a Keynote file. CI checks on a Mac that each of these fonts is there.
- **The PowerPoint download uses fonts the computer has.** For each language it takes the first font of the slide template's list that Windows has; before, it always took the first one, which could be a Mac font. Traditional Chinese now defaults to Microsoft JhengHei, which every Windows PC has; PMingLiU comes only with Windows' optional Traditional Chinese fonts.
- No database change.

## 0.14.3 — language tabs and the launcher

- **Resting the pointer on a field's language tab** (**EN**, **简** …) shows the field's whole text in that language, with its line breaks, in a panel that scrolls when the text is long. It works the same in every browser, on Windows and on a Mac, and with the keyboard. Before, the browser's own tooltip showed only the first 200 characters.
- **The line under a field that repeated the first language is gone.** It showed two lines at most, and only the first language. Use **Side by side** to see every language together while translating.
- **start-canon.bat shows the office PC's network address** (e.g. `http://192.168.1.20:5018`) for other computers, instead of its name. If no address is found it shows the name as before.
- No database change.

## 0.14.2 — Canon's library

- **Canon's library is a choice.** A new Canon starts without bundled hymns, texts or templates. In **Getting started**, the first administrator ticks what to add and presses **Add to the library**:
  - **Hymns & psalms**: about 380.
  - **Liturgical texts**: creeds, calls to worship, confessions, prayers and benedictions, in English and Chinese.
  - **Service templates**: five orders of worship.
  - **Westminster Standards**: downloaded from the internet.

  The rest can be added later from **Library → Canon's library** (administrators). Each part says how much of it is already in the library.
- **About 350 more public-domain hymns** in it. Each has its English words and credits: author, translator, composer, tune, metre and year.
  - The words are public domain in most countries: their authors and translators died by 1955, and they were published by 1930.
  - A few hymns' usual tune or harmony is still in copyright, for example FINLANDIA for *Be Still, My Soul*. Those are marked not public domain, with a note saying which music. The words themselves are free to print and project.
- **A bundled item you delete stays deleted.** Canon used to put a deleted hymn, text or template back on the next start. Now each one is offered once. Items new in an update are still added to the parts you chose. **Also add back the ones you deleted** brings them back.
- **Service templates keep catechism questions and stanzas.** In the template editor, a liturgy item in numbered parts has **Questions** (or **Parts**), e.g. `1-4`, and a hymn has **Stanzas**. Services made from the template start with them. Template CSV files have a **stanzas** column for this.
- **Evening Worship** (built-in template) uses the full Westminster Shorter Catechism, questions 1–4, instead of a separate four-question excerpt. The excerpt is no longer bundled.
- **Getting started shows again for a new church.** Since 0.1, a church name entered when creating the administrator skipped this page.
- **Chinese for two prayers:** the *General Confession* (公认罪文) and the *Collect for Holy Scripture* (求主赐我们领受圣经的祷文).
- No database change. Canons set up before this version keep their whole library.

## 0.14.1 — the dashboard

- **The greeting follows the day.** Good morning, afternoon or evening, or a greeting of the church year, a different one each day:
  - Advent: "Come, Lord Jesus";
  - Christmastide: "Glory to God in the highest";
  - Epiphany: "The Light has come";
  - Eastertide: "Christ is risen";
  - and "Grace and peace", "The Lord be with you" and "Peace be with you".

  Sundays, Christmas Day, Easter Day and Pentecost have their own. Every greeting is in each interface language.
- **The Bible card** lists the installed versions by language, instead of a verse count.
- **The library cards** open their own Library tab: Hymns & songs, Liturgical texts or Bible.
- **Canon's mark:** the gold reed now stands in front of the white crossbar.
- **The user guide** has sections of its own for **Meetings** and **Service templates** (they were bullet points inside other sections, so they were missing from the guide's contents). The service template editor's name field says **Template name**, as in the other editors.
- No database change.

## 0.14.0 — UI/UX audit of the core

A review of the core screens (`docs/UI-AUDIT-0.14.md`), and what came out of it.

- **Easier to read.** The grey used for hints, table headers and second-language titles, and the amber of warnings, now meet the accessibility minimum (WCAG AA) in light and dark themes.
- **The service planner's bar:**
  - **Bulletin**, **Slides** and **Run sheet** stay as buttons.
  - **Files ▾** holds PowerPoint, Word and FreeShow.
  - **Share** opens the link panel and shows **On** while the link works.
  - **⋯** holds Duplicate, Save as template and **Delete this service** (in red, apart from the rest).
- **On phones:**
  - the planner fits the screen (each item's role and minutes go under its title);
  - the dashboard shows its figures two per row.
- **The sidebar:**
  - **Planner** (策划) covers services and meetings, so **Meetings** moved there from Congregation;
  - click a section's name to fold it (remembered in the browser);
  - going to a page in a folded section opens it.
- **One language switch per section.** Sections with several multilingual fields have **EN / 简** and **Side by side** at their top right, turning all their fields at once:
  - the visitor form and member field settings;
  - a service's details and Bulletin tab;
  - a meeting's details;
  - a bulletin template.

  Each field keeps its own small tabs, in dialogs too. Click one to switch just that field, or hover over it to read the field in that language.
- **One ⋯ menu on all three template pages.** Service templates now use the same ⋯ menu as slide and bulletin templates (Set as church default, Archive, Restore, Delete). The ⋯ button is larger, and the church default's Archive shows greyed out with the reason.
- **Settings:** **My profile** is its own first tab, and the other tabs are grouped.
- **A visitor form for meetings.** **Visitors can fill in a form on their phone**, next to **An offering is taken at this meeting**. The meeting gets its own QR code, link and cards to print, and its leader can switch it on and accept the entries.
- **Canon's mark** is one image file (`public/canon-mark.svg`), used in the app and as the browser tab's icon. Its white crossbar now runs across the measuring reed.
- **Accessibility:**
  - the main content is marked as such;
  - headings are in order;
  - search boxes and filters have names;
  - small targets are larger (field language tabs, "?" tips, calendar entries, insert buttons on touch screens);
  - "reduce motion" is honoured.
- No database change.

## 0.13.2 — permissions for exports, households and precedent

Fixes from the review of 0.13.1.

- **CSV follows congregation walls.** For an account limited to one congregation, member, co-worker, group, team and time-away exports, import previews and name matching cover only its congregation's people and the whole church's. Before, an export or a preview could show another congregation's member.
- **CSV follows the sensitive-field permission.** A role that doesn't see sensitive member fields gets no column for them in exports or previews. A column for one in a file it imports is ignored, and the stored values stay.
- **Households behind a wall.** A household whose members are all in other congregations can't be read, renamed or joined by a limited account, on the web or through an AI agent.
- **Precedent behind a wall.** Similar past services (`similar_to`, `like`) come from the account's own congregation and the whole church.
- **Lists and reports.** The member counts, the co-worker list and the serving report leave other congregations' people out.
- **The scripture report** follows the meeting rules like the other reports: no meetings when Meetings is switched off.
- **Tests:** the permission matrix now covers CSV, households, precedent and the scripture report, and checks that forbidden values appear nowhere in a response. Its record-tool case now uses the real tool, with a check that the call succeeds before Meetings is switched off.

## 0.13.1 — permissions hold through every channel

Fixes from the review of 0.13.0.

- **Congregation walls hold everywhere.** Rows are now checked where they are read and saved, so the web app, AI agents and imports follow the same wall.
  - An account limited to one congregation can no longer read or change another congregation's members or services through an AI agent.
  - It can't add another congregation's member to its groups, rota or roles.
  - Group member lists, team rosters, a service's roster, the rota grid, time away and households leave other congregations' people out.
  - Moving something to another congregation needs an account for the whole church.
- **The rota for a limited account** shows its own congregation's services again, not only the whole church's.
- **Sensitive member fields through AI agents** follow the role's own permission. A role that sees contact details but not sensitive fields (the secretary) no longer gets them, or can change them, through an agent.
- **Sensitive fields on the web.** A role without them could clear them by saving a member: the empty boxes on its form were sent as values. They are now left off its form and ignored by the server.
- **Meetings through AI agents** follow the role, as in the web app. A role that only reads meetings (the service planner) can't change them through the service, order or record tools. When Meetings is switched off, meetings, their records and meeting reports don't exist for agents.
- **Encrypted backups never fall back to plain copies.** Canon now records that encryption is on, separately from the key file. If this computer's key file is missing, damaged or unreadable, backups stop with a message, and the Backups tab and security checklist say so.
- **Tests:** a permission matrix runs the same cases through the web app and AI agents, and checks what was saved as well as the responses.

## 0.13.0 — roles and permissions, optional modules, second hardening round

- **Roles a church can shape** (Settings → Users & access → Roles):
  - ready-made roles: administrator, pastor, editor, planner, treasurer, secretary and read-only;
  - each sets, per module, no access, read or edit, and whether the role sees members' contact details, sensitive fields, and may reopen a verified cash count;
  - administrators can adjust the ready-made ones or add their own;
  - one model for the web app and AI agents: the sidebar, the server and the MCP tools follow the same role.
- **Congregation walls:** an account can be limited to one congregation. It then sees and creates only that congregation's (and the whole church's) services, members, groups, meetings and records.
- **Counters approve from their own accounts** (Settings → Offerings): a cash count can be approved by each counter signed in to their own account, shown apart from signatures drawn on one device.
- **Approved versions** of a service's bulletin and slides: **Approve** keeps a dated copy; later changes don't alter it, and the copy can be opened, printed or projected as approved.
- **Optional modules** (Settings → Modules, and in onboarding): meetings and calendar, volunteers and rota, and the visitor form can be turned off. A module that is off is hidden, refused by the server and missing from AI agents' tools; its data is kept.
- **Signing in:**
  - five wrong passwords lock an account for 15 minutes (an administrator's new password unlocks it);
  - **two-step sign-in** with an authenticator app, with one-time recovery codes (Settings → My profile);
  - a church can require it for administrators (Settings → Security & privacy); an administrator can reset it for someone who lost their phone.
- **Encrypted backups:** with a backup password (Settings → Backups), backups and the archive copies made with them are encrypted. This computer restores its own backups without the password; elsewhere Canon asks for it. `npm run decrypt-backup` for restoring by hand.
- **A member's personal data (PDPA):** administrators download everything Canon holds about a member as a file for them, and erase it on request. The record stays as an anonymous placeholder so history still counts; the change log and archives forget them.
- **Archive ages per kind:** service records and logs can be archived after different numbers of years.
- **Bible version licences:** each version records its edition, licence and whether it may be printed, projected or put online. Outputs a use isn't allowed for show the reference without the text, and the planner warns. New uploads start without "online".
- **AI agents:** tools follow the account's role and congregation; a module that is off has no tools.
- Database: 23 → 24.

## 0.12.0 — meetings, Sunday school and the church calendar

- **Meetings** (Congregation → Meetings): fellowship meetings, cell groups, prayer meetings, Sunday school classes, committee meetings and one-off gatherings.
  - Each is a lighter kind of service: date, time, place, its own leader (a member, or a name), passage and topic. An order of service, bulletin and slides are optional.
  - A group's new meeting copies its previous one. A one-off meeting belongs to no group and has a title of its own. **Next meeting** copies a meeting to another date.
  - **Offering on or off per meeting**, carried forward to the next. Without an offering, the record has no money sections and the meeting stays out of the offerings reports.
- **Records** for meetings, like a service's: headcount, new visitors with follow-up, notes, and the cash count with declaration and signing when an offering is taken.
- **Services and meetings stay apart:**
  - the Services list, the rota, precedent and the next service are services only;
  - Service records switches between **Services** and **Meetings**;
  - reports are about services unless **Meetings** (and a group) is chosen, so a cell group's headcount never lowers a Sunday's average.
- **Group leaders record their own meetings**, with any account linked to them:
  - an administrator links an account to its member (Settings → Users);
  - a member marked **Leads** in a group, or chosen as a meeting's leader, can record those meetings — headcount, visitors with their contact details, notes, the offering with its count and signing, the details and the next meeting — even with a read-only account;
  - everything else stays read-only for them.
- **Sunday school**: classes are groups of their own kind, with the pupils' ages. Teachers lead them; pupils are members.
- **Recurring meetings**:
  - a group's meeting pattern: every week, every two weeks, or the first … fourth / last weekday of the month, with a time and place;
  - its meetings for the coming weeks are created daily, or with **Create meetings ahead**.
- **The church calendar** (sidebar, under Dashboard): services, meetings and the church's other events, by month, week or list, filtered by congregation and group. Editors add events, such as a camp over several days.
- **On a phone**: the record page's offering lines and visitors stack into labelled cards, and the calendar shows as a list.
- **AI agents:**
  - `canon_get_calendar`;
  - `kind` and `group_id` on the records list and the report tools;
  - `leads` on group members;
  - the `sunday_school` group kind.
- Database: 22 → 23.

## 0.11.2 — fixes from the v0.11.1 review

- **Archiving never drops a different record.** A restored record that is also in an archive is treated as the same record only if every stored field matches: money, visitors, signatures and its last save. Before, a matching id and save time were enough, so a record changed within the same second could be removed. Now archiving stops, and the live record and its money stay as they are.
- **Erasing visitors' details reaches deleted services too.** When a service is deleted, Canon keeps its id and date, so the change-log entries of its record (the create and delete snapshots) are still erased on time. Deletions from before 0.11.2 are filled in from the change log. An entry whose service date can't be found is erased once the entry itself is older than the setting.
- Database: 21 → 22.

## 0.11.1 — fixes from the v0.11.0 review

- **Archived records stay protected.** Canon now remembers which services have their record in an archive file:
  - that record is read-only;
  - nobody can start a second record for the service, delete it or move it to another date;
  - an archive never holds two records for one service.
  - To correct one, an administrator brings it back from the archive (logged), and the next archiving files it again.
  - Archives made by 0.11.0 are linked at start-up. One that already holds two records for a service is flagged.
- **Erasing visitors' details reaches every copy:**
  - service records, archive files and the change log;
  - archiving erases first;
  - a restored backup is erased again straight away.
  - Backups keep their copies until they are removed, and Settings says so.
- **Edit conflicts use a revision number** instead of the time of the last save, so two saves in the same second are no longer missed:
  - the record page's saves before verifying, signing and finishing are checked too;
  - a record someone else created meanwhile is caught;
  - editing the order of service no longer makes a later save of the service details look like a conflict.
- **Node.js 24 is now required.** 0.11.0 claimed 22.18, which failed in CI.
- **Clearer about what the numbers mean:**
  - reports say when a period includes archived years;
  - new-visitor figures count entries on service records, not different people;
  - Settings warns when the change log is kept for less time than the archive age.
- Corrected: fields marked sensitive are hidden from read-only accounts (and from AI agents without personal data); editors and administrators see them.
- AI agents: `canon_get_service_record` returns `archived_year` and `read_only` for an archived record.
- Database: 20 → 21.

## 0.11.0 — hardening

- **Read-only accounts** no longer see members' phone, e-mail, address or notes, and see birthdays as day and month only. Share links and agents acting for read-only users get the same.
- **Custom member fields** (Settings → Member fields): text, date, yes/no or a choice. A field marked *sensitive* is hidden from read-only accounts, and from AI agents unless personal data is shared; editors and administrators see and edit it. Custom fields are in the member form, filters and the CSV export and import.
- **Settings → Security & privacy:**
  - a checklist of the church's own security settings;
  - a log of who opened which member's details;
  - **keeping and archiving**:
    - visitors' contact details are erased after a set number of months (default 24);
    - service records and log entries older than a set number of years (default 5) move to one read-only archive file per year;
    - archives can be opened in Canon, and are copied with every backup.
- **Storage** (Settings → Backups): the size of the database, archives, uploads and backups, and how fast they grow.
- **Edit conflicts:** when two people edit the same service, member or service record, the second save is refused with who changed it and when, instead of overwriting the first person's work.
- **Safer updates:**
  - Canon keeps a copy of the database before upgrading it (`data/pre-upgrade/`, newest three);
  - a database from a newer Canon is refused unchanged;
  - `start-canon.bat` checks the Node.js version, and installs and rebuilds what changed after an update;
  - continuous integration runs on Windows and Linux;
  - added [docs/UPGRADING.md](docs/UPGRADING.md) and this changelog.
- **Public-domain status depends on the country:** the README and *About Canon* now say so (the KJV in the UK; hymns under life + 70).
- **Under the hood:** long files are split into smaller modules, with no change in behaviour. The README is shorter, with [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ADMINISTRATION.md](docs/ADMINISTRATION.md) beside it.
- Database: 18 → 20.

## 0.10.7
- The change log and AI activity log: filters line up; both export as CSV.

## 0.10.6
- **Visitor form** per service: visitors fill it in on their phones (QR code). A reviewer checks each entry before it joins the service record. The planner chooses whether to ask for prayer requests (kept as sensitive), how they heard about the church, and which description fits them best. Entries are rate-limited per device.
- Database: 16 → 18.

## 0.10.5
- References for services and for service, slide and bulletin templates.
- A service template can choose its slide and bulletin templates.
- Database: 15 → 16.

## 0.10.4
- Archive service, slide and bulletin templates that are no longer used. They stay available for past services.
- Database: 14 → 15.

## 0.10.3
- Settings → Offerings: funds, currencies, signing, and the minimum number of counters.
- **Finish signing** completes an on-screen count. After verification, only the cash lines are locked.

## 0.10.2
- The cash-count declaration records the date the money was counted, with a date picker.
- Database: 13 → 14.

## 0.10.1
- Scripture report: every book and chapter of the Bible, read and preached, as a heatmap. Songs have their own report.

## 0.10.0
- **Reports:**
  - attendance;
  - offerings by fund, month and method, with a treasurer's summary;
  - new visitors' follow-up;
  - serving load;
  - songs sung;
  - membership.
- Reports can be printed and exported to Excel.
- AI agents can read service records, and offerings with their own separate permission.
- Fixes from a code review.

## 0.9.1
- Offerings in other currencies: each is counted and totalled on its own, never converted.
- Counters can sign the cash count on screen.
- Database: 12 → 13.

## 0.9.0
- **Service records:** attendance, new visitors, offerings, and the cash count with a printable declaration.
- **Change log** and history on members and records.
- **Congregations.**
- Serving teams become groups.
- Slide-background library and library check.
- `canon_whoami` for agents.
- Database: 8 → 12.

## 0.8.0
- **Template pages:** a gallery and a step-by-step editor.
- PowerPoint download and 4:3 slides.
- A background picture per service item.
- A church default service template.
- Restore a backup in place.
- Short-lived download links for agents.
- Database: 7 → 8.

## 0.7.0
- **Bulletin page layout:** sections and page breaks.
- Weekly bulletin sections in the planner.
- Slide line limits.
- Similar past services and "last sung" for planners and agents.
- Settings → Backups.
- Database: 6 → 7.

## 0.6.2
- First public release:
  - service planner with bulletins and slides;
  - member and co-worker registers;
  - groups and the volunteer rota;
  - CSV import and export;
  - Bible uploads;
  - backups;
  - in-app guide;
  - OAuth MCP server for AI agents.
