# UI/UX audit — Canon 0.13.0 (input to 0.14)

Method: the Design plugin's critique framework, with Impeccable's technical audit rubric (five dimensions scored 0–4, issues P0–P3). Evidence comes from a test instance (a copy of real data, not committed), probed in the browser at 1280px and 375px:

- text contrast measured against the computed background (WCAG 2.x);
- tap-target sizes, unlabelled form controls, heading order, landmarks and horizontal overflow;
- screenshots of the dashboard and the service planner;
- token contrast computed from `src/styles.css`.

Not run: Impeccable's own detector CLI (`npx impeccable`), a screen reader, and real touch gestures. Drag-and-drop in the planner was not tested under touch.

## Audit health score

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | Muted text (`--ink-3`) is 3.2–3.8:1 on every page, below 4.5:1 |
| 2 | Performance | 3 | Fine in use; main bundle 569 kB (200 kB gzip); not profiled further |
| 3 | Responsive | 2 | The service planner overflows a phone (478px wide at 375px); the Outputs toolbar fills the first phone screen |
| 4 | Theming | 3 | Full token set with a dark theme; dark `--ink-3` is marginal on raised cards (4.06:1) |
| 5 | Implementation integrity | 3 | A coherent, product-specific visual system; 462 inline `style={{…}}` blocks show layout drift in code |
| | **Total** | **13/20** | **Acceptable: significant work needed** |

**Integrity verdict: pass.** The "measuring reed" identity looks deliberate and specific to a church, not a generic SaaS template:

- warm paper, ink and lapis, with reed gold as an accent rather than text;
- serif type for worship content and sans for the UI;
- the timeline planner.

The drift is in the code: spacing and layout are set inline instead of through shared classes. Users don't see it, but it makes the audit fixes harder to apply consistently.

## Overall impression

The core reads as a calm, purposeful tool. Bilingual content set side by side is handled well, and the planner's timeline with the library beside it is the strongest screen. The biggest opportunities are:

- one token change that fixes contrast everywhere;
- taming the planner's action bar;
- making the planner work on a phone.

## Findings

### P1: fix before release

1. **Muted text fails contrast everywhere.**
   - Measured ratios for `--ink-3 #7a7f88`:

     | Background | Ratio |
     |---|---|
     | paper | 3.48:1 |
     | `--paper-2` (cards) | 3.76:1 |
     | `--sunk` | 3.18:1 |

   - Affected: table headers, hints, sub-headings, inactive tabs, `.muted`, the sidebar church name and tagline, Chinese secondary titles (3.27:1 in the calendar). This fails WCAG 1.4.3.
   - Fix: `--ink-3: #5f646d` measures 5.14 on paper, 5.56 on cards and 4.69 on sunk. Lift the dark theme's `--ink-3` to about `#9a9588`.
   - Command: `/impeccable colorize` (token only).
2. **The service planner overflows a phone.** At 375px the page lays out 478px wide, so the browser zooms out or scrolls sideways.
   - Item cards are clipped on the right (the role badge is cut off).
   - The tab row hides Bulletin and Visitor form with no sign that it scrolls.
   - Fix: let item cards wrap (badge and duration under the title), add a fade or arrow on scrolling tab rows, and check the library panel collapses.
   - Command: `/impeccable adapt`.
3. **The planner's action bar has no hierarchy.**
   - Twelve controls with equal weight sit above the order of worship: seven Outputs buttons, Approve, Share and Enable link, Duplicate, Save as template, and Delete.
   - On a phone they fill the whole first screen before the first item.
   - Delete sits next to Save as template.
   - Fix: group them.
     - **Preview:** Bulletin, Slides, Run sheet.
     - **Files ▾:** PowerPoint, Word, FreeShow.
     - **Share:** link, Email the team.
     - **⋯ More:** Duplicate, Save as template, Delete (set apart, red).
     - Keep Draft/Final and Approve together as the status.
     - On a phone, collapse everything to one "Outputs ▾" button.
   - Command: `/impeccable distill`.

### P2: next pass

4. **Landmarks and headings.**
   - There is no `<main>` landmark.
   - Volunteers and Reports jump from H1 to H3.
   - Search fields are labelled only by their placeholder: planner library, Library, Members.
   - Fix: wrap the routed content in `<main>`, fix the heading levels, and add `aria-label` to the search fields.
   - Command: `/impeccable harden`.
