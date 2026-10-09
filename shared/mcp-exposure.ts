// Which AI tools a church offers (Settings → AI / MCP), in one place for the server and the settings screen (0.20.0:
// the screen kept its own copy of the rule, which missed Settings → Modules and the tool that is always offered).
// The server then lowers each module's level further by the connection's scope and the person's role
// (server/lib/mcp-access.ts).
import { configuredAccess, type McpConfig, type ModuleAccess, type ModuleKey } from './types.ts';
import type { ModuleSwitches, OptionalModule } from './modules.ts';

/** AI modules that are also parts of Canon a church can switch off (Settings → Modules): off there, off for agents. */
export const MODULE_SWITCH: Partial<Record<ModuleKey, OptionalModule>> = { volunteers: 'volunteers', lending: 'lending', equipment: 'equipment', bookkeeping: 'bookkeeping' };

export const isSwitchedOff = (s: OptionalModule | undefined, switches: Partial<ModuleSwitches> | undefined) => !!s && switches?.[s] === false;

/** The most a module can be on any connection: the administrator's level, unless MCP or that part of Canon is off. */
export function churchLevel(module: ModuleKey, cfg: McpConfig, switches: Partial<ModuleSwitches> | undefined): ModuleAccess {
  if (!cfg.enabled || isSwitchedOff(MODULE_SWITCH[module], switches)) return 'off';
  return configuredAccess(module, cfg.modules);
}

/** Members' personal data is shared with agents (before the role's own limit). */
export const piiShared = (cfg: McpConfig) => !!cfg.expose_member_pii && configuredAccess('members', cfg.modules) !== 'off';
/** Songs' sheet music is shared with agents. */
export const scoresShared = (cfg: McpConfig) => !!cfg.sheet_music && configuredAccess('library', cfg.modules) !== 'off';

export interface ToolShape {
  access: 'read' | 'write';
  /** offered on every connection while MCP is on (canon_whoami) */
  always?: boolean;
  /** a part of Canon it needs besides its module (the calendar: meetings) */
  switch?: OptionalModule;
  requires_pii?: boolean;
  requires_scores?: boolean;
}

/** Is a tool offered, given its module's level on the connection and whether personal data and sheet music are shared? */
export function toolOffered(t: ToolShape, level: ModuleAccess, pii: boolean, scores: boolean, enabled: boolean, switches: Partial<ModuleSwitches> | undefined): boolean {
  if (t.always) return enabled;
  if (isSwitchedOff(t.switch, switches)) return false;
  if (level === 'off' || (t.access === 'write' && level !== 'write')) return false;
  if (t.requires_scores && !scores) return false;
  return !t.requires_pii || pii;
}
