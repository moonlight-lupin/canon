# Canon user guide

Canon helps the church office plan the Sunday service, print the bulletin, project the slides and keep the registers. This guide follows the weekly routine. Labels in **bold** are exactly what you see on screen.

> **Tip:** Everything you type in one language can be typed in each of the church's languages. Simplified and Traditional Chinese convert automatically, so type Chinese only once.

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

### Adding colleagues

**Settings → Users & access → Add user**. Choose a role:
- **Admin**: everything, including settings.
- **Editor**: plans services and edits the registers, library and rota.
- **Viewer**: can view and print only.

## Every week

The [Dashboard](/) is the home page: the next service and its status, open roster roles and clashes for the coming weeks, upcoming birthdays, and quick links to the bulletin and slides.

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
- **Slide background** puts a picture behind this item's slides only (for example bread and cup for the Lord's Supper), instead of the slide template's background. Choose from the pictures in **Library → QR codes & notes** (add one there with **New picture**). The picture is faded with the template's background colour so the words stay readable, and it is used in the PowerPoint download too.

**Service details** — press **Edit…** above the order to change the date, time, languages (up to 3), **Bible versions**, **Liturgical season**, **Bulletin cover**, **Bulletin template** and **Slide theme**. Press **Save** in that card.

When the service is ready, switch **Draft** to **Final** at the top.

> **Tip:** **Duplicate** copies a service to another date (optionally with the roster). **Save as template** turns a good order into a template.

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

**PowerPoint** in the **Outputs** bar downloads the slides as a PowerPoint file, for a computer without Canon or to send to the AV team. It uses the service's slide template (colours, background picture, fonts, text size, lines per slide, footer and screen shape); **Custom CSS** is not carried over. Open it in PowerPoint and press **F5**.

### 5. Share with the team

- **Run sheet**: a printable timed list with leaders and AV cues for the team.
- **Share with team**: press **Enable link**, then **Copy** and send the link. It is read-only and shows no contact details. **Disable link** stops it; turning it on again makes a new link.
- **PowerPoint**, **Word document** and **FreeShow project** download files for other programs.
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

### QR codes & notes

**Library → QR codes & notes** holds **New QR code**, **New picture** and **New note** blocks, used on the bulletin's back cover and on slides (e.g. the giving link or the Wi-Fi).

## Templates

- [Service templates](/templates): reusable orders of worship. Hymn slots stay empty to fill each week. **New template**, **Edit**, **Use template**. **Set as church default** (administrators) picks the template **New service** starts from; it shows a **Church default** badge.

Bulletin templates and slide templates both open on a gallery. Each card has a main button (**Edit** for your own templates, **Preview** for built-in ones) and a **⋯** menu:

- **Set as church default** (administrators): services use this template unless they choose another.
- **Make a copy to customise** / **Duplicate**: built-in templates come with Canon and can't be changed or deleted, so copy one and change the copy.
- **Hide** leaves a template out of the lists in the service planner (services already using it keep it). Hidden templates are under **Hidden templates** at the bottom of the gallery; **Show again** brings one back. The church default can't be hidden.
- **Export to a file** saves the template as one file (with its background picture, or the QR codes and pictures its pages print), to copy to another computer or share with another church. **Import a template file…** at the top of the page adds it as a new template; QR codes and notes it needs are added to the Library unless one of the same name is already there.
- **Delete** (your own templates only).

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

- [Groups](/groups): committees, fellowships, cell groups and ministries. **Add group**, then **Add members** with a **Role in group** and term dates. To keep history, set an end date or untick **Active** instead of deleting.
- [Members](/members): **Add person** with names, **Chinese name**, **Honorific title** (弟兄, 姐妹, Bro., Sis., Rev.…), contact, status, baptism and membership dates, household. **Birthdays** lists the coming birthdays.
- [Co-workers](/coworkers): pastors, elders, deacons and staff. **Add co-worker**, choose the person, **Position** and **Category**. **Add to committee…** tags them with their committees.
- [Volunteers](/volunteers):
  - **Teams & roles**: **Add team**, **Add role** with **Needed per service** and **Qualified people**.
  - **Rota**: pick a period, press **Auto-fill** to fill empty slots fairly, click names to change status, **Print**.
  - **Unavailability**: **Add unavailability** for people who are away; auto-fill skips them.