5. **Small targets.**

   | Control | Size |
   |---|---|
   | EN / 简 language switch | 25×16 |
   | "?" tooltips | 16×16 |
   | Checkboxes | 16×16 |
   | Inline text links ("Open →", dates in lists, "Settings → Offerings") | 17–19px tall |
   | Calendar entries | 20px tall |
   | Planner insert buttons on a phone | 22×22 |

   - Fix: at least 24×24 everywhere (WCAG 2.2, 2.5.8), and about 40px on phones, using padding or a larger hit area rather than bigger glyphs.
   - Command: `/impeccable adapt`.
6. **Settings layout.**
   - The **My profile** card (with password and two-step sign-in) repeats above every Settings tab, pushing each tab's content down.
   - Twelve tabs sit in one row.
   - Fix: make My profile its own first tab, and group the rest:
     - **Church:** church, languages, modules.
     - **People & access:** users, member fields.
     - **Records:** offerings, visitor form.
     - **System:** e-mail, backups, security, change log, AI.
   - Command: `/impeccable layout`.
7. **Dashboard on a phone.**
   - The four member figures stack one per row with very large numerals, so the screen shows mostly zeros.
   - "New service" appears twice.
   - Fix: a 2×2 grid of figures, and one call to action.
   - Command: `/impeccable layout`.

### P3: polish

8. **Reduced motion.** The spinner and transitions ignore `prefers-reduced-motion`. Motion is small, so the impact is low.
9. **Inline styles.** 462 `style={{…}}` blocks for gaps and margins. Replace the common ones with layout classes (`row`/`stack` gap steps) while touching each screen in 0.14, rather than as a separate sweep.

## What works well

- A distinctive, coherent identity with semantic tokens and a complete dark theme.
- Visible focus rings on buttons and form fields.
- Icon-only buttons are labelled.
- No sideways overflow on any screen except the planner.
- Bilingual titles set side by side, with the second language in a lighter tone (once the contrast fix lands).
- The planner's timeline with clock times and the library panel beside it.
- Placeholder badges such as "Hymn ?" make the gaps obvious.
- Record screens already stack into cards on phones (0.12).

## Recommended order for 0.14

1. **[P1] Colour:** the `--ink-3` token, light and dark.
2. **[P1] Distill:** the planner action bar.
3. **[P1] Adapt:** the planner on phones.
4. **[P2] Harden:** landmarks, headings and labels.
5. **[P2] Adapt:** target sizes across the app.
6. **[P2] Layout:** Settings and the dashboard on phones.
7. **[P3] Polish:** reduced motion, and inline styles replaced on each touched screen.

Re-run this audit after the fixes.

## Done in 0.14 (re-measured with the same probe)

- **P1 contrast:** `--ink-3` is `#5f646d` in light (4.7–5.9:1) and `#9a9588` in dark (5.0–6.2:1). `--warn` is `#875c0e` (4.6–5.9:1). The probe finds no failing text on the 11 core screens.
- **P1 planner bar:**
  - Bulletin, Slides and Run sheet stay as buttons.
  - **Files ▾** holds PowerPoint, Word and FreeShow.
  - Email the team stays.
  - On the right: Approve, a compact **Share** (it opens the link panel and shows **On**), and **⋯** for Duplicate, Save as template and Delete this service (in red).
- **P1 planner on phones:** the page is exactly 375px wide (it was 478px). Item rows wrap the role and minutes under the title.
- **P2 landmarks and headings:**
  - The content is in `<main>`.
  - Card titles under the page title are `h2` (they look the same).
  - Empty states are not headings.
  - Search boxes and the song category filter have labels.
- **P2 targets:**
  - The per-field language tabs are at least 34×24.
  - The "?" tips answer a 26px area.
  - Calendar entries are at least 24px tall.
  - The planner's insert buttons are 28px on touch screens.
  - The sidebar footer links are taller.
- **P2 Settings:** My profile is its own first tab. The other tabs are in groups with thin separators.
- **P2 Dashboard:** the figures sit two per row on phones and tablets, and the duplicate "New service" link is gone.
- **P3 reduced motion:** honoured globally, and the spinner stops.
- **Also from your feedback:**
  - One ⋯ menu on all template pages.
  - The sidebar has a Planner section, and its sections fold.
  - A language switch per section, with per-field tabs kept for hovering.

Still open: inline styles (cleaned up on each screen as it's touched), and a real-device check of touch drag-and-drop in the planner.
