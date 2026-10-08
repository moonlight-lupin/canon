# Canon

Project memory for AI agents lives in `.claude/memory/` (local to this machine, not in git) — read `.claude/memory/MEMORY.md` first if it exists.

- Run: `npm install --ignore-scripts` (the database library's binaries are ready-built; some npm versions otherwise try to compile it), `npm run import:bible`, `npm run dev` (web on :5173, API on :3000). Production: `npm run build && npm start`.
- Server is TypeScript run directly by Node 24 type-stripping: use `import type`, `.ts` import extensions, no enums/namespaces/parameter properties.
- Scratch / helper scripts go in `_workings/`, not the root.

## Documentation is part of every change (required)
- Any user-visible change → update `docs/guide/en.md` **and** `docs/guide/zh.md` (Simplified; `npm run i18n` keeps `zh-Hant.md` in step both ways).
- New UI text: `t('English')` with its Simplified Chinese in `locales/zh/ui.json` (printed words: `locales/*/outputs.json`; e-mails and public pages: `locales/*/server.json`), then `npm run i18n`. See CONTRIBUTING-TRANSLATIONS.md.
- Any MCP change (tools, arguments, prompts, resources, instructions) → update `docs/AGENT-PLAYBOOKS.md` **and** `skills/canon/` (`SKILL.md`, `references/playbooks.md`, `references/tools.md`), and `server/mcp-prompts.ts` if a playbook step changes.
- `tests/docs-coverage.test.ts` fails when a sidebar page, Settings tab, MCP tool or prompt is undocumented; `tests/mcp-prompts.test.ts` fails when docs name a tool that doesn't exist. Keep both green.
- Public repo: examples in code, tests and docs are fictional — never real church data.
