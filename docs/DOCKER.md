# Running Canon with Docker

Docker is an alternative to `start-canon.bat`. It suits a small always-on server, a NAS (Synology, QNAP), a Linux box or a cloud VM. Everything Canon stores lives in one Docker volume, so moving or upgrading is simple.

## Start

```bash
docker compose up -d
```

Open <http://localhost:3000> (or `http://<server-name>:3000` from the office network). The first screen creates the administrator account and asks for your worship languages. The Bible import runs from the onboarding page, so no command line is needed after this point.

| Task | Command |
|---|---|
| See logs | `docker compose logs -f canon` |
| Stop | `docker compose down` (your data is kept) |
| Update to a new version | `git pull` (or copy in the new files), then `docker compose up -d --build` |
| Back up now | `docker compose exec canon npm run backup` (the backup file is written to `./backups` on the host) |
| Restore | see [Restoring a backup](#restoring-a-backup) |
| Use another port | `CANON_HTTP_PORT=8080 docker compose up -d` |

The container runs as an unprivileged user. On Linux, if backups fail with "permission denied", run `sudo chown 1000:1000 backups` once on the host.

## Restoring a backup

```bash
docker compose down
docker run --rm -v canon_canon-data:/data -v "$PWD/backups:/b" alpine sh -c "rm -f /data/canon.db-wal /data/canon.db-shm && cp /b/canon-YYYY-MM-DD-HHMM.db /data/canon.db && chown 1000:1000 /data/canon.db"
docker compose up -d
```

Replace the file name with your backup. The volume is called `<folder>_canon-data`; `docker volume ls` shows the exact name.

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
