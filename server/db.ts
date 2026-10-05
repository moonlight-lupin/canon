import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
/** The newest schema version this Canon knows. */
export const schemaVersion = () => MIGRATIONS.length;
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

/**
 * A migration is SQL, or SQL plus a step in code. `noForeignKeys` runs it with foreign-key checks off (needed to
 * rebuild a table that others refer to — SQLite's documented way to change a CHECK constraint); the checks are
 * verified afterwards.
 */
interface Migration {
  sql: string;
  run?: (d: DatabaseSync) => void;
  noForeignKeys?: boolean;
}

/** Ordered migrations. Append only; never edit a shipped migration. */
const MIGRATIONS: (string | Migration)[] = [
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
];

/** Bring the database up to the current schema (also after restoring an older backup). */
export function migrate() {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    const m: Migration = typeof MIGRATIONS[v] === 'string' ? { sql: MIGRATIONS[v] as string } : (MIGRATIONS[v] as Migration);
    if (m.noForeignKeys) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      m.run?.(db);
      if (m.noForeignKeys) {
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`migration ${v + 1}: foreign key check failed (${JSON.stringify(broken.slice(0, 3))})`);
      }
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      if (m.noForeignKeys) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}
migrate();

/** Run fn inside a transaction (nested calls join the outer one). */
let txDepth = 0;
export function tx<T>(fn: () => T): T {
  if (txDepth > 0) return fn();
  txDepth++;
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

export type SqlValue = string | number | bigint | null | Uint8Array;

export function all<T>(sql: string, ...params: SqlValue[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}
export function get<T>(sql: string, ...params: SqlValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}
export function run(sql: string, ...params: SqlValue[]) {
  return db.prepare(sql).run(...params);
}
