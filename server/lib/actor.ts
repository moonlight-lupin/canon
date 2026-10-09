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
  /** may see and change member fields marked sensitive (absent = yes: Canon's own tasks) */
  sensitive?: boolean;
  /**
   * Checks every row this request reads or changes through the shared table helper (lib/table.ts), after the wall:
   * MCP uses it for meetings (role access, the Meetings module switched off). Throws to refuse.
   */
  gate?: (entity: string, row: { id?: number; congregation_id: number | null; kind?: string | null }, mode: 'read' | 'write') => void;
}

const store = new AsyncLocalStorage<Actor>();

/** Run `fn` with `actor` as the one making changes. */
export const asActor = <T>(actor: Actor, fn: () => T): T => store.run(actor, fn);

/** The current actor, or null outside a request (seeding and migrations: not logged). */
export const currentActor = (): Actor | null => store.getStore() ?? null;

/**
 * Canon itself: the daily tidy, automatic backups, notes made at start-up. Its changes are logged by "Canon" (0.20.0,
 * Daedalus Workshop study of 0.19.10: they had no actor, so the change log never showed them).
 */
export const SYSTEM: Actor = { user_id: null, user_name: 'Canon', via: 'system' };
export const asSystem = <T>(fn: () => T): T => asActor(SYSTEM, fn);
