# Canon user guide

Canon helps the church office plan the Sunday service, print the bulletin, project the slides and keep the registers. This guide follows the weekly routine. Labels in **bold** are exactly what you see on screen.

> **Tip:** Everything you type in one language can be typed in each of the church's languages. Simplified and Traditional Chinese convert automatically, so type Chinese only once. Where a dialog or a section has several such fields, the language switch at its top right (**EN** / **简** …) turns all of them to one language at once, and **Side by side** shows every language together. Each field also keeps its own small language tabs: click one to switch just that field, or hover over it to read the field in that language without switching.

## Getting started

### First sign-in

1. Open Canon in your browser (on the office PC: `http://localhost:3000`; other computers use the office PC's name instead of localhost). The number after the colon is the port: to use another one, your IT helper puts a line such as `set CANON_PORT=5018` in a file `canon.local.bat` next to `start-canon.bat`.
2. The first time, Canon shows **Welcome to Canon**. Choose the **Worship languages** (primary first), type the **Church name**, then your **Display name**, **Username** and **Password** (8 characters or more).
3. Press **Create administrator**. You can switch the interface between **EN**, **简体中文** and **繁體中文** at the top.

### Languages and Bibles

Next comes **Getting started**, the same panel as [Settings → Languages](/settings).

1. **Worship languages**: tick your languages; the first is the primary language.
2. **Bible**: for each language, press **Download & import** for a public-domain Bible (KJV, 和合本 and others) and choose the **Default version**.
3. **Bulletins & slides**: choose the **Languages printed and projected by default** (up to 3) and the **Bilingual layout** (**Side by side** or **Stacked**).
4. Press **Finish setup**.

> **Tip:** Licensed Bibles (ESV, 和合本修订版, 新译本…) can be uploaded later with **＋ Add a Bible**. See [Bibles](#bibles).

### Church details and logo

Open [Settings](/settings) → **Church**: the church name, **Church logo** (**Upload logo**: PNG, JPEG, WebP or SVG, up to 2 MB), address, **Contact line** (printed on the bulletin), **CCLI licence number** and **Default start time**. Press **Save**.

### Several congregations {#congregations}

If one church has several congregations — for example English, Chinese and Indonesian services — add them under **Settings → Church → Congregations** (**Add congregation**): a name, a **Short label** for badges (EN, 华, ID), a colour and the **Languages of its services**. Then:

- services, service templates, members and groups can each belong to a congregation (the **Congregation** field in their form);
- **Services**, **Members**, **Groups** and the rota get **All · EN · 华 · ID** filter buttons, remembered on this computer;
- a new service for a congregation starts with its languages, and a service template can belong to one so the services made from it do too.

A church with one congregation leaves the list empty and sees none of this. Deleting a congregation keeps its services, members and groups; they just lose the tag.

### Adding colleagues

**Settings → Users & access → Add user**. Choose a role:
- **Administrator**: everything, including settings, accounts and roles.
- **Pastor / Elder**: members with their details and notes, groups, meetings and services; sees the records and offerings.
- **Editor**: plans services and edits the registers, library, rota and records (as before 0.13).
- **Service planner**: services, templates, the library and the rota; members by name only.
- **Treasurer**: service records and offerings — enters, verifies and reopens cash counts; reads the rest.
- **Secretary**: the registers — members, co-workers, groups, meetings and service records (not offerings).
- **Read-only**: can view and print; no money, no members' contact details or notes.

**Roles** (below the accounts) shows what each role may do in each part of Canon: **No access**, **Read** or **Edit**, and whether it sees members' contact details and notes, fields marked sensitive, and may reopen verified cash counts. **Edit** a ready-made role to fit your church (the Administrator always keeps everything), or **New role** for anything else, e.g. a worship leader who edits services and the library. A role in use can't be deleted. Pages a role can't read are left out of the sidebar, and AI assistants acting for a person follow the same role. A role that doesn't see sensitive fields can't change them either: they aren't on its member form, so saving a member leaves them as they are.

**Signing in safely**:
- Five wrong passwords in a row lock an account for 15 minutes (the list shows **Locked**); **Reset password** unlocks it.
- **Two-step sign-in** (Settings → My profile → **Set up two-step sign-in**): scan the QR code with an authenticator app on your phone (Google or Microsoft Authenticator, 1Password …) and enter its code. From then on Canon asks for the 6-digit code after your password. Keep the **recovery codes** shown once: each signs you in once if you lose your phone.
- **Reset 2-step** (administrators, in the user list) turns it off for someone who lost their phone. In Security & privacy, **Require it for administrators** makes every administrator use it: one without it can't use administrator functions until they set it up.

**Limited to** (churches with several congregations): an account limited to one congregation sees that congregation's services, meetings, records, members, groups and events, and the whole church's — not those of other congregations; what it creates belongs to its congregation, and its reports are about it. The same holds for AI assistants acting for it, and for people reached through something else (a group's members, the rota, a household): other congregations' people are left out, and they can't be added to its groups or rota. Moving something to another congregation needs an account for the whole church. A household whose members are all in other congregations is hidden from it too. Administrators always see everything.
- **Meeting leaders**: link an account to the member it belongs to (the **Member** column). A member ticked **Leads** in a group, or chosen as a meeting's **Leader**, can then record those meetings with that account, even a read-only one: the headcount, new visitors with their contact details (for the follow-up), notes and the offering with its cash count and signing, the meeting's details and its next meeting. Nothing else changes for them: services, other meetings and the registers stay read-only, and deleting a meeting or reopening a verified count stays with editors and administrators.

| What | Admin | Editor | Viewer |
|---|---|---|---|
| See services, library, registers, groups, rota | ✓ | ✓ | ✓ |
| Members' phone, e-mail, address, notes, reasons for absence, birth year | ✓ | ✓ | — (names, households, groups and birthdays — day and month — only) |
| Plan services; edit library, members, co-workers, groups, rota, templates | ✓ | ✓ | — |
| Service records: attendance and notes | ✓ | ✓ | see only |
| Record the meetings they lead (linked to a member who leads them) | ✓ | ✓ | ✓ |
| Service records: offerings and visitors' contact details | ✓ | ✓ (until the cash count is verified) | — |
| Reopen a verified cash count | ✓ | — | — |
| Delete a service record entered by mistake | ✓ | — | — |
| Visitor form: switch it on for a service, review visitors' entries | ✓ | ✓ | — |
| Visitor form: switch it on for the church, its texts | ✓ | — | — |
| Reports: attendance, visitors, serving, songs and Scripture, membership | ✓ | ✓ | ✓ (visitors without contact details) |
| Reports: offerings, and the monthly summary for the treasurer | ✓ | ✓ | — |
| Import CSV; export personal data | ✓ | ✓ | — |
| Send reminder e-mails | ✓ | ✓ | — |
| Church defaults (slide, bulletin and service templates) | ✓ | — | — |
| Settings: church, congregations, languages, users, offerings, e-mail, backups and restore, change log, AI / MCP | ✓ | — | — |
| Add or delete Bibles | ✓ | — | — |

An AI assistant always works as the person who connected it and never gets more than their role allows (see [AI assistants](#ai-assistants)).

## Every week

The sidebar groups the pages: **Planner** (services, meetings, the library and the three kinds of template), **Congregation** (groups, members, co-workers, volunteers), **Records** and **Administration**. Click a section's name to fold it away, and again to open it; Canon remembers this in your browser, and going to a page in a folded section opens it again.

The [Dashboard](/) is the home page: the next service and its status, open roster roles and clashes for the coming weeks, upcoming birthdays, and quick links to the bulletin and slides. Its greeting follows the time of day and the church year (Advent, Christmas, Easter …), with its own on Sundays and the great feasts. At the bottom, the library: the number of hymns and of liturgical texts, and the Bible versions installed for each language; each card opens that part of the Library.

The [Calendar](/calendar) shows services, meetings and the church's other events together: **Month**, **Week** or **List** (the next eight weeks; phones show a list), for a congregation (with the whole church's items) and a group. Click a service or meeting to open it. **New event** (editors) adds anything else on the church's calendar — a camp, a wedding, a working bee — with its dates (**Until** for several days), times, place, congregation and group; click an event to change or delete it.

### 1. Plan Sunday's service

1. Go to [Services](/services) and press **＋ New service**.
2. Check the **Date** (next Sunday is filled in), add the **Preacher**, **Sermon text** (e.g. Isaiah 6:1-8) and **Sermon title**.
3. Choose a **Template** (or **Blank service**) and press **New service**. The planner opens.

**The order of worship**

- Hover between two items and press the small **＋** (**Insert here**). Pick a kind (**Hymn**, **Scripture Reading**, **Liturgy**, **Prayer**…), then search, or choose **Add an empty slot to fill later**.
- Or use the library panel on the right (**Hymns & psalms**, **Creeds & liturgy**, **Scripture**, **Elements**): click an entry to add it, or drag it into the order.
- Each hymn shows when it was **last sung** before this service's date (or **never sung**); it is highlighted when it was sung in the four weeks before, so you notice repetition.
- To reorder, drag the grip, or open an item and press **Move up** / **Move down**.
- A **Hymn ?** or **Reference ?** badge means a slot still needs filling.

**Editing an item** — click it. Changes save by themselves.

- **Hymn**: choose the song, tick the **Stanzas** to sing (the refrain prints automatically). If it is in several hymnals, **Hymnal** picks which number is shown.
- **Scripture**: type the **Reference** (`Romans 8:28-39`, `Ps 23`, `约 3:16`). **Bible version** can differ per language for this reading.
- **Liturgy**: choose the text. For a catechism, type the **Questions**, e.g. `1-3` or `Q4-6`; **Next block** moves on to the next questions.
- **Posture**: stand (众立) or sit (众坐) prints on the bulletin.
- **In bulletin**: **Template default**, **Full text**, **Title only** or **Hidden**. **On slides** includes or leaves out the item.
- **Role** fills the leader from the roster; **Leader** is free text.
- **QR codes & notes on slides** adds a QR code or a short note to the item's slides.
- **Slide background** puts a picture behind this item's slides only (for example bread and cup for the Lord's Supper), instead of the slide template's background. Choose from **Library → Slide backgrounds** (type to search). The picture is faded with the template's background colour so the words stay readable, and it is used in the PowerPoint download too.

**Service details** — press **Edit…** above the order to change the date, time, languages (up to 3), **Bible versions**, **Liturgical season**, **Bulletin cover**, **Bulletin template**, **Slide theme** and a **Reference** — your own short code for the service, e.g. `EN-2026-12-25`. Press **Save** in that card.

**References.** Services and all three kinds of template can carry a **Reference**: a short code you choose (letters, digits and - _ . without spaces, e.g. `EN-001` or `CN-10pmService`), unique within its kind. It shows as a small code badge and can be used instead of the name — by people, and by AI assistants: “create next Sunday’s service from template CN-10pmService”. Set it in the service details, in the service template editor, or with **Set reference…** in the **⋯** menu of a slide or bulletin template.

When the service is ready, switch **Draft** to **Final** at the top.

> **Tip:** in the **⋯** menu at the end of the **Outputs** bar, **Duplicate** copies a service to another date (optionally with the roster) and **Save as template** turns a good order into a template. **Delete this service** is there too.

### 2. Roster and reminders

Open the **Team & roster** tab.

1. Under each role, press **＋ Add** and choose a person (**Qualified for** lists the usual people first; people who are away are marked).
2. Click a name to change its status: **Scheduled → Confirmed → Declined**. **×** removes it.
3. Read the **Warnings** panel: unfilled roles, double bookings, people who are away.
4. Press **Send reminders**. Tick the **Recipients**, add a **Note** if needed, check the **Preview**, then **Send to N** → **Send now**.

> **Tip:** Nothing is ever e-mailed automatically, and sent e-mails cannot be recalled. Turn on the share link first if you want the order of service in the e-mail. E-mail must be set up in Settings → **E-mail**.

### 3. Print the bulletin

**This week's announcements** — open the planner's **Bulletin** tab (next to **Order of worship** and **Team & roster**). It lists the weekly sections of the service's bulletin template: **Announcements** first (家讯 / 报告事项), then any weekly text such as a **Pastor's note**. Type each one in every language you need; it saves by itself. **Numbered lines print as a list.** The **Announcements** item stays in the order of worship as a timed item, but its words now print in the announcements section. An older service whose announcements were typed in that item shows them pre-filled with **save to keep**. If the tab says **This template has no weekly sections**, add an **Announcements** or **Weekly text** section to the template's page layout.

1. In the planner's **Outputs** bar, press **Bulletin**.
2. Choose the **Template**, **Paper** (usually **A4 landscape, folded (A5 booklet)**), languages, layout and **Font size**.
3. Press **Print**.

> **Tip:** For booklets: **print double-sided, flip on short edge, then fold.** A folded booklet needs a multiple of 4 pages: a note such as "5 pages — 3 blank pages will be added to make a folded booklet (8 pages)" means blank pages go in before the back cover. If a warning says content is taller than a page, reduce the font size or print fewer words (change **In bulletin** on long items).

### 4. Project the slides

1. Press **Slides** in the **Outputs** bar. They open in a new tab; drag that tab to the projector screen and press **F** for full screen.
2. Press **Open presenter window** for your own screen: current and next slide, notes and a clock. Both windows must be in the same browser on the same computer.

| Key | Action |
|---|---|
| → / Space / Enter | Next slide |
| ← / Backspace | Previous slide |
| **B** | Black screen on/off |
| **W** | Clear text (background only) |
| **F** | Full screen |
| **O** | Overview of all slides |
| number + Enter | Jump to that slide |

**Files** → **PowerPoint** in the **Outputs** bar downloads the slides as a PowerPoint file, for a computer without Canon or to send to the AV team. It uses the service's slide template (colours, background picture, fonts, text size, lines per slide, footer and screen shape); **Custom CSS** is not carried over. Open it in PowerPoint and press **F5**.

**Approve** (in the **Outputs** bar; anyone who may edit the service): keeps a copy of the bulletin and slides as they are now — the words, order, people, bulletin template and slide template — with the date and who approved it, and an optional note. The button then shows **Approved**, or **Changed since approved** once the service changes. **Approved versions** lists them; **Bulletin** or **Slides** next to one opens that version exactly as it was approved (a green line at the top says so), even after the service has changed. Pictures are referred to, not copied.

### 5. Share with the team

- **Run sheet**: a printable timed list with leaders and AV cues for the team.
- **Share** (in the **Outputs** bar; it shows **On** while the link works): press **Enable link**, then **Copy** and send the link. It is read-only and shows no contact details. **Disable link** stops it; turning it on again makes a new link.
- **Files** → **PowerPoint**, **Word document** and **FreeShow project** download files for other programs.
- An AI assistant connected to Canon can also make **download links** for these files (they stop working after a day or so). Anyone with such a link can download that file without signing in, so send it only to the people who need it.
- **Email the team** opens your own e-mail program with the team in BCC.

## Library

Open [Library](/library).

### Hymns and hymnals

- **Hymns & songs**: search by title, words or number (`HP 123`). **New song**: title, author, tune, **Stanzas** (label `R` for a refrain), **Hymnal numbers**. Untick **Public domain** to add the copyright line and **CCLI song #**.
- **Hymnals**: **New hymnal** with an **Abbreviation** (shown before numbers, e.g. HP 123). The first hymnal is the default for numbers.
- To load a hymnal's index (numbers and titles), use **Import CSV…** on the hymnal. Songs not yet in the library are added as title-only songs tagged *needs-words*; words are never imported.

> **Tip:** Copyrighted hymn words may only be typed in under your church's licence.

### Liturgical texts and catechisms

- **New text**: choose the category (Call to worship, Confession, Creed, Catechism…). Responsive lines start with `L:` (leader), `C:` (congregation) or `A:` (all); a blank line starts a new paragraph or slide.
- **Use numbered parts** splits a long text into parts (e.g. questions). For a catechism, line 1 is `L: question`, line 2 `C: answer`.
- **Import Westminster Standards** (admins) adds the Shorter and Larger Catechisms and the Confession (English).

### Bibles

- Library → **Bible**: look up a **Reference** or **Search** words; **＋ Compare** shows up to 4 versions side by side.
- To add a licensed Bible: **Settings → Languages → ＋ Add a Bible**. Download the CSV template (`book, chapter, verse, text`), save from Excel as **CSV UTF-8**, tick the permission box, check the preview, then **Import**.
  - **Licence and allowed uses** (administrators): the lock button next to an installed version records its **Edition**, the **Licence** text and what it may be used for — **Printed** (bulletins, Word files), **Projected** (slides, presentation files, FreeShow) and **Online** (the public share page). A newly uploaded version is printed and projected but not put online until you tick **Online**; public-domain versions allow everything. Where a use isn't allowed, that output shows the passage's reference without the text, and the service planner warns above the order (**Bible licence**) so you can choose another version or paste licensed text. Uploading the version again keeps what you recorded.
  - **Indonesian**: Canon does not include an Indonesian Bible. The usual versions (Terjemahan Baru, and the older Terjemahan Lama) are held by Lembaga Alkitab Indonesia, so a church uploads the one it uses with the Bible Society's permission.

### QR codes & notes

**Library → QR codes & notes** holds **New QR code**, **New picture** and **New note** blocks, used on the bulletin's back cover and on slides (e.g. the giving link or the Wi-Fi).

### Check the library

**Check library** (on the Hymns & songs, Liturgical texts and Bible tabs) lists songs and texts whose languages have drifted apart — a verse or part with words in one language but not the other, different numbers of lines or paragraphs, Leader / People lines in a different order — and possible duplicates (the same title twice, a hymnal number used twice), and Bible versions with fewer verses in a chapter (usually different numbering, sometimes a missing book). **Check** items probably need fixing; **Note** items may be fine. An AI assistant can work through the list with you (the **check_library** playbook).

### Slide backgrounds

**Library → Slide backgrounds** keeps full-screen pictures for the slides of one service item. **Add background…** uploads a PNG, JPEG or WebP (up to 10 MB); each shows its size, with a warning when it is smaller than the screen (use 1920 × 1080 for widescreen projectors, 1440 × 1080 for 4:3), and how many items use it. **Rename**, **Replace** (every item using it gets the new picture) or delete one; items that used a deleted background go back to the template's.

## Templates

- [Service templates](/templates): reusable orders of worship. Hymn slots stay empty to fill each week. **New template**, **Edit**, **Use template**; the other actions are in the card's **⋯** menu, as on the slide and bulletin template pages. **Set as church default** (administrators) picks the template **New service** starts from; it shows a **Church default** badge. In the editor, a service template can also choose its **Slide template** and **Bulletin template**: new services made from it start with these (each service can still choose others), so an evening Chinese service template brings its own bulletin and slides. **Saving a service as a template** keeps its slide and bulletin templates and congregation. **Archive** (in the **⋯** menu) moves a template you no longer use to **Archived templates** at the bottom of the page — see the archive rules below; they are the same for all three kinds of template.

Bulletin templates and slide templates both open on a gallery. Each card has a main button (**Edit** for your own templates, **Preview** for built-in ones) and a **⋯** menu:

- **Set as church default** (administrators): services use this template unless they choose another.
- **Make a copy to customise** / **Duplicate**: built-in templates come with Canon and can't be changed or deleted, so copy one and change the copy.
- **Archive** leaves a template out of the lists in the service planner (services already using it keep it). Archived templates are under **Archived templates** at the bottom of the page; **Restore** brings one back. The church default can't be archived; making an archived template the church default restores it.
- **Export to a file** saves the template as one file (with its background picture, or the QR codes and pictures its pages print), to copy to another computer or share with another church. **Import a template file…** at the top of the page adds it as a new template; QR codes and notes it needs are added to the Library unless one of the same name is already there.
- **Delete** (administrators): only archived templates can be deleted, and never Canon's built-in ones (they can only be archived). Archive first, then delete from **Archived templates**. Services using a deleted slide or bulletin template go back to the church default; services made from a deleted service template keep their order of service.

The editor shows the settings in numbered steps that fold open, with a large live preview beside them. Changes appear in the preview straight away; **Save changes** in the bar at the bottom keeps them, **Discard** drops them. Point at a **?** for a short explanation, or press **How this works** to come back here.

### Bulletin templates {#bulletin-templates}

[Bulletin templates](/bulletin-templates) decide what the printed bulletin includes. The **Live preview** shows every page of a sample service.

1. **Paper and languages**: paper (usually A4 landscape, folded into an A5 booklet), font size, all languages or the main one only, side by side or one after the other.
2. **What to print** for each kind of item: all the words, the first verse only, or the title / reference only.
3. **Cover and order of service**: cover style, banner colours, list or table, hymn numbers, posture, leaders and times.
4. **Page layout**: the list of sections in print order: **Cover page or banner**, **Order of service**, **Full words** (creeds, catechism and hymns gathered after the order), **Announcements**, **Weekly text**, **Fixed text**, **Serving today**, **Serving next week**, a bold **Note**, **QR codes, pictures and notes**, a **Sermon notes page** and **Copyright notices and church contact**. Drag a section (or use ↑ ↓) to reorder it; **Add section ▾** and **Add page break** add more.
   - Each section can **Start a new page**, be **Kept together** on one page, or go **On the back cover**, which always prints on the last page (a folded booklet puts its blank pages before it).
   - A **Fixed text** (a welcome, the church's vision, giving details) is the same every week and is typed in the template. A **Weekly text** (a pastor's note, prayer requests) and the **Announcements** are typed per service in the planner's **Bulletin** tab.

### Slide templates {#slide-templates}

[Slide templates](/slide-templates) decide how the slides look on the projector and in the **PowerPoint** download. The preview shows a title slide, hymn words, a reading and responsive liturgy; click one to see it large.

1. **Colours and background**: dark or light starting point, the four colours, a background picture and how much to fade it.
2. **Fonts and text size**: a font for each script your church uses (only fonts installed on the projector computer work), text size, line spacing, alignment.
3. **How much on each slide**: **Lines per slide** (default: 2 lines per language when two or more languages show, 3 for one language; in readings, creeds and prayers a line is one sentence; a sentence can span several lines of a creed or prayer, and keeps its line breaks on the slide). **Same text size on every slide** keeps the size steady through the whole service.
4. **Screen shape and footer**: **Widescreen 16:9** (most projectors and TVs) or **Standard 4:3** (older, squarer projectors); scripture reference, church name and slide number in the footer; the posture cue.
5. **Custom CSS (advanced)** is optional and does not carry over to the PowerPoint download.

> **Tip:** FreeShow sets its screen shape in its own output settings, so the FreeShow project ignores the template's screen shape.

## People

- [Groups](/groups): committees, fellowships, cell groups, ministries and **Serving teams**. **Add group**, then **Add members** with a **Role in group** and term dates. To keep history, set an end date or untick **Active** instead of deleting.
  - Every volunteer team is also a **Serving team** group: its members are the team roster, with roles (a **Leader** role makes a team leader) and term dates like any group. Teams are added, renamed and deleted in **Volunteers**, where their rota roles are; renaming in either place renames both.
  - **Leads**: tick it for the people who lead a group (a **Leader**, **Chair** or **Teacher** role ticks it when they are added). Leaders can record the group's meetings — see [Meetings](/meetings).
  - A **Sunday school class** is a group too: its teachers lead it, its pupils are its members, and **Ages** gives the pupils' age range.
- [Meetings](/meetings): fellowship meetings, cell groups, prayer meetings, Sunday school classes, committee meetings and one-off gatherings — a lighter kind of service with its own record.
  - **New meeting**: choose a group and a date. A group's new meeting copies its previous one (time, place, leader, whether an offering is taken); the first one takes the group's name. For a one-off meeting choose **No group** and give it a title.
  - On the meeting's page: **Title**, **Date**, **Start time**, **Place**, **Leader** (a member; type a name instead for someone outside the register), **Passage**, **Topic** and notes. **Next meeting** copies the meeting to another date (a week later unless you change it).
  - **An offering is taken at this meeting**: on or off for each meeting (the next one copies it). With an offering, the record has the cash count, declaration and signing, as for a service; without one, it has headcount, new visitors and notes only, and the meeting stays out of the offerings reports.
  - **Visitors can fill in a form on their phone**: the same visitor form as a service's (Settings → Visitor form must be on). Tick it and the meeting gets its own QR code and link, with **Print cards**; entries wait below until you **accept** them into the meeting's record. The meeting's leader can do this too.
  - **Record this meeting** opens its record. An order of service, bulletin and slides are optional (**Add an order of service**).
  - **Meeting pattern** (in **Edit group**): **Every week**, **Every two weeks** or **Once a month** (the first … fourth or last weekday), with the **Start time** and **Place**. **Create meetings ahead** makes the meetings for that many weeks each day (0 = only when you press **Create meetings ahead** in the group), each copying the one before, so the leader just opens tonight's meeting. A meeting can still be moved or deleted on its own.
- [Members](/members): **Add person** with names, **Chinese name**, **Honorific title** (弟兄, 姐妹, Bro., Sis., Rev.…), contact, status, baptism and membership dates, household, and the church's own fields under **More details** (see below). **Birthdays** lists the coming birthdays. A yes / no or choice field can filter the list (**All members** ▾). Read-only accounts see names, households, groups and birthdays (day and month), but not contact details, notes, ages or sensitive fields.
  - **A member's personal data (PDPA)** — administrators, on the member's page: **Personal data** downloads everything Canon holds about them (details, household, groups, teams, serving, time away, staff record, account, e-mails sent, who viewed the record, changes, and where their name is typed on services) as a file to give them. **Erase…** erases it when they ask: type their name to confirm. Their name, contact details, dates, notes and church fields are cleared for good; qualifications, team places, time away, staff records and future duties are removed; their account is unlinked; and the change log (with its archives) forgets them. Past rotas and group histories keep an anonymous "(erased)" so counts stay right. Names typed on services and offering records (preacher, counters, signatures) are kept as church records. Backups keep their copies until they are removed.
- [Co-workers](/coworkers): pastors, elders, deacons and staff. **Add co-worker**, choose the person, **Position** and **Category**. **Add to committee…** tags them with their committees.
- [Volunteers](/volunteers):
  - **Teams & roles**: **Add team**, **Add role** with **Needed per service** and **Qualified people**. Someone qualified for a role joins that team's roster (its Serving team group) automatically.
  - **Rota**: pick a period, press **Auto-fill** to fill empty slots fairly, click names to change status, **Print**.
  - **Unavailability**: **Add unavailability** for people who are away; auto-fill skips them.

## Importing from Excel

Most lists have **Download template**, **Export** and **Import CSV…**.

1. Press **Download template** and fill it in Excel.
2. Save with **Save As → CSV UTF-8 (Comma delimited)**.
3. Press **Import CSV…** and choose the file. Nothing is saved yet: the preview shows what is **new**, **to update**, **unchanged** and **with problems**.
4. Press **Import N rows**, or **Import valid rows and skip errors**.

> **Tip:** Importing the same file twice is safe: existing records are matched and updated, not duplicated.

Exports and imports follow the account's access, like the screens: an account limited to one congregation exports, previews and updates only its congregation's people (and the whole church's), and a role that doesn't see sensitive member fields gets no column for them — a column for one in a file it imports is ignored, so the stored values stay.

## Service records {#service-records}

[Service records](/records) (under **Records** in the sidebar) keeps what happened at each service held: attendance, new visitors, notes for the team and the offerings. The list shows the last 8 weeks, 6 months or 12 months (and a congregation, if your church has several), with the average attendance, the number of new visitors and the offering total. Click a service to open its record. **Services** / **Meetings** switches between services and the meetings of groups (see [Meetings](/meetings)), so a cell group's headcount never lowers a Sunday's average; a meeting without an offering shows **No offering**.

- **Attendance**: **People present** (adults and children), **of whom children**, and **Online** if you stream.
- **New visitors**: name, contact, **How they came**, **Follow-up by**, **Follow-up** (New, Contacted, Came back, Joined the church) and notes. Visitors' details are personal data: record only what the church needs to follow up.
- **Notes for the team**: what went well, what to fix, prayer needs.
- **Offerings**: one line per fund and method (cash, cheque, bank transfer, PayNow, card), with totals per method. Administrators set the currency and the funds in **Settings → Offerings**.
- **Another currency**: when a gift comes in another currency (say a USD note in an SGD church), set that line's **Currency** (pick **Other…** to type any three-letter code, e.g. THB). Each currency is totalled on its own and never converted: the list and the totals show the church's currency, with the others listed underneath (“+ USD 20.00”).
- **Cash count**: the number of each note and coin; Canon adds them up and shows any difference from the cash lines. Cash in another currency gets its own count under **Cash in USD** (or just a **Counted total** for currencies Canon has no notes and coins for), and an optional **Value once exchanged** in the church's currency for the treasurer (not added to the totals). Every currency's count must match its cash lines.
- **Signing the count**: administrators choose in **Settings → Offerings** how counters sign, and the **Minimum counters** (2 by default; more may always count and sign):
  - **On paper** (the default): enter at least the minimum number of **Counted by** names and the **Date counted** (pick it from the calendar; left empty, the service date is used), print the declaration for them to sign — their names and the date are already filled in — then **Mark as counted and verified**.
  - **On screen**: once every count matches, each counter types their name and signs on the record with a finger, pen or mouse (**Sign the count**). Any number may sign. When everyone has signed — at least the minimum — press **Finish – all counters have signed**: that verifies the count. The signatures belong to that exact cash: if an administrator reopens the count, or the cash changes before finishing, the signatures are removed and the counters sign again.
  - **Counters approve from their own accounts** (with **On screen**): instead of drawing, each counter signs in to Canon on their own account and presses **Approve from my account**. Signatures drawn on one device passed round can't show that different people counted; approvals from different accounts can, so with this setting only they count towards the minimum. The record and the declaration show how each counter signed.

  After verification the cash is locked for everyone: cash lines, the notes and coins counted, the counters and the date. Offerings by other methods can still be added — for example a bank transfer that arrives later. To correct the cash, an administrator presses **Reopen cash count**, changes it, and the count is verified (or signed) again. Attendance, visitors and notes can still be updated.
- **Deleting**: a service that has a record cannot be deleted, so its attendance and offerings are never lost by accident. If a record was entered by mistake, an administrator can **Delete record** on the record page (a verified count must be reopened first); the change log keeps a copy, offerings in full.
- **Print cash-count declaration** prints an A4 page with the count (each currency separately), the totals by method, a short declaration, and the counters' signatures — drawn on screen, or blank name, signature and date lines to sign on paper. Churches that sign on screen can still print blank lines as a fallback before anyone has signed.

Read-only users see attendance and notes only, without offerings or visitors' contact details. Every change is in **Settings → Change log** (an administrator's **History** button on the record shows just that service).

## Visitor form {#visitor-form}

Visitors can tell you they came by filling in a short form on their phone: **name**, **phone or e-mail** (optional), **Which describes you best?** (optional — e.g. interested in the Christian faith, a believer not yet baptised, a baptised Christian, visiting or travelling, looking for a church home), **How did you hear about us?** (optional — choices such as a friend invited me, walked past, social media, or **Other** with their own words), **I would like someone to contact me**, and — if the church offers it — a **prayer request** (optional). A box to agree to the church keeping their details must be ticked when they leave contact details or a prayer request.

1. An administrator switches it on in **Settings → Visitor form**, and can change the **Welcome text**, the **Consent text**, the answers offered for **Which describes you best?** (remove them all to leave the question out) and **How did you hear about us?**, whether to offer the prayer request box, and until how many days after the service entries are accepted (from the day before the service). Chosen answers are kept in the church's first language, so the New visitors report counts the same answer together; staff typing **How they came** on a record get the same answers as suggestions.
2. On a service, the **Visitor form** tab switches the form on for that service. Choose where its QR code appears: **Print the QR code on the bulletin's back page**, **Show the QR code on a slide after the Announcements**, or **Print cards** (eight to an A4 page for the welcome desk or the pews) — any or all.
3. Entries do not go straight into the records: they wait under **Visitor cards to review** (on the service's Visitor form tab and on its service record; the records list shows how many wait). **Accept** adds the visitor to the service's **New visitors** (marked "via visitor form", with any prayer request); **Discard** deletes spam or duplicates.

The form is a public page: anyone with the service's link or QR code can open it without signing in, so phones need to reach Canon — set the **Public address** in Settings → AI / MCP. Without one, the link uses the address Canon was opened at when the form was switched on, which works only on the church's own network — and not at all if that was "localhost" (the tab warns you: open Canon by its network address, as other computers do, and switch the form off and on). The page shows only the church name and the service's title and date, has no scripts, and refuses entries that come too fast, too often from one place, or outside the open days. Contact details, prayer requests and how visitors describe themselves are personal data (PDPA): read-only users and AI assistants never see them unless personal data is shared; the New visitors report shows only how many chose each answer (**Who they are**, for editors and administrators). One place — for example the church's Wi-Fi, where all phones share one internet address — can send up to 40 entries in 10 minutes.

## Reports {#reports}

[Reports](/reports) (under **Records** in the sidebar) sums up a period: choose **Last 3 / 6 / 12 months**, **This year**, **Last year** or **Choose dates…**, and a congregation if your church has several. Reports are about services unless you choose **Meetings** (and a group, or **All groups**); serving and membership are always about services and people. **Print** prints the report on the screen; the **CSV** button on each table downloads it for Excel.

- **Attendance**: the average, the same period last year (with the change in %), the highest service, children and online, a chart of each service with a four-week average (dashed), and averages per month and congregation.
- **Offerings** (editors and administrators): totals by fund and month and by payment method, in the church's currency; other currencies listed separately and never converted; cash counts still waiting to be verified, with how many days they have waited. **Monthly summary for the treasurer** opens one printable A4 page for a month: totals by fund and method, each service with its cash count, other currencies, and lines to sign.
- **New visitors**: how many came, and how many were contacted, came back and joined the church (set on each service record under **Follow-up**), how they came, and per month. These count entries on service records: someone entered at two services counts twice, as Canon does not link visitors across services. Read-only users see names only.
- **Serving**: how often each person served (and declined), team members who were not rostered, and **Roles that are hard to fill** — short of people at some services, or with too few qualified people.
- **Songs**: how often each song was sung, with its copyright and CCLI number (export the list for your licence report), and songs not sung in the period.
- **Scripture**: every book and chapter of the Bible as a grid of small squares — blue where a chapter was read in a service, gold where it was preached on, half and half for both, darker when more often. Click a square to see when. Choose one or more **Years** (they need not follow each other, e.g. 2023 and 2025) instead of the period, and tick **Only books with readings or sermons** for a shorter list. The totals show how much of the Bible, and of each Testament, the church has read or preached; useful for planning a series on books not yet covered.
- **Membership**: members and regulars, by status, age, gender and congregation, and who joined or was baptised in the period.

## Settings

Open [Settings](/settings).

- **My profile** (everyone; for administrators it is the first tab): display name, interface language, **Change password**.
- **Church**, **Languages**, **Users & access**: see [Getting started](#getting-started).
- **Modules** (administrators; also offered when Canon is first set up): turn off the parts your church doesn't use — **Meetings and calendar**, **Volunteers and rota**, **Visitor form**. A part that is off is hidden for everyone (the sidebar, the planner's tabs, settings and reports), refused by the server, and AI assistants don't see it. Nothing is deleted: turning it on again brings everything back.
- **Member fields** (administrators): your own fields on the member register — **Text**, **Date**, **Yes / no** or **Choice from a list** (with its choices), each with a label in the church's languages, e.g. "Cell group leader?", "Joined via", "Dietary needs". Tick **Sensitive** to hide a field from read-only accounts and AI assistants (unless personal data is shared). They show on each member's page under **More details**, filter the members list, and are columns in the members CSV (`custom_…`). Removing a field hides it; values already entered are kept and come back if the field is added again.
- **Offerings** (administrators): the church's currency, the funds offerings go to, **Signing the count** (on paper or on screen) and the **Minimum counters** — see [Service records](#service-records).
- **E-mail**: choose the **Provider** (Gmail, Microsoft 365 or other), fill in the SMTP details and **Save**, then **Send test**. Gmail needs an app password.
- **Security & privacy** (administrators): a **Security checklist** in plain words — disk encryption (tick **Done** once BitLocker or similar is on; Canon cannot see it), automatic backups and their age, where backups are kept, backup encryption, the public address, how many administrators, accounts not used for six months, whether AI assistants receive personal data, the visitor form and how long logs are kept — each with what to do. Below it, **Who viewed member records**: every time someone opened a member's page, an AI assistant read a member, or the members list was exported (the same person and page within 10 minutes count once), with filters, **Export CSV** and the change log's **Keep** period. **Keeping and archiving**: **Erase visitors' contact details after** (default 24 months — phone or e-mail, prayer request, how they described themselves and notes go; names, how they came and follow-up stay, so reports still count) and **Archive records older than** (default 5 years) for service records with their offerings, and **Archive logs older than** (**Same as records** unless you choose fewer or more years) for the change log, AI activity and record views. **Check what can be archived** shows which whole years qualify; **Archive now** moves those years' service records (with offerings) and log entries into one read-only file per year in `data/archives` — the services themselves stay. Archived years can be **Open**ed (service records and change log, read-only) or **Download**ed, and every backup copies the archive files too.
  - **Archiving never overwrites a record.** If a restored backup brings back a record that is also in an archive, archiving goes ahead only when the two are exactly the same. Otherwise it stops and leaves the live record as it is; bring the archived one back and compare them.
  - **An archived record is read-only.** Its service shows **Archived** on Service records. Nobody can start a new record for it, delete the service or move it to another date. To correct an archived record, open its year and press **Bring back**: the record returns to Service records (logged), and the next archiving files it again.
  - **Erasing visitors' details covers every copy Canon keeps:** the service records, the archive files and the change log, including entries for services that were deleted since. Archiving erases first, so expired details never reach an archive. Backups keep their copies until they are removed (Settings → Backups → keep the newest); a restored backup is erased again straight away.
  - **The change log's Keep period still applies:** if it is shorter than the archive age, log entries are removed before they are old enough to archive, and Canon says so here. Keep the change log longer if the archives should hold the history too.
  - **Reports cover the live records only:** when a period includes archived years, the Reports page says which.
- **Change log** (administrators): every change made in Canon, by an AI agent or by a CSV import — who, when, how, and each field's old → new value. Filter by what (members, services, songs…), who, how, added / changed / deleted, dates or words, and page through older entries. **Export CSV** downloads every entry matching the filters (up to 20,000) for Excel. **Keep** sets how many months are kept (older entries are deleted once a day). Passwords are never recorded. A member's **History** button shows the changes to that person.
- **AI / MCP**: see below.

## AI assistants

Canon can connect to Claude (claude.ai) so you can ask, for example, "plan next Sunday's service on Romans 8" or "who is still missing from the rota?".

### Connecting Claude

1. Claude needs a public **https** address for Canon, usually through a tunnel set up by your IT helper.
2. **Settings → AI / MCP**: turn on **Enable MCP server**, paste the **Public address**, press **Check**, then **Save**.
3. Set each module under **Module access** to **Off**, **Read only** or **Read & write**, and press **Save AI access**. **Service records** (attendance, visitors' names and follow-up, notes) and, inside it, **Offerings (contributions)** are off until you switch them on; offerings can only ever be read — Claude never changes money, signs or verifies a count, and read-only accounts never see offerings.
4. In claude.ai: **Settings → Connectors → Add custom connector**, paste the **Connector URL**, leave the client ID blank, sign in to Canon and approve.

Claude also gets ready-made playbooks (plan a service, suggest hymns, check the rota, proofread a service, plan a catechism series, bring in an existing bulletin or slide deck, write a monthly report for the leaders…). For the last one, share your current bulletin (PDF, Word or a photo) or PowerPoint with Claude: it matches the hymns and liturgy with the Library, builds the service for you to check, and lists the settings to choose in the template editors.

Claude looks at your past services first: the same Sunday last year, the same season, earlier sermons on the same book, when each hymn was last sung and which catechism question you reached. It follows your church's usual order, hymns and rota, avoids hymns sung in the last few weeks, and tells you which past services it based a plan on.

### What Claude can and can't see

- It sees only the modules you allow, and acts as the person who approved it. A viewer's connection is always read only.
- Member contact details and birthdays stay hidden unless you turn on **Expose member contact details & birthdays** — and a connection approved by a read-only account never gets them, whatever the switch says.
- It cannot send e-mail, delete people, or see accounts or settings. It asks before changing things.
- **Connected agents** lists connections (**Revoke** to cut one off); **Activity log** shows every action, newest first, with filters (module, user, client, tool, OK or errors, dates, words in the arguments), pages, **Export CSV** (every entry matching the filters) and its own **Keep** period.

## Backups and moving to Docker

- **Back up**: [Settings → Backups](/settings?tab=backups). Press **Back up now**, or turn on **Automatic backups** (daily or weekly; older ones are removed). Set the **Backup folder** to a USB drive or a synced folder (OneDrive, Google Drive) on an account the church controls, and press **Check**. Backups are full copies with personal data — keep them where only the office can open them.
- **Encryption**: on the Backups tab, set a **backup password** (at least 10 characters) and press **Encrypt backups**. From then on every backup, and the archive copies made with it, is encrypted (`.db.enc`), so a lost USB drive or a shared cloud folder doesn't expose members' data. This computer remembers the key: automatic backups need no one, and its own backups restore without the password. On another computer, or for a backup made before you changed the password, Canon asks for the password when you restore. Keep the password with the church's records: without it, an encrypted backup can't be opened by anyone. **Stop encrypting** makes new backups plain copies again. If this computer's key file goes missing or is damaged while encryption is on, backups stop and the tab says so — they are never made unencrypted instead: set the backup password again, or press **Stop encrypting**.
- **Storage** (top of the Backups tab): how big the database is, what uses the space (Bible texts, pictures, records, logs…), the backups folder, the free space on the drive and how fast Canon grows (measured from one reading a day), with a warning well before space runs out.
- **Restore**: press **Restore** next to a saved backup, or **Restore from a file…** to use a backup file from this computer (a USB drive, another Canon). Canon first saves a copy of the current data, so a restore can be undone by restoring that copy; changes made since the backup are lost, and you may need to sign in again. If Canon will not start at all, the page also lists the steps to restore by hand.
- **Updating Canon**: make a backup, close the Canon window, put the new version's files over the old ones (or `git pull`), then start `start-canon.bat` again. It installs and rebuilds what changed. The database is upgraded on the first start, and a copy of it from before the upgrade is kept in `data/pre-upgrade/` (the newest three). If the new version has a problem, that copy lets you go back: see `docs/UPGRADING.md`. An older Canon refuses to open a database that a newer Canon has upgraded, so it cannot damage it. What changed in each version: `CHANGELOG.md`.
- **Moving to Docker** (a server or NAS): make a backup on the office PC, start Canon on the new machine with `docker compose up -d`, then restore the backup there with **Restore from a file…** (or as described under "Restoring a backup" in `docs/DOCKER.md`). Your IT helper can do this in a few minutes.

## FAQ and troubleshooting

**"Someone else changed this … after you opened it."**
Two people edited the same service details, service record or member at the same time. Canon keeps the first save and refuses the second instead of silently overwriting it, and says who changed it and when. Copy anything you typed, reload the page to see their changes, then make yours again.

**Chinese text is garbled when I open an export in Excel.**
Canon's exports open correctly in Excel. If a file became garbled after you saved it, save it again as **CSV UTF-8**. Canon still reads files saved in Chinese encodings.

**The slides use the wrong Chinese font.**
Slides use fonts installed on the projector computer. Choose another font in [Slide templates](/slide-templates) (e.g. 黑体 or 楷体), or install the font on that computer.

**The booklet pages come out in the wrong order.**
Print double-sided and choose **flip on short edge**, then fold the stack in half. Print one test copy first.

**Canon asks me to sign in again after an update.**
That is normal if the address or port changed, after 14 days, or when your password was reset. Just sign in again; nothing is lost. If pages look old after an update, press Ctrl+F5.

**Canon doesn't open.**
On the office PC, the "Canon server" window must stay open. Double-click `start-canon.bat` again.

**A hymn has no words.**
It was imported from a hymnal index. Open it in the Library and type the words (under your licence).

**Claude can't see something.**
Check **Settings → AI / MCP → Module access** and press **Save AI access**.
