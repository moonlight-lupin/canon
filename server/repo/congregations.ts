// Congregations of one church (e.g. English, Chinese and Indonesian services that are legally one church).
// Services, service templates, members and groups can belong to one; lists can be filtered by it. A church with
// no congregations defined sees none of this.
import type { L10n, Lang } from '../../shared/types.ts';
import { all, run } from '../db.ts';
import { BadRequest, table } from '../lib/table.ts';

export interface Congregation {
  id: number;
  name: L10n;
  /** short label on badges, e.g. "EN", "华", "ID" */
  code: string;
  /** the languages its services normally use (new services start with these) */
  languages: Lang[];
  color: string;
  sort: number;
  active: boolean;
}

export const congregations = table<Congregation>({
  name: 'congregations',
  cols: ['name', 'code', 'languages', 'color', 'sort', 'active'],
  json: ['name', 'languages'],
  bool: ['active'],
});

export const listCongregations = () => congregations.list('', [], 'sort, id');

const hasText = (l?: L10n) => !!l && Object.values(l).some((v) => v?.trim());

export function saveCongregation(id: number | null, input: Partial<Congregation>): Congregation {
  if (input.name !== undefined && !hasText(input.name)) throw new BadRequest('Give the congregation a name');
  if (input.code !== undefined) input.code = input.code.trim().slice(0, 8);
  if (!id) {
    if (!hasText(input.name)) throw new BadRequest('Give the congregation a name');
    const sort = (all<{ s: number | null }>('SELECT MAX(sort) AS s FROM congregations')[0]?.s ?? 0) + 1;
    return congregations.insert({ languages: [], color: '#64748b', active: true, sort, ...input, code: input.code || '' });
  }
  return congregations.update(id, input);
}

/** Delete a congregation: services, templates, members and groups that belonged to it simply lose the tag. */
export function deleteCongregation(id: number) {
  congregations.get(id);
  for (const t of ['services', 'templates', 'people', 'groups']) run(`UPDATE ${t} SET congregation_id = NULL WHERE congregation_id = ?`, id);
  congregations.remove(id);
}

/** Find a congregation by id, code or name (any language), for agents and CSV files. */
export function findCongregation(ref: string | number | null | undefined): Congregation | undefined {
  if (ref == null || ref === '') return undefined;
  const list = listCongregations();
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return list.find((c) => c.id === Number(ref));
  const s = String(ref).trim().toLowerCase();
  return list.find((c) => c.code.toLowerCase() === s || Object.values(c.name).some((n) => n?.trim().toLowerCase() === s));
}
