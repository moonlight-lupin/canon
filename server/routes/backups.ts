// Settings → Backups (administrators only).
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { getSettings, updateSettings } from '../repo/settings.ts';
import {
  DEFAULT_BACKUP_DIR, backupDir, backupPath, checkFolder, createBackup, deleteBackup, lastBackupAt, listBackups, nextDue, prune,
} from '../repo/backups.ts';

export const backupRoutes = express.Router();

const adminOnly = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Administrators only' });
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
});

backupRoutes.get('/backups', adminOnly, (_req, res) => res.json(status()));

backupRoutes.post('/backups', adminOnly, (_req, res, next) => {
  try {
    const problem = checkFolder(backupDir());
    if (problem) return res.status(400).json({ error: problem });
    const b = createBackup();
    const removed = prune(getSettings().backup.keep);
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
  updateSettings({ backup: { dir, auto: b.auto, keep: b.keep } });
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

backupRoutes.delete('/backups/:name', adminOnly, (req, res) => {
  if (!deleteBackup(String(req.params.name))) return res.status(404).json({ error: 'Backup not found' });
  res.json(status());
});
