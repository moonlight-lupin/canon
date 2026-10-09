// Who may see what over an AI connection (MCP): one rule for the tools, the playbooks, canon_whoami, the server's
// instructions, the consent page and the settings screen. The effective level of a module is the lowest of the
// administrator's setting (Settings → AI / MCP), Settings → Modules (a part switched off is off), the connection's
// scope and the person's role. Kept apart from server/mcp.ts so the OAuth pages can use it too.
import { configuredAccess } from '../../shared/types.ts';
import type { McpConfig, ModuleAccess, ModuleKey, Role, VisitorAccess } from '../../shared/types.ts';
import type { OptionalModule } from '../../shared/modules.ts';
import type { PermModule } from '../../shared/permissions.ts';
import { MODULE_SWITCH, churchLevel, isSwitchedOff, piiShared, scoresShared } from '../../shared/mcp-exposure.ts';
import { getSettings } from '../repo/settings.ts';
import { roleDef } from './permissions.ts';

/**
 * A part of Canon switched off (Settings → Modules) is 'off' in every connection's access levels, so its tools, the
 * playbooks that need it, canon_whoami and the server instructions all follow from one rule (Daedalus Workshop study of
 * 0.19.10: tools were hidden by name, playbooks not). The rule itself is shared with the settings screen.
 */
export const switchOff = (s: OptionalModule | undefined) => isSwitchedOff(s, getSettings().modules);
export const switchedOff = (module: ModuleKey) => switchOff(MODULE_SWITCH[module]);

/** Members' personal data on this connection: the administrator shares it, and the person's role sees members' details. */
export const piiFor = (cfg: McpConfig, role: Role) => piiShared(cfg) && roleDef(role).member_details;
/** New visitors on service records: off with Service records, names only unless contact details are shared (and the role sees members' details). */
export function visitorsFor(cfg: McpConfig, role: Role): VisitorAccess {
  if (configuredAccess('records', cfg.modules) === 'off') return 'off';
  const v = cfg.visitors ?? 'names';
  return v === 'contact' && !roleDef(role).member_details ? 'names' : v;
}
/** Songs' sheet music: shared by the administrator, while the Library is shared. */
export const scoresFor = (cfg: McpConfig) => scoresShared(cfg);
/** The church's member fields marked sensitive: personal data is shared, and the role sees sensitive fields too. */
export const sensitiveFor = (cfg: McpConfig, role: Role) => piiFor(cfg, role) && roleDef(role).sensitive_fields;

/** What the person's role allows in a module (administrators: everything). */
export const roleAccess = (module: ModuleKey, role: Role) => (roleDef(role).admin ? 'edit' : roleDef(role).access[module as PermModule] ?? 'none');

/** Effective access to a module for this request = min(admin setting, Settings → Modules, token scope, user role). */
export function effectiveAccess(module: ModuleKey, cfg: McpConfig, scopes: Set<string>, role: Role, own = false): ModuleAccess {
  const setting = churchLevel(module, cfg, getSettings().modules);
  if (setting === 'off') return 'off';
  // as in the web app: the role decides (e.g. read-only accounts never see offerings) — except for a person's own
  // records, such as their expense claims, which anyone may make
  const ra = own ? 'edit' : roleAccess(module, role);
  if (ra === 'none') return 'off';
  if (!scopes.has('canon:read') && !scopes.has('canon:write')) return 'off';
  if (setting === 'write' && scopes.has('canon:write') && ra === 'edit') return 'write';
  return 'read';
}
