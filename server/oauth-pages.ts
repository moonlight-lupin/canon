// The OAuth pages people see when connecting an AI agent: the consent page and the error pages (plain HTML).
// The consent page is in the signed-in person's own language (English underneath); the error pages in the church's
// languages. The wording is in locales/<code>/server.json (server/lib/server-text.ts).
import type { Response } from 'express';
import type { ModuleAccess, ModuleKey } from '../shared/types.ts';
import { MODULES, configuredAccess } from '../shared/types.ts';
import { effectiveAccess, piiFor, visitorsFor } from './lib/mcp-access.ts';
import { roleDef } from './lib/permissions.ts';
import type { User } from './auth.ts';
import { getSettings } from './repo/settings.ts';
import type { ValidAuthz } from './oauth.ts';
import { st } from './lib/server-text.ts';
import { langInfo } from '../shared/languages.ts';

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const CSS = `
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f4f5f7;color:#1f2933}
main{max-width:560px;margin:24px auto;padding:0 16px}.card{background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:22px}
h1{font-size:1.3rem;margin:0 0 4px}.zh{color:#52606d;font-size:.95em}.muted{color:#616e7c;font-size:.9rem}
.host{font-size:1.25rem;font-weight:700;word-break:break-all;margin:6px 0 2px}.uri{font:12px/1.4 ui-monospace,Consolas,monospace;color:#616e7c;word-break:break-all}
.warn{background:#fff8e6;border:1px solid #f5d48a;border-radius:8px;padding:8px 10px;font-size:.88rem;margin:10px 0}
h2{font-size:.95rem;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.03em;color:#52606d}
ul{margin:0;padding-left:20px}li{margin:3px 0}table{width:100%;border-collapse:collapse;font-size:.92rem}
td{padding:5px 4px;border-bottom:1px solid #eef0f2;vertical-align:top}td.l{text-align:right;white-space:nowrap}
.off{color:#9aa5b1}.read{color:#2f6f3e}.write{color:#9a4d00;font-weight:600}
.btns{display:flex;gap:10px;margin-top:20px}button{flex:1;font:inherit;font-weight:600;padding:12px;border-radius:8px;border:1px solid #cbd2d9;background:#fff;cursor:pointer}
button.allow{background:#1f5fbf;border-color:#1f5fbf;color:#fff}.err{color:#b42318}
`;

export function page(res: Response, status: number, title: string, body: string, lang = 'en') {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'",
  );
  res.send(
    `<!doctype html><html lang="${langInfo(lang).htmlLang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${esc(title)}</title><style>${CSS}</style></head><body><main><div class="card">${body}</div></main></body></html>`,
  );
}

/** The languages a page is in: the person's (or the church's) first, English last, each once. */
function pageLangs(first: string[]): string[] {
  const L = [...new Set([...first.filter((l) => l !== 'en'), 'en'])];
  return L.slice(0, 2);
}
/** A phrase in the page's languages: the first plainly, the second smaller after it. */
const bi = (en: string, L: string[], sep = ' ') => {
  const u = [...new Set(L.map((l) => st(en, l)))];
  return u.map((x, i) => (i ? `<span class="zh">${esc(x)}</span>` : esc(x))).join(sep);
};

export function errorPage(res: Response, status: number, en: string, detail?: string) {
  const L = pageLangs(getSettings().languages);
  page(
    res,
    status,
    st('Authorization error', L[0]),
    `<h1 class="err">${bi('Authorization error', L)}</h1><p>${bi(en, L, '<br>')}</p>` +
      (detail ? `<p class="muted">${esc(detail)}</p>` : '') +
      `<p class="muted">${bi('You can close this window.', L)}</p>`,
    L[0],
  );
}

// the English wording (translations: locales/<code>/server.json)
export const MODULE_LABEL: Record<ModuleKey, string> = {
  members: 'Members register',
  coworkers: 'Co-workers register',
  groups: 'Groups & committees',
  volunteers: 'Volunteer rota',
  services: 'Service planner',
  library: 'Song & liturgy library',
  templates: 'Service templates',
  records: 'Service records (attendance, visitors, notes)',
  contributions: 'Offerings and cash counts',
  lending: 'Lending library',
  equipment: 'Asset register',
  bookkeeping: 'Book-keeping (drafts only)',
  admin: 'Administration (checklist, backups, accounts, logs)',
};

export const ACCESS_LABEL: Record<ModuleAccess, string> = { off: 'Hidden', read: 'Read only', write: 'Read & edit' };

export const SCOPE_LABEL: Record<string, string> = {
  'canon:read': 'View Canon data in the modules listed below',
  'canon:write': 'Create and change data in modules set to “Read & edit”',
};

