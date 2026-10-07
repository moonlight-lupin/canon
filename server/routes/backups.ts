// Settings → Backups (administrators only).
import express, { type NextFunction, type Request, type Response } from 'express';
import { seed } from '../seed/index.ts';
import { z } from 'zod';
import { getSettings, updateSettings } from '../repo/settings.ts';
import {
  DEFAULT_BACKUP_DIR, backupDir, backupPath, checkBackupFile, checkFolder, createBackup, deleteBackup, lastBackupAt, lastRestore, listBackups, nextDue, prune,
  newestEncrypted, restoreBackup, saveUpload, withPlainBackup,
} from '../repo/backups.ts';
import path from 'node:path';
import { isAdmin } from '../lib/permissions.ts';
import { backupKeyState, clearBackupPassword, setBackupPassword } from '../lib/backup-crypto.ts';
import { logChange } from '../repo/changelog.ts';
import {
  DriveError, disconnectDrive, downloadFromDrive, driveStatus, listDriveBackups, pollDriveConnect, setDriveClient, setDriveKeep, startDriveConnect, syncToDrive,
} from '../lib/gdrive.ts';

export const backupRoutes = express.Router();

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'Administrators only' });
  next();
};

const status = () => ({
  dir: backupDir(),
  default_dir: DEFAULT_BACKUP_DIR,
  settings: getSettings().backup,
  last: lastBackupAt(),
  next: nextDue(),
  folder_problem: checkFolder(backupDir()),
  items: listBackups(),
  last_restore: lastRestore(),
  ...encryptionStatus(),
});
const encryptionStatus = () => {
  const st = backupKeyState(getSettings().backup.encrypted);
  return { encrypted: st.encrypted, key_problem: st.problem };
};

backupRoutes.get('/backups', adminOnly, (_req, res) => res.json(status()));

backupRoutes.post('/backups', adminOnly, (_req, res, next) => {
  try {
    const problem = checkFolder(backupDir());
    if (problem) return res.status(400).json({ error: problem });
    const b = createBackup();
    const removed = prune(getSettings().backup.keep);
    // to Google Drive in the background when connected (the result shows in Settings → Backups)
    if (b.name.endsWith('.db.enc')) void syncToDrive({ name: b.name, path: b.path });
    res.json({ created: b.name, size: b.size, removed, ...status() });
  } catch (e) {
    next(e);
  }
});

backupRoutes.put('/backups/settings', adminOnly, (req, res) => {
  const b = z.object({
    dir: z.string().max(500),
    auto: z.enum(['off', 'daily', 'weekly']),
    keep: z.number().int().min(1).max(365),
  }).parse(req.body);
  const dir = b.dir.trim();
  const problem = checkFolder(dir);
  if (problem) return res.status(400).json({ error: problem });
  updateSettings({ backup: { ...getSettings().backup, dir, auto: b.auto, keep: b.keep } });
  res.json(status());
});

/** Test a folder without saving it (the "Check" button). */
backupRoutes.post('/backups/check-folder', adminOnly, (req, res) => {
  const dir = z.string().max(500).parse(req.body?.dir ?? '').trim();
  const problem = checkFolder(dir);
  res.json({ ok: !problem, message: problem ?? 'Canon can save backups in this folder.', resolved: dir || DEFAULT_BACKUP_DIR });
});

backupRoutes.get('/backups/:name/download', adminOnly, (req, res) => {
  const p = backupPath(String(req.params.name));
  if (!p) return res.status(404).json({ error: 'Backup not found' });
  // contains members' personal data — never cache
  res.setHeader('Cache-Control', 'no-store');
  res.download(p);
});

/** Replace all data with a saved backup (a copy of the current data is saved first). */
backupRoutes.post('/backups/:name/restore', adminOnly, async (req, res, next) => {
  try {
    const p = backupPath(String(req.params.name));
    if (!p) return res.status(404).json({ error: 'Backup not found' });
    const r = await restoreBackup(p, typeof req.body?.password === 'string' ? req.body.password : null);
    await seed();
    res.json({ ...r, ...status() });
  } catch (e) {
    next(e);
  }
});

/** Restore from a backup file chosen on this computer (e.g. from a USB drive or another Canon). */
backupRoutes.post('/backups/restore-upload', adminOnly, express.raw({ type: () => true, limit: '500mb' }), async (req, res, next) => {
  try {
    const data = req.body as Buffer;
    const encrypted = Buffer.isBuffer(data) && data.subarray(0, 9).toString() === 'CANONENC1';
    if (!Buffer.isBuffer(data) || data.length < 512 || (!encrypted && data.subarray(0, 15).toString() !== 'SQLite format 3')) {
      return res.status(400).json({ error: 'Choose a Canon backup file (.db or .db.enc).' });
    }
    // the password of an encrypted backup comes in a header (not in the address)
    const password = req.get('x-backup-password') ? decodeURIComponent(req.get('x-backup-password')!) : null;
    const file = saveUpload(data);
    let problem: string | null;
    try {
      problem = await withPlainBackup(file, password, (plain) => checkBackupFile(plain));
    } catch (e) {
      deleteBackup(file.split(/[\\/]/).pop()!);
      throw e;
    }
    if (problem) {
      deleteBackup(file.split(/[\\/]/).pop()!);
      return res.status(400).json({ error: problem });
    }
    const r = await restoreBackup(file, password);
    await seed();
    res.json({ ...r, ...status() });
  } catch (e) {
    next(e);
  }
});

