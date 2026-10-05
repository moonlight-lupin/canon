// References: short codes people choose for services and templates ("EN-001", "CN-10pmService"), so a person or an
// AI agent can name one instead of an id ("create next Sunday's service from template CN-10pmService"). Each kind
// has its own list; a reference is unique within its kind, ignoring upper / lower case.
import { get } from '../db.ts';
import { BadRequest, Conflict, NotFound } from '../lib/table.ts';

export type RefKind = 'service' | 'service_template' | 'slide_template' | 'bulletin_template';
const TABLE: Record<RefKind, string> = {
  service: 'services', service_template: 'templates', slide_template: 'slide_themes', bulletin_template: 'bulletin_templates',
};
const LABEL: Record<RefKind, string> = {
  service: 'service', service_template: 'service template', slide_template: 'slide template', bulletin_template: 'bulletin template',
};

/** Letters (any script), digits, and - _ . inside; 1–40 characters; no spaces. */
export const REF_PATTERN = /^[\p{L}\p{N}](?:[\p{L}\p{N}._-]{0,38}[\p{L}\p{N}])?$/u;

/**
 * A reference ready to store: trimmed, '' → null; checked for form and that no other record of the kind uses it.
 * `undefined` stays undefined (not being changed).
 */
export function cleanRef(kind: RefKind, value: unknown, selfId?: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const ref = String(value).trim();
  if (!ref) return null;
  if (!REF_PATTERN.test(ref)) {
    throw new BadRequest(`"${ref}" is not a valid reference: use letters, digits and - _ . (no spaces), up to 40 characters, e.g. EN-001 or CN-10pmService.`);
  }
  const other = get<{ id: number }>(`SELECT id FROM ${TABLE[kind]} WHERE ref = ? COLLATE NOCASE AND id != ?`, ref, selfId ?? 0);
  if (other) throw new Conflict(`The reference "${ref}" is already used by another ${LABEL[kind]}.`);
  return ref;
}

/** The id of a record given its id or its reference (case does not matter). */
export function resolveRef(kind: RefKind, idOrRef: number | string): number {
  if (typeof idOrRef === 'number' || /^\d+$/.test(String(idOrRef).trim())) {
    const id = Number(idOrRef);
    // a reference may itself look like a number ("001"): prefer it when it exists
    const byRef = typeof idOrRef === 'string' ? get<{ id: number }>(`SELECT id FROM ${TABLE[kind]} WHERE ref = ? COLLATE NOCASE`, idOrRef.trim()) : undefined;
    if (byRef) return byRef.id;
    if (get(`SELECT 1 FROM ${TABLE[kind]} WHERE id = ?`, id)) return id;
    throw new NotFound(`No ${LABEL[kind]} with id ${id}.`);
  }
  const r = get<{ id: number }>(`SELECT id FROM ${TABLE[kind]} WHERE ref = ? COLLATE NOCASE`, String(idOrRef).trim());
  if (!r) throw new NotFound(`No ${LABEL[kind]} with the reference "${String(idOrRef).trim()}".`);
  return r.id;
}
