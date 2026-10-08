// The database schema, as an append-only list of migrations. PRAGMA user_version is how many have been applied.
// Never edit a migration that has shipped: add a new one (and a line in CHANGELOG.md).
import type { Db } from './lib/sqlite.ts';
import { isLeaderRole } from '../shared/group-roles.ts';
import { BUILTIN_ROLES } from '../shared/permissions.ts';

/**
 * A migration is SQL, or SQL plus a step in code. `noForeignKeys` runs it with foreign-key checks off (needed to
 * rebuild a table that others refer to — SQLite's documented way to change a CHECK constraint); the checks are
 * verified afterwards.
 */
export interface Migration {
  sql: string;
  run?: (d: Db) => void;
  noForeignKeys?: boolean;
}

/** Ordered migrations. Append only; never edit a shipped migration. */
export const MIGRATIONS: (string | Migration)[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
    lang TEXT NOT NULL DEFAULT 'en',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE households (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT, phone TEXT, notes TEXT
  );
  CREATE TABLE people (
    id INTEGER PRIMARY KEY,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL DEFAULT '',
    native_name TEXT, preferred_name TEXT,
    gender TEXT CHECK (gender IN ('M','F')),
    birth_date TEXT, phone TEXT, email TEXT, address TEXT,
    household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,
    household_role TEXT,
    status TEXT NOT NULL DEFAULT 'regular',
    membership_date TEXT, baptism_date TEXT, baptism_type TEXT, profession_date TEXT,
    preferred_lang TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX people_household ON people(household_id);

  CREATE TABLE coworkers (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    position TEXT NOT NULL,
    category TEXT NOT NULL,
    employment TEXT NOT NULL DEFAULT 'volunteer',
    ministry_area TEXT,
    ordained INTEGER NOT NULL DEFAULT 0,
    start_date TEXT, end_date TEXT, notes TEXT
  );

  CREATE TABLE teams (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,          -- L10n JSON
    description TEXT,
    color TEXT NOT NULL DEFAULT '#64748b',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE roles (
    id INTEGER PRIMARY KEY,
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,          -- L10n JSON
    needed INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE role_members (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, person_id)
  );
  CREATE TABLE unavailability (
    id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL, end_date TEXT NOT NULL, reason TEXT
  );

  CREATE TABLE songs (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    title TEXT NOT NULL,         -- L10n JSON
    author TEXT, composer TEXT, tune TEXT, meter TEXT, year INTEGER,
    category TEXT NOT NULL DEFAULT 'hymn',
    psalm INTEGER,
    public_domain INTEGER NOT NULL DEFAULT 0,
    copyright TEXT, ccli TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    stanzas TEXT NOT NULL DEFAULT '[]',
    refrain_after_each INTEGER NOT NULL DEFAULT 0,
    notes TEXT
  );
  CREATE TABLE texts (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    category TEXT NOT NULL,
    title TEXT NOT NULL,         -- L10n JSON
    body TEXT NOT NULL,          -- L10n JSON
    source TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    public_domain INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE templates (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    name TEXT NOT NULL,          -- L10n JSON
    description TEXT NOT NULL DEFAULT '{}',
    service_type TEXT NOT NULL DEFAULT 'lords_day',
    start_time TEXT NOT NULL DEFAULT '10:00',
    items TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE services (
    id INTEGER PRIMARY KEY,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL DEFAULT '10:00',
    title TEXT NOT NULL DEFAULT '{}',
    service_type TEXT NOT NULL DEFAULT 'lords_day',
    preacher TEXT,
    sermon_title TEXT NOT NULL DEFAULT '{}',
    sermon_ref TEXT,
    theme TEXT NOT NULL DEFAULT '{}',
    languages TEXT NOT NULL DEFAULT '["en","zh"]',
    status TEXT NOT NULL DEFAULT 'draft',
    notes TEXT,
    share_token TEXT UNIQUE,
    template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX services_date ON services(date);
  CREATE TABLE service_items (
    id INTEGER PRIMARY KEY,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '{}',
    ref_id INTEGER,
    scripture_ref TEXT,
    stanzas TEXT,
    body TEXT NOT NULL DEFAULT '{}',
    duration_min REAL NOT NULL DEFAULT 0,
    role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
    leader TEXT,
    notes TEXT,
    in_bulletin INTEGER NOT NULL DEFAULT 1,
    on_slides INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX service_items_service ON service_items(service_id, position);
  CREATE TABLE assignments (
    id INTEGER PRIMARY KEY,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'scheduled',
    notes TEXT,
    UNIQUE (service_id, role_id, person_id)
  );

  CREATE TABLE bible_translations (
    code TEXT PRIMARY KEY,
    lang TEXT NOT NULL,
    name TEXT NOT NULL,
    license TEXT NOT NULL
  );
  CREATE TABLE bible_verses (
    translation TEXT NOT NULL,
    book INTEGER NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (translation, book, chapter, verse)
  ) WITHOUT ROWID;

  -- OAuth 2.1 authorization server for the MCP endpoint
  CREATE TABLE oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_secret_hash TEXT,
    client_name TEXT,
    redirect_uris TEXT NOT NULL,
    token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
    created_at INTEGER NOT NULL,
    registered_ip TEXT
  );
  CREATE TABLE oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    redirect_uri TEXT NOT NULL,
    scope TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    resource TEXT,
    grant_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE oauth_tokens (
    token_hash TEXT PRIMARY KEY,
    token_type TEXT NOT NULL CHECK (token_type IN ('access','refresh')),
    client_id TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope TEXT NOT NULL,
    resource TEXT,
    grant_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  CREATE INDEX oauth_tokens_grant ON oauth_tokens(grant_id);

  CREATE TABLE mcp_audit (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER,
    client_id TEXT,
    tool TEXT NOT NULL,
    module TEXT,
    access TEXT,
    ok INTEGER NOT NULL,
    args TEXT,
    error TEXT
  );
  `,
  // v0.2 — hymnals, text parts, groups, team members, e-mail log, assets, season & cover
  `
  CREATE TABLE hymnals (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,          -- L10n JSON
    abbr TEXT NOT NULL,
    publisher TEXT, year INTEGER, notes TEXT,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE song_hymnals (
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    hymnal_id INTEGER NOT NULL REFERENCES hymnals(id) ON DELETE CASCADE,
    number TEXT NOT NULL,
    PRIMARY KEY (song_id, hymnal_id)
  );
  CREATE INDEX song_hymnals_number ON song_hymnals(hymnal_id, number);

  ALTER TABLE texts ADD COLUMN parts TEXT;                 -- JSON TextPart[] or NULL
  ALTER TABLE service_items ADD COLUMN hymnal_id INTEGER REFERENCES hymnals(id) ON DELETE SET NULL;

  CREATE TABLE groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,          -- L10n JSON
    kind TEXT NOT NULL CHECK (kind IN ('committee','fellowship','cell_group','ministry','other')),
    description TEXT,
    color TEXT NOT NULL DEFAULT '#64748b',
    meeting TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE group_members (
    id INTEGER PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role TEXT, start_date TEXT, end_date TEXT,
    UNIQUE (group_id, person_id)
  );
  CREATE INDEX group_members_person ON group_members(person_id);

  CREATE TABLE team_members (
    team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    is_leader INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (team_id, person_id)
  );
  INSERT OR IGNORE INTO team_members (team_id, person_id)
    SELECT DISTINCT r.team_id, rm.person_id FROM role_members rm JOIN roles r ON r.id = rm.role_id;

  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER,
    service_id INTEGER,
    person_id INTEGER,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    kind TEXT NOT NULL,
    ok INTEGER NOT NULL,
    error TEXT
  );

  CREATE TABLE assets (
    key TEXT PRIMARY KEY,        -- e.g. 'logo'
    mime TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE services ADD COLUMN season TEXT;
  ALTER TABLE services ADD COLUMN cover TEXT NOT NULL DEFAULT '{}';
  `,
  // v0.3 — slide themes (custom CSS) and bulletin templates (what to print, how)
  `
  CREATE TABLE slide_themes (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,                     -- L10n JSON
    base TEXT NOT NULL DEFAULT 'dark' CHECK (base IN ('dark','light')),
    vars TEXT NOT NULL DEFAULT '{}',        -- JSON: colours, fonts, sizes, background (see shared/presentation.ts)
    css TEXT NOT NULL DEFAULT '',           -- extra CSS, scoped to the slide stage
    sort INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE bulletin_templates (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,                     -- L10n JSON
    description TEXT NOT NULL DEFAULT '{}', -- L10n JSON
    options TEXT NOT NULL DEFAULT '{}',     -- JSON: paper, layout, per-kind full text, sections (see shared/presentation.ts)
    sort INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  ALTER TABLE services ADD COLUMN slide_theme_id INTEGER REFERENCES slide_themes(id) ON DELETE SET NULL;
  ALTER TABLE services ADD COLUMN bulletin_template_id INTEGER REFERENCES bulletin_templates(id) ON DELETE SET NULL;
  -- per item: NULL = follow the bulletin template; 'full' = print the words; 'title' = title / reference only
  ALTER TABLE service_items ADD COLUMN bulletin_text TEXT CHECK (bulletin_text IN ('full','title'));
  `,
  // v0.4 — congregation posture per item, honorific titles for people, bulletin blocks (QR codes, images, notes)
  `
  ALTER TABLE service_items ADD COLUMN posture TEXT CHECK (posture IN ('stand','sit','kneel'));
  ALTER TABLE people ADD COLUMN honorific TEXT;   -- L10n JSON, e.g. {"en":"Bro.","zh":"弟兄"}
  CREATE TABLE bulletin_blocks (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('qr','image','text')),
    name TEXT NOT NULL,                   -- admin label, e.g. "PayNow giving"
    data TEXT NOT NULL DEFAULT '{}',      -- JSON: {url, caption L10n, text L10n, asset} (see shared/presentation.ts)
    sort INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // v0.5 — choose Bible versions per service and per reading; churches can upload their own Bibles
  `
  ALTER TABLE services ADD COLUMN bibles TEXT NOT NULL DEFAULT '{}';       -- JSON {lang: translation code}
  ALTER TABLE service_items ADD COLUMN bibles TEXT NOT NULL DEFAULT '{}';  -- JSON {lang: translation code}
  ALTER TABLE bible_translations ADD COLUMN source TEXT NOT NULL DEFAULT 'catalog';  -- 'catalog' | 'upload'
  ALTER TABLE bible_translations ADD COLUMN notes TEXT;                    -- licence / permission note for uploads
  ALTER TABLE bible_translations ADD COLUMN created_at TEXT;
  `,
  // v0.6 — QR codes / notes (bulletin blocks) shown on the projector slides of an item
  `
  ALTER TABLE service_items ADD COLUMN slide_blocks TEXT NOT NULL DEFAULT '[]';  -- JSON block ids, shown after the item's slides
  `,
  // v0.7 — bulletin page layout: weekly sections filled per service (announcements, pastor's note, prayer requests …)
  `
  ALTER TABLE services ADD COLUMN bulletin_content TEXT NOT NULL DEFAULT '{}';  -- JSON {section_key: L10n}
  `,
  // v0.8 — short-lived download links (for AI agents and for sending a file to someone without a Canon login)
  `
  CREATE TABLE download_links (
    token TEXT PRIMARY KEY,               -- random, unguessable; the link is /api/dl/<token>
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,                   -- slides_pptx | bulletin_docx | freeshow | run_sheet
    langs TEXT,                           -- JSON [lang] or NULL = the service's languages
    expires_at TEXT NOT NULL,             -- ISO time
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX download_links_expiry ON download_links(expires_at);
  -- hidden templates stay usable by services that chose them, but leave the pickers (built-ins can't be deleted)
  ALTER TABLE slide_themes ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE bulletin_templates ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
  -- a background picture for one item's slides (a picture block from Library → QR codes & notes); NULL = the template's
  ALTER TABLE service_items ADD COLUMN slide_bg INTEGER REFERENCES bulletin_blocks(id) ON DELETE SET NULL;
  -- "Worship Leader" is called "Liturgist" from v0.8: the role, the service-template slots and bulletin rosters naming it
  UPDATE roles SET name = json_set(name, '$.en', 'Liturgist') WHERE lower(json_extract(name, '$.en')) = 'worship leader';
  UPDATE templates SET items = replace(replace(items, '"role":"Worship Leader"', '"role":"Liturgist"'), '"role":"Worship leader"', '"role":"Liturgist"')
    WHERE items LIKE '%Worship Leader%' OR items LIKE '%Worship leader%';
  UPDATE bulletin_templates SET options = replace(replace(options, '"Worship Leader"', '"Liturgist"'), '"Worship leader"', '"Liturgist"')
    WHERE options LIKE '%Worship Leader%' OR options LIKE '%Worship leader%';
  `,
  // v0.9 — change log: who changed what, when and how (web, AI agent, CSV import)
  `
  CREATE TABLE change_log (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_name TEXT,                       -- kept when the account is deleted
    via TEXT NOT NULL,                    -- web | mcp | import | system
    client TEXT,                          -- MCP client name
    entity TEXT NOT NULL,                 -- table, e.g. people, services, songs
    entity_id INTEGER,
    action TEXT NOT NULL CHECK (action IN ('create','update','delete')),
    name TEXT NOT NULL DEFAULT '',        -- readable name of the record at the time
    summary TEXT,
    changes TEXT NOT NULL DEFAULT '{}',   -- JSON {field: [old, new]} (long values shortened)
    parent_entity TEXT,                   -- e.g. the service an item belongs to
    parent_id INTEGER
  );
  CREATE INDEX change_log_at ON change_log(at);
  CREATE INDEX change_log_entity ON change_log(entity, entity_id);
  CREATE INDEX change_log_parent ON change_log(parent_entity, parent_id);
  CREATE INDEX mcp_audit_at ON mcp_audit(at);
  -- congregations of one church (English / Chinese / Indonesian services …); services, templates, members, groups
  CREATE TABLE congregations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,                   -- L10n JSON
    code TEXT NOT NULL DEFAULT '',        -- short badge label, e.g. EN, 华, ID
    languages TEXT NOT NULL DEFAULT '[]', -- JSON [lang]: new services start with these
    color TEXT NOT NULL DEFAULT '#64748b',
    sort INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  ALTER TABLE services ADD COLUMN congregation_id INTEGER REFERENCES congregations(id) ON DELETE SET NULL;
  ALTER TABLE templates ADD COLUMN congregation_id INTEGER REFERENCES congregations(id) ON DELETE SET NULL;
  ALTER TABLE people ADD COLUMN congregation_id INTEGER REFERENCES congregations(id) ON DELETE SET NULL;
  ALTER TABLE groups ADD COLUMN congregation_id INTEGER REFERENCES congregations(id) ON DELETE SET NULL;
  CREATE INDEX services_congregation ON services(congregation_id, date);
  `,
  // v0.9 — service records: attendance, new visitors, notes, offerings and the cash count (one per service)
  `
  CREATE TABLE service_records (
    id INTEGER PRIMARY KEY,
    service_id INTEGER NOT NULL UNIQUE REFERENCES services(id) ON DELETE CASCADE,
    attendance INTEGER,
    children INTEGER,
    online INTEGER,
    visitors TEXT NOT NULL DEFAULT '[]',   -- JSON [{name, contact, source, follow_up_by, notes}]
    notes TEXT,                            -- notes for the team
    offerings TEXT NOT NULL DEFAULT '[]',  -- JSON [{fund, method, amount (minor units), note}]
    cash TEXT NOT NULL DEFAULT '{}',       -- JSON {denomination (minor units): count}
    counters TEXT NOT NULL DEFAULT '[]',   -- JSON [name]
    currency TEXT NOT NULL DEFAULT 'SGD',
    verified_at TEXT,
    verified_by TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // v0.9 — volunteer teams are "Serving team" groups: one membership list (with roles and terms) per team
  {
    noForeignKeys: true,
    sql: `
    CREATE TABLE groups_v09 (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,          -- L10n JSON
      kind TEXT NOT NULL CHECK (kind IN ('committee','fellowship','cell_group','ministry','serving_team','other')),
      description TEXT,
      color TEXT NOT NULL DEFAULT '#64748b',
      meeting TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      congregation_id INTEGER REFERENCES congregations(id) ON DELETE SET NULL
    );
    INSERT INTO groups_v09 (id, name, kind, description, color, meeting, active, sort, congregation_id)
      SELECT id, name, kind, description, color, meeting, active, sort, congregation_id FROM groups;
    DROP TABLE groups;
    ALTER TABLE groups_v09 RENAME TO groups;
    ALTER TABLE teams ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL;
    `,
    run: (d) => {
      const teamRows = d.prepare('SELECT id, name, description, color, sort FROM teams ORDER BY sort, id').all() as {
        id: number; name: string; description: string | null; color: string; sort: number;
      }[];
      const base = (d.prepare('SELECT COALESCE(MAX(sort), 0) AS s FROM groups').get() as { s: number }).s;
      const addGroup = d.prepare("INSERT INTO groups (name, kind, description, color, active, sort) VALUES (?, 'serving_team', ?, ?, 1, ?)");
      const link = d.prepare('UPDATE teams SET group_id = ? WHERE id = ?');
      const addMember = d.prepare('INSERT OR IGNORE INTO group_members (group_id, person_id, role) VALUES (?, ?, ?)');
      for (const t of teamRows) {
        const g = Number(addGroup.run(t.name, t.description, t.color, base + 1 + t.sort).lastInsertRowid);
        link.run(g, t.id);
        const roster = d.prepare('SELECT person_id, is_leader FROM team_members WHERE team_id = ?').all(t.id) as { person_id: number; is_leader: number }[];
        for (const m of roster) addMember.run(g, m.person_id, m.is_leader ? 'Leader' : null);
      }
      // the old roster table stays (renamed) as a safety copy; nothing reads it any more
      d.exec('ALTER TABLE team_members RENAME TO team_members_v08');
    },
  },
  // v0.9 — slide backgrounds: their own library of full-screen pictures (not QR codes & notes)
  {
    sql: `
    CREATE TABLE slide_backgrounds (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      bytes INTEGER NOT NULL DEFAULT 0,
      version TEXT NOT NULL DEFAULT '',   -- changes when the picture changes (cache key); asset slide-bg-<id>
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE service_items ADD COLUMN slide_background_id INTEGER REFERENCES slide_backgrounds(id) ON DELETE SET NULL;
    `,
    // pictures from QR codes & notes already used as item backgrounds (v0.8) move to the new library
    run: (d) => {
      const used = d.prepare(`SELECT DISTINCT b.id, b.name, a.mime, a.data FROM service_items i JOIN bulletin_blocks b ON b.id = i.slide_bg
                              JOIN assets a ON a.key = 'bulletin-block-' || b.id WHERE i.slide_bg IS NOT NULL`).all() as { id: number; name: string; mime: string; data: Uint8Array }[];
      for (const u of used) {
        const data = Buffer.from(u.data);
        const id = Number(d.prepare('INSERT INTO slide_backgrounds (name, mime, bytes, version) VALUES (?, ?, ?, ?)').run(u.name, u.mime, data.length, `m${u.id}`).lastInsertRowid);
        d.prepare("INSERT OR REPLACE INTO assets (key, mime, data, updated_at) VALUES (?, ?, ?, datetime('now'))").run(`slide-bg-${id}`, u.mime, data);
        d.prepare('UPDATE service_items SET slide_background_id = ?, slide_bg = NULL WHERE slide_bg = ?').run(id, u.id);
      }
    },
  },
  // v0.9.1 — offerings in other currencies; counters' signatures drawn on screen
  `
  ALTER TABLE service_records ADD COLUMN foreign_cash TEXT NOT NULL DEFAULT '{}';  -- JSON {currency: {cash, total, converted}}
  ALTER TABLE service_records ADD COLUMN signatures TEXT NOT NULL DEFAULT '[]';    -- JSON [{name, image, signed_at, by, hash}]
  `,
  // v0.10.2 — the date the cash was counted (printed on the declaration; empty = the service date)
  `ALTER TABLE service_records ADD COLUMN counted_on TEXT;`,
  // v0.10.4 — service templates can be archived like slide and bulletin templates ("hidden" = archived)
  `ALTER TABLE templates ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;`,
  // v0.10.5 — references people choose (EN-001, CN-10pmService), unique per kind ignoring case; a service template
  // chooses the slide and bulletin templates its services start with
  `
  ALTER TABLE services ADD COLUMN ref TEXT;
  ALTER TABLE templates ADD COLUMN ref TEXT;
  ALTER TABLE slide_themes ADD COLUMN ref TEXT;
  ALTER TABLE bulletin_templates ADD COLUMN ref TEXT;
  CREATE UNIQUE INDEX services_ref ON services(ref COLLATE NOCASE) WHERE ref IS NOT NULL;
  CREATE UNIQUE INDEX templates_ref ON templates(ref COLLATE NOCASE) WHERE ref IS NOT NULL;
  CREATE UNIQUE INDEX slide_themes_ref ON slide_themes(ref COLLATE NOCASE) WHERE ref IS NOT NULL;
  CREATE UNIQUE INDEX bulletin_templates_ref ON bulletin_templates(ref COLLATE NOCASE) WHERE ref IS NOT NULL;
  ALTER TABLE templates ADD COLUMN slide_theme_id INTEGER REFERENCES slide_themes(id) ON DELETE SET NULL;
  ALTER TABLE templates ADD COLUMN bulletin_template_id INTEGER REFERENCES bulletin_templates(id) ON DELETE SET NULL;
  `,
  // v0.10.6 — the visitor form: each service's form link and QR choices; visitors' entries wait for review
  `
  ALTER TABLE services ADD COLUMN visitor_form TEXT NOT NULL DEFAULT '{}';  -- JSON {token, bulletin, slides}
  CREATE UNIQUE INDEX services_visitor_token ON services(json_extract(visitor_form, '$.token')) WHERE json_extract(visitor_form, '$.token') IS NOT NULL;
  CREATE TABLE visitor_cards (
    id INTEGER PRIMARY KEY,
    service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT NOT NULL,
    contact TEXT,
    source TEXT,
    wants_contact INTEGER NOT NULL DEFAULT 0,
    prayer TEXT,
    consent INTEGER NOT NULL DEFAULT 0,
    lang TEXT
  );
  CREATE INDEX visitor_cards_service ON visitor_cards(service_id);
  `,
  // v0.10.6 — "Which describes you best?" on the visitor form
  `ALTER TABLE visitor_cards ADD COLUMN about TEXT;`,
  // v0.11.0 — custom member fields (definitions in settings.member_fields; values per person, JSON {key: text})
  `ALTER TABLE people ADD COLUMN custom TEXT NOT NULL DEFAULT '{}';`,
  // v0.11.0 — who looked at member records (kept as long as the change log); when each account last signed in
  `
  CREATE TABLE member_views (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    user_id INTEGER,
    user_name TEXT,
    person_id INTEGER,
    via TEXT NOT NULL CHECK (via IN ('web', 'mcp', 'export')),
    detail TEXT
  );
  CREATE INDEX member_views_at ON member_views(at);
  CREATE INDEX member_views_person ON member_views(person_id);
  ALTER TABLE users ADD COLUMN last_login_at TEXT;
  `,
  // 21 (0.11.1): a revision number for edit conflicts (counts saves; a timestamp is only to the second), and which
  // services have their record in an archive file (that record is read-only and the service can't be deleted)
  `
  ALTER TABLE services ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE people ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE service_records ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE archived_records (
    service_id INTEGER PRIMARY KEY REFERENCES services(id) ON DELETE RESTRICT,
    year INTEGER NOT NULL,
    archived_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // 22 (0.11.2): a deleted service leaves its id and date, so erasing visitors' details still finds the change-log
  // entries of its record (they outlive the service). Earlier deletions are filled in from the change log.
  {
    sql: `
    CREATE TABLE service_tombstones (
      id INTEGER PRIMARY KEY,
      date TEXT NOT NULL,
      deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TRIGGER services_tombstone AFTER DELETE ON services
    BEGIN
      INSERT OR REPLACE INTO service_tombstones (id, date) VALUES (OLD.id, OLD.date);
    END;
    `,
    run: (d) => {
      const rows = d.prepare(
        `SELECT entity_id, changes FROM change_log WHERE entity = 'services' AND action = 'delete'
         AND entity_id IS NOT NULL AND entity_id NOT IN (SELECT id FROM services)`,
      ).all() as { entity_id: number; changes: string }[];
      const put = d.prepare('INSERT OR IGNORE INTO service_tombstones (id, date, deleted_at) VALUES (?, ?, ?)');
      for (const r of rows) {
        try {
          const date = (JSON.parse(r.changes) as { date?: [unknown, unknown] }).date?.[0];
          if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) put.run(r.entity_id, date, 'before 0.11.2');
        } catch { /* an entry that can't be read: the entry's own age decides (repo/archive.ts) */ }
      }
    },
  },
  // 23 (0.12): meetings, Sunday school, group leaders, recurring meetings.
  //  - a meeting is a lighter kind of service (services.kind = 'meeting'), of a group or a one-off, with a place,
  //    its leader (a member: leader_id; or a name: chair), a topic and an offering that each meeting turns on or off;
  //  - groups gain the Sunday school kind, an age range and a meeting pattern (rebuilt: kind has a CHECK);
  //  - group_members.leads marks who leads a group (filled from leader roles once); a read-only account linked to a
  //    member (users.person_id) records the meetings of the groups that member leads.
  {
    noForeignKeys: true,
    sql: `
    ALTER TABLE services ADD COLUMN kind TEXT NOT NULL DEFAULT 'service';
    ALTER TABLE services ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL;
    ALTER TABLE services ADD COLUMN place TEXT;
    ALTER TABLE services ADD COLUMN chair TEXT;
    ALTER TABLE services ADD COLUMN leader_id INTEGER REFERENCES people(id) ON DELETE SET NULL;
    ALTER TABLE services ADD COLUMN topic TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE services ADD COLUMN offering INTEGER NOT NULL DEFAULT 1;
    CREATE INDEX services_kind_date ON services(kind, date);
    CREATE INDEX services_group_date ON services(group_id, date);

    CREATE TABLE groups_v12 (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('committee','fellowship','cell_group','sunday_school','ministry','serving_team','other')),
      description TEXT,
      color TEXT NOT NULL DEFAULT '#64748b',
      meeting TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      congregation_id INTEGER REFERENCES congregations(id) ON DELETE SET NULL,
      age_min INTEGER,
      age_max INTEGER,
      pattern TEXT NOT NULL DEFAULT '{}'
    );
    INSERT INTO groups_v12 (id, name, kind, description, color, meeting, active, sort, congregation_id)
      SELECT id, name, kind, description, color, meeting, active, sort, congregation_id FROM groups;
    DROP TABLE groups;
    ALTER TABLE groups_v12 RENAME TO groups;

    ALTER TABLE group_members ADD COLUMN leads INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN person_id INTEGER REFERENCES people(id) ON DELETE SET NULL;

    -- the church calendar's own events (services and meetings come from services)
    CREATE TABLE events (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '{}',
      date TEXT NOT NULL,
      end_date TEXT,
      start_time TEXT,
      end_time TEXT,
      place TEXT,
      description TEXT,
      congregation_id INTEGER REFERENCES congregations(id) ON DELETE SET NULL,
      group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX events_date ON events(date);
    `,
    run: (d) => {
      const rows = d.prepare('SELECT id, role FROM group_members').all() as { id: number; role: string | null }[];
      const mark = d.prepare('UPDATE group_members SET leads = 1 WHERE id = ?');
      for (const r of rows) if (isLeaderRole(r.role)) mark.run(r.id);
    },
  },
  // 24 (0.13): roles a church can shape (access per module, member details, sensitive fields, reopening counts);
  // accounts keep their role key (admin / editor / viewer stay as they were) — the users table loses its fixed list
  // of three roles (rebuilt: a CHECK can't be dropped otherwise).
  {
    noForeignKeys: true,
    sql: `
    CREATE TABLE access_roles (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '{}',
      description TEXT NOT NULL DEFAULT '{}',
      builtin INTEGER NOT NULL DEFAULT 0,
      admin INTEGER NOT NULL DEFAULT 0,
      access TEXT NOT NULL DEFAULT '{}',
      member_details INTEGER NOT NULL DEFAULT 0,
      sensitive_fields INTEGER NOT NULL DEFAULT 0,
      reopen_counts INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 100
    );
    CREATE TABLE users_v13 (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer',
      lang TEXT NOT NULL DEFAULT 'en',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT,
      person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      -- limited to one congregation (null = the whole church)
      congregation_id INTEGER REFERENCES congregations(id) ON DELETE SET NULL,
      -- wrong passwords in a row, and until when the account is locked after too many
      failed_logins INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      -- two-step sign-in: the authenticator secret, whether it is on, and the hashed one-time recovery codes
      totp_secret TEXT,
      totp_enabled INTEGER NOT NULL DEFAULT 0,
      recovery_codes TEXT NOT NULL DEFAULT '[]'
    );
    INSERT INTO users_v13 (id, username, display_name, password_hash, role, lang, created_at, last_login_at, person_id)
      SELECT id, username, display_name, password_hash, role, lang, created_at, last_login_at, person_id FROM users;
    DROP TABLE users;
    ALTER TABLE users_v13 RENAME TO users;

    -- approved, dated versions of a service's bulletin and slides (repo/approvals.ts)
    CREATE TABLE output_approvals (
      id INTEGER PRIMARY KEY,
      service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      approved_at TEXT NOT NULL DEFAULT (datetime('now')),
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_by TEXT NOT NULL,
      note TEXT,
      snapshot TEXT NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE INDEX output_approvals_service ON output_approvals(service_id, id);

    -- a member whose personal data was erased (repo/pdpa.ts): the row stays, anonymised, so history still counts
    ALTER TABLE people ADD COLUMN erased_at TEXT;

    -- what the church may do with a Bible version's text (shared/bible-rights.ts): the edition, and print / project /
    -- online. Public-domain versions allow everything; uploaded (licensed) ones start without "online".
    ALTER TABLE bible_translations ADD COLUMN edition TEXT;
    ALTER TABLE bible_translations ADD COLUMN rights TEXT NOT NULL DEFAULT '{"print":true,"project":true,"online":true}';
    UPDATE bible_translations SET rights = '{"print":true,"project":true,"online":false}' WHERE source = 'upload';
    `,
    run: (d) => {
      const put = d.prepare(`INSERT OR IGNORE INTO access_roles (key, name, description, builtin, admin, access, member_details, sensitive_fields, reopen_counts, sort)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`);
      for (const r of BUILTIN_ROLES) {
        put.run(r.key, JSON.stringify(r.name), JSON.stringify(r.description), r.admin ? 1 : 0, JSON.stringify(r.access), r.member_details ? 1 : 0, r.sensitive_fields ? 1 : 0, r.reopen_counts ? 1 : 0, r.sort);
      }
    },
  },
  // 25 (0.15): the external guest role (read-only; an auditor, say) — the only accounts not linked to a member.
  {
    sql: `SELECT 1;`,
    run: (d) => {
      const r = BUILTIN_ROLES.find((x) => x.key === 'guest')!;
      d.prepare(`INSERT OR IGNORE INTO access_roles (key, name, description, builtin, admin, access, member_details, sensitive_fields, reopen_counts, sort)
        VALUES (?, ?, ?, 1, 0, ?, 0, 0, 0, ?)`).run(r.key, JSON.stringify(r.name), JSON.stringify(r.description), JSON.stringify(r.access), r.sort);
    },
  },
  // 26 (0.15): the lending library (a catalogue, numbered copies, loans to members) and the asset register (equipment,
  // its maintenance log, photos and receipts). Both optional modules start switched off. Every role gets access to
  // them (the ready-made roles as shipped; a church's own roles none); new ready-made roles Librarian and Asset keeper.
  {
    sql: `
    CREATE TABLE lending_books (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      subtitle TEXT,
      authors TEXT,
      isbn TEXT,
      publisher TEXT,
      year INTEGER,
      kind TEXT NOT NULL DEFAULT 'book' CHECK (kind IN ('book', 'dvd', 'curriculum', 'other')),
      category TEXT,
      language TEXT,
      shelf TEXT,
      description TEXT,
      notes TEXT,
      has_cover INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX lending_books_isbn ON lending_books(isbn);

    CREATE TABLE lending_copies (
      id INTEGER PRIMARY KEY,
      book_id INTEGER NOT NULL REFERENCES lending_books(id) ON DELETE CASCADE,
      number TEXT NOT NULL UNIQUE COLLATE NOCASE,
      status TEXT NOT NULL DEFAULT 'in' CHECK (status IN ('in', 'lost', 'withdrawn')),
      condition TEXT,
      acquired_on TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX lending_copies_book ON lending_copies(book_id);

    CREATE TABLE lending_loans (
      id INTEGER PRIMARY KEY,
      copy_id INTEGER NOT NULL REFERENCES lending_copies(id) ON DELETE CASCADE,
      person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      lent_on TEXT NOT NULL,
      due_on TEXT NOT NULL,
      returned_on TEXT,
      renewals INTEGER NOT NULL DEFAULT 0,
      reminded_on TEXT,
      overdue_reminded_on TEXT,
      notes TEXT,
      lent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      -- 'desk' (the librarian) or 'self' (the borrower, on a phone: self-service)
      via TEXT NOT NULL DEFAULT 'desk',
      -- the borrower said it is back (self-service); the librarian checks it in
      return_pending_on TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX lending_loans_copy ON lending_loans(copy_id);
    CREATE INDEX lending_loans_person ON lending_loans(person_id);
    CREATE INDEX lending_loans_open ON lending_loans(returned_on, due_on);

    CREATE TABLE equipment (
      id INTEGER PRIMARY KEY,
      number TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      category TEXT,
      make_model TEXT,
      serial_no TEXT,
      location TEXT,
      custodian_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      bought_on TEXT,
      price REAL,
      supplier TEXT,
      warranty_until TEXT,
      condition TEXT NOT NULL DEFAULT 'good' CHECK (condition IN ('good', 'fair', 'poor', 'broken')),
      status TEXT NOT NULL DEFAULT 'in_use' CHECK (status IN ('in_use', 'stored', 'out_of_service')),
      maintenance_every_months INTEGER,
      next_maintenance_on TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX equipment_custodian ON equipment(custodian_id);

    CREATE TABLE equipment_maintenance (
      id INTEGER PRIMARY KEY,
      equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
      done_on TEXT NOT NULL,
      what TEXT NOT NULL,
      cost REAL,
      done_by TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX equipment_maintenance_item ON equipment_maintenance(equipment_id);

    -- the file itself is in assets, key 'equip-file-<id>' (included in backups)
    CREATE TABLE equipment_files (
      id INTEGER PRIMARY KEY,
      equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo', 'receipt', 'warranty', 'other')),
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX equipment_files_item ON equipment_files(equipment_id);

    -- self-service sign-in: a 6-digit code e-mailed to a member (only its hash is kept), valid for 10 minutes
    CREATE TABLE lending_self_codes (
      id INTEGER PRIMARY KEY,
      person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX lending_self_codes_person ON lending_self_codes(person_id);
    `,
    run: (d) => {
      // existing roles: Canon's own get the access they ship with; a church's own roles start without (an
      // administrator gives it in Settings → Roles & permissions)
      const roles = d.prepare('SELECT key, builtin, access FROM access_roles').all() as { key: string; builtin: number; access: string }[];
      const set = d.prepare('UPDATE access_roles SET access = ? WHERE key = ?');
      for (const r of roles) {
        const shipped = BUILTIN_ROLES.find((x) => x.key === r.key);
        const access = JSON.parse(r.access || '{}') as Record<string, string>;
        for (const m of ['lending', 'equipment']) access[m] = r.builtin && shipped ? shipped.access[m as 'lending'] : 'none';
        set.run(JSON.stringify(access), r.key);
      }
      const put = d.prepare(`INSERT OR IGNORE INTO access_roles (key, name, description, builtin, admin, access, member_details, sensitive_fields, reopen_counts, sort)
        VALUES (?, ?, ?, 1, 0, ?, 0, 0, 0, ?)`);
      for (const key of ['librarian', 'keeper']) {
        const r = BUILTIN_ROLES.find((x) => x.key === key)!;
        put.run(r.key, JSON.stringify(r.name), JSON.stringify(r.description), JSON.stringify(r.access), r.sort);
      }
    },
  },
  // 27 (0.15.2): the bulletin link for attendees (one per service, like the visitor form: token and where its QR code
  // shows), roles a church can archive (kept, but not offered for accounts), and sheet music for songs (scans or
  // photos; the files are in assets, key 'score-<id>', so backups include them).
  {
    sql: `
    ALTER TABLE services ADD COLUMN attendee TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE access_roles ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
    CREATE TABLE song_scores (
      id INTEGER PRIMARY KEY,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX song_scores_song ON song_scores(song_id);
    -- a page's file goes with it (also when its song is deleted)
    CREATE TRIGGER song_scores_file AFTER DELETE ON song_scores BEGIN
      DELETE FROM assets WHERE key = 'score-' || OLD.id;
    END;
    `,
  },
  // 28 (0.15.4): the church's spaces (halls, rooms …): each service, meeting or calendar event can be in one, so
  // double bookings show up; a space in use is archived rather than deleted.
  {
    sql: `
    CREATE TABLE spaces (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '{}',
      capacity INTEGER,
      notes TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ALTER TABLE services ADD COLUMN space_id INTEGER REFERENCES spaces(id) ON DELETE SET NULL;
    ALTER TABLE events ADD COLUMN space_id INTEGER REFERENCES spaces(id) ON DELETE SET NULL;
    CREATE INDEX services_space ON services(space_id, date);
    CREATE INDEX events_space ON events(space_id, date);
    `,
  },
  // 29 (0.15.5): short-lived links to add a song's sheet music from a phone (made in Canon or by an AI assistant):
  // anyone with the link may add pages to that one song until it expires.
  {
    sql: `
    CREATE TABLE upload_links (
      token TEXT PRIMARY KEY,
      song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      expires_at TEXT NOT NULL,
      uploads INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    `,
  },
  // 30 (0.15.9): an item's cover slide (its title and who leads it): null = the content only (as before),
  // 'cover' = the cover only (e.g. "Threefold Amen" instead of three amens), 'both' = the cover, then the content.
  {
    sql: `ALTER TABLE service_items ADD COLUMN slide_cover TEXT;`,
  },
  // 31 (0.15.10): who leads an item comes from the rota only: the people ticked (person ids; null = the role's
  // whole rota, or nobody for an item without a role). Names typed before stay in \`leader\` / services.preacher.
  {
    sql: `ALTER TABLE service_items ADD COLUMN leader_people TEXT;`,
  },
  // 32 (0.17.0): book-keeping — the chart of accounts, funds, projects and ministries, journals and their lines
  // (every line with a fund), and bank statements. A posted journal is never changed or deleted (the triggers
  // refuse it whatever writes): a mistake is corrected by a reversing journal. Ids are never reused (AUTOINCREMENT):
  // the change log and a journal's history name records by id, and a deleted draft's id must not pass to another.
  {
    sql: `
    CREATE TABLE bk_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '{}',
      type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
      kind TEXT NOT NULL DEFAULT 'other',
      active INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      sort INTEGER NOT NULL DEFAULT 0,
      bank_csv TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE bk_funds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '{}',
      restriction TEXT NOT NULL DEFAULT 'unrestricted' CHECK (restriction IN ('unrestricted','designated','restricted','endowment')),
      active INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE bk_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE bk_ministries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE bk_journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT UNIQUE,
      date TEXT NOT NULL,
      memo TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
      kind TEXT NOT NULL DEFAULT 'manual',
      service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
      reverses_id INTEGER REFERENCES bk_journals(id),
      reversed_by_id INTEGER REFERENCES bk_journals(id),
      created_via TEXT NOT NULL DEFAULT 'web',
      created_by TEXT,
      posted_by TEXT,
      posted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX bk_journals_date ON bk_journals(date);
    CREATE INDEX bk_journals_service ON bk_journals(service_id);
    CREATE TABLE bk_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journal_id INTEGER NOT NULL REFERENCES bk_journals(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      account_id INTEGER NOT NULL REFERENCES bk_accounts(id),
      fund_id INTEGER NOT NULL REFERENCES bk_funds(id),
      project_id INTEGER REFERENCES bk_projects(id) ON DELETE SET NULL,
      ministry_id INTEGER REFERENCES bk_ministries(id) ON DELETE SET NULL,
      congregation_id INTEGER REFERENCES congregations(id) ON DELETE SET NULL,
      debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
      credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
      memo TEXT,
      orig_currency TEXT,
      orig_amount INTEGER,
      rate REAL,
      CHECK (NOT (debit > 0 AND credit > 0))
    );
    CREATE INDEX bk_lines_journal ON bk_lines(journal_id);
    CREATE INDEX bk_lines_account ON bk_lines(account_id);
    CREATE INDEX bk_lines_fund ON bk_lines(fund_id);
    CREATE TABLE bk_statements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES bk_accounts(id),
      starts_on TEXT,
      ends_on TEXT,
      opening_balance INTEGER,
      closing_balance INTEGER,
      file_name TEXT,
      imported_by TEXT,
      imported_at TEXT NOT NULL DEFAULT (datetime('now')),
      done_by TEXT,
      done_at TEXT
    );
    CREATE TABLE bk_statement_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      statement_id INTEGER NOT NULL REFERENCES bk_statements(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      description TEXT,
      reference TEXT,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','ignored')),
      line_id INTEGER REFERENCES bk_lines(id) ON DELETE SET NULL,
      journal_id INTEGER REFERENCES bk_journals(id) ON DELETE SET NULL
    );
    CREATE INDEX bk_statement_lines_statement ON bk_statement_lines(statement_id);
    CREATE UNIQUE INDEX bk_statement_lines_matched ON bk_statement_lines(line_id) WHERE line_id IS NOT NULL;

    CREATE TRIGGER bk_journals_posted_update BEFORE UPDATE ON bk_journals
      WHEN OLD.status = 'posted' AND (NEW.status IS NOT OLD.status OR NEW.date IS NOT OLD.date OR NEW.number IS NOT OLD.number
        OR NEW.memo IS NOT OLD.memo OR NEW.kind IS NOT OLD.kind OR NEW.reverses_id IS NOT OLD.reverses_id)
      BEGIN SELECT RAISE(ABORT, 'A posted journal cannot be changed: reverse it instead.'); END;
    CREATE TRIGGER bk_journals_posted_delete BEFORE DELETE ON bk_journals WHEN OLD.status = 'posted'
      BEGIN SELECT RAISE(ABORT, 'A posted journal cannot be deleted: reverse it instead.'); END;
    CREATE TRIGGER bk_lines_posted_update BEFORE UPDATE ON bk_lines
      WHEN (SELECT status FROM bk_journals WHERE id = OLD.journal_id) = 'posted'
      BEGIN SELECT RAISE(ABORT, 'A posted journal cannot be changed: reverse it instead.'); END;
    CREATE TRIGGER bk_lines_posted_delete BEFORE DELETE ON bk_lines
      WHEN (SELECT status FROM bk_journals WHERE id = OLD.journal_id) = 'posted'
      BEGIN SELECT RAISE(ABORT, 'A posted journal cannot be changed: reverse it instead.'); END;
    CREATE TRIGGER bk_lines_posted_insert BEFORE INSERT ON bk_lines
      WHEN (SELECT status FROM bk_journals WHERE id = NEW.journal_id) = 'posted'
      BEGIN SELECT RAISE(ABORT, 'A posted journal cannot be changed: reverse it instead.'); END;
    `,
    run: (d) => {
      // existing roles: Canon's own get the access they ship with; a church's own roles start without
      const roles = d.prepare('SELECT key, builtin, access FROM access_roles').all() as { key: string; builtin: number; access: string }[];
      const set = d.prepare('UPDATE access_roles SET access = ? WHERE key = ?');
      for (const r of roles) {
        const shipped = BUILTIN_ROLES.find((x) => x.key === r.key);
        const access = JSON.parse(r.access || '{}') as Record<string, string>;
        access.bookkeeping = r.builtin && shipped ? shipped.access.bookkeeping : 'none';
        set.run(JSON.stringify(access), r.key);
      }
    },
  },
  // 33 (0.17.1): expense claims — a claimant's lines (several receipts per claim) with receipt files, signed on
  // screen, approved by named approvers (people, not a role), then into the books: approval drafts the expense owed,
  // payment drafts paying it. Sign-in codes for members' phones gain a purpose (the library's, or claims').
  {
    sql: `
    CREATE TABLE bk_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      number TEXT UNIQUE,
      person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      claimant TEXT NOT NULL,
      purpose TEXT,
      ministry_id INTEGER REFERENCES bk_ministries(id) ON DELETE SET NULL,
      project_id INTEGER REFERENCES bk_projects(id) ON DELETE SET NULL,
      fund_id INTEGER REFERENCES bk_funds(id) ON DELETE SET NULL,
      congregation_id INTEGER REFERENCES congregations(id) ON DELETE SET NULL,
      pay_to TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','paid','withdrawn')),
      note TEXT,
      signature TEXT,
      submitted_at TEXT,
      approved_at TEXT,
      approval_journal_id INTEGER REFERENCES bk_journals(id) ON DELETE SET NULL,
      payment_journal_id INTEGER REFERENCES bk_journals(id) ON DELETE SET NULL,
      paid_on TEXT,
      paid_by TEXT,
      payment_ref TEXT,
      approver_paid INTEGER NOT NULL DEFAULT 0,
      created_via TEXT NOT NULL DEFAULT 'web',
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX bk_claims_person ON bk_claims(person_id);
    CREATE INDEX bk_claims_status ON bk_claims(status);
    CREATE TABLE bk_claim_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id INTEGER NOT NULL REFERENCES bk_claims(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      date TEXT,
      description TEXT NOT NULL DEFAULT '',
      payee TEXT,
      amount INTEGER NOT NULL DEFAULT 0 CHECK (amount >= 0),
      account_id INTEGER REFERENCES bk_accounts(id) ON DELETE SET NULL,
      fund_id INTEGER REFERENCES bk_funds(id) ON DELETE SET NULL,
      ministry_id INTEGER REFERENCES bk_ministries(id) ON DELETE SET NULL,
      project_id INTEGER REFERENCES bk_projects(id) ON DELETE SET NULL
    );
    CREATE INDEX bk_claim_lines_claim ON bk_claim_lines(claim_id);
    CREATE TABLE bk_claim_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id INTEGER NOT NULL REFERENCES bk_claims(id) ON DELETE CASCADE,
      line_id INTEGER REFERENCES bk_claim_lines(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX bk_claim_files_claim ON bk_claim_files(claim_id);
    CREATE TABLE bk_claim_approvers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL UNIQUE REFERENCES people(id) ON DELETE CASCADE,
      ministry_ids TEXT,
      max_amount INTEGER,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE bk_claim_approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_id INTEGER NOT NULL REFERENCES bk_claims(id) ON DELETE CASCADE,
      person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('approved','rejected','returned')),
      note TEXT,
      image TEXT,
      hash TEXT,
      via TEXT NOT NULL DEFAULT 'device',
      account_id INTEGER,
      at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX bk_claim_approvals_claim ON bk_claim_approvals(claim_id);
    ALTER TABLE bk_journals ADD COLUMN claim_id INTEGER REFERENCES bk_claims(id) ON DELETE SET NULL;
    ALTER TABLE lending_self_codes ADD COLUMN purpose TEXT NOT NULL DEFAULT 'library';
    `,
  },
  // 34 (0.18.0): bank matches in groups — several statement lines against one book line (PayNow gifts against one
  // offering line) or one statement line against several (a deposit covering several services), when the totals
  // agree (v0.17.2 review, F5). A one-to-one match stays on the statement line (line_id).
  {
    sql: `
    CREATE TABLE bk_match_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL REFERENCES bk_accounts(id),
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE bk_match_book_lines (
      group_id INTEGER NOT NULL REFERENCES bk_match_groups(id) ON DELETE CASCADE,
      line_id INTEGER NOT NULL UNIQUE REFERENCES bk_lines(id) ON DELETE CASCADE
    );
    CREATE INDEX bk_match_book_lines_group ON bk_match_book_lines(group_id);
    ALTER TABLE bk_statement_lines ADD COLUMN group_id INTEGER REFERENCES bk_match_groups(id) ON DELETE SET NULL;
    `,
  },
  // 35 (0.18.0, review): an approval counts for the submission it was given for (round = the claim's revision then),
  // so approvals from before a claim was sent back or moved to another ministry don't carry over; existing approvals
  // of the claim as signed now belong to its current submission. A posted journal also keeps who posted it and
  // when, its claim, and the journal that reversed it (set once).
  {
    sql: `
    ALTER TABLE bk_claim_approvals ADD COLUMN round INTEGER;
    UPDATE bk_claim_approvals SET round = (SELECT c.revision FROM bk_claims c WHERE c.id = bk_claim_approvals.claim_id)
      WHERE decision = 'approved' AND hash IS NOT NULL
        AND hash = (SELECT json_extract(c.signature, '$.hash') FROM bk_claims c WHERE c.id = bk_claim_approvals.claim_id);
    DROP TRIGGER bk_journals_posted_update;
    CREATE TRIGGER bk_journals_posted_update BEFORE UPDATE ON bk_journals
      WHEN OLD.status = 'posted' AND (NEW.status IS NOT OLD.status OR NEW.date IS NOT OLD.date OR NEW.number IS NOT OLD.number
        OR NEW.memo IS NOT OLD.memo OR NEW.kind IS NOT OLD.kind OR NEW.reverses_id IS NOT OLD.reverses_id
        OR NEW.posted_by IS NOT OLD.posted_by OR NEW.posted_at IS NOT OLD.posted_at OR NEW.claim_id IS NOT OLD.claim_id
        OR (OLD.reversed_by_id IS NOT NULL AND NEW.reversed_by_id IS NOT OLD.reversed_by_id))
      BEGIN SELECT RAISE(ABORT, 'A posted journal cannot be changed: reverse it instead.'); END;
    `,
  },
  // 36 (0.19.2, review): sample data marks its own rows. Removing it once trusted a row's number and a creation time
  // close to the sample's — a real service made after a sample one was deleted could take its number and be removed.
  // Now every person, household, group and service the sample adds carries its batch, and only those go. Rows of sample
  // data added before this version are marked by the checks used until now (each row once, here).
  {
    sql: `
    ALTER TABLE people ADD COLUMN sample_batch TEXT;
    ALTER TABLE households ADD COLUMN sample_batch TEXT;
    ALTER TABLE groups ADD COLUMN sample_batch TEXT;
    ALTER TABLE services ADD COLUMN sample_batch TEXT;
    `,
    run: (d) => {
      const meta = d.prepare("SELECT value FROM settings WHERE key = '_sample_data'").get() as { value: string } | undefined;
      if (!meta) return;
      const a = JSON.parse(meta.value) as { added_at: string; people?: number[]; households?: number[]; groups?: number[]; services?: number[]; batch?: string };
      const batch = 'before-0.19.2';
      const near = (created: string | null) => {
        if (!created) return false;
        const t = Date.parse(created.includes('T') ? created : `${created.replace(' ', 'T')}Z`);
        return Math.abs(t - Date.parse(a.added_at)) < 3_600_000;
      };
      for (const id of a.people ?? []) {
        const r = d.prepare('SELECT notes, created_at FROM people WHERE id = ?').get(id) as { notes: string | null; created_at: string } | undefined;
        if (r && (r.notes ?? '').includes('Sample person (fictional)') && near(r.created_at)) d.prepare('UPDATE people SET sample_batch = ? WHERE id = ?').run(batch, id);
      }
      for (const id of a.services ?? []) {
        const r = d.prepare('SELECT created_at FROM services WHERE id = ?').get(id) as { created_at: string } | undefined;
        if (r && near(r.created_at)) d.prepare('UPDATE services SET sample_batch = ? WHERE id = ?').run(batch, id);
      }
      for (const [table, ids] of [['households', a.households ?? []], ['groups', a.groups ?? []]] as const) {
        for (const id of ids) d.prepare(`UPDATE ${table} SET sample_batch = ? WHERE id = ?`).run(batch, id);
      }
      d.prepare("UPDATE settings SET value = ? WHERE key = '_sample_data'").run(JSON.stringify({ ...a, batch }));
    },
  },
  // 37 (0.19.4): who typed in where to repay a claimant — the claimant, or the office (a paper claim, or a change made
  // for them). Approvers never see the details; they are told when the office entered them. Claims already made: from
  // the claimant's own page → the claimant; entered by the office → the office; drafted by an AI assistant → not known.
  {
    sql: `
    ALTER TABLE bk_claims ADD COLUMN pay_to_by TEXT;
    UPDATE bk_claims SET pay_to_by = CASE created_via WHEN 'self' THEN 'claimant' WHEN 'web' THEN 'office' END WHERE pay_to IS NOT NULL;
    `,
  },
];
