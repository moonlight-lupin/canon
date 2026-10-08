# Running Canon with Docker

Docker is an alternative to `start-canon.bat`. It suits a small always-on server, a NAS (Synology, QNAP), a Linux box or a cloud VM. Everything Canon stores lives in one Docker volume, so moving or upgrading is simple.

## Start

Canon's image is published on GitHub for every release, for ordinary PCs and servers (amd64) and for ARM machines such as many NAS models (arm64): `ghcr.io/moonlight-lupin/canon`. Nothing needs building.

**From GitHub, without the source:** make a folder (e.g. `canon`) with a `backups` folder in it and this `docker-compose.yml`:

```yaml
services:
  canon:
    image: ghcr.io/moonlight-lupin/canon:latest
    container_name: canon
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      TZ: Asia/Kuala_Lumpur
    volumes:
      - canon-data:/app/data
      - ./backups:/app/backups
volumes:
  canon-data:
```

```bash
docker compose pull
docker compose up -d
```

On a Synology NAS: **Container Manager → Project → Create**, choose the folder, and paste the file above. On QNAP: **Container Station → Applications → Create**.

**With the source** (this repository): `docker compose pull && docker compose up -d` uses the same published image; `docker compose up -d --build` builds it from the source instead.

To stay on one version, use `ghcr.io/moonlight-lupin/canon:0.18.0` (or `CANON_VERSION=0.18.0` with this repository's compose file) instead of `latest`.

While the repository is private, so is its image: sign in once on the NAS with `docker login ghcr.io -u moonlight-lupin`, using a GitHub token with the *read:packages* permission as the password (github.com → Settings → Developer settings → Personal access tokens). Once the image is public, nobody needs to sign in.

Open <http://localhost:3000> (or `http://<server-name>:3000` from the office network). The first screen creates the administrator account and asks for your worship languages. The Bible import runs from the onboarding page, so no command line is needed after this point.

| Task | Command |
|---|---|
| See logs | `docker compose logs -f canon` |
| Stop | `docker compose down` (your data is kept) |
| Update to a new version | `docker compose pull && docker compose up -d` (from the source: `git pull`, then `docker compose up -d --build`) |
| Back up now | `docker compose exec canon npm run backup` (the backup file is written to `./backups` on the host) |
| Restore | see [Restoring a backup](#restoring-a-backup) |
| Use another port | `CANON_HTTP_PORT=8080 docker compose up -d` |

Canon runs as an unprivileged user (uid 1000) inside the container. When it starts, it makes the `backups` folder its own, so backups work on a Synology or QNAP NAS without a command line. (If you set `user:` in `docker-compose.yml`, that user must be able to write to `backups`.)

Backups can also go to the church's Google Drive (Settings → Backups → Google Drive). The sign-in uses a code at google.com/device, so it works from the container with no public address or port. The container only needs outbound HTTPS. See the user guide, "Backups to Google Drive".

## Restoring a backup

The easy way: **Settings → Backups → Restore** (or **Restore from a file…**) while Canon is running. Canon saves a copy of the current data first.

If Canon will not start, restore by hand:

```bash
docker compose down
docker run --rm -v canon_canon-data:/data -v "$PWD/backups:/b" alpine sh -c "rm -f /data/canon.db-wal /data/canon.db-shm && cp /b/canon-YYYY-MM-DD-HHMM.db /data/canon.db && chown 1000:1000 /data/canon.db"
docker compose up -d
```

Replace the file name with your backup. The volume is called `<folder>_canon-data`; `docker volume ls` shows the exact name. An encrypted backup (`.db.enc`) must be decrypted first: `docker compose run --rm canon npm run decrypt-backup -- /app/backups/canon-YYYY-MM-DD-HHMM.db.enc` writes the `.db` next to it.

## Going back to the previous version

An older Canon refuses a database that a newer one has upgraded. Before each upgrade, Canon keeps a copy of the database in `pre-upgrade/` inside the data volume (the newest three). To go back:

```bash
git checkout v0.17.4          # the version you had
docker compose down
docker run --rm -v canon_canon-data:/data alpine sh -c "ls /data/pre-upgrade"
docker run --rm -v canon_canon-data:/data alpine sh -c "rm -f /data/canon.db-wal /data/canon.db-shm && cp /data/pre-upgrade/<the copy> /data/canon.db && chown 1000:1000 /data/canon.db"
docker compose up -d --build
```

With the published image (no source), put the version you had in the compose file instead of `latest` (e.g. `ghcr.io/moonlight-lupin/canon:0.17.4`), copy the database back as above, then `docker compose pull && docker compose up -d`.

Anything entered since the upgrade is not in that copy.

## A test copy of the church's data

To try a new version on the church's real data (for example on a NAS, away from the office PC), restore a backup in the test Canon with **Settings → Backups → Restore from a file…** rather than copying the database by hand: the restore keeps the test Canon's own Google Drive connection, so it can't upload into, or tidy up, the church's Drive folder.

Then start the test copy with `CANON_TEST_COPY=1` (in `.env` next to `docker-compose.yml`, or `environment:` in the compose file). A test copy sends no e-mail (no loan reminders, codes, rotas or notices to real members) and doesn't touch Google Drive; a banner says it is a test copy.

## Connecting claude.ai (optional)

claude.ai needs a public **https** address. The compose file includes an optional Cloudflare Tunnel:

1. In the Cloudflare Zero Trust dashboard, create a tunnel. Add a public hostname (e.g. `canon.your-church.org`) that points to the service `http://canon:3000`.
2. Copy the tunnel token into a file named `.env` next to `docker-compose.yml`:
   ```
   TUNNEL_TOKEN=eyJhIjoi...
   ```
3. Start Canon with the tunnel:
   ```bash
   docker compose --profile tunnel up -d
   ```
4. In Canon, go to **Settings → AI / MCP → Public address**. Enter `https://canon.your-church.org`, then press **Check** and **Save**.

Other reverse proxies (Caddy, Nginx, Traefik) also work. Point them at port 3000 and enter the public address in Settings in the same way.

## What's in the image

- Node 24 (slim) running Canon's TypeScript server directly, plus the pre-built web app.
- Volumes: `/app/data` for the database, Bible source files and uploaded images, and `/app/backups`.
- A health check that calls `/api/me` every 30 seconds.
- Optional environment variables: `CANON_PORT`, `CANON_DB`, `CANON_PUBLIC_URL` and `CANON_TRUST_PROXY`. You normally don't need any of them, because the public address is set in the UI.
