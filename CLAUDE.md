# Canon

Project memory for AI agents lives in `.claude/memory/` (local to this machine, not in git) — read `.claude/memory/MEMORY.md` first if it exists.

- Run: `npm install`, `npm run import:bible`, `npm run dev` (web on :5173, API on :3000). Production: `npm run build && npm start`.
- Server is TypeScript run directly by Node 24 type-stripping: use `import type`, `.ts` import extensions, no enums/namespaces/parameter properties.
- Scratch / helper scripts go in `_workings/`, not the root.
