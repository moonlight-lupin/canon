# Running Canon

For whoever looks after the computer Canon runs on. Everything a church office uses day to day is in Canon's **Settings**, and is explained in the [user guide](guide/en.md).

## Configuration

Environment variables are optional overrides:

| Variable | Default | Purpose |
|---|---|---|
| `CANON_PORT` | `3000` | HTTP port. On Windows, put e.g. `set CANON_PORT=5018` in a file `canon.local.bat` next to `start-canon.bat`; on a Mac, `export CANON_PORT=5018` in `canon.local.sh` next to `start-canon.command`. It is read at start-up and is not part of the repository. |
| `CANON_HOST` | `0.0.0.0` | Interface to listen on. The default lets the office network reach Canon. |
| `CANON_DB` | `data/canon.db` | The SQLite database file. Archives (`archives/`) and pre-upgrade copies (`pre-upgrade/`) sit next to it. |
| `CANON_PUBLIC_URL` | — | Forces the public address. Normally set in Settings → AI / MCP instead. |
| `CANON_TRUST_PROXY` | — | Honours `X-Forwarded-*` from a proxy on this computer or the local network (Cloudflare Tunnel, Caddy, Docker). Automatic once a public address is set. |
| `CANON_KEY_FILE` | — | A file (at least 32 bytes, e.g. a Docker secret) that locks Canon's encryption keys, kept outside the data folder. See [Encryption](#encryption). |
| `CANON_ENCRYPT` | — | `0` keeps a **new** database plain (not recommended). An existing database is never changed by it. |
| `CANON_TEST_COPY` | — | `1` for a test copy of the church's data: no e-mail is sent and Google Drive is left alone; a banner says so. See [DOCKER.md](DOCKER.md#a-test-copy-of-the-churchs-data). |

### In the background on Windows

Canon can run without a window, starting when the computer starts (before anyone signs in) and starting again if it stops by itself. Its icon by the clock shows that it is running and the address other computers use.

