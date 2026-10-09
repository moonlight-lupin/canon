# Changelog

What changed in each version of Canon. How to update and how to go back: [docs/UPGRADING.md](docs/UPGRADING.md). What's planned next: [docs/ROADMAP.md](docs/ROADMAP.md).

"Database" lines say when a version upgrades the database. Canon does this by itself on start and keeps a copy of the database from before (from 0.11.0).

## 0.19.7 — A sample church that does everything

- **Settings → Sample data** now also fills every part of Canon that is switched on, so you can see them working together: the last eight Sundays and the next two, made from Canon's service templates (Canon's library is added first if it isn't there), with rotas and service records — attendance, visitors, offerings counted and verified; cell-group and Sunday school meetings with their records; events on the calendar and spaces; library books with loans (two overdue); the asset register with custodians and maintenance; and, when the books haven't been started, the books — opening balances, offerings posted, cash banked, the monthly bills, a bank statement matched (one line left to match), and expense claims being prepared, waiting, sent back, approved and paid. The screen says which modules are off and so left out.
- **Removing it takes out exactly that** (database version 38: each row marks the sample as its own): services and meetings with their records, events, spaces, books and loans, assets, journals, the bank statement, claims and approvers. A posted journal still can't be deleted — only the sample's own, when the sample is removed — and none can be marked as the sample's after it was posted. What real records now depend on stays and is listed. When the sample started the books and nothing real is in them, they go back to not started.
- **Fixed: the dashboard's "Next service"** showed the furthest planned service, not the soonest, when several were planned ahead (found with the sample church).
- **From an adversarial UX test** (a fictional 68-year-old church secretary doing her weekly tasks on the sample church):
  - **The Secretary can record visitors.** Visitors' details went with seeing the money, so a role with the registers but not the offerings couldn't add a visitor, and was told only editors could. They now go with **members' details**, the offerings with **Offerings**, each on its own.
  - **Fixed: a treasurer (or anyone seeing the money but not members' details) saving a service record wiped its visitors' contact details**, prayer requests and notes — the shortened list it was shown replaced the full one. Such a save now leaves the visitors as they are.
  - **A dialog with something typed in asks before it closes** with Escape, a click outside or ✕ (Escape had thrown away a new member's details without a word). Cancel and Save are unchanged.
  - **The household list shows who is in each household** (two "Lim family" households can be told apart), and **New household…** makes one without leaving the member form.
  - **New family** (Members, next to Add person, and on the Households tab): a whole family in one form — a row for each person (names, Chinese name, place in the household, gender, birthday, status) and the household (its name follows the first person's surname), saved together. It had taken a household and then one form per person.
  - A role that can only view the rota is told so, instead of finding nothing to click; the bulletin's printing hint says where to choose double-sided printing.
  - The sample's people take turns on the rota, and its meetings have their group's leader.
- Database: version 38 (the sample's mark on the rows it adds).

## 0.19.6 — Flowcharts in the guide; a receipt viewer; a compact roles table

- **Flowcharts in the guide**: a week at a glance, the visitor form, offerings into the books, expense claims, recovering after a lost computer, and updating from inside Canon — each step as a box (with who does it), the ways a step can go side by side. In English and Chinese. (The guide's Markdown gains a `flow` block; read as text, e.g. by AI assistants, it is the steps in order.)
- **A receipt viewer for claims** (Book-keeping → Claims, and the claim page approvers open): one receipt at a time inside a frame that never spills out of the claim, each labelled with its line (or **Not on a line**, e.g. the signed paper form), with ‹ › and thumbnails, **Actual size** to read small print, and **Open in a new tab**. Before, a large photo could run past the dialog's edges.
- **Settings → Roles & permissions** is compact: each role's description is behind its **?**, and **Edit** sits beside the role's name (the rest stay in the ⋯ menu).
- Database: no change.

## 0.19.5 — Recovery through Google Drive, tested; Docker checked on every change

- **Disaster recovery through Google Drive is tested end to end**: the office's Canon sends its backup package to Drive; the office computer is then lost with everything on it; a new computer with a new Canon connects to the same Drive, copies the backup back and restores it with the recovery key — in the app, and by hand with `npm run restore-backup` — and the members and the archived year read back. Without the recovery key the new computer can't open it. Google is played by a stand-in.
- **The Docker image is built and started for every change**, not only for releases: it must start and be healthy, make an encrypted backup inside the container, stop cleanly with `docker stop` in normal use and during start-up, start again, and restore the backup by hand.
- No change to Canon itself. Database: no change.

## 0.19.4 — Updates from inside Canon; claims and congregations

- **Check for updates and update from inside Canon** (administrators, About Canon → **Updates**): Canon asks GitHub once a day whether there is a newer version (it can be switched off; nothing about the church is sent), and the sidebar says when there is. On a Windows PC or a Mac, **Update now…** makes a backup, gets the new version (a git copy: the release's tag; a download: the release's archive, written over the folder, never over the data) and restarts; Canon installs what the new version needs, rebuilds and upgrades the database as usual. If the new version can't be prepared, Canon goes back to the version you had and says so. In Docker, Canon only tells you: update with `docker compose pull`.
- **A new launcher**: `start-canon.bat` and `start-canon.command` hand over to `scripts/launcher.mjs`, which prepares, starts and restarts Canon as the batch file did, and installs updates. The batch file now does this on one line, so an update can replace it while it runs. The Windows background task and the tray icon work as before. **Updating to 0.19.4 itself is by hand** (as before); later versions can be installed from inside Canon.
- **Claims follow congregations**: an account limited to one congregation sees that congregation's claims and the whole church's in Book-keeping → Claims (also through AI assistants), and enters claims only for those members; another congregation's claim, its receipts and its members are not found. The journals, reports and approvers stay the whole church's: the books are one set.
- **Approvers are told when the office typed in where to repay** (a paper claim, or a change made for the claimant): approvers never see the details, so the claim says so, and they check with the claimant. The office's view marks it too. (Database version 37.)
- **About Canon** ends with *Soli Deo Gloria*.
- Database: version 37 (who typed in where to repay a claim).

## 0.19.3 — One backup file holds everything

- **A backup is a complete package**: each backup of an encrypted Canon is one file with the database **and every archived year**, encrypted with the backup key, so the copy in Google Drive (or on a USB drive) is the whole of the church's data. Before, archived years were copied beside local backups only and never reached Drive.
- **Restoring brings the archived years back**, in Settings → Backups and with `npm run restore-backup`: the package's archived years take their place, and the ones Canon had are set aside in `data/pre-restore/`, not deleted. The change log says how many archived years came back.
- **A damaged backup is refused**: each part carries its SHA-256, so a file changed or cut short on the way is turned away before anything changes.
- `npm run decrypt-backup` writes a package's archived years to `<name>-archives/`; `npm run backup` writes packages too. Older backups (`.db.enc` from 0.19.0–0.19.2, and those made with a backup password) still restore as before.
- Database: no change.

## 0.19.2 — Fixes from the v0.19.1 review

- **Sample data marks its own rows** (database version 36): removing it takes only the people, households, groups and services that carry its mark. Before, a real service made after a sample one was deleted could take its number and be removed with the sample.
- **An explicitly configured key file is that or nothing**: if `CANON_KEY_FILE` is missing, unreadable or too short, Canon stops with a message — it no longer quietly keeps the keys in a form anyone with the data folder can read, nor makes a new database unencrypted; the same when a recovery key re-locks the keys.
- **Restoring by hand works with encryption**: `npm run restore-backup -- <file> [recovery key]`, with Canon stopped, opens the backup, gives it this Canon's own key, sets the database there was aside and brings back archived years found next to the backup; on a new computer it makes new keys and shows their recovery key once. (Copying a decrypted backup over `canon.db`, as the guide said, left a plain database beside the keys, which Canon rightly refuses.)
- The README's privacy section and the roadmap say how things stand now: encryption, the pilot conditions for the books, and a 0.20.0 milestone for recovery and operational acceptance.
- Database: version 36 (sample data's mark on its rows).

## 0.19.1 — Installing without build tools

- Canon's dependencies are installed with `--ignore-scripts` (on start after an update, in Docker and in CI): the database library brings ready-built binaries, and some npm versions otherwise try to compile it from source — which fails on a computer without build tools, and failed the 0.19.0 Docker image. Installing Canon by hand: `npm install --ignore-scripts`.
- Database: no change.

## 0.19.0 — Encryption

- **The church's data is encrypted** on the computer Canon runs on (SQLCipher format, AES-256): the database, the copies kept before upgrades and the archived years, with the database key; **backups with a separate backup key**. A new Canon is encrypted from its first start.
- **The keys open by themselves**, locked to this computer: the Windows account Canon runs as (DPAPI), the macOS keychain, or in Docker a secret outside the data volume (`CANON_KEY_FILE`) — Canon still starts with the computer, with nobody there. `data/keys.json` holds them, locked.
- **The recovery key**, made at setup and shown once (eight groups of five, a QR code, a sheet to print; confirmed by typing its end): it opens the data on a new computer or after the Windows account changed, and restores any backup anywhere — each backup names the recovery key that opens it. A new one can be made (Settings → Security & privacy, the password asked again).
- **Canon locked**: when this computer can't open the keys, one page asks for the recovery key, on the computer itself only; then Canon starts as usual. The icon by the clock says so.
- **A Canon from before 0.19.0**: a red banner for administrators until **Encrypt now…** — a backup first, then the database encrypted in place, the recovery key shown, and the plain copies Canon holds (backups, pre-upgrade copies, archived years) encrypted and the plain originals removed; database files Canon didn't make are listed and left alone.
- Restoring: a backup of an encrypted Canon restores on this computer by itself, elsewhere with its recovery key; backups made with a backup password before still restore with it; `npm run decrypt-backup` takes the recovery key too.
- **Reviewed before release** (an independent security review): a plain database put in place of an encrypted one is refused, so nobody can have Canon issue a recovery key for the real keys; **Encrypt now** asks for the password again; copies it couldn't encrypt can be encrypted later; a test copy leaves its backup folder alone; `keys.json` is private to Canon's account on Windows; keys unlocked through PowerShell come back masked (a PowerShell transcript sees noise); scratch files are never in the backup folder and are swept at start; a plain upload into an encrypted Canon isn't kept; the locked page takes guesses from itself only; `npm run unlock` for Docker.
- **A security review of the whole app** (independent; each finding fixed with a test):
  - accounts that see the money but not members' details (an external auditor, a treasurer) no longer get what visitors told the church — their contact details, prayer requests, how they describe themselves, follow-up notes — in records, the visitors report or the visitor cards;
  - wrong two-step codes count against the account like wrong passwords (a known password and endless guesses at the code locked nothing before); a correct password forgives nothing until the code is right too;
  - setting up two-step sign-in again while it is on is refused (it turned it off without the password);
  - the sign-in page answers a locked account like a wrong password (no telling which usernames exist);
  - when the church requires two-step sign-in, an account without it gets no AI access either;
  - the AI sign-in's address comes only from the church's own proxy; signing out needs the session's token; the API's answers are never cached by the browser; a library file can't unpack to more than 200 MB;
  - AI assistants are told that text people typed (notes, prayer requests, song words, bank and claim lines) is data, never instructions.
- The database driver is now better-sqlite3-multiple-ciphers (SQLite with encryption built in, ready-built for Windows, macOS and Linux on x64 and ARM).
- **Canon's Docker image on GitHub:** every release is built for amd64 and arm64 (most NAS models included) and published as `ghcr.io/moonlight-lupin/canon` (`:latest` and `:<version>`). `docker compose pull && docker compose up -d` installs or updates Canon without building it; docs/DOCKER.md has a compose file that needs no source.
- A **Sponsor** button: Buy Me a Coffee (`.github/FUNDING.yml`).
- Database: version 35 (unchanged); the file itself is encrypted once an administrator encrypts it.

## 0.18.0 — Hardening: the books reviewed, Canon in the background

- **Importing the chart of accounts and the funds** (Book-keeping → Accounts and funds → Import…) from Excel or CSV — the same columns as their export. Rows are matched by code; a preview first; nothing deleted; an account already used keeps its type.
- **Canon in the background on Windows** (`scripts\windows-task.ps1 install`, as administrator): a Task Scheduler task starts Canon with the computer, before anyone signs in, without a window, and again if it stops by itself; it runs as the office account (Windows asks for its password once and keeps it). See `docs/ADMINISTRATION.md`.
- **Canon's icon by the clock**: green when Canon is running, grey when not; click to open Canon; right-click for the address other computers use (click to copy), Start Canon, and **Exit**, which stops Canon properly. In the Start menu as **Canon**, and started when someone signs in.
- **Stopping properly**: the icon's Exit, Ctrl+C in the window and `docker stop` (SIGTERM) let running requests finish, close the database and exit cleanly, so the launcher doesn't take it for a crash. The icon asks with a token only the account running Canon can read, from the PC itself.
- **Signing on a phone:** the signature box follows one finger (a second finger, e.g. while zooming, no longer draws a line), and a long press no longer opens the phone's selection or magnifier. A claim signed on a phone carries the claimant's name from their member record, whatever name the page sends.
- **A review of the books, claims, upgrades and Docker** (three independent reviews; each finding fixed with a test):
  - **Bank:** a statement line matched in a group can't also be matched alone (and unmatching leaves nothing behind); a reconciliation counts what had cleared by the statement's last day, so matching next month's statement doesn't change a month already reconciled; decimal commas (`12,50`, `1.234,50`) read right in statements and journal imports; a statement whose lines are in services' offerings can't be deleted; marking a statement reconciled is in the change log.
  - **Claims:** the expense is posted before the payment can be (and drafted again if missing); deleting a payment draft makes the claim approved again; nobody pays their own claim; approvals count for the submission they were given for (sent back, or moved to another ministry, they start again); an approver's sign-in e-mail is changed only by an administrator or someone who may change the books; AI assistants write claims for others only with book-keeping edit; up to 20 claims being prepared per member.
  - **Journals:** a reversal, offering or claim draft keeps its kind when saved; the database also keeps a posted journal's poster, time, claim and reversal; numbers go on past 9999 in a year; a journal import comes in whole.
  - **Security:** the Excel reader refuses zip bombs and can't be frozen by damaged XML; only the church's own proxy is believed about a visitor's address (the sign-in limits can't be dodged); the stop token is readable by Canon's account only, on Windows too.
  - **Running Canon:** Docker makes its `backups` folder its own on a NAS; the image takes the languages from its build; `docker stop` works from the first moment; **CANON_TEST_COPY=1** for a test copy (no e-mail, no Google Drive, a banner); DOCKER.md: decrypting a backup by hand, going back a version. Windows: the icon for every account, `-User` to install for the office account, never giving up restarting in the background, stopping only Canon's own processes.
- **Release gates for the books:**
  - a fictional reference church's year (opening balances, offerings, a claim, a correction by reversal, a bank reconciliation with a group match, a closed month, the new year, the accountant's export) checked against figures worked out by hand;
  - an encrypted backup of the books (posted journals, a paid claim with its receipt, bank matches, a closed month) restoring exactly.
- Database: version 35 (an approval's submission; posted journals guard more of their fields).

## 0.17.4 — Financial correctness (review fixes)

Fixes for the findings of an external review of v0.17.2.
- **Bank re-imports keep genuine look-alike transactions.** A line is the same transaction only with the same bank reference; without references, look-alike lines are counted. A second SGD 50 gift on the same day is no longer dropped as "already imported". A file that is entirely repeated makes no empty statement.
- **One offering per bank receipt.** Adding a bank line to a service's offerings again (a retry, a double click) adds nothing; it returns what was done.
- **Group matching at the bank:**
  - several statement lines against one book entry (PayNow gifts against a service's one offering line);
  - one statement line against several (a deposit covering several services), when the totals agree.
  - Canon suggests such groups.
- **Sample data removal is safe:** what has gained real records (a verified cash count, journals, an account, loans, claims) stays and is listed, and a reused number can never remove a real member.
- **Congregation walls in the lending library and asset register:** another congregation's borrower or custodian is not named in lists, details, history, scans or searches.
- **Excel files using the 1904 date system** (older Mac workbooks) are read with the right dates.
- Database: version 34 (bank match groups).

## 0.17.3 — Reversals as drafts

- **Reverse…** on a posted journal now drafts the reversing journal (every line the other way round) instead of posting it straight away.
  - The posted journal stays as it is until the reversal is posted; then the two are linked and cancel out.
  - The draft can be checked and its date or narration changed first. Deleting it changes nothing.
  - One reversing draft at a time. The journal shows it is waiting, with a link to open it.
- **AI assistants can draft a reversal** too (new tool `canon_draft_reversal`, by the journal's number). As with every journal, only a person posts it.
- Database: no change.

## 0.17.2 — Excel exports, and importing journals

- **Exports are Excel files.**
  - **What:** every list, report and log downloads as an .xlsx file — the members, the library, Reports, the book-keeping reports, the change log, AI activity, who viewed member records, Export data and its zip.
  - **The title block** above each table: the church and what the file is; the period and the filters chosen; when it was exported and by whom (with their role); and a note when it holds personal data.
  - **The table:** the headings are frozen, with filters. Dates are real dates and amounts are numbers.
  - **Importing back:** an exported list imports back as it is.
  - **Where CSV stays:** where another program reads the file — the journals for accounting software, and Bible texts.
- **Imports read Excel files** (.xlsx) as well as CSV: the lists, bank statements and journals. Templates are Excel files.
- **Importing journals** (Book-keeping → Journals → Import…):
  - **The file:** from the template or another Canon's export. One row per line; the rows of a journal share its reference.
  - **The preview** shows what stops each journal.
  - **Everything comes in as drafts** for the treasurer to post.
- **My claims** opens in a tab of its own, and the claims page links back to Canon.
- Database: no change.

## 0.17.1 — Expense claims

- **Expense claims** (part of Book-keeping): anyone can claim back what they spent for the church, with several receipts in one claim, on their phone or from **My claims**.
  - **Claiming:** one line per receipt, a photo of each, where to repay them, signed on screen. Members without a Canon account sign in with a code e-mailed to their member record, once the treasurer switches this on.
  - **Approving:** by named people (not a role), optionally for some ministries and up to an amount, with an on-screen signature.
    - Above an amount you set, two different approvers.
    - Nobody approves their own claim, and an approver who also pays is marked.
    - Approvers can send a claim back or reject it, with a reason.
  - **The books:** approval drafts the expense owed (Dr expense / Cr Claims to repay); paying drafts the payment (Dr Claims to repay / Cr bank), matched later on the bank statement.
  - **The office:** chooses how each line is booked, enters claims handed in on paper, and pays.
  - **E-mails:** approvers hear of new claims; claimants hear when theirs is approved, sent back, rejected or paid.
- **AI assistants:** anyone can send Claude photos of their receipts to draft a claim; Claude replies with the claim's link to attach the photos and sign. Two new tools: `canon_claims` and `canon_draft_claim`.
- **Fixed:**
  - The language picker on the phone pages stays small.
  - The "Sign here" hint no longer overlaps the Clear button on narrow screens.
- Database: version 33 (the claims tables). Upgrading adds them; nothing else changes.

## 0.17.0 — Book-keeping

- **Book-keeping** (an optional module, off until switched on in Settings → Modules): the church's double-entry books, kept in Canon, under **Finance** in the sidebar. The **Treasurer** keeps them; Pastor / Elder and the external guest can read them.
  - **Starting:** choose the start date and financial year. A church chart of accounts and four funds are ready (General, Missions, Building, Benevolence). Then enter the opening balances, split between the funds.
  - **Journals:** drafts, then posted with a number. A posted journal never changes: **Reverse** corrects it. Every line has a fund, and can carry a project, a ministry and a congregation.
  - **Offerings:** verifying a cash count drafts its journal (each payment method into its account, each fund's offerings into its income); the treasurer posts it. A corrected count drafts only the difference, and so does a PayNow or transfer line added after the count is verified.
  - **Bank:** import the bank's CSV statement (its layout is found and remembered), match the lines, enter bank charges and interest, and see the reconciliation. A PayNow or transfer gift first seen on the statement can be added to a service's offerings from there (**Offering…**), so the service record and the offering reports have it; it is posted and matched in one step.
  - **Reports:** income and expenditure by fund, balance sheet, fund movements, trial balance, by project / ministry / congregation, and an account's ledger. Each one prints or downloads as CSV. A journal export is there for the church's accountant.
  - **Closing:** close the books up to a date; administrators can reopen.
  - **History:** every change to a journal is recorded, its lines included (account, fund, amount before → after), before and after posting. An offering journal's history also shows the cash count's changes and any earlier drafts for that service. Bank matches are logged too.
  - **Elsewhere:** the service record shows whether its offerings are drafted or posted in the books; a dashboard card counts the drafts to post and the bank lines to match; Settings → Export data has the journals, the chart of accounts and the funds as CSV.
- **AI assistants** (Book-keeping off for them by default) can read the books, the reports and the imported bank statements, and **draft** journals. A draft for a bank line the books lack is matched to it when posted. They never post, reverse or change a posted journal, import a statement or match lines. Five new tools: `canon_books`, `canon_books_report`, `canon_books_journals`, `canon_bank_statements` and `canon_draft_journal`.
- Chinese: the books call a fund 款项; the offering screens keep 奉献项目. For translators, a key can carry a context after "‖" (e.g. `Fund‖books`), so one English word can be translated two ways.
- Database: version 32 (the book-keeping tables). Upgrading adds them; nothing else changes.

## 0.16.1 — Backups to Google Drive

- **Settings → Backups → Google Drive:** Canon can send every backup to a "Canon backups" folder in the church's Google Drive, and keep the newest N there.
  - **Connecting:** with the church's own Google sign-in client (made once in Google Cloud, about 10 minutes; the user guide walks through every step). You connect by entering a code at google.com/device, so it works the same on an office PC and in Docker, with no public address.
  - **Safety:** Canon only sends encrypted backups (a backup password is required) and can see only the files it put there.
  - **Restoring:** **Backups in Drive** lists them, and **Copy to this computer** brings one back to restore as usual.
  - The connection is kept when an older backup is restored.
- Database: no change.

## 0.16.0 — Languages anyone can add, and Chinese converted everywhere

- **Adding a language is a folder, not code.** Each language's words are in `locales/<code>/`:
  - `ui.json` for Canon's screens;
  - `outputs.json` for what is printed in bulletins and slides;
  - `server.json` for e-mails and public pages.

  A language with screen translations appears by itself, with a **UI** badge in Settings → Languages that shows how complete it is (e.g. "UI 82%"). Missing phrases show in English (or a chosen fallback language). `npm run i18n:new`, `npm run i18n:check` and `npm run i18n` help translators; see [CONTRIBUTING-TRANSLATIONS.md](CONTRIBUTING-TRANSLATIONS.md).
- **Simplified ⇄ Traditional Chinese, both ways and everywhere:**
  - Church content typed in one script now shows converted for someone reading the other: on Canon's screens (service lists, planner, calendar), in print, in e-mails, on the visitor welcome form and on the page for connecting an AI app.
  - The visitor form follows the service's languages: Traditional for a Traditional service, Malay for a Malay one, with English underneath.
  - For translators, Simplified and Traditional files follow each other: edit either and the other is converted, while wording written by hand in both is kept.
- **Faster to open:** each language's words are fetched only when someone uses that language, so the app's main download is about a third of its old size.
- The page for connecting an AI app is in the signed-in person's own language, with English underneath.
- The printed cash-count and offering forms are in the reader's language with English after each heading (before: Chinese only).
- Docker: the image now includes the user guide and translations (`docs/`, `locales/`).
- Database: no change.

## 0.15.10 — Leaders from the rota, a size for each language, and warnings you can read

- **Leaders come from the rota only.** An item's **Leader** is now a list of tick boxes with the people on the service's rota — no typed names:
  - with a **Role**, everyone on the rota for that role is ticked; untick some to print only those (e.g. one of two ushers);
  - without a role, tick anyone on the service's rota (nobody by default);
  - the **Preacher** is whoever leads the Sermon item; the Preacher box and the New service dialog no longer take a typed name.

  Names typed before still print while nobody from the rota is chosen; the planner flags them as **Typed earlier** with **Remove**. A copied service, or one made from a template, starts without typed names. AI assistants tick people with `leader_people`; they cannot type a leader or preacher.
- **Slide templates, a size for each language:** the Fonts step starts with the template's languages; each then has its font and its size against the others (60–160 %) — at the same point size Chinese looks smaller than English, so e.g. 115 % evens them out. Canon's slides and the PowerPoint file use it, and text still shrinks to fit.
- **Dashboard:** rest the pointer on a ⚠ or "open roles" badge in Upcoming — or tap it on a phone — to read the warnings or the roles still open.
- Database: version 31 — the people ticked for an item. Canon upgrades by itself on start.

## 0.15.9 — Cover slides, a closing slide, and who leads an item

- **An item's cover slide:** next to **On slides**, **Slides** chooses **Content only** (as before), **Cover only** — one slide with the item's title and who leads it, e.g. "Threefold Amen" instead of three amens — or **Cover, then content** (e.g. the reading's title and reader, then the passage). Service templates and their CSV (`slide_cover`), the PowerPoint and FreeShow files and AI assistants (`slide_cover` on `canon_edit_order`) follow it.
- **A closing slide:** each slide template can end the deck with a closing message in every language and the church name (on unless turned off; "Thank you for worshipping with us" until you change it), in Canon, the PowerPoint file and FreeShow.
- **Hymn slides:** the stanza number (or "Refrain") is on every slide of a stanza, not only the first; the run sheet still gives where each stanza starts.
- **Who leads an item:** when the rota has someone for an item's role, they are printed and shown, not a name typed in **Leader** — the planner now says so under **Leader**, and the empty box shows who the rota has. The service's **Preacher** box warns the same way when the rota has someone else for the sermon. The heading of an item in the order now follows the same rule as the outputs (before, with nobody on the rota, it showed the role's name instead of the typed leader).
- Database: version 30 — an item's cover slide choice. Canon upgrades by itself on start.

## 0.15.8 — Sample data, and tidier service details

- **Settings → Sample data** (administrators): add a fictional church to try Canon with — about 40 people in households with English names and Chinese names of their own, birthdays, cell groups by area, committees, fellowships, a Sunday school and people on every serving team, optionally on the next two Sundays' rotas — and remove exactly that again in one click.
- **A service's details:** the Bible version boxes no longer spill into the next column (Liturgical season) when a Bible's name is long; they shrink to fit and show the rest when opened.
- **Text in several languages** (a title, a sermon title…): when the language on screen is empty but another has words, the box shows them faintly (e.g. "简体中文: …"), so it is clear they are under the other tab.
- **The team's share page:** next week's names are in every language of the service, like today's.
- Database: no change.

## 0.15.7 — QR code placement, the library by section, a log file, and a lighter AI connector

- **The bulletin link's QR code on the title slide**: each slide template now chooses its corner and size (Small, Medium, Large) under **Screen shape and footer**. The PowerPoint download follows the same choice.
- **The library, section by section.** Export one section at a time as a library file:
  - each hymnal's hymns (words, numbers, sheet music);
  - songs in no hymnal;
  - liturgical texts;
  - each uploaded Bible;
  - QR codes & notes;
  - slide backgrounds, which the whole-library file now includes too.

  Each Library tab has an **Export** button and **Import a library file…**; Settings → Export data lists them all.
- **When Canon stops by itself:**
  - The window starts it again after 10 seconds, up to 10 times. Closing the window or pressing Ctrl+C still stops it for good.
  - Everything Canon prints is also written to `data/logs/canon-<date>.log`, with the last 30 days kept, so the reason for a stop is on disk.
- **AI connector, lighter:**
  - The longest tool descriptions were shortened, with the details moved to the agent handbook ("Writing services and songs").
  - The service tools no longer offer meeting-only fields.
  - Id-or-reference arguments are described more compactly.
  - Together this trims the fixed cost sent with every turn by about 9%: about 11,800 down to 10,700 tokens with the modules of a typical church.
  - `canon_whoami {"brief": true}` returns just who, role, scopes and access levels, at under a third of the size.
- **The team's share link** now shows what only the team needs, which the congregation's bulletin link leaves out: the service's notes ("Notes for the team", at the top), each item's notes under the item, and who serves at the next service, after today's serving team.
- **Settings → Languages:** the lock, download and delete buttons of an installed Bible stay on the first line of its row; only the name and badges wrap underneath, so long rows no longer leave a gap.
- Database: no change.

## 0.15.6 — Export data in one place; the library as one file; pages that fit a phone; the bulletin QR code on the title slide

- **Settings → Export data** (administrators):
  - one click for each part of Canon's CSVs, with the ones holding personal data marked;
  - **Download everything (zip)**: all of them plus the library file, with a note on what's inside (it is not a backup).
- **The library as one file** (`.canonlib`): hymnals, songs with words, numbers and sheet music, liturgical texts, QR codes & notes and, if you choose, uploaded Bibles.
  - **Import a library file…** on another Canon previews what it would add, then adds only what is missing. Songs and texts match by key or title, hymnals by abbreviation.
  - Uploaded Bibles are imported only with the church's confirmation that it may use them.
- **Share → Bulletin for the congregation**: its QR code is now in a corner of the **title slide**, the slide on screen while people arrive, instead of a slide of its own after it. This applies in Canon's slides and the PowerPoint file. The FreeShow project, which has no title slide, keeps it as its first show.
- On a phone or a narrow window, these pages now shrink to fit the screen's width instead of running off its edge: the bulletin preview, the run sheet, sheet music, printable visitor cards, the cash declaration, a month's offerings summary and QR labels. Printing is unchanged: always the real paper size.
- Database: no change.

## 0.15.5 — Sheet music from a phone or in bulk; menus that fit a phone

- **Sheet music from a phone.** A song's **Sheet music** has a **From a phone** button that shows a QR code.
  - Scan it, take photos of the hymnal page by page (or choose files), and they become the song's next pages.
  - No sign-in is needed. The link lasts 24 hours and takes up to 30 pages.
- **Upload sheet music in bulk** (Library → Hymns & songs).
  - Choose many scans named by hymnal number, e.g. `HP 178.jpg`, and `HP 178-2.jpg` for page 2.
  - Canon matches them to the hymns. You check the list, change or skip any, and add them after a hymn's pages or replace them.
- **AI assistants**: Claude can't upload files through the connector, but with the Library at Read & write, `canon_sheet_music_upload_link` gives you an upload link for a hymn (e.g. "add sheet music for HP 178").
- **Phones**: the ⋯ menus, the **Share** popover and the searchable pickers now stay on the screen instead of opening past its edge. Tall ones scroll inside.
- Database: upgraded to version 29 (upload links).

## 0.15.4 — Church spaces and double bookings; notes under the announcements

- **Spaces** (new in Settings, for administrators): the church's halls, rooms and other places.
  - Each space has a name in each language, a capacity and notes.
  - A space nothing was ever booked in can be deleted. One in use is archived instead: it stays on its bookings but isn't offered for new ones.
- **A space for every service, meeting and calendar event.** There is a **Space** field beside the date and time.
  - A group's next meeting keeps its space, and the calendar shows each item's space.
  - **Double bookings**: when the same space is booked at overlapping times, a warning lists the other bookings. It doesn't stop you saving, since sharing a hall can be on purpose.
  - A service lasts for the minutes of its order of service. A meeting, or a service without items, counts as an hour. An event without times counts as all day.
- **Reports → Spaces**:
  - use per space in the period (services, meetings, events, hours);
  - every double booking;
  - everything booked in the coming four weeks, to plan ahead.
- **Bulletin: notes under the section before them.** In a bulletin template's page layout, **Sermon notes** can now fill **the rest of the page under the section before it**, for example ruled lines under the announcements for members' own notes. The other choices are a page of its own, or only a spare page of a folded booklet. In the Word file it is a heading and ten lines.
- AI assistants can set a service's or meeting's space (`space_id`), and calendar items carry `space`.
- Database: upgraded to version 28 (spaces, and a space on services, meetings and events).

## 0.15.3 — Bulletin QR on slide 2; sheet music and administration for AI assistants; new greetings

- **Share → Bulletin for the congregation**: its QR code is now on a slide of its own right after the title slide (slide 2), to show as people arrive, instead of after the Announcements, which can come at the end. The run sheet notes slide 2. The PowerPoint export has it in the same place; the FreeShow project has it as a show of its own before the first item.
- The visitor form's QR code stays after the Announcements, where visitors are usually welcomed.
- **AI assistants: sheet music.** In Settings → AI / MCP, the Library row has a **Sheet music** switch, off by default.
  - When shared, `canon_sheet_music` lists a service's songs in order with their pages.
  - It can also send the scanned pages for Claude to read (key, range, tune). PDFs are not sent.
  - The pages become copies at the AI provider: share them only if the church may copy the music.
- **AI assistants: administration.** A new **Administration** row in Settings → AI / MCP, off by default and only for connections approved by an administrator.
  - **Read only**: the security checklist, backups, accounts (never passwords), the change log (values only when contact details are shared), who viewed member records, and a settings overview.
  - **Read & write** adds two actions: back up now, and run the checks (public address, backup folder, e-mail).
  - Accounts, roles and settings are still only changed in Canon.
- **Greetings**: the home page now and then says Shalom, Grace to you, Soli Deo gloria, Blessings, "The joy of the Lord is your strength", Maranatha (in Advent) or Hallelujah (never in Lent).
- Database: no change.

## 0.15.2 — Slide numbers on the run sheet, the bulletin on attendees' phones, sheet music

- **Run sheet: slide numbers.**
  - A **Slide** column gives each item's slides.
  - The AV cue says where each part starts, e.g. "1 → 3 · 2 → 6 · 3 → 9 · Refrain → 5, 8, 11" for a hymn with its refrain after every stanza, and where the QR code or note slide is.
  - The numbers match the slide footer, so the operator types one and presses Enter (which already worked, in the slides window and the presenter view).
- **The bulletin for the congregation.** **Share** in the Outputs bar has a second link, one per service, for attendees to read the bulletin on their phones. The page has:
  - the order of service, the words of the hymns and readings, and the announcements, with a language switch;
  - no serving team, team notes or contact details.

  Its QR code can go on that week's bulletin, on a slide after the Announcements, or anywhere else with **Download QR code**. The team's share link is unchanged.
- **Sheet music.** In the Library, a song takes scans or photos of its music (PNG, JPEG, WebP) or a PDF, up to 10 MB a page, in page order.
  - **Outputs → Sheet music**, beside the run sheet, shows the service's songs in order with the stanzas sung and their music, to print or open on a tablet.
  - Sheet music stays inside Canon and its backups: never on share pages, slides or for AI assistants.
- **Links phones can open.** The team's share link, the bulletin link, the visitor form, the team e-mails and the QR labels use the **Public address**. Without one they use this computer's address on the church network, no longer "localhost" or the computer's name.
- **Settings → Roles & permissions: a ⋯ menu on each role**, as on templates:
  - **Edit**.
  - **Duplicate**: a new role starting from a copy.
  - **Archive**: a role no account has. It is kept, but not offered for accounts, and waits under **Archived roles** until **Restore**.
  - **Delete**: your own unused roles.
- Database: upgraded to version 27. It adds the bulletin link per service, archived roles and a table for sheet music. The files themselves are kept with the church logo's, so backups include them.

## 0.15.1 — Settings: roles, and AI access beside the data it protects

- **Settings → Roles & permissions** is its own section, next to **User accounts**. Administrators edit the roles there; User accounts keeps the accounts and points to it. In Chinese the section is now 角色与权限, no longer the rota word 岗位.
- **Settings → AI / MCP**:
  - **Enable MCP server** takes effect at once, with no need to scroll down and save. Turning it off asks first, since every connected assistant loses access.
  - Module levels are saved with **Save AI access** in a bar that stays at the bottom of the window while there are unsaved changes.
- **Personal data for AI assistants, beside the data it protects.** The separate "Expose member contact details & birthdays" box is gone.
  - **Members register → Contact details & birthdays** (Off / Shared) covers members' phone numbers, e-mail and home addresses, birth dates, notes and reasons for absence, plus co-workers' and households' contact details.
  - **Service records → Visitors** has three levels:
    - **Off**: attendance numbers only. Agents get a count and cannot record visitors.
    - **Names & follow-up**: names, how they came and follow-up, without contact details.
    - **With contact details**: also phone or e-mail and prayer requests.
- **Stricter than before:**
  - With the Members register off, no contact details reach agents, including co-workers' and households'.
  - With Service records off, no visitors reach agents.
  - A connection approved by an account that doesn't see members' details gets visitors' names at most.
  - The approval page and the security checklist show both switches.
- **Your settings carry over.** Where the old box was on, Contact details stays on and Visitors starts at With contact details. Otherwise Contact details stays off and Visitors starts at Names & follow-up.
- Database: no change.

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
- **Self-service** (Loan rules): members borrow, renew and say they've returned books on their own phones, without a Canon account.
  - **Sign-in**: they scan a book's QR label and sign in with a 6-digit code e-mailed to their address on the member register. The code is valid for 10 minutes and works once.
  - **Renewal links**: reminder e-mails get a **Renew online** link. Opening it changes nothing; the button on the page renews.
  - **Returns**: a returned book waits under **On loan → To check in** for the librarian. Reminders stop meanwhile.
  - **Gates**: it switches on only when e-mail works (a test e-mail succeeded since the e-mail settings last changed), the public https address reaches this very Canon (Canon checks by calling itself), and the library is on with its rules saved. A gate that breaks pauses self-service, and phones are asked to see the librarian; it resumes by itself when the gate passes again.
  - **Limits and checklist**: code requests are limited per address and per e-mail. The security checklist shows it, with the sign-in codes sent this week.
- **QR labels** for copies and items, on A4 sticker sheets (24, 21 or 65 to a page, starting part-way through a used sheet) or a 62 mm label printer. The QR code holds the office computer's network address even when Canon is opened as localhost.
- **CSV import and export** for the catalogue (one row per title, with its copies) and the register.
- **Roles**: new ready-made **Librarian** and **Asset keeper** roles. They choose borrowers and custodians by name, without the member register. The other ready-made roles get sensible access: for example, the Secretary edits the library, the Treasurer edits the register, and the External guest reads the register. A church's own roles start without access.
- **AI assistants**: `canon_lending`, `canon_save_book`, `canon_equipment`, `canon_save_equipment`. They are off for agents until the administrator allows them. Agents add books and equipment and record maintenance; lending and returns stay at the desk.
- **Dashboard**: what is on loan and overdue, and maintenance due, when the modules are on.
- **Members' personal data** (PDPA export) lists their loans and the equipment they look after. Erasing them keeps past loans anonymised and clears them as custodian.
- **E-mail**: a successful test e-mail is remembered for the current settings, and an error that would stop every message (sign-in, connection) is remembered until a message goes through. These feed self-service's e-mail check.
- Database: version 26 adds the lending library, self-service and asset register tables, the two new roles, and every role's access to the new modules.

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
