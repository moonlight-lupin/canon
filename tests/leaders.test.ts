// 0.15.10: who leads an item comes from the service's rota only — the role's people (all, or the ones ticked),
// anyone on the rota for an item without a role, and the preacher from the sermon item. Names typed before still
// print until replaced, but nothing new can be typed. Fictional data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-leaders-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');

const svc = await import('../server/repo/services.ts');
const vol = await import('../server/repo/volunteers.ts');
const reg = await import('../server/repo/registers.ts');
const grp = await import('../server/repo/groups.ts');
const { renderService } = await import('../server/repo/render.ts');
const { db, run } = await import('../server/db.ts');
const { itemLeaders } = await import('../shared/leaders.ts');

after(() => {
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const person = (first: string) => (reg.people.insert({ first_name: first, last_name: 'Example', status: 'member' } as never) as { id: number }).id;

test('leaders and the preacher come from the rota; typed names only until replaced', () => {
  const team = grp.createTeam({ name: { en: 'Leaders test team' } });
  const preacherRole = (vol.roles.insert({ team_id: team, name: { en: 'Preacher' }, needed: 1 } as never) as { id: number }).id;
  const usherRole = (vol.roles.insert({ team_id: team, name: { en: 'Usher' }, needed: 2 } as never) as { id: number }).id;
  const ann = person('Ann');
  const ben = person('Ben');
  const cal = person('Cal');
  const { service } = svc.createService({ date: '2031-05-04' });
  vol.assign(service.id, preacherRole, ann);
  vol.assign(service.id, usherRole, ben);
  vol.assign(service.id, usherRole, cal);
  const sermon = svc.addItem(service.id, { kind: 'sermon', title: { en: 'Sermon' }, role_id: preacherRole });
  const ushers = svc.addItem(service.id, { kind: 'offering', title: { en: 'Offering' }, role_id: usherRole });
  const welcome = svc.addItem(service.id, { kind: 'other', title: { en: 'Welcome' } });

  // a role's whole rota by default; the ones ticked when the planner chooses
  let r = renderService(service.id);
  const lead = (id: number) => r.items.find((i) => i.id === id)!.leader;
  assert.equal(lead(ushers.id), 'Ben Example, Cal Example');
  svc.updateItem(ushers.id, { leader_people: [cal] });
  r = renderService(service.id);
  assert.equal(lead(ushers.id), 'Cal Example');
  // an item without a role: nobody, until someone on the rota is ticked
  assert.equal(lead(welcome.id), null);
  svc.updateItem(welcome.id, { leader_people: [ann] });
  r = renderService(service.id);
  assert.equal(lead(welcome.id), 'Ann Example');
  // the preacher is whoever leads the sermon item
  assert.equal(r.preacher, 'Ann Example');
  assert.equal(svc.preachersOf([svc.services.get(service.id)]).get(service.id), 'Ann Example');

  // nothing new can be typed, and only people on the rota can be ticked
  assert.throws(() => svc.updateItem(sermon.id, { leader: 'Rev. Typed' }), /come from the rota/);
  assert.throws(() => svc.addItem(service.id, { kind: 'other', title: { en: 'X' }, leader: 'Someone' }), /come from the rota/);
  const dan = person('Dan');
  assert.throws(() => svc.updateItem(welcome.id, { leader_people: [dan] }), /not on this service's rota/);

  // a name typed before 0.15.10 prints only while the rota gives nobody, and can be removed
  run('UPDATE service_items SET leader = ? WHERE id = ?', 'Old Typed Name', welcome.id);
  run('UPDATE service_items SET leader_people = NULL WHERE id = ?', welcome.id);
  r = renderService(service.id);
  assert.equal(lead(welcome.id), 'Old Typed Name');
  svc.updateItem(welcome.id, { leader: null });
  r = renderService(service.id);
  assert.equal(lead(welcome.id), null);

  // a copy starts without typed names; ticks stay only with the rota
  run('UPDATE services SET preacher = ? WHERE id = ?', 'Typed Preacher', service.id);
  const copy = svc.duplicateService(service.id, '2031-05-11');
  assert.equal(copy.preacher, null);
  assert.ok(copy.items.every((i) => !i.leader && !i.leader_people));
  const withRota = svc.duplicateService(service.id, '2031-05-18', true);
  assert.deepEqual(withRota.items.find((i) => i.kind === 'offering')!.leader_people, [cal]);

  // someone ticked who has left the rota: the role's whole rota again
  assert.deepEqual(itemLeaders({ kind: 'offering', role_id: usherRole, leader_people: [999] }, [
    { role_id: usherRole, person_id: ben, person_name: 'Ben', status: 'scheduled' },
  ]).map((a) => a.person_id), [ben]);
});
