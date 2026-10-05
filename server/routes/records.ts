// REST routes for service records (attendance, visitors, offerings), reports and the visitor form. Mounted inside /api after authentication.
import express, { type Request } from 'express';
import { z } from 'zod';
import * as S from '../../shared/schemas.ts';
import { requireAdmin } from '../auth.ts';
import * as rec from '../repo/records.ts';
import { leadsMeeting } from '../lib/leaders.ts';
import * as arc from '../repo/archive.ts';
import * as reports from '../repo/reports.ts';
import { Forbidden } from '../lib/table.ts';
import { assertFresh } from '../lib/versions.ts';
import * as vf from '../repo/visitor-form.ts';
import type { ServiceRecord } from '../../shared/records.ts';
import { getSettings, updateSettings } from '../repo/settings.ts';
import { h, id, str } from './helpers.ts';
import { can, mayReopenCounts } from '../lib/permissions.ts';

export const recordRoutes = express.Router();

// ---------------------------------------------------------------- service records (attendance, visitors, offerings)

// admin = may reopen verified counts and delete records (Administrator, Treasurer …); money = may change offerings
const recWho = (req: Request) => ({ name: req.user?.display_name ?? '', admin: mayReopenCounts(req.user), money: can(req.user, 'contributions', 'edit') || leadsMeeting(req.user?.person_id, Number(req.params.id)) });
const VisitorSchema = z.object({ name: z.string().max(200), contact: z.string().max(300).optional(), source: z.string().max(300).optional(), follow_up_by: z.string().max(200).optional(), notes: z.string().max(2000).optional(), status: z.enum(['new', 'contacted', 'returning', 'joined']).optional(), prayer: z.string().max(1500).optional(), about: z.string().max(200).optional() });
const RecordInput = z.object({
  attendance: z.number().int().min(0).max(100000).nullable().optional(),
  children: z.number().int().min(0).max(100000).nullable().optional(),
  online: z.number().int().min(0).max(1000000).nullable().optional(),
  visitors: z.array(VisitorSchema).max(500).optional(),
  notes: z.string().max(20000).nullable().optional(),
  offerings: z.array(z.object({ fund: z.string().max(100), method: z.string().max(20), amount: z.number().int().min(0), currency: z.string().max(3).optional(), note: z.string().max(300).optional() })).max(200).optional(),
  foreign_cash: z.record(z.string().regex(/^[A-Z]{3}$/), z.object({ cash: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(1000000)).optional(), total: z.number().int().min(0).optional(), converted: z.number().int().min(0).nullable().optional() })).optional(),
  cash: z.record(z.string().regex(/^\d+$/), z.number().int().min(0).max(1000000)).optional(),
  counters: z.array(z.string().max(120)).max(10).optional(),
  counted_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  currency: z.string().max(5).optional(),
});
recordRoutes.get('/records', h((req) => rec.listRecords({ from: str(req.query.from), to: str(req.query.to), congregation_id: Number(req.query.congregation) || undefined, kind: str(req.query.kind) as rec.RecordsQuery['kind'], group_id: Number(req.query.group) || undefined })
  .map((r) => (canSeeMoney(req) ? r : rec.listRowForViewer(r)))));
