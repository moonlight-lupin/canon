// Who leads an item (0.15.10): only people on the service's rota, never a typed name.
//  - An item with a role: the people on the rota for that role — all of them, or the ones the planner ticked
//    (leader_people). If none of the ticked people are on the rota any more, all of them again.
//  - An item without a role: the people the planner ticked from everyone on the service's rota (none by default).
//  - The preacher is whoever leads the (first) sermon item.
// A name typed before 0.15.10 (item `leader`, service `preacher`) still prints when the rota gives nobody, and the
// planner flags it until it is replaced.

export interface RotaEntry {
  role_id: number;
  person_id: number;
  person_name: string;
  status: string;
}

export interface LeaderItem {
  kind: string;
  role_id: number | null;
  leader_people?: number[] | null;
}

/** The people on the rota an item can name: its role's, else everyone on the service's rota (each person once). */
export function leaderPool(it: LeaderItem, rota: RotaEntry[]): RotaEntry[] {
  const seen = new Set<number>();
  return rota.filter((a) => {
    if (a.status === 'declined' || (it.role_id && a.role_id !== it.role_id) || seen.has(a.person_id)) return false;
    seen.add(a.person_id);
    return true;
  });
}

/** Who leads the item, from the rota. */
export function itemLeaders(it: LeaderItem, rota: RotaEntry[]): RotaEntry[] {
  const pool = leaderPool(it, rota);
  const ticked = it.leader_people ? pool.filter((p) => it.leader_people!.includes(p.person_id)) : null;
  if (it.role_id) return ticked?.length ? ticked : pool;
  return ticked ?? [];
}

/** Who preaches: whoever leads the first sermon item that has someone. */
export function sermonLeaders(items: LeaderItem[], rota: RotaEntry[]): RotaEntry[] {
  for (const it of items) {
    if (it.kind !== 'sermon') continue;
    const who = itemLeaders(it, rota);
    if (who.length) return who;
  }
  return [];
}

export const joinNames = (people: { person_name: string }[]) => people.map((p) => p.person_name).join(', ');