1. Sign in to the office PC as the account Canon should run as (normally the office's own account).
2. Open PowerShell **as administrator** (right-click **Start** → **Terminal (Admin)**), go to the Canon folder and run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\windows-task.ps1 install
   ```
   If the office account isn't an administrator and an administrator's account approves the prompt, name the office account: `… install -User OFFICE-PC\Office`.
3. Windows asks for that account's password once, so Canon can run while nobody is signed in. The password goes to Windows only; Canon does not keep it. (An account without a password can't be used; give it one first.)
4. Close the old "Canon server" window if it is still open. Running both doesn't work: they would want the same port.

What it sets up:
- a Task Scheduler task **Canon**: at start-up, runs `start-canon.bat` without a window or pauses, as that account; if it fails, it is started again every minute;
- **Canon** in the Start menu and in Startup, for every account on the PC: the icon by the clock. Only the account Canon runs as (and administrators) can start or stop it from the icon; for others it just shows whether Canon is running. Windows 11 first puts new icons under **^**; to keep it in view, drag it onto the taskbar, or turn it on in Settings → Personalisation → Taskbar → Other system tray icons.

The icon: green dot = running, grey = not running. Click it to open Canon. Right-click it for:
- the address for other computers (click to copy);
- **Start Canon** (when it isn't running);
- **Exit**: stops Canon properly (requests already running finish, the database is closed) and closes the icon. Opening **Canon** from the Start menu, or restarting the computer, starts it again.

Exit asks Canon through a token in `data\run\` that only the account running Canon (and administrators) can read, and only from the PC itself; nobody on the network can stop Canon this way.

From PowerShell (no administrator needed, except to install or uninstall):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows-task.ps1 status     # the task, Canon, the icon
powershell -ExecutionPolicy Bypass -File scripts\windows-task.ps1 restart    # after an update
powershell -ExecutionPolicy Bypass -File scripts\windows-task.ps1 stop       # or start
powershell -ExecutionPolicy Bypass -File scripts\windows-task.ps1 uninstall  # as administrator: back to start-canon.bat
```

What Canon does is written to `data\logs\` as before (`launcher.log` for restarts). In the background Canon never gives up: after 10 quick restarts it waits five minutes and tries again. Ctrl+C in the window, and `docker stop`, also stop Canon properly now.

### On a Mac

`start-canon.command` does what `start-canon.bat` does, in a Terminal window:
- **The first time:** macOS blocks a script downloaded from the internet. Right-click it, choose **Open**, then **Open** again; after that a double-click is enough.
- **Firewall:** when macOS asks whether `node` may accept incoming connections, choose **Allow**, or other computers can't reach Canon. It can be changed later in System Settings → Network → Firewall → Options.
- **Sleep:** the launcher runs Canon under `caffeinate`, so the Mac doesn't sleep while Canon is running (the screen still can). Closing a laptop's lid still sleeps it.
- **Starting with the Mac:** add `start-canon.command` to System Settings → General → Login Items.
- Node.js from nodejs.org or from Homebrew both work.

## Encryption

From 0.19.0 Canon encrypts the church's data on the computer it runs on (SQLCipher format, AES-256):
- **The database** (`data/canon.db`), the copies kept before upgrades (`data/pre-upgrade/`) and the archived years (`data/archives/`), with the **database key**.
- **Backups**, with a separate **backup key**: a backup copied to a USB drive or Google Drive and the live database never share a secret.
- Both keys are random and kept in **`data/keys.json`**, locked to this computer:
  - **Windows**: DPAPI, with the Windows account Canon runs as. Another account, or the file copied elsewhere, can't open them. Install the background task (above) as the same account that encrypted the data, or Canon starts locked.
  - **macOS**: the login keychain.
  - **Linux and Docker**: with `CANON_KEY_FILE` when it is set (a secret kept outside the data volume), else only by the file's permissions — then anyone who can read the data folder can read the keys too.
- **The recovery key** (eight groups of five, shown once at setup with a QR code to print) locks the same two keys a second time. Canon never stores it. With it:
  - Canon opens on a new computer, or after the Windows account changed: Canon starts **locked** and shows one page, on the computer itself only, asking for it; then it locks the keys to this computer again. Where no browser on that computer can reach the page (Docker, a server without a desktop): `npm run unlock -- <recovery key>`, then start Canon.
  - Any backup restores anywhere: each backup carries its backup key locked with the recovery key current when it was made, and names that key's ID.
  - A new recovery key (Settings → Security & privacy, password asked again) replaces the old one for the database; older backups keep needing the one they name.
- **A plain `canon.db` beside `keys.json` is refused**: Canon won't start, and says the database file has been replaced. Only an encryption that was interrupted leaves a plain database next to its keys (Canon marks that with the database key itself), so anything else was put there — possibly to have Canon issue a recovery key for the real keys. Restore the newest backup; if the file really is the church's database, move `keys.json` aside first.
- **`keys.json` is readable by Canon's account only** (on Windows Canon sets its permissions so; elsewhere mode 600).
- **Keep `keys.json` with `canon.db`.** Copying or moving the data folder, take both. Without `keys.json` the database can't be opened, even with the recovery key — restore the newest backup instead (the backups carry what they need).
- **A database from before 0.19.0** stays plain until an administrator presses **Encrypt now…** (a red banner on every page) and enters their password again. Canon makes a backup, encrypts the database in place, shows the recovery key, then encrypts the plain copies it holds (backups in the backup folder and its `archives/`, `data/pre-upgrade/`, `data/archives/`) and removes the plain originals. Other database files in those folders are listed and left alone. Copies it couldn't do then (a drive unplugged, a file in use) stay listed under Settings → Security & privacy → Encryption, with **Encrypt them now**. A test copy (`CANON_TEST_COPY=1`) never converts its backup folder, which may be the real Canon's. Scratch files a crash leaves behind are removed when Canon starts.
- **Disk encryption** (BitLocker, FileVault) is still worth having: deleted plain files can stay on the disk until overwritten, and it protects everything else on the computer.

## Backups

Backups are set up in **Settings → Backups**. From the command line, `npm run backup` is safe while Canon is running:

```bash
npm run backup                      # → backups/canon-YYYY-MM-DD-HHMM.db
npm run backup -- D:\CanonBackups   # to a USB drive or synced folder
```

Backups of an encrypted Canon are always encrypted (`.db.enc`, with the backup key; see [Encryption](#encryption)). Before 0.19.0 — and while a database isn't encrypted yet — a backup password (Settings → Backups → Encryption) encrypts them instead (AES-256-GCM; the key in `data/backup-key.json`, never inside a backup). To restore an encrypted backup by hand, decrypt it first (this computer's keys; or give the recovery key, or the backup password, after the file name):

```bash
npm run decrypt-backup -- D:\CanonBackups\canon-2026-01-04-0900.db.enc
```

Add the password after the file for a backup from another computer or made before the password changed.

Archive files are copied with every backup. To restore by hand, or to update Canon and go back, see [UPGRADING.md](UPGRADING.md). For Docker, see [DOCKER.md](DOCKER.md).

### Google Drive

Canon can also send each encrypted backup to the church's Google Drive. Setup is in the user guide, under "Backups to Google Drive" (Help → Guide in Canon, or `docs/guide/en.md#google-drive`). In short:
- **Google's side:** the church makes its own Google Cloud project with the Google Drive API on, and an OAuth client of type **TV and Limited Input devices**. The app should be published **In production**, because a Testing app's sign-in expires after 7 days.
- **Canon's side:** the client goes into Settings → Backups → Google Drive, and someone connects with a code at google.com/device. There's no redirect URI, so this works behind NAT and in Docker.

How it works:
- **Permission:** the scope is `drive.file`. Canon can see and delete only the files it created, in a "Canon backups" folder.
- **What is sent:** only `.db.enc` backups. The newest N are kept there.
- **When:** uploads happen in the server after **Back up now** and automatic backups. A backup made with `npm run backup` (which does not load Canon) is sent at the next half-hourly check.
- **Restores:** the connection is kept across restores, like the backup folder.
- **What is stored:** the client secret and Google's refresh token are in the database (settings key `_gdrive`).
- **Network:** Canon needs outbound HTTPS to `oauth2.googleapis.com` and `www.googleapis.com`.

## Connecting Claude (MCP)

1. **Settings → AI / MCP:** enable the server and choose each module's access. By default, members are hidden and contact details are redacted.
2. claude.ai needs a public **https** address. Run a tunnel, for example [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) (`cloudflared tunnel --url http://localhost:3000`). Paste its address into **Settings → AI / MCP → Public address**, press **Check**, then **Save**.
3. In claude.ai, go to **Settings → Connectors → Add custom connector** and paste `https://<your-host>/mcp`. Leave the client ID blank, then sign in with a Canon account and approve.
4. Connected agents and the activity log are listed under Settings → AI / MCP, where each one can be revoked.

For each module, an agent's access is the most restrictive of three things:
- the administrator's module setting;
- the token's scope (`canon:read` or `canon:write`);
- the signed-in user's role. A viewer only ever gets read access, and never personal details.

Tools an agent may not use never appear in its tool list, and `canon_whoami` tells an agent who it acts for and what it may do. Batch tools (`canon_edit_order`, `canon_update_rota`, …) apply all or nothing. Agents can't send e-mail, delete people, or see accounts, settings or OAuth data. Every call is logged, with argument names but not the personal data itself.

The [agent handbook](AGENT-PLAYBOOKS.md) describes the tools and playbooks; the server also offers it as the resource `canon://guide/agents`. The [Claude skill](../skills/README.md) packages it for claude.ai and Claude Code.