## Importing from Excel

Most lists have **Download template**, **Export** and **Import CSV…**.

1. Press **Download template** and fill it in Excel.
2. Save with **Save As → CSV UTF-8 (Comma delimited)**.
3. Press **Import CSV…** and choose the file. Nothing is saved yet: the preview shows what is **new**, **to update**, **unchanged** and **with problems**.
4. Press **Import N rows**, or **Import valid rows and skip errors**.

> **Tip:** Importing the same file twice is safe: existing records are matched and updated, not duplicated.

## Settings

Open [Settings](/settings).

- **My profile** (everyone): display name, interface language, **Change password**.
- **Church**, **Languages**, **Users & access**: see [Getting started](#getting-started).
- **E-mail**: choose the **Provider** (Gmail, Microsoft 365 or other), fill in the SMTP details and **Save**, then **Send test**. Gmail needs an app password.
- **AI / MCP**: see below.

## AI assistants

Canon can connect to Claude (claude.ai) so you can ask, for example, "plan next Sunday's service on Romans 8" or "who is still missing from the rota?".

### Connecting Claude

1. Claude needs a public **https** address for Canon, usually through a tunnel set up by your IT helper.
2. **Settings → AI / MCP**: turn on **Enable MCP server**, paste the **Public address**, press **Check**, then **Save**.
3. Set each module under **Module access** to **Off**, **Read only** or **Read & write**, and press **Save AI access**.
4. In claude.ai: **Settings → Connectors → Add custom connector**, paste the **Connector URL**, leave the client ID blank, sign in to Canon and approve.

Claude also gets ready-made playbooks (plan a service, suggest hymns, check the rota, proofread a service, plan a catechism series, bring in an existing bulletin or slide deck…). For the last one, share your current bulletin (PDF, Word or a photo) or PowerPoint with Claude: it matches the hymns and liturgy with the Library, builds the service for you to check, and lists the settings to choose in the template editors.

Claude looks at your past services first: the same Sunday last year, the same season, earlier sermons on the same book, when each hymn was last sung and which catechism question you reached. It follows your church's usual order, hymns and rota, avoids hymns sung in the last few weeks, and tells you which past services it based a plan on.

### What Claude can and can't see

- It sees only the modules you allow, and acts as the person who approved it. A viewer's connection is always read only.
- Member contact details and birthdays stay hidden unless you turn on **Expose member contact details & birthdays**.
- It cannot send e-mail, delete people, or see accounts or settings. It asks before changing things.
- **Connected agents** lists connections (**Revoke** to cut one off); **Activity log** shows every action.

## Backups and moving to Docker

- **Back up**: [Settings → Backups](/settings?tab=backups). Press **Back up now**, or turn on **Automatic backups** (daily or weekly; older ones are removed). Set the **Backup folder** to a USB drive or a synced folder (OneDrive, Google Drive) and press **Check**. Backups contain personal data — keep downloaded copies safe.
- **Restore**: press **Restore** next to a saved backup, or **Restore from a file…** to use a backup file from this computer (a USB drive, another Canon). Canon first saves a copy of the current data, so a restore can be undone by restoring that copy; changes made since the backup are lost, and you may need to sign in again. If Canon will not start at all, the page also lists the steps to restore by hand.
- **Moving to Docker** (a server or NAS): make a backup on the office PC, start Canon on the new machine with `docker compose up -d`, then restore the backup there with **Restore from a file…** (or as described under "Restoring a backup" in `docs/DOCKER.md`). Your IT helper can do this in a few minutes.

## FAQ and troubleshooting

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
