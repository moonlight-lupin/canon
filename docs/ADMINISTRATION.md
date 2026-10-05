# Running Canon

For whoever looks after the computer Canon runs on. Everything a church office uses day to day is in Canon's **Settings**, and is explained in the [user guide](guide/en.md).

## Configuration

Environment variables are optional overrides:

| Variable | Default | Purpose |
|---|---|---|
| `CANON_PORT` | `3000` | HTTP port. On Windows, put e.g. `set CANON_PORT=5018` in a file `canon.local.bat` next to `start-canon.bat`. It is read at start-up and is not part of the repository. |
| `CANON_HOST` | `0.0.0.0` | Interface to listen on. The default lets the office network reach Canon. |
| `CANON_DB` | `data/canon.db` | The SQLite database file. Archives (`archives/`) and pre-upgrade copies (`pre-upgrade/`) sit next to it. |
| `CANON_PUBLIC_URL` | — | Forces the public address. Normally set in Settings → AI / MCP instead. |
| `CANON_TRUST_PROXY` | — | Honours `X-Forwarded-*`. Automatic once a public address is set. |

To start Canon when Windows starts, add `start-canon.bat` to Task Scheduler with the trigger "At log on".

## Backups

Backups are set up in **Settings → Backups**. From the command line, `npm run backup` is safe while Canon is running:

```bash
npm run backup                      # → backups/canon-YYYY-MM-DD-HHMM.db
npm run backup -- D:\CanonBackups   # to a USB drive or synced folder
```

Archive files are copied with every backup. To restore by hand, or to update Canon and go back, see [UPGRADING.md](UPGRADING.md). For Docker, see [DOCKER.md](DOCKER.md).

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
