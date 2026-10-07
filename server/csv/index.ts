// Registry of CSV entities (one declarative spec per kind of data). See server/csv/engine.ts.
import type { Entity } from './engine.ts';
import { members } from './members.ts';
import { coworkers } from './coworkers.ts';
import { groupsCsv } from './groups.ts';
import { teamMembersCsv, unavailabilityCsv } from './volunteers.ts';
import { hymnalIndexCsv, songsCsv, textsCsv } from './library.ts';
import { templatesCsv } from './templates.ts';
import { booksCsv, equipmentCsv } from './resources.ts';

export const CSV_ENTITIES: Record<string, Entity> = Object.fromEntries(
  [members, coworkers, groupsCsv, teamMembersCsv, unavailabilityCsv, songsCsv, textsCsv, templatesCsv, hymnalIndexCsv, booksCsv, equipmentCsv].map((e) => [e.key, e]),
);

export { runImport, templateCsv, exportCsv, templateRows, exportRows, guide, makeCtx, ImportBlocked, RowError, say } from './engine.ts';
export type { Entity, Preview } from './engine.ts';
