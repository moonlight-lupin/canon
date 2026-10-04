import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

/** Ordered migrations. Append only; never edit a shipped migration. */
const MIGRATIONS: string[] = [
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
];

function migrate() {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
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
