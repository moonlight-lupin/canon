// Who is making the current change: a signed-in person in the web app, an AI agent through MCP (on behalf of a
// person), a CSV import, or Canon itself. Kept per request with AsyncLocalStorage so the change log can record it
// without passing it through every function.
import { AsyncLocalStorage } from 'node:async_hooks';

export type Via = 'web' | 'mcp' | 'import' | 'system';

export interface Actor {
  user_id: number | null;
  user_name: string | null;
  via: Via;
  /** MCP: the connected client (e.g. "Claude") */
  client?: string | null;
  /** the congregation this account is limited to (lib/walls.ts); null = the whole church */
  congregation_id?: number | null;
}

const store = new AsyncLocalStorage<Actor>();

/** Run `fn` with `actor` as the one making changes. */
export const asActor = <T>(actor: Actor, fn: () => T): T => store.run(actor, fn);

/** The current actor, or null outside a request (start-up, seeding, migrations: not logged). */
export const currentActor = (): Actor | null => store.getStore() ?? null;
