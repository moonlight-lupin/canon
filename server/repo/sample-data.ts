// Settings → Sample data (administrators, 0.15.8): a fictional church to try Canon with — households with English
// and Chinese names (each a name of its own, not a translation), birthdays, cell groups by area, committees,
// fellowships, Sunday school, people on every serving team, and the rota of the next service and the one after.
// Canon keeps a list of everything it added (meta _sample_data), so removing it takes out exactly that and nothing
// a person typed. Every person's notes say they are sample data.
import { get, tx } from '../db.ts';
import { deleteMeta, getMeta, setMeta } from './settings.ts';
import * as reg from './registers.ts';
import * as grp from './groups.ts';
import * as vol from './volunteers.ts';
import * as svc from './services.ts';
import { BadRequest } from '../lib/table.ts';

export const SAMPLE_NOTE = 'Sample person (fictional) — Settings → Sample data removes it.';

interface Added {
  added_at: string;
  people: number[];
  households: number[];
  groups: number[];
  services: number[];
  assignments: number[];
}

type Area = 'east' | 'west' | 'north' | 'young';
type P = [first: string, last: string, chinese: string, gender: 'M' | 'F', born: string, role: 'head' | 'spouse' | 'child' | 'other'];
// Singapore-style: a wife keeps her own Chinese surname; children take their father's
const HOUSEHOLDS: { name: string; area: Area; people: P[] }[] = [
  { name: 'Tan family', area: 'east', people: [
    ['Daniel', 'Tan', '陈志明', 'M', '1975-03-14', 'head'], ['Grace', 'Tan', '林美玲', 'F', '1978-10-14', 'spouse'],
    ['Joel', 'Tan', '陈子轩', 'M', '2010-05-21', 'child'], ['Hannah', 'Tan', '陈欣怡', 'F', '2014-11-09', 'child']] },
  { name: 'Ng family', area: 'east', people: [
    ['Joshua', 'Ng', '黄伟强', 'M', '1983-12-05', 'head'], ['Esther', 'Ng', '吴慧敏', 'F', '1985-04-30', 'spouse'],
    ['Caleb', 'Ng', '黄家豪', 'M', '2016-02-11', 'child']] },
  { name: 'Chua family', area: 'east', people: [
    ['Andrew', 'Chua', '蔡振华', 'M', '1980-09-19', 'head'], ['Martha', 'Chua', '杨佩珊', 'F', '1982-01-08', 'spouse'],
    ['Isaac', 'Chua', '蔡天佑', 'M', '2012-07-26', 'child'], ['Abigail', 'Chua', '蔡嘉欣', 'F', '2018-03-17', 'child']] },
  { name: 'Foo family', area: 'east', people: [
    ['Barnabas', 'Foo', '符志强', 'M', '1987-08-14', 'head'], ['Dorcas', 'Foo', '何丽华', 'F', '1989-05-25', 'spouse']] },
  { name: 'Lee family', area: 'west', people: [
    ['Samuel', 'Lee', '李建国', 'M', '1962-01-27', 'head'], ['Ruth', 'Lee', '黄秀英', 'F', '1964-06-18', 'spouse'],
    ['Jonathan', 'Lee', '李俊杰', 'M', '1994-09-03', 'child']] },
  { name: 'Goh family', area: 'west', people: [
    ['Timothy', 'Goh', '吴文辉', 'M', '1970-07-07', 'head'], ['Lydia', 'Goh', '许淑芬', 'F', '1972-10-21', 'spouse']] },
  { name: 'Koh family', area: 'west', people: [
    ['Benjamin', 'Koh', '许世杰', 'M', '1988-11-11', 'head'], ['Naomi', 'Koh', '张婉婷', 'F', '1990-02-14', 'spouse']] },
  { name: 'Quek family', area: 'west', people: [
    ['Kenneth', 'Quek', '郭俊辉', 'M', '1966-10-10', 'head'], ['Irene', 'Quek', '林丽娟', 'F', '1968-07-30', 'spouse'],
    ['Chloe', 'Quek', '郭诗涵', 'F', '2006-08-19', 'child']] },
  { name: 'Yeo family', area: 'north', people: [
    ['Nathan', 'Yeo', '杨明辉', 'M', '1977-06-01', 'head'], ['Deborah', 'Yeo', '刘素珍', 'F', '1979-09-27', 'spouse'],
    ['Phoebe', 'Yeo', '杨雅琪', 'F', '2008-12-02', 'child']] },
  { name: 'Lim family', area: 'north', people: [
    ['Stephen', 'Lim', '林国栋', 'M', '1958-03-03', 'head'], ['Priscilla', 'Lim', '郭玉兰', 'F', '1960-12-24', 'spouse']] },
  { name: 'Ong family', area: 'north', people: [
    ['Philip', 'Ong', '王永康', 'M', '1955-05-05', 'head'], ['Lois', 'Ong', '陈月娥', 'F', '1957-08-22', 'spouse']] },
  { name: 'Teo household', area: 'north', people: [
    ['Matthew', 'Teo', '张德胜', 'M', '1950-04-12', 'head'], ['Miriam', 'Teo', '刘宝珠', 'F', '1948-01-16', 'other']] },
  { name: 'Chen household', area: 'north', people: [['Joanna', 'Chen', '陈秀珠', 'F', '1953-10-17', 'head']] },
  // young adults living on their own: no household
  { name: '', area: 'young', people: [
    ['Rachel', 'Sim', '沈晓燕', 'F', '1996-07-19', 'other'], ['Elijah', 'Low', '刘耀祖', 'M', '1999-10-30', 'other'],
    ['Aaron', 'Wong', '黄庆福', 'M', '1992-03-08', 'other'], ['Susanna', 'Ho', '何静怡', 'F', '1995-12-12', 'other'],
    ['Ian', 'Seah', '佘家明', 'M', '1998-04-04', 'other'], ['Michelle', 'Toh', '卓诗婷', 'F', '1997-02-26', 'other']] },
];

