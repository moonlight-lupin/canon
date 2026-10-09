// A member's personal data (PDPA): everything Canon holds about one person, as a file for them (an access request),
// and erasing it (a withdrawal of consent / an erasure request).
//
// Erasing anonymises rather than deletes: the person's row stays as "(erased)" with every personal field cleared, so
// past rotas, group histories and attendance still count. Their qualifications, team places, time away, staff records
// and future duties go; their account is unlinked; the change log (and its archive copies) loses their details.
// Names typed on services and records — a preacher, a counter, a signature on an offering count — are part of the
// church's records and are kept: the export lists them.
import type { Person } from '../../shared/types.ts';
import { all, get, run, tx } from '../db.ts';
import { BadRequest } from '../lib/table.ts';
import { displayName, people } from './registers.ts';
import { logChange } from './changelog.ts';
import { forEachArchive } from './archive.ts';
import { churchToday } from '../lib/dates.ts';

const ERASED = '(erased member)';
const today = () => churchToday();
const parse = (s: string | null) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return s;
  }
};

/**
 * The ways the person's name may be written (longest first: "Jane Tan Mei Ling" before "Jane Tan"). Only whole names:
 * a first name alone ("John") would also match other people and Bible references.
 */
function nameVariants(p: Person): string[] {
  const v = new Set<string>();
  const add = (s: string | null | undefined, native = false) => {
    const x = (s ?? '').trim().replace(/\s+/g, ' ');
    if (native ? x.length >= 2 : x.length >= 5 && x.includes(' ')) v.add(x);
  };
  add(displayName(p));
  add(`${p.first_name} ${p.last_name ?? ''}`);
  add(`${p.preferred_name ?? ''} ${p.last_name ?? ''}`);
  add(`${p.last_name ?? ''} ${p.first_name}`);
  add(p.native_name, true);
  return [...v].sort((a, b) => b.length - a.length);
}

/** Services and records where the name was typed (not linked by id). */
function mentions(names: string[]) {
  if (!names.length) return { services: [], records: [], items: [] };
  const anyOf = (col: string) => `(${names.map(() => `instr(${col}, ?) > 0`).join(' OR ')})`;
  return {
    services: all<{ id: number; date: string; title: string; preacher: string | null; chair: string | null }>(
      `SELECT id, date, title, preacher, chair FROM services WHERE ${anyOf("IFNULL(preacher, '')")} OR ${anyOf("IFNULL(chair, '')")} ORDER BY date`, ...names, ...names,
    ).map((s) => ({ ...s, title: parse(s.title) })),
    records: all<{ service_id: number; date: string }>(
      `SELECT r.service_id, s.date FROM service_records r JOIN services s ON s.id = r.service_id
       WHERE ${anyOf("IFNULL(r.counters, '')")} OR ${anyOf("IFNULL(r.signatures, '')")} ORDER BY s.date`,
      ...names, ...names,
    ).map((r) => ({ ...r, as: 'counter or signature (offering count)' })),
    items: all<{ service_id: number; date: string; leader: string }>(
      `SELECT i.service_id, s.date, i.leader FROM service_items i JOIN services s ON s.id = i.service_id WHERE ${anyOf("IFNULL(i.leader, '')")} ORDER BY s.date`, ...names,
    ),
  };
}

