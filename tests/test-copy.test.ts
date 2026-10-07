// A test copy of the church's data (0.18.0, CANON_TEST_COPY=1), e.g. on a NAS to try a new version: it sends no
// e-mail to real members and leaves the church's Google Drive folder alone, even with the church's settings in it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-testcopy-'));
process.env.CANON_DB = path.join(tmp, 'canon.db');
process.env.CANON_TEST_COPY = '1';

const { createApp } = await import('../server/app.ts');
const { seed } = await import('../server/seed/index.ts');
const { updateSettings, getSettings } = await import('../server/repo/settings.ts');
const { sendMail } = await import('../server/lib/mailer.ts');
const { uploadToDrive, listDriveBackups } = await import('../server/lib/gdrive.ts');
const { db } = await import('../server/db.ts');

after(() => {
  try {
    db.close();
  } catch { /* ignore */ }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('a test copy sends no e-mail and leaves Google Drive alone, and says so', async () => {
  await seed();
  // the church's own e-mail settings, as a restored backup would bring them
  updateSettings({ smtp: { ...getSettings().smtp, host: 'smtp.example.org', port: 587, user: 'office@example.org', pass: 'not-a-real-password', from_email: 'office@example.org' } } as never);
  await assert.rejects(sendMail({ to: 'member@example.org', subject: 'Your loan is due', text: 'Fictional' }), /test copy/);
  const backup = path.join(tmp, 'canon-2030-01-01-0900.db.enc');
  fs.writeFileSync(backup, 'not really encrypted');
  await assert.rejects(uploadToDrive(backup), /test copy/);
  await assert.rejects(listDriveBackups(), /test copy/);
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const about = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/about`)).json();
  server.close();
  assert.equal(about.test_copy, true, 'the screens show a banner');
});
