// The OAuth pages people see when connecting an AI agent: the consent page and the error pages (plain HTML).
import type { Response } from 'express';
import type { ModuleAccess, ModuleKey, Role } from '../shared/types.ts';
import { MODULES, configuredAccess } from '../shared/types.ts';
import type { User } from './auth.ts';
import { getSettings } from './repo/settings.ts';
import type { ValidAuthz } from './oauth.ts';

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

export function page(res: Response, status: number, title: string, body: string) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'",
  );
  res.send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${esc(title)}</title><style>${CSS}</style></head><body><main><div class="card">${body}</div></main></body></html>`,
  );
}

export function errorPage(res: Response, status: number, en: string, zh: string, detail?: string) {
  page(
    res,
    status,
    'Authorization error',
    `<h1 class="err">Authorization error <span class="zh">授权错误</span></h1><p>${esc(en)}<br><span class="zh">${esc(zh)}</span></p>` +
      (detail ? `<p class="muted">${esc(detail)}</p>` : '') +
      `<p class="muted">You can close this window. 您可以关闭此窗口。</p>`,
  );
}

export const MODULE_LABEL: Record<ModuleKey, [string, string]> = {
  members: ['Members register', '会友名册'],
  coworkers: ['Co-workers register', '同工名册'],
  groups: ['Groups & committees', '小组与委员会'],
  volunteers: ['Volunteer rota', '义工轮值'],
  services: ['Service planner', '聚会程序'],
  library: ['Song & liturgy library', '诗歌与礼文库'],
  templates: ['Service templates', '聚会模板'],
  records: ['Service records (attendance, visitors, notes)', '聚会记录（出席、新朋友、备注）'],
  contributions: ['Offerings and cash counts', '奉献与现金点算'],
  lending: ['Lending library', '图书馆'],
  equipment: ['Asset register', '资产登记'],
};

export const ACCESS_LABEL: Record<ModuleAccess, [string, string]> = {
  off: ['Hidden', '隐藏'],
  read: ['Read only', '只读'],
  write: ['Read & edit', '读写'],
};

export const SCOPE_LABEL: Record<string, [string, string]> = {
  'canon:read': ['View Canon data in the modules listed below', '查看以下所列模块中的资料'],
  'canon:write': ['Create and change data in modules set to “Read & edit”', '在设为“读写”的模块中新增和修改资料'],
};

export const ROLE_LABEL: Record<Role, string> = { admin: 'administrator 管理员', editor: 'editor 编辑', viewer: 'viewer 只读用户' };

export function consentPage(res: Response, a: ValidAuthz, user: User & { csrf: string }) {
  const s = getSettings().mcp;
  const host = (() => {
    try {
      const u = new URL(a.redirect_uri);
      return u.host || u.protocol;
    } catch {
      return a.redirect_uri;
    }
  })();
  const canWrite = a.scopes.includes('canon:write');
  const rows = MODULES.map((m) => {
    let lvl = configuredAccess(m, s.modules);
    const capped = lvl === 'write' && !canWrite;
    if (capped) lvl = 'read';
    const [en, zh] = MODULE_LABEL[m];
    const [aen, azh] = ACCESS_LABEL[lvl];
    return `<tr><td>${esc(en)} <span class="zh">${esc(zh)}</span></td><td class="l ${lvl}">${esc(aen)} ${esc(azh)}${capped ? ' *' : ''}</td></tr>`;
  }).join('');
  const piiRow = `<tr><td>Member contact details, addresses &amp; birthdays <span class="zh">会友联系资料、地址与生日</span></td>` +
    `<td class="l ${s.expose_member_pii ? 'write' : 'off'}">${s.expose_member_pii ? 'Shared 提供' : 'Hidden 隐藏'}</td></tr>`;
  const hidden = (n: string, v: string | null | undefined) => `<input type="hidden" name="${n}" value="${esc(v ?? '')}">`;
  page(
    res,
    200,
    'Authorize access — Canon',
    `<h1>Connect an AI app to Canon <span class="zh">授权 AI 应用连接 Canon</span></h1>
<p class="muted">The application below is asking to access Canon on your behalf. 以下应用请求代表您访问 Canon。</p>
<p style="margin:14px 0 0"><b>${esc(a.client.client_name || 'Unnamed client')}</b></p>
<div class="warn">This name was supplied by the application itself and has not been verified. Check where access will be sent below.<br>
<span class="zh">此名称由应用自行提供，未经验证。请核对下方的回传地址。</span></div>
<div class="muted">Access will be sent to 授权将发送至</div>
<div class="host">${esc(host)}</div>
<div class="uri">${esc(a.redirect_uri)}</div>
<h2>It will be able to 它将能够</h2>
<ul>${a.scopes.map((sc) => `<li>${esc(SCOPE_LABEL[sc][0])}<br><span class="zh">${esc(SCOPE_LABEL[sc][1])}</span></li>`).join('')}</ul>
<h2>Modules currently exposed 当前开放的模块</h2>
<table>${rows}${piiRow}</table>
${!canWrite ? '<p class="muted">* Limited to read only for this connection. 此连接仅限只读。</p>' : ''}
<p class="muted">An administrator controls these levels in <b>Settings → AI / MCP</b>; changes apply immediately, and access can be revoked there at any time.<br>
<span class="zh">管理员可在“设置 → AI / MCP”中调整以上权限（即时生效），并可随时撤销此授权。</span></p>
<p class="muted">Signed in as 当前登录：<b>${esc(user.display_name)}</b> (${esc(ROLE_LABEL[user.role])})</p>
<form method="post" action="/oauth/authorize">
${hidden('client_id', a.client.client_id)}${hidden('redirect_uri', a.redirect_uri)}${hidden('state', a.state)}
${hidden('scope', a.scopes.join(' '))}${hidden('code_challenge', a.code_challenge)}${hidden('code_challenge_method', 'S256')}
${hidden('resource', a.resource)}${hidden('response_type', 'code')}${hidden('csrf', user.csrf)}
<div class="btns"><button type="submit" name="decision" value="deny">Deny 拒绝</button>
<button type="submit" name="decision" value="allow" class="allow">Allow 允许</button></div>
</form>`,
  );
}

export function disabledPage(res: Response) {
  page(
    res,
    503,
    'AI access is turned off — Canon',
    `<h1>AI access is turned off <span class="zh">AI 访问已关闭</span></h1>
<p>Connecting AI apps (MCP) is currently disabled for this Canon installation. An administrator can enable it in <b>Settings → AI / MCP</b>.</p>
<p class="zh">此 Canon 系统目前未开放 AI 应用（MCP）连接。管理员可在“设置 → AI / MCP”中开启。</p>`,
  );
}

// ---------------------------------------------------------------- authorize