/** Everything Canon holds about a member, for the member (an access request under the PDPA). */
export function personalData(pid: number) {
  const p = people.get(pid);
  if (p.erased_at) throw new BadRequest('This member’s personal data was erased.');
  const { revision: _r, ...person } = p;
  const account = get<Record<string, unknown>>(
    'SELECT username, display_name, role, lang, created_at, last_login_at, totp_enabled FROM users WHERE person_id = ?', pid,
  );
  return {
    exported_at: new Date().toISOString(),
    about: 'Everything Canon holds about this person. Names of other people are left out.',
    person,
    household: p.household_id ? get('SELECT name, address, phone FROM households WHERE id = ?', p.household_id) ?? null : null,
    groups: all<{ name: string; role: string | null; start_date: string | null; end_date: string | null; leads: number }>(
      'SELECT g.name, m.role, m.start_date, m.end_date, m.leads FROM group_members m JOIN groups g ON g.id = m.group_id WHERE m.person_id = ? ORDER BY m.start_date', pid,
    ).map((g) => ({ ...g, name: parse(g.name), leads: !!g.leads })),
    teams: all<{ name: string; is_leader: number }>('SELECT t.name, m.is_leader FROM team_members_v08 m JOIN teams t ON t.id = m.team_id WHERE m.person_id = ?', pid)
      .map((t) => ({ name: parse(t.name), leader: !!t.is_leader })),
    qualified_for: all<{ name: string }>('SELECT r.name FROM role_members m JOIN roles r ON r.id = m.role_id WHERE m.person_id = ?', pid).map((r) => parse(r.name)),
    serving: all<{ date: string; title: string; role: string; status: string; notes: string | null }>(
      `SELECT s.date, s.title, r.name AS role, a.status, a.notes FROM assignments a JOIN services s ON s.id = a.service_id JOIN roles r ON r.id = a.role_id
       WHERE a.person_id = ? ORDER BY s.date`, pid,
    ).map((a) => ({ ...a, title: parse(a.title), role: parse(a.role) })),
    meetings_led: all<{ date: string; title: string }>('SELECT date, title FROM services WHERE leader_id = ? ORDER BY date', pid).map((s) => ({ ...s, title: parse(s.title) })),
    time_away: all('SELECT start_date, end_date, reason FROM unavailability WHERE person_id = ? ORDER BY start_date', pid),
    staff_records: all('SELECT position, category, employment, ministry_area, ordained, start_date, end_date, notes FROM coworkers WHERE person_id = ?', pid),
    account: account ? { ...account, totp_enabled: !!account.totp_enabled } : null,
    library_loans: all('SELECT b.title, c.number, l.lent_on, l.due_on, l.returned_on FROM lending_loans l JOIN lending_copies c ON c.id = l.copy_id JOIN lending_books b ON b.id = c.book_id WHERE l.person_id = ? ORDER BY l.lent_on', pid),
    looks_after: all('SELECT number, name, location FROM equipment WHERE custodian_id = ? ORDER BY number', pid),
    emails_sent: all('SELECT at, to_addr, subject, kind, ok FROM email_log WHERE person_id = ? ORDER BY at', pid),
    record_viewed: all('SELECT at, user_name, via, detail FROM member_views WHERE person_id = ? ORDER BY at', pid),
    changes: all<{ at: string; user_name: string | null; action: string; summary: string | null; changes: string | null }>(
      "SELECT at, user_name, action, summary, changes FROM change_log WHERE entity = 'people' AND entity_id = ? ORDER BY at", pid,
    ).map((c) => ({ ...c, changes: parse(c.changes) })),
    named_in: mentions(nameVariants(p)),
  };
}

const jsonText = (s: string) => JSON.stringify(s).slice(1, -1);

/** Replace the names in a text column of rows matching `where` (change log, AI log), in main or an archive. */
function scrubNames(schema: string, table: string, cols: string[], names: string[]): number {
  let n = 0;
  for (const col of cols) {
    for (const name of names) {
      for (const form of new Set([name, jsonText(name)])) {
        const r = run(`UPDATE ${schema}.${table} SET ${col} = replace(${col}, ?, ?) WHERE instr(${col}, ?) > 0`, form, ERASED, form);
        n += Number(r.changes);
      }
    }
  }
  return n;
}

/** The change log, AI log and record views in one database (main, or an attached archive). */
function scrubLogs(schema: string, pid: number, names: string[], ids: { unavailability: number[]; coworkers: number[] }): number {
  let n = 0;
  const has = (t: string) => !!get(`SELECT 1 FROM ${schema}.sqlite_master WHERE type = 'table' AND name = ?`, t);
  if (!has('change_log')) return 0;
  n += Number(run(
    `UPDATE ${schema}.change_log SET name = ?, summary = 'Personal data erased', changes = '{}' WHERE entity = 'people' AND entity_id = ?`, ERASED, pid,
  ).changes);
  for (const [entity, list] of Object.entries(ids)) {
    for (const id of list) n += Number(run(`UPDATE ${schema}.change_log SET changes = '{}', name = ? WHERE entity = ? AND entity_id = ?`, ERASED, entity, id).changes);
    // and every entry about the person in that table by who it is about, also rows deleted before (their ids are gone):
    // an away date's reason, a co-worker's notes
    n += Number(run(
      `UPDATE ${schema}.change_log SET changes = '{}', name = ? WHERE entity = ? AND changes <> '{}' AND json_valid(changes)
         AND (json_extract(changes, '$.person_id[0]') = ? OR json_extract(changes, '$.person_id[1]') = ?)`, ERASED, entity, pid, pid,
    ).changes);
  }
  n += scrubNames(schema, 'change_log', ['name', 'summary', 'changes'], names);
  if (has('mcp_audit')) n += scrubNames(schema, 'mcp_audit', ['args'], names);
  if (has('member_views')) n += Number(run(`UPDATE ${schema}.member_views SET detail = NULL WHERE person_id = ? AND detail IS NOT NULL`, pid).changes);
  return n;
}