/** Encrypt backups with a password (or change it), or stop encrypting (null). */
backupRoutes.put('/backups/password', adminOnly, (req, res, next) => {
  try {
    const b = z.object({ password: z.string().max(200).nullable() }).parse(req.body);
    if (b.password === null) clearBackupPassword();
    else setBackupPassword(b.password);
    // what the church wants is kept apart from the key file: losing the file stops backups instead of silently
    // making plain ones
    updateSettings({ backup: { ...getSettings().backup, encrypted: b.password !== null } });
    logChange({ entity: 'backups', entity_id: null, action: 'update', summary: b.password === null ? 'Backups no longer encrypted' : 'Backup password set: backups are encrypted' });
    res.json(status());
  } catch (e) {
    next(e);
  }
});

backupRoutes.delete('/backups/:name', adminOnly, (req, res) => {
  if (!deleteBackup(String(req.params.name))) return res.status(404).json({ error: 'Backup not found' });
  res.json(status());
});

// ---------------------------------------------------------------- Google Drive (0.16.1)

const drive = (fn: (req: Request) => unknown) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    if (e instanceof DriveError) return res.status(e.status).json({ error: e.message });
    if (e instanceof TypeError && /fetch/i.test(e.message)) return res.status(502).json({ error: 'Canon could not reach Google. Check this computer’s internet connection.' });
    next(e);
  }
};

backupRoutes.get('/backups/drive', adminOnly, drive(() => driveStatus()));
backupRoutes.put('/backups/drive/client', adminOnly, drive((req) => {
  const b = z.object({ client_id: z.string().max(200), client_secret: z.string().max(200) }).parse(req.body);
  setDriveClient(b.client_id, b.client_secret);
  logChange({ entity: 'backups', entity_id: null, action: 'update', summary: 'Google Drive: the church’s Google client was set' });
  return driveStatus();
}));
backupRoutes.put('/backups/drive/settings', adminOnly, drive((req) => {
  setDriveKeep(z.object({ keep: z.number().int().min(1).max(365) }).parse(req.body).keep);
  return driveStatus();
}));
backupRoutes.post('/backups/drive/connect', adminOnly, drive(() => startDriveConnect()));
backupRoutes.post('/backups/drive/connect/poll', adminOnly, drive(async () => {
  const r = await pollDriveConnect();
  if (r.state === 'connected') logChange({ entity: 'backups', entity_id: null, action: 'update', summary: `Google Drive connected${r.email ? ` (${r.email})` : ''}` });
  return { ...r, status: driveStatus() };
}));
// (not DELETE /backups/drive: DELETE /backups/:name above deletes a backup file)
backupRoutes.post('/backups/drive/disconnect', adminOnly, drive(async () => {
  await disconnectDrive();
  logChange({ entity: 'backups', entity_id: null, action: 'update', summary: 'Google Drive disconnected' });
  return driveStatus();
}));
/** Send the newest backup now (even if it was sent before), and keep the newest N there. */
backupRoutes.post('/backups/drive/upload', adminOnly, drive(async () => {
  const b = newestEncrypted();
  if (!b) throw new DriveError('There is no encrypted backup to send yet. Set a backup password, then press Back up now.');
  const before = driveStatus();
  if (!before.connected) throw new DriveError('Google Drive is not connected.');
  await syncToDrive({ ...b, name: b.name }, () => undefined);
  const after = driveStatus();
  if (after.last && !after.last.ok) throw new DriveError(after.last.error ?? 'The upload did not finish.');
  return after;
}));
backupRoutes.get('/backups/drive/files', adminOnly, drive(async () => ({ files: await listDriveBackups() })));
/** Copy a backup from Drive into this computer's backup folder; restore it from the list as usual. */
backupRoutes.post('/backups/drive/files/:id/copy', adminOnly, drive(async (req) => {
  const f = await downloadFromDrive(String(req.params.id));
  const file = saveUpload(f.data);
  logChange({ entity: 'backups', entity_id: null, action: 'update', summary: `Copied ${f.name} from Google Drive to this computer` });
  return { copied: path.basename(file), from: f.name, ...status() };
}));
