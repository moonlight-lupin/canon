// REST routes for SMTP settings, test e-mail, manual volunteer reminders. Mounted inside /api after authentication (see server/api.ts).
// Nothing here sends automatically: reminders go out only when an editor presses "Send reminders".
// There are deliberately no MCP tools for e-mail — agents must not send e-mail.
import { addressForOthers } from '../lib/lan.ts';
import express, { type Request } from 'express';
import { z } from 'zod';
import { getSettings, updateSettings, setMeta, deleteMeta } from '../repo/settings.ts';
import { externalBase } from '../oauth.ts';
import { emailLog, reminderPreview, sendReminders, sendTestEmail, serviceExists } from '../repo/email.ts';
import { h } from './helpers.ts';
import { can, isAdmin } from '../lib/permissions.ts';

export const emailRoutes = express.Router();

const forbid = (msg: string) => Object.assign(new Error(msg), { status: 403 });
const adminOnly = (req: Request) => {
  if (!isAdmin(req.user)) throw forbid('Administrators only');
};
const editorOnly = (req: Request) => {
  if (!can(req.user, 'volunteers', 'edit')) throw forbid('Your role can’t send reminders');
};
const serviceId = (req: Request) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw Object.assign(new Error('Bad id'), { status: 400 });
  if (!serviceExists(n)) throw Object.assign(new Error(`service ${n} not found`), { status: 404 });
  return n;
};

const Email = z.string().trim().max(254).regex(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/, 'not a valid e-mail address');
const EmailOrBlank = z.union([z.literal(''), Email]);
const NoBreaks = (max: number) => z.string().trim().max(max).regex(/^[^\r\n]*$/, 'must be one line');

const SmtpInput = z.object({
  host: NoBreaks(255),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: NoBreaks(255),
  from_name: NoBreaks(100),
  from_email: EmailOrBlank,
  reply_to: EmailOrBlank,
  /** omitted = keep the stored password; "" = clear it */
  password: z.string().max(500).optional(),
});

// ---------------------------------------------------------------- settings (admins)

emailRoutes.get('/email/settings', h((req) => {
  adminOnly(req);
  return getSettings().smtp;
}));

emailRoutes.put('/email/settings', h((req) => {
  adminOnly(req);
  const { password, ...smtp } = SmtpInput.parse(req.body);
  if (password !== undefined) {
    if (password === '') deleteMeta('smtp_password');
    else setMeta('smtp_password', password);
  }
  return updateSettings({ smtp }).smtp;
}));

emailRoutes.post('/email/test', h(async (req) => {
  adminOnly(req);
  const { to } = z.object({ to: Email }).parse(req.body);
  return sendTestEmail(to, req.user!.id);
}));

emailRoutes.get('/email/log', h((req) => {
  editorOnly(req);
  const sid = Number(req.query.service_id) || undefined;
  return emailLog({ serviceId: sid, limit: Number(req.query.limit) || undefined });
}));

// ---------------------------------------------------------------- volunteer reminders (editors)

emailRoutes.get('/services/:id/reminders/preview', h((req) => {
  editorOnly(req);
  const note = typeof req.query.note === 'string' && req.query.note.trim() ? req.query.note.slice(0, 1000) : undefined;
  return reminderPreview(serviceId(req), { baseUrl: addressForOthers(externalBase(req)), note });
}));

emailRoutes.post('/services/:id/reminders', h(async (req) => {
  editorOnly(req);
  const b = z.object({
    person_ids: z.array(z.number().int().positive()).max(500).optional(),
    note: z.string().max(1000).optional(),
  }).parse(req.body ?? {});
  return sendReminders(serviceId(req), {
    baseUrl: addressForOthers(externalBase(req)),
    userId: req.user!.id,
    personIds: b.person_ids,
    note: b.note?.trim() ? b.note : undefined,
  });
}));
