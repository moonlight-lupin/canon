// Shared building blocks for MCP tool definitions. Each feature file (services.ts, library.ts, volunteers.ts,
// people.ts, groups.ts) exports a ToolDef[] array which server/mcp.ts merges into the tool table.
import { isSqliteError } from '../lib/sqlite.ts';
import { z, ZodError } from 'zod';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ModuleAccess, ModuleKey } from '../../shared/types.ts';
import { RefError } from '../../shared/bible.ts';
import { db, tx } from '../db.ts';
import type { McpAuth } from '../oauth.ts';

export type Access = 'read' | 'write';
export interface Ctx {
  auth: McpAuth;
  /** member contact details / birth dates / notes may be returned */
  pii: boolean;
  /** the church's member fields marked sensitive may be returned and changed (absent = as pii) */
  sensitive?: boolean;
  /** new visitors on service records: none, names & follow-up, or with contact details (absent = none) */
  visitors?: 'off' | 'names' | 'contact';
  /** songs' sheet music may be listed and its pictures returned */
  scores?: boolean;
  /** effective access per module on this connection (absent = none: checks fail closed) */
  levels?: Record<ModuleKey, ModuleAccess>;
  /** the address this client reached Canon at (for links in results), without a trailing slash */
  base?: string;
}

/** May this request read `module`? Used where one tool adds data from another module (e.g. song usage from services). */
export const canRead = (ctx: Ctx, module: ModuleKey) => !!ctx.levels && ctx.levels[module] !== 'off';
// Handlers receive arguments already validated against `input` by the MCP SDK.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Args = Record<string, any>;

export interface ToolDef {
  name: string;
  module: ModuleKey;
  access: Access;
  title: string;
  description: string;
  input: Record<string, z.ZodType>;
  annotations: ToolAnnotations;
  /** only offered when the admin exposes member PII */
  requiresPii?: boolean;
  /** only offered when the administrator shares sheet music (Library → Sheet music) */
  requiresScores?: boolean;
  /** offered on every connection, whatever the module settings (canon_whoami) */
  always?: boolean;
  /** follows the connection's module setting but not the person's role: the person's own records (expense claims) */
  own?: boolean;
  handler: (args: Args, ctx: Ctx) => unknown;
}

/** A result with pictures (e.g. pages of sheet music): the JSON first, then each image as MCP image content. */
export class WithImages {
  data: unknown;
  images: { mime: string; base64: string }[];
  constructor(data: unknown, images: { mime: string; base64: string }[]) {
    this.data = data;
    this.images = images;
  }
}

export const RO: ToolAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
export const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

export const Id = z.number().int().positive();
export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const Limit = (def: number, max: number) => z.number().int().min(1).max(max).default(def).describe(`max ${max}`);

export const today = () => new Date().toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);

// ---------------------------------------------------------------- PII redaction

export const PERSON_PII = ['phone', 'email', 'address', 'birth_date', 'notes'] as const;
export const HOUSEHOLD_PII = ['address', 'phone', 'notes'] as const;
export const COWORKER_PII = ['phone', 'email', 'notes'] as const;

export function redact<T extends object>(o: T, keys: readonly string[], pii: boolean): T {
  if (pii) return o;
  const out = { ...o } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return out as T;
}

// ---------------------------------------------------------------- errors

/** A batch whose operations did not all succeed; nothing was applied. */
export class BatchError extends Error {
  status = 400;
  errors: { index: number; op: string; error: string }[];
  constructor(errors: { index: number; op: string; error: string }[], total: number) {
    super(`${errors.length} of ${total} operation${total > 1 ? 's' : ''} failed — nothing was applied. Fix them and send the whole batch again.`);
    this.errors = errors;
  }
}

export class InputError extends Error {
  status = 400;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ZodError) return e.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
  if (e instanceof RefError) return e.message;
  const err = e as { status?: number; message?: string; code?: string };
  if (isSqliteError(err) && /UNIQUE|FOREIGN KEY|CHECK/.test(err.message ?? '')) {
    return `Conflict: ${/FOREIGN KEY/.test(err.message ?? '') ? 'a referenced record does not exist or is still in use' : err.message}`;
  }
  if (err.status && err.status < 500 && err.message) return err.message;
  console.error('[mcp] tool error', e);
  return 'Internal error';
}

/**
 * Apply a batch of operations all-or-nothing. Every operation runs (each in its own savepoint, so a failed one
 * leaves no trace) so that all problems are reported at once; if any failed, the whole transaction is rolled back
 * and a BatchError lists the per-operation errors.
 */
export function runBatch<O extends { op: string }, R>(ops: O[], apply: (op: O, index: number) => R): R[] {
  return tx(() => {
    const results: R[] = [];
    const errors: { index: number; op: string; error: string }[] = [];
    ops.forEach((op, i) => {
      db.exec('SAVEPOINT mcp_batch_op');
      try {
        results.push(apply(op, i));
        db.exec('RELEASE mcp_batch_op');
      } catch (e) {
        db.exec('ROLLBACK TO mcp_batch_op');
        db.exec('RELEASE mcp_batch_op');
        errors.push({ index: i, op: op.op, error: errorMessage(e) });
      }
    });
    if (errors.length) throw new BatchError(errors, ops.length);
    return results;
  });
}

/** `need(a.x, 'x', 'add')` — a field required by one op type of a flat batch schema. */
export function need<T>(v: T | null | undefined, field: string, op: string): T {
  if (v === undefined || v === null) throw new InputError(`${field} is required for "${op}"`);
  return v;
}

// ---------------------------------------------------------------- multilingual updates

type L10nValue = Record<string, string>;

/**
 * Merge a multilingual value from an agent's update into the stored one: languages in the patch replace only
 * those languages, other languages are kept, and an empty string removes a language. Agents usually add or fix
 * one language at a time, so replacing the whole value would silently delete the others.
 */
export function mergeL10n(cur: L10nValue | null | undefined, patch: L10nValue): L10nValue {
  const out: L10nValue = { ...(cur ?? {}) };
  for (const [lang, text] of Object.entries(patch)) {
    if (text === '') delete out[lang];
    else out[lang] = text;
  }
  return out;
}

/**
 * Merge labelled multilingual entries (song stanzas, text parts) by label: a patch entry with a known label
 * merges into that entry (via `merge`), a new label is appended, entries not mentioned are kept in place.
 * An entry left with no text in any language is dropped.
 */
export function mergeLabelled<T extends { label: string }>(cur: T[] | null | undefined, patch: T[], merge: (a: T, b: T) => T, isEmpty: (x: T) => boolean): T[] {
  const out = [...(cur ?? [])];
  for (const p of patch) {
    const i = out.findIndex((x) => x.label === p.label);
    if (i >= 0) out[i] = merge(out[i], p);
    else out.push(p);
  }
  return out.filter((x) => !isEmpty(x));
}

/** Patch with each listed multilingual field merged into the stored row (fields absent from the patch untouched). */
export function mergeL10nFields<T extends object>(cur: T, patch: Partial<T>, keys: (keyof T)[]): Partial<T> {
  const out = { ...patch };
  for (const k of keys) {
    const p = patch[k];
    if (p && typeof p === 'object' && !Array.isArray(p)) out[k] = mergeL10n(cur[k] as L10nValue | null, p as L10nValue) as T[keyof T];
  }
  return out;
}

export const L10N_MERGE_NOTE = 'Multilingual fields merge by language: send only the languages you are adding or changing — the others are kept; "" removes a language.';
