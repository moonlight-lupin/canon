# Changelog

What changed in each version of Canon. How to update and how to go back: [docs/UPGRADING.md](docs/UPGRADING.md). What's planned next: [docs/ROADMAP.md](docs/ROADMAP.md).

"Database" lines say when a version upgrades the database. Canon does this by itself on start and keeps a copy of the database from before (from 0.11.0).

## 0.11.0 — hardening

- **Read-only accounts** no longer see members' phone, e-mail, address or notes, and see birthdays as day and month only. Share links and agents acting for read-only users get the same.
- **Custom member fields** (Settings → Member fields): text, date, yes/no or a choice. A field marked *sensitive* is shown to administrators only. Custom fields are in the member form, filters and the CSV export and import.
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
