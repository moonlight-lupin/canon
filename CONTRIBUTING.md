# Contributing to Canon

Contributions are welcome. Please open an issue first to discuss larger changes. Keep `npm test` and `npm run typecheck` green; [CI](.github/workflows/ci.yml) runs both, plus the build, on Windows and Linux.

```bash
npm install --ignore-scripts   # the database library brings ready-built binaries: nothing to compile
npm run import:bible   # the public-domain Bibles for the default languages
npm run dev            # API on :3000 (watch) + Vite on :5173 (proxied)
npm test               # node:test
npm run typecheck
npm run build          # runs npm run i18n (translations in step), then builds the web app
```

## Stack and layout

- **Server:** Node 24 runs the TypeScript directly (type stripping, no build step), with Express 5 and `node:sqlite`.
- **Web app:** React 19, Vite and dnd-kit, styled with hand-written CSS (no UI framework).

| Path | Contents |
|---|---|
| `server/repo/*` | business logic |
| `server/api.ts`, `server/routes/*` | REST |
| `server/mcp.ts`, `server/mcp-tools/*` | the MCP server and its tools |
| `server/oauth.ts` | the OAuth authorization server |
| `server/repo/render.ts` | turns a service into one resolved multilingual structure that every output uses |
| `server/migrations.ts` | the database schema, as append-only migrations |
| `server/csv/*` | import and export specifications |
| `shared/*` | types, schemas, the language registry, Bible references, the liturgical calendar |
| `src/*` | the web app (`src/pages/<page>/` holds a page's parts) |

## Conventions

- **Database:** append a migration to `server/migrations.ts`, and never edit one that has shipped. Add a line to [CHANGELOG.md](CHANGELOG.md). `tests/upgrade.test.ts` checks that every older schema upgrades cleanly.
- **TypeScript:** use `.ts` import extensions and `import type`. Node's type stripping rules out enums, namespaces and parameter properties. Unused locals fail the typecheck.
- **Translations:** see [CONTRIBUTING-TRANSLATIONS.md](CONTRIBUTING-TRANSLATIONS.md). The English text is the key:
  - text on screen goes through `t('…')`, with its translation in `locales/<code>/ui.json`;
  - printed words go through `printed()` (`shared/printed.ts`), from `outputs.json`;
  - e-mails and public pages go through `st()` (`server/lib/server-text.ts`), from `server.json`.

  Add the Simplified Chinese for new phrases to `locales/zh/*.json`, then run `npm run i18n`: it keeps Traditional Chinese in step and updates `shared/locales.generated.ts`. `tests/i18n.test.ts` fails when that wasn't run.
- **Documentation is part of every change:**
  - A change users can see updates the guide, `docs/guide/en.md` and `zh.md`.
  - A change agents can see updates `docs/AGENT-PLAYBOOKS.md` and `skills/canon/`.
  - `tests/docs-coverage.test.ts` and `tests/mcp-prompts.test.ts` check the basics.
- **Examples are fictional:** never use real church or member data in code, tests or docs.
- **Scratch files** go in `_workings/` (git-ignored).