const CELLS: [Area, { en: string; zh: string }][] = [
  ['east', { en: 'Cell Group — East', zh: '东区小组' }],
  ['west', { en: 'Cell Group — West', zh: '西区小组' }],
  ['north', { en: 'Cell Group — North', zh: '北区小组' }],
  ['young', { en: 'Young Adults Cell', zh: '青年小组' }],
];

function added(): Added | null {
  const raw = getMeta('sample_data');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Added;
  } catch {
    return null;
  }
}

const count = (table: string, ids: number[]) =>
  ids.length ? get<{ n: number }>(`SELECT COUNT(*) n FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)!.n : 0;

/** Whether sample data is in, and how much of it is still there. */
export function sampleDataStatus() {
  const a = added();
  if (!a) return { present: false as const };
  return {
    present: true as const,
    added_at: a.added_at,
    people: count('people', a.people),
    households: count('households', a.households),
    groups: count('groups', a.groups),
    services: count('services', a.services),
    assignments: count('assignments', a.assignments),
  };
}

/** Add the sample church. `rota`: also put sample people on the next service's rota and a copy of it a week later. */
export function addSampleData(opts: { rota?: boolean; today?: string } = {}) {
  if (added()) throw new BadRequest('The sample data is already there. Remove it first to add it again.');
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const year = Number(today.slice(0, 4));
  const age = (born: string) => year - Number(born.slice(0, 4));
  // a fixed seed: the same "random" choices every time
  let seed = 20261011;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(a: T[], n: number) => [...a].sort(() => rnd() - 0.5).slice(0, n);
  const out: Added = { added_at: new Date().toISOString(), people: [], households: [], groups: [], services: [], assignments: [] };

  tx(() => {
    interface Made { id: number; born: string; area: Area; child: boolean }
    const people: Made[] = [];
    for (const h of HOUSEHOLDS) {
      const hid = h.name ? (reg.households.insert({ name: h.name } as never) as { id: number }).id : null;
      if (hid) out.households.push(hid);
      for (const [first_name, last_name, native_name, gender, birth_date, role] of h.people) {
        const adult = age(birth_date) >= 18;
        const joined = Math.max(Number(birth_date.slice(0, 4)) + 18, 1990 + Math.floor(rnd() * 34));
        const p = reg.people.insert({
          first_name, last_name, native_name, gender, birth_date,
          household_id: hid, household_role: hid ? role : null,
          status: rnd() < 0.85 ? 'member' : 'regular',
          membership_date: adult ? `${Math.min(joined, year)}-0${1 + Math.floor(rnd() * 9)}-15` : null,
          notes: SAMPLE_NOTE,
        } as never) as { id: number };
        out.people.push(p.id);
        people.push({ id: p.id, born: birth_date, area: h.area, child: !adult });
      }
    }
    const adults = people.filter((p) => !p.child);
    const group = (name: { en: string; zh: string }, kind: string, members: Made[], leader = 'Leader') => {
      const g = grp.createGroup({ name, kind }) as { id: number };
      out.groups.push(g.id);
      members.forEach((p, i) => grp.addGroupMember(g.id, { person_id: p.id, leads: i === 0, role: i === 0 ? leader : null }));
    };
    // cell groups by area, households together (adults); the young adults' cell also takes grown-up children
    for (const [area, name] of CELLS) {
      const members = area === 'young'
        ? [...adults.filter((p) => p.area === 'young'), ...adults.filter((p) => p.area !== 'young' && age(p.born) <= 32)]
        : adults.filter((p) => p.area === area && age(p.born) > 32);
      group(name, 'cell_group', members);
    }
    const older = adults.filter((p) => age(p.born) >= 40);
    group({ en: 'Church Council', zh: '教会议会' }, 'committee', pick(older, 5), 'Chair');
    group({ en: 'Missions Committee', zh: '宣教委员会' }, 'committee', pick(adults.filter((p) => age(p.born) >= 30), 4), 'Chair');
    group({ en: 'Finance Committee', zh: '财务委员会' }, 'committee', pick(older, 3), 'Chair');
    group({ en: 'Worship Committee', zh: '崇拜委员会' }, 'committee', pick(adults, 4), 'Chair');
    group({ en: 'Young Adults Fellowship', zh: '青年团契' }, 'fellowship', adults.filter((p) => age(p.born) <= 35));
    group({ en: 'Seniors Fellowship', zh: '长青团契' }, 'fellowship', adults.filter((p) => age(p.born) >= 64));
    group({ en: 'Sunday School', zh: '主日学' }, 'sunday_school', [...pick(adults.filter((p) => age(p.born) < 60), 3), ...people.filter((p) => p.child)], 'Teacher');

    // serving teams: adults up to 76, added to whoever is already there; each role gains some of them
    const servers = adults.filter((p) => age(p.born) <= 76);
    const pools = new Map<number, number[]>();
    for (const t of vol.teamsWithRoles()) {
      const hadLeader = t.members.some((m) => m.is_leader);
      const crew = pick(servers, 6 + Math.floor(rnd() * 3));
      crew.forEach((p, i) => grp.addTeamMember(t.id, p.id, !hadLeader && i === 0));
      for (const r of t.roles) {
        const able = pick(crew, Math.max(3, Math.min(crew.length, 2 + Math.floor(rnd() * 4)))).map((p) => p.id);
        vol.setRoleMembers(r.id, [...r.members.map((m) => m.person_id), ...able]);
        if (r.needed > 0) pools.set(r.id, able);
      }
    }

    if (opts.rota !== false) {
      const upcoming = get<{ id: number; date: string }>("SELECT id, date FROM services WHERE kind = 'service' AND date >= ? ORDER BY date, start_time LIMIT 1", today);
      if (upcoming) {
        const d = new Date(`${upcoming.date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 7);
        const nextDate = d.toISOString().slice(0, 10);
        let next = get<{ id: number }>("SELECT id FROM services WHERE kind = 'service' AND date = ? ORDER BY start_time LIMIT 1", nextDate);
        if (!next) {
          next = svc.duplicateService(upcoming.id, nextDate) as { id: number };
          out.services.push(next.id);
        }
        // only sample people fill the empty places, so removing them leaves the real rota as it was
        const roles = vol.teamsWithRoles().flatMap((t) => t.roles);
        for (const sid of [upcoming.id, next.id]) {
          const busy = new Set<number>();
          for (const r of roles) {
            const pool = (pools.get(r.id) ?? []).filter((pid) => !busy.has(pid));
            const have = get<{ n: number }>("SELECT COUNT(*) n FROM assignments WHERE service_id = ? AND role_id = ? AND status != 'declined'", sid, r.id)!.n;
            for (const pid of pick(pool, Math.max(0, r.needed - have))) {
              if (get('SELECT 1 FROM assignments WHERE service_id = ? AND person_id = ?', sid, pid)) continue;
              const a = vol.assign(sid, r.id, pid) as { id: number };
              out.assignments.push(a.id);
              busy.add(pid);
            }
          }
        }
      }
    }
    setMeta('sample_data', JSON.stringify(out));
  });
  return sampleDataStatus();
}

/** Take out everything the sample data added (people with their places on teams, groups and rotas; households;
 *  groups; the copied service) and nothing else. */
export function removeSampleData() {
  const a = added();
  if (!a) throw new BadRequest('There is no sample data to remove.');
  const done = { people: 0, households: 0, groups: 0, services: 0 };
  tx(() => {
    for (const id of a.services) if (get('SELECT 1 FROM services WHERE id = ?', id)) { svc.services.remove(id); done.services++; }
    // a person's team places, role pools, group places and rota places go with them
    for (const id of a.people) if (get('SELECT 1 FROM people WHERE id = ?', id)) { reg.people.remove(id); done.people++; }
    for (const id of a.households) {
      // a household someone real has since joined stays
      if (get('SELECT 1 FROM households WHERE id = ?', id) && !get('SELECT 1 FROM people WHERE household_id = ?', id)) { reg.households.remove(id); done.households++; }
    }
    for (const id of a.groups) {
      if (get('SELECT 1 FROM groups WHERE id = ?', id) && !get('SELECT 1 FROM group_members WHERE group_id = ?', id)) { grp.deleteGroup(id); done.groups++; }
    }
    deleteMeta('sample_data');
  });
  return done;
}
