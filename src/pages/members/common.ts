// Members: types and labels shared by the member pages.
import type { Coworker, Household, L10n, Person, Unavailability } from '../../types-client.ts';

export type HouseholdWithMembers = Household & { members: Person[] };

export type PersonDetail = Person & {
  coworker: Coworker[];
  roles: number[];
  schedule: { service_id: number; date: string; start_time: string; title: L10n; role_name: L10n; status: string }[];
  unavailability: Unavailability[];
};

export const HH_ROLES = ['head', 'spouse', 'child', 'other'] as const;

export type HhRole = (typeof HH_ROLES)[number];

export const HH_ROLE_LABEL: Record<HhRole, string> = { head: 'Head', spouse: 'Spouse', child: 'Child', other: 'Other' };

export const CAT_LABEL: Record<string, string> = {
  pastor: 'Pastor', elder: 'Elder', deacon: 'Deacon', ministry_staff: 'Ministry staff', admin_staff: 'Admin staff', lay_leader: 'Lay leader',
};

export const ASSIGN_LABEL: Record<string, string> = { scheduled: 'Scheduled', confirmed: 'Confirmed', declined: 'Declined' };
