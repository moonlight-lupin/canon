# Changelog

What changed in each version of Canon. How to update and how to go back: [docs/UPGRADING.md](docs/UPGRADING.md). What's planned next: [docs/ROADMAP.md](docs/ROADMAP.md).

"Database" lines say when a version upgrades the database. Canon does this by itself on start and keeps a copy of the database from before (from 0.11.0).

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