// reports (Records → Reports): offerings for editors and administrators only; visitors' contact details likewise
const reportPeriod = (req: Request) => reports.period({
  from: str(req.query.from), to: str(req.query.to), congregation_id: Number(req.query.congregation) || undefined,
  kind: str(req.query.kind), group_id: Number(req.query.group) || undefined,
});
const canSeeMoney = (req: Request) => can(req.user, 'contributions', 'read');
// which years are in archive files (reports cover the live database only, and say so)
recordRoutes.get('/reports/archived-years', h(() => ({ years: arc.archiveYears() })));
recordRoutes.get('/reports/attendance', h((req) => reports.attendanceReport(reportPeriod(req))));
recordRoutes.get('/reports/offerings', h((req) => {
  if (!canSeeMoney(req)) throw new Forbidden('Offerings are only shown to editors and administrators.');
  return reports.offeringsReport(reportPeriod(req));
}));
recordRoutes.get('/reports/visitors', h((req) => reports.visitorsReport(reportPeriod(req), { contact: canSeeMoney(req) })));
recordRoutes.get('/reports/serving', h((req) => reports.servingReport(reportPeriod(req))));
recordRoutes.get('/reports/songs', h((req) => reports.songsReport(reportPeriod(req))));
recordRoutes.get('/reports/scripture', h((req) => reports.scriptureReport({
  from: str(req.query.from), to: str(req.query.to), congregation_id: Number(req.query.congregation) || undefined,
  years: (str(req.query.years) ?? '').split(',').map(Number).filter(Boolean),
})));
recordRoutes.get('/reports/membership', h((req) => reports.membershipReport(reportPeriod(req))));
recordRoutes.get('/services/:id/record', h((req) => {
  const r = rec.recordFor(id(req));
  // editors and administrators, and the leader of this meeting, see the whole record
  return canSeeMoney(req) || leadsMeeting(req.user?.person_id, id(req)) ? r : rec.forViewer(r);
}));
// visitor form: settings (administrators), a service's form (editors), the review queue (editors)
const origin = (req: Request) => `${req.protocol}://${req.get('host')}`;
recordRoutes.get('/visitor-form-settings', h(() => vf.formSettings()));
recordRoutes.put('/visitor-form-settings', requireAdmin, h((req) => vf.saveFormSettings(z.object({
  enabled: z.boolean().optional(), prayer: z.boolean().optional(), welcome: S.L10nSchema.optional(), consent: S.L10nSchema.optional(),
  days_after: z.number().int().min(0).max(14).optional(),
  sources: z.array(S.L10nSchema).max(12).optional(),
  abouts: z.array(S.L10nSchema).max(12).optional(),
}).parse(req.body))));
recordRoutes.get('/services/:id/visitor-form', h((req) => vf.serviceFormInfo(id(req), origin(req))));
recordRoutes.put('/services/:id/visitor-form', h((req) => {
  if (!canSeeMoney(req)) throw new Forbidden('Only editors and administrators can change the visitor form.');
  return vf.setServiceForm(id(req), z.object({ enabled: z.boolean(), bulletin: z.boolean().optional(), slides: z.boolean().optional() }).parse(req.body), origin(req));
}));
recordRoutes.get('/services/:id/visitor-cards', h((req) => {
  if (!canSeeMoney(req)) throw new Forbidden('Only editors and administrators review visitor cards.');
  return vf.cardsFor(id(req));
}));
recordRoutes.post('/visitor-cards/:id/accept', h((req) => {
  if (!canSeeMoney(req)) throw new Forbidden('Only editors and administrators review visitor cards.');
  return vf.acceptCard(id(req), recWho(req));
}));
recordRoutes.delete('/visitor-cards/:id', h((req) => {
  if (!canSeeMoney(req)) throw new Forbidden('Only editors and administrators review visitor cards.');
  return vf.discardCard(id(req));
}));
recordRoutes.delete('/services/:id/record', requireAdmin, h((req) => rec.deleteRecord(id(req), recWho(req))));
recordRoutes.put('/services/:id/record', h((req) => {
  const cur = rec.recordFor(id(req));
  // a screen that saw no record yet sends 0: a record someone else created meanwhile is a conflict too
  assertFresh(req, cur.saved ? cur : { revision: 0 }, 'service_records', cur.id);
  return rec.saveRecord(id(req), RecordInput.parse(req.body) as Partial<ServiceRecord>, recWho(req));
}));
recordRoutes.post('/services/:id/record/sign', h((req) => rec.sign(id(req), z.object({ name: z.string().max(120), image: z.string().max(400_000) }).parse(req.body), recWho(req))));
recordRoutes.post('/services/:id/record/approve', h((req) => rec.approve(id(req), { ...recWho(req), user_id: req.user!.id })));
recordRoutes.post('/services/:id/record/finish', h((req) => rec.finishSigning(id(req), recWho(req))));
recordRoutes.post('/services/:id/record/unsign', h((req) => rec.unsign(id(req), z.object({ name: z.string().max(120) }).parse(req.body).name, recWho(req))));
recordRoutes.post('/services/:id/record/verify', h((req) => rec.setVerified(id(req), z.object({ verified: z.boolean() }).parse(req.body).verified, recWho(req))));
recordRoutes.put('/offering-settings', requireAdmin, h((req) => {
  const b = z.object({ currency: z.string().max(5), funds: z.array(z.string().min(1).max(100)).min(1).max(30), signing: z.enum(['paper', 'screen']).optional(), min_counters: z.number().int().min(2).max(6).optional(), own_accounts: z.boolean().optional() }).parse(req.body);
  const cur = getSettings().offering;
  return updateSettings({ offering: {
    currency: b.currency, funds: [...new Set(b.funds.map((f) => f.trim()).filter(Boolean))], signing: b.signing ?? cur.signing ?? 'paper',
    min_counters: b.min_counters ?? cur.min_counters ?? 2, own_accounts: b.own_accounts ?? cur.own_accounts ?? false,
  } }).offering;
}));
