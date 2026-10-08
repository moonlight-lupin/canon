# Updating Canon

Updating Canon replaces its program files. Your data stays in `data/` (the database, archives and uploaded files), and is never part of an update. Canon upgrades the database itself the first time the new version starts, and keeps a copy of it as it was. An update can therefore always be undone.

What changed in each version: [CHANGELOG.md](../CHANGELOG.md).

## Supported versions

| | Supported |
|---|---|
| Node.js | 24 or newer (the current LTS). Older versions are refused at start, with a message. |
| Database | Any database from an earlier Canon is upgraded. A database from a *newer* Canon is refused unchanged: install that newer Canon again. |
| Backups | A backup from any earlier Canon can be restored; it is upgraded when restored. |

Tests run on Windows and Linux, on Node.js 24, for every change ([CI](../.github/workflows/ci.yml)).

## Upgrading to 0.19.0: encryption

0.19.0 encrypts Canon's data. Upgrading changes nothing by itself: your database stays as it is, and administrators see a red banner, **The church's data is not encrypted**, until one of them presses **Encrypt now…**. Before you do:
- have a printer ready (or pen and paper): the recovery key is shown once;
- on Windows, encrypt while Canon runs as the account it will keep running as (the background task's account);
- know which plain copies you keep yourself outside Canon's folders: Canon lists the ones in its folders and leaves them alone.

## Windows PC or Mac

1. **Make a backup.** Use Settings → Backups → **Back up now**, or `npm run backup` (safe while Canon is running).
2. **Stop Canon:** close the "Canon server" window. If Canon runs in the background (its icon by the clock), right-click the icon → **Exit**.
3. **Get the new version:**
   - with git: `git pull`;
   - with a download: unzip the new version *over* the Canon folder, replacing files. Do not delete the folder first. `data/`, `backups/`, `canon.local.bat` and `canon.local.sh` are not in the download, so they are kept.
4. **Start Canon:** double-click `start-canon.bat` (on a Mac, `start-canon.command`); in the background, open **Canon** from the Start menu. Before Canon starts, it:
   - checks the Node.js version;
   - installs new dependencies, if there are any;
   - rebuilds the web app, if it changed;
   - upgrades the database, first saving a copy in `data/pre-upgrade/` (the newest three are kept).
5. Check **About Canon** (bottom of the sidebar) for the new version number.

If something goes wrong at step 4, the window says what happened and your data has not been changed. In the background there is no window: see `data/logs/`.

## Docker

```bash
docker compose pull
docker compose up -d
```

(Built from the source instead: `git pull`, then `docker compose up -d --build`.)

The database is upgraded on start in the same way, with the copy in `data/pre-upgrade/` inside the data volume. See [DOCKER.md](DOCKER.md).

## Going back to the previous version

Undo an update only if the new version has a problem you can't wait to have fixed. Anything entered *after* the update is lost when you go back, so first note what was entered since.

1. Stop Canon.
2. Go back to the previous program files:
   - with git: `git checkout v0.10.7` (the version you had);
   - with a download: unzip the previous version over the folder.
3. Put the database back as it was before the update:
   - in `data/`, delete `canon.db`, `canon.db-wal` and `canon.db-shm`;
   - copy the newest file from `data/pre-upgrade/` (for example `canon-v18-before-v20-20261005-093000.db`) to `data/canon.db`.
4. Start Canon.

If you skip step 3, the previous version refuses to start ("This database was made by a newer version of Canon"). This is deliberate: an older Canon would damage a newer database. Your data is not affected.

## Restoring a backup

Restore a backup in Settings → Backups → **Restore**. Canon saves a copy of the current data first. A backup from an older version is upgraded as it is restored.

If Canon will not start:

1. Stop Canon.
2. In the Canon folder: `npm run restore-backup -- <backup file>` (add the recovery key after the file name for a backup from another computer). It sets the database there was aside in `data/pre-restore/`, gives the backup this Canon's key, and brings back the archived years — the ones inside the backup (0.19.3 and later), or, for an older backup, those in its `archives/` folder that are missing here.
3. Start Canon.

From 0.19.3 a backup of an encrypted Canon carries its archived years inside, so one file — local or from Google Drive — restores everything. Older backups (and those of a Canon not encrypted yet) keep the archived years in the backup folder's `archives/`: keep that folder too.
