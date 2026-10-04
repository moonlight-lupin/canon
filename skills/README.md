# Claude skills for Canon

`canon/` is a Claude skill (`canon-church-assistant`) that teaches Claude how to work in Canon through the Canon MCP connector: confirm before writing, respect the church's languages, privacy and copyright, and follow the playbooks (plan a service, suggest hymns, check the rota, proofread, catechism series, translations, member care, groups).

The skill only guides Claude. The data comes from the **Canon MCP connector**, so connect that first:

1. In Canon: **Settings → AI / MCP** → enable the server, set the public address, choose module access, **Save AI access**.
2. In claude.ai: **Settings → Connectors → Add custom connector** → `https://<your Canon address>/mcp` → sign in to Canon and approve.

## Install in claude.ai (or the Claude desktop app)

1. Zip the `canon` folder so that `canon/SKILL.md` is inside the zip (e.g. right-click → *Send to → Compressed (zipped) folder*).
2. In claude.ai: **Settings → Capabilities → Skills** → **Upload skill**, choose the zip, and turn it on.

## Install in Claude Code

Copy the folder into a skills directory:

```bash
# for every project on this computer
cp -r skills/canon ~/.claude/skills/canon
# or only for one project
cp -r skills/canon <project>/.claude/skills/canon
```

Claude Code also needs the MCP connection, e.g. `claude mcp add --transport http canon https://<your Canon address>/mcp`.

## Keeping it in step

The playbooks mirror the MCP prompts in `server/mcp-prompts.ts` and the agent handbook `docs/AGENT-PLAYBOOKS.md` (also served as the resource `canon://guide/agents`). `tests/mcp-prompts.test.ts` checks that every tool name mentioned in these files exists.
