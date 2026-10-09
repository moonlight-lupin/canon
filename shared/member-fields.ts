// Custom member fields: the church adds its own fields to the member register (Settings → Member fields), e.g.
// "Cell group leader?" (yes / no), "Dietary needs" (text, sensitive), "Joined via" (a choice). Values are kept per
// person in people.custom as text: dates YYYY-MM-DD, yes / no as "yes" / "no", a choice as the option's label in the
// church's first language. A sensitive field is hidden from read-only accounts and from AI agents unless the church
// shares personal data.
import type { L10n } from './types.ts';

export type MemberFieldType = 'text' | 'date' | 'yesno' | 'choice';
export const MEMBER_FIELD_TYPES: MemberFieldType[] = ['text', 'date', 'yesno', 'choice'];

export interface MemberField {
  /** stable key (letters, digits, _), made from the English label when the field is created; never changes */
  key: string;
  label: L10n;
  type: MemberFieldType;
  /** choice: the options */
  options?: L10n[];
  /** hidden from read-only accounts and AI agents unless personal data is shared */
  sensitive?: boolean;
}

export const MAX_MEMBER_FIELDS = 30;
export const MEMBER_FIELD_TEXT_MAX = 500;
const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** A key from a label: "Cell group leader?" → "cell_group_leader". */
export function fieldKey(label: L10n, taken: string[]): string {
  const base = (label.en ?? Object.values(label).find(Boolean) ?? 'field')
    .toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'f_$1').slice(0, 32) || 'field';
  let k = KEY_RE.test(base) ? base : `field_${base}`.slice(0, 40).replace(/[^a-z0-9_]/g, '');
  if (!KEY_RE.test(k)) k = 'field';
  let n = 2;
  const out = k;
  while (taken.includes(k)) k = `${out}_${n++}`;
  return k;
}

/** An option's stored value: its label in the church's first language. */
export const optionValue = (o: L10n, firstLang = 'en') => (o[firstLang] || o.en || o.zh || Object.values(o).find(Boolean) || '').trim();

/**
 * Clean field definitions from an administrator. A field the church has keeps its key, and so does an archived one
 * brought back (restored, with its values); a new field gets a key never used before — not by a field it has, one it
 * archived, nor one whose values are still in the register (`taken`). Fields left out are archived, not deleted, so a
 * new field with the same label never shows an old field's values (0.20.0, Daedalus Workshop study of 0.19.10).
 */
export function cleanFieldDefs(input: MemberField[], current: MemberField[], retired: MemberField[] = [], taken: string[] = []): { fields: MemberField[]; retired: MemberField[] } {
  const out: MemberField[] = [];
  const known = new Set([...current, ...retired].map((c) => c.key));
  for (const f of input.slice(0, MAX_MEMBER_FIELDS)) {
    if (!Object.values(f.label ?? {}).some((v) => v?.trim())) continue;
    const type = MEMBER_FIELD_TYPES.includes(f.type) ? f.type : 'text';
    const key = f.key && known.has(f.key) && !out.some((o) => o.key === f.key) ? f.key : fieldKey(f.label, [...known, ...taken, ...out.map((o) => o.key)]);
    const options = type === 'choice' ? (f.options ?? []).filter((o) => Object.values(o).some((v) => v?.trim())).slice(0, 30) : undefined;
    out.push({ key, label: f.label, type, ...(options ? { options } : {}), ...(f.sensitive ? { sensitive: true } : {}) });
  }
  const kept = new Set(out.map((o) => o.key));
  const archived = [...retired, ...current.filter((c) => !retired.some((r) => r.key === c.key))].filter((c) => !kept.has(c.key));
  return { fields: out, retired: archived };
}

/**
 * A person's custom values, checked against the definitions: unknown fields dropped, wrong values refused with a
 * message. Empty values are dropped (the field is cleared).
 */
export function cleanCustomValues(input: Record<string, unknown> | null | undefined, defs: MemberField[], firstLang = 'en'): { values: Record<string, string>; errors: string[] } {
  const values: Record<string, string> = {};
  const errors: string[] = [];
  for (const d of defs) {
    const raw = input?.[d.key];
    if (raw === undefined || raw === null) continue;
    const v = String(raw).trim();
    if (!v) continue;
    const name = d.label.en || Object.values(d.label)[0] || d.key;
    if (d.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`${name}: "${v}" is not a date (YYYY-MM-DD).`);
      else values[d.key] = v;
    } else if (d.type === 'yesno') {
      const yes = /^(yes|y|true|1|是|有)$/i.test(v);
      const no = /^(no|n|false|0|否|没有|沒有)$/i.test(v);
      if (!yes && !no) errors.push(`${name}: "${v}" should be yes or no.`);
      else values[d.key] = yes ? 'yes' : 'no';
    } else if (d.type === 'choice') {
      const opt = (d.options ?? []).find((o) => Object.values(o).some((x) => x?.trim().toLowerCase() === v.toLowerCase()));
      if (!opt) errors.push(`${name}: "${v}" is not one of the choices (${(d.options ?? []).map((o) => optionValue(o, firstLang)).join(', ')}).`);
      else values[d.key] = optionValue(opt, firstLang);
    } else {
      values[d.key] = v.slice(0, MEMBER_FIELD_TEXT_MAX);
    }
  }
  return { values, errors };
}

/** Keys of the sensitive fields. */
export const sensitiveKeys = (defs: MemberField[]) => new Set(defs.filter((d) => d.sensitive).map((d) => d.key));

/** The values to show: only fields that are defined now, and sensitive ones only when allowed. */
export function visibleCustom(values: Record<string, unknown> | null | undefined, defs: MemberField[], sensitiveAllowed: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of defs) {
    const v = values?.[d.key];
    if (v === undefined || v === null || v === '') continue;
    if (d.sensitive && !sensitiveAllowed) continue;
    out[d.key] = String(v);
  }
  return out;
}