export function consentPage(res: Response, a: ValidAuthz, user: User & { csrf: string }) {
  const s = getSettings().mcp;
  const L = pageLangs([user.lang ?? 'en']);
  const host = (() => {
    try {
      const u = new URL(a.redirect_uri);
      return u.host || u.protocol;
    } catch {
      return a.redirect_uri;
    }
  })();
  const canWrite = a.scopes.includes('canon:write');
  // what this connection will really reach: the administrator's levels, Settings → Modules, the scope asked for and
  // this person's role — the same rule the MCP server applies on every call (0.20.0: the page showed the
  // administrator's levels only, so a read-only account was shown "Read & edit")
  const scopes = new Set(a.scopes);
  const rows = MODULES.map((m) => {
    const lvl = effectiveAccess(m, s, scopes, user.role);
    const capped = lvl === 'read' && !canWrite && configuredAccess(m, s.modules) === 'write' && effectiveAccess(m, s, new Set(['canon:read', 'canon:write']), user.role) === 'write';
    return `<tr><td>${bi(MODULE_LABEL[m], L)}</td><td class="l ${lvl}">${bi(ACCESS_LABEL[lvl], L)}${capped ? ' *' : ''}</td></tr>`;
  }).join('');
  const piiOn = piiFor(s, user.role);
  const vis = visitorsFor(s, user.role);
  const VIS: Record<string, [string, string]> = { off: ['Hidden', 'off'], names: ['Names & follow-up', 'read'], contact: ['With contact details', 'write'] };
  const piiRow = `<tr><td>${bi('Member contact details, addresses & birthdays', L)}</td>` +
    `<td class="l ${piiOn ? 'write' : 'off'}">${bi(piiOn ? 'Shared' : 'Hidden', L)}</td></tr>` +
    `<tr><td>${bi('New visitors', L)}</td><td class="l ${VIS[vis][1]}">${bi(VIS[vis][0], L)}</td></tr>`;
  const hidden = (n: string, v: string | null | undefined) => `<input type="hidden" name="${n}" value="${esc(v ?? '')}">`;
  page(
    res,
    200,
    `${st('Connect an AI app to Canon', L[0])} — Canon`,
    `<h1>${bi('Connect an AI app to Canon', L)}</h1>
<p class="muted">${bi('The application below is asking to access Canon on your behalf.', L)}</p>
<p style="margin:14px 0 0"><b>${esc(a.client.client_name || 'Unnamed client')}</b></p>
<div class="warn">${bi('This name was supplied by the application itself and has not been verified. Check where access will be sent below.', L, '<br>')}</div>
<div class="muted">${bi('Access will be sent to', L)}</div>
<div class="host">${esc(host)}</div>
<div class="uri">${esc(a.redirect_uri)}</div>
<h2>${bi('It will be able to', L)}</h2>
<ul>${a.scopes.map((sc) => `<li>${bi(SCOPE_LABEL[sc], L, '<br>')}</li>`).join('')}</ul>
<h2>${bi('Modules currently exposed', L)}</h2>
<table>${rows}${piiRow}</table>
${!canWrite ? `<p class="muted">* ${bi('Limited to read only for this connection.', L)}</p>` : ''}
<p class="muted">${bi('An administrator controls these levels in Settings → AI / MCP; changes apply immediately, and access can be revoked there at any time.', L, '<br>')}</p>
<p class="muted">${bi('Signed in as', L)}: <b>${esc(user.display_name)}</b> (${esc(roleName(user.role, L))})</p>
<form method="post" action="/oauth/authorize">
${hidden('client_id', a.client.client_id)}${hidden('redirect_uri', a.redirect_uri)}${hidden('state', a.state)}
${hidden('scope', a.scopes.join(' '))}${hidden('code_challenge', a.code_challenge)}${hidden('code_challenge_method', 'S256')}
${hidden('resource', a.resource)}${hidden('response_type', 'code')}${hidden('csrf', user.csrf)}
<div class="btns"><button type="submit" name="decision" value="deny">${bi('Deny', L)}</button>
<button type="submit" name="decision" value="allow" class="allow">${bi('Allow', L)}</button></div>
</form>`,
    L[0],
  );
}

/** A role's name in the page's first language (the church's own roles too), else in English. */
const roleName = (role: string, L: string[]) => {
  const n = roleDef(role).name as Record<string, string | undefined>;
  return L.map((l) => n[l]).find(Boolean) ?? n.en ?? role;
};

export function disabledPage(res: Response) {
  const L = pageLangs(getSettings().languages);
  page(
    res,
    503,
    `${st('AI access is turned off', L[0])} — Canon`,
    `<h1>${bi('AI access is turned off', L)}</h1>
<p>${bi('Connecting AI apps (MCP) is currently disabled for this Canon installation. An administrator can enable it in Settings → AI / MCP.', L, '</p><p class="zh">')}</p>`,
    L[0],
  );
}

// ---------------------------------------------------------------- authorize