/**
 * Erase a member's personal data. `confirm` must be the member's name as shown (a typed confirmation).
 * Returns what was done and what was kept.
 */
export function erasePerson(pid: number, confirm: string) {
  const p = people.get(pid);
  if (p.erased_at) throw new BadRequest('This member’s personal data was already erased.');
  if (confirm.trim() !== displayName(p)) throw new BadRequest(`Type the member’s name exactly as shown (${displayName(p)}) to erase.`);
  if (get('SELECT 1 FROM lending_loans WHERE person_id = ? AND returned_on IS NULL', pid)) throw new BadRequest('This member has items from the lending library on loan: take them back first.');
  const names = nameVariants(p);
  const kept = mentions(names);
  // their contact details wherever an entry quotes them (an approver's e-mail, a note), in the case they were written
  // and in lower case (e-mail addresses are often typed either way)
  const contact = [p.email, p.email?.toLowerCase(), p.phone, p.address].map((x) => x?.trim() ?? '').filter((x) => x.length >= 5);
  const ids = {
    unavailability: all<{ id: number }>('SELECT id FROM unavailability WHERE person_id = ?', pid).map((r) => r.id),
    coworkers: all<{ id: number }>('SELECT id FROM coworkers WHERE person_id = ?', pid).map((r) => r.id),
  };
  const done = tx(() => {
    const future = Number(run('DELETE FROM assignments WHERE person_id = ? AND service_id IN (SELECT id FROM services WHERE date >= ?)', pid, today()).changes);
    run('UPDATE assignments SET notes = NULL WHERE person_id = ?', pid);
    run('DELETE FROM role_members WHERE person_id = ?', pid);
    run('DELETE FROM team_members_v08 WHERE person_id = ?', pid);
    run('DELETE FROM unavailability WHERE person_id = ?', pid);
    run('DELETE FROM coworkers WHERE person_id = ?', pid);
    run("UPDATE group_members SET end_date = IFNULL(end_date, ?), leads = 0, role = NULL WHERE person_id = ?", today(), pid);
    run('UPDATE users SET person_id = NULL WHERE person_id = ?', pid);
    // past loans stay (the borrower shows as erased); equipment they looked after has no one now
    run('UPDATE equipment SET custodian_id = NULL WHERE custodian_id = ?', pid);
    run("UPDATE email_log SET to_addr = '(erased)' WHERE person_id = ?", pid);
    run(
      `UPDATE people SET first_name = '(erased)', last_name = '', native_name = NULL, preferred_name = NULL, gender = NULL, birth_date = NULL,
         phone = NULL, email = NULL, address = NULL, household_id = NULL, household_role = NULL, status = 'inactive', membership_date = NULL,
         baptism_date = NULL, baptism_type = NULL, profession_date = NULL, preferred_lang = NULL, honorific = NULL, notes = NULL, custom = '{}',
         erased_at = datetime('now'), updated_at = datetime('now'), revision = revision + 1
       WHERE id = ?`, pid,
    );
    // a household left with no one: its address and phone go too
    if (p.household_id && !get('SELECT 1 FROM people WHERE household_id = ?', p.household_id)) run('DELETE FROM households WHERE id = ?', p.household_id);
    const log = scrubLogs('main', pid, [...new Set([...names, ...contact])], ids);
    return { future_duties_removed: future, log_entries_cleaned: log };
  });
  forEachArchive(() => {
    done.log_entries_cleaned += tx(() => scrubLogs('arc', pid, [...new Set([...names, ...contact])], ids));
  });
  // no name in the entry: it is about someone whose name is gone
  logChange({ entity: 'people', entity_id: pid, action: 'update', summary: 'Personal data erased (PDPA request)' });
  return {
    ...done,
    kept: { services: kept.services.length, records: kept.records.length, items: kept.items.length },
  };
}
