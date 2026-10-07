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
git pull
docker compose up -d --build
```

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
2. In `data/`, delete `canon.db-wal` and `canon.db-shm`.
3. Copy the backup over `data/canon.db`.
4. Start Canon.

Archive files (`data/archives/`) are copied along with every backup. To restore them, copy them back into `data/archives/`.
