// Type-only re-exports of server shapes used by the client (erased at build time).
export type { Settings, PaperSize } from '../server/repo/settings.ts';
export type { RenderedService, RenderedItem, Paras, Line } from '../shared/render-types.ts';
export * from '../shared/types.ts';

import type { Person, Coworker, Team, ServiceRole, Service, Unavailability } from '../shared/types.ts';

/** `birthday` (MM-DD) replaces `birth_date` for read-only accounts: no year, no age */
export type PersonRow = Person & { household_name: string | null; birthday?: string };
export type CoworkerRow = Coworker & { person_name: string; phone: string | null; email: string | null };
export type RoleWithMembers = ServiceRole & { members: { person_id: number; name: string }[] };
export type TeamWithRoles = Team & { roles: RoleWithMembers[] };
export type ServiceListRow = Service & { item_count: number; assigned_count: number };
export type RosterWarning = { type: 'unavailable' | 'double_booked' | 'unfilled'; message: string; role_id?: number; person_id?: number };
export interface Rota {
  services: { id: number; date: string; start_time: string; title: import('../shared/types.ts').L10n; status: string }[];
  teams: TeamWithRoles[];
  assignments: { id: number; service_id: number; role_id: number; person_id: number; status: string; person_name: string }[];
  unavailability: (Unavailability & { person_name: string })[];
}
