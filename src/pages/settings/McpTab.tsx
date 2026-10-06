// Settings → AI agents (MCP): what agents may do, who has connected, and the AI activity log.
import { SaveBar } from '../template-ui.tsx';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Empty, ErrorBox, Loading, Seg, confirmAction, useAction, useToast } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { FilterBar, Pager, useLogQuery, type Paged } from '../../components/LogTools.tsx';
import type { McpConfig, ModuleAccess, ModuleKey } from '../../types-client.ts';
import type { VisitorAccess } from '../../../shared/types.ts';
import { MODULES, MODULE_PARENT, READ_ONLY_MODULES, configuredAccess } from '../../types-client.ts';
import { InfoTip } from '../../components/InfoTip.tsx';
import { fmtStamp, PublicUrlField } from './common.tsx';
import { DateRange, KeepMonths } from './ChangeLogTab.tsx';
import '../people.css';
import '../presentation.css';

export type Tool = { name: string; module: ModuleKey; access: 'read' | 'write'; title: string; description: string; requires_pii: boolean };

export type Grant = {
  grant_id: string; client_id: string; client_name: string; user_id: number; user_name: string; scope: string;
  created_at: string | null; last_used_at: string | null; expires_at: string | null;
};

export type Audit = {
  id: number; at: string; user_id: number | null; client_id: string | null; tool: string; module: string | null; access: string | null;
  ok: number; args: string | null; error: string | null; user_name: string | null; client_name: string | null;
};

export const MOD_LABEL: Record<ModuleKey, string> = {
  members: 'Members register',
  coworkers: 'Co-workers',
  groups: 'Groups & committees',
  volunteers: 'Volunteers & rota',
  services: 'Services & planner',
  library: 'Library (hymns, texts, Bible)',
  templates: 'Templates',
  records: 'Service records',
  contributions: 'Offerings (contributions)',
  lending: 'Lending library',
  equipment: 'Asset register',
};

export const MOD_TIP: Partial<Record<ModuleKey, string>> = {
  records: 'Attendance and notes for the team, and the attendance report; new visitors as the Visitors switch below says. With Read & write, agents may record attendance, notes and (when Visitors is on) visitors — never money.',
  lending: 'The catalogue and its copies, who has what on loan and what is overdue. With Read & write, agents may add books and copies (e.g. from a list of ISBNs) — not lend or return.',
  equipment: 'The asset register and its maintenance log. With Read & write, agents may add or update items and record maintenance.',
  contributions: 'Offerings and cash counts, and the offerings report. Part of Service records: needs it switched on. Always read only: agents never change money, sign or verify a count. Read-only accounts never see offerings.',
};

export const toolExposed = (tool: Tool, level: ModuleAccess, pii: boolean) =>
  level !== 'off' && (tool.access === 'read' || level === 'write') && (!tool.requires_pii || pii);

export function McpTab() {
  const { t } = useI18n();
  const toast = useToast();
  const cfg = useApi<McpConfig>('/mcp/config');
  const endpoint = useApi<EndpointInfo>('/mcp/endpoint');
  const tools = useApi<Tool[]>('/mcp/tools');
  const [d, setD] = useState<McpConfig | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const { run, busy } = useAction();
  useEffect(() => {
    if (cfg.data) setD(cfg.data);
  }, [cfg.data]);
  const dirty = useMemo(() => !!d && !!cfg.data && JSON.stringify(d) !== JSON.stringify(cfg.data), [d, cfg.data]);

  if (cfg.error) return <ErrorBox error={cfg.error} />;
  if (!d) return <Loading />;

  const save = async () => {
    const r = await run(() => api.put<McpConfig>('/mcp/config', d), t('Saved.'));
    if (r) cfg.setData(r);
  };
  // the server switch takes effect at once (the module levels below are reviewed and saved together)
  const setEnabled = async (enabled: boolean) => {
    if (!cfg.data) return;
    if (!enabled && !confirmAction(t('Turn the MCP server off? Every connected AI assistant loses access until you turn it on again.'))) return;
    const r = await run(() => api.put<McpConfig>('/mcp/config', { ...cfg.data!, enabled }), enabled ? t('The MCP server is on.') : t('The MCP server is off.'));
    if (r) {
      cfg.setData(r);
      setD((x) => x && { ...x, enabled: r.enabled });
    }
  };
  const copy = async (s: string) => {
    try {
      await navigator.clipboard.writeText(s);
      toast(t('Copied.'));
    } catch {
      window.prompt(t('Copy'), s);
    }
  };
  const pii = d.expose_member_pii && configuredAccess('members', d.modules) !== 'off';
  const visible = (tools.data ?? []).filter((x) => toolExposed(x, d.enabled ? configuredAccess(x.module, d.modules) : 'off', pii)).length;

  return (
    <div className="stack">
      <div className="callout lapis">
        {t('Canon can be connected to Claude (claude.ai) as a custom connector so an AI assistant can help plan services and rotas. You decide exactly which parts of the church’s data it may see or change. Each agent acts as the user who approved it: viewers only ever get read access.')}
      </div>

      <div className="card stack">
        <label className="switch">
          <input type="checkbox" checked={d.enabled} disabled={busy} onChange={(e) => void setEnabled(e.target.checked)} />
          <strong>{t('Enable MCP server')}</strong>
          <span className={`badge ${d.enabled ? 'ok' : ''}`}>{d.enabled ? t('On') : t('Off')}</span>
        </label>
        <div>
          <h3 className="sect">{t('Connector URL')}</h3>
          {endpoint.data ? (
            <div className="endpoint">
              <span className="code">{endpoint.data.url}</span>
              <button className="btn sm" onClick={() => copy(endpoint.data!.url)}><Icon name="copy" />{t('Copy')}</button>
            </div>
          ) : endpoint.error ? <ErrorBox error={endpoint.error} /> : <Loading />}
        </div>
        {endpoint.data && <PublicUrlField info={endpoint.data} onSaved={endpoint.reload} />}
        <div className="small">
          <strong>{t('To connect in claude.ai')}</strong>
          <ol className="steps">
            <li>{t('Settings → Connectors → Add custom connector.')}</li>
            <li>{t('Paste the connector URL above. Leave the client ID and secret blank.')}</li>
            <li>{t('Sign in to Canon when asked and approve the access.')}</li>
          </ol>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>{t('Module access')}</h2>
          <span className="muted small">{visible} {t('tools available to agents')}</span>
        </div>
        {!d.enabled && <div className="callout small" style={{ marginBottom: 8 }}>{t('The MCP server is off — no tools are available until you enable it.')}</div>}
        {MODULES.map((m) => {
          const parent = MODULE_PARENT[m];
          const parentOff = !!parent && configuredAccess(parent, d.modules) === 'off';
          const readOnly = READ_ONLY_MODULES.includes(m);
          const level = configuredAccess(m, d.modules);
          const mt = (tools.data ?? []).filter((x) => x.module === m);
          const on = mt.filter((x) => toolExposed(x, level, pii)).length;
          return (
            <div key={m} className={`mod-row${parent ? ' nested' : ''}`}>
              <div className="row between">
                <div>
                  <strong>{t(MOD_LABEL[m])}</strong>
                  {MOD_TIP[m] && <InfoTip text={t(MOD_TIP[m]!)} />}
                  {parentOff && <span className="small muted"> · {t('switch on {m} first').replace('{m}', t(MOD_LABEL[parent!]))}</span>}
                  <button className="btn ghost sm" onClick={() => setOpen({ ...open, [m]: !open[m] })} aria-expanded={!!open[m]}>
                    <Icon name={open[m] ? 'chevronDown' : 'chevronRight'} />{on}/{mt.length} {t('tools')}
                  </button>
                </div>
                {parentOff ? <span className="badge">{t('Off')}</span> : (
                  <Seg<ModuleAccess> value={level} onChange={(v) => setD((x) => x && { ...x, modules: { ...x.modules, [m]: v } })}
                    options={[{ value: 'off', label: t('Off') }, { value: 'read', label: t('Read only') }, ...(readOnly ? [] : [{ value: 'write' as const, label: t('Read & write') }])]} />
                )}
              </div>
              {m === 'members' && (
                <div className="mod-row nested">
                  <div className="row between">
                    <div>
                      <strong>{t('Contact details & birthdays')}</strong>
                      <InfoTip text={t('PDPA: while this is off, members’ phone numbers, e-mail and home addresses, birth dates, notes and reasons for absence — and co-workers’ and households’ contact details — are withheld from everything an AI agent receives, and the birthday tool is hidden. Turn it on only if the church has consent to share them with the AI provider.')} />
                      <div className="small muted">{t('Members, co-workers and households')}</div>
                    </div>
                    {level === 'off' ? <span className="badge">{t('Off')}</span> : (
                      <Seg<'off' | 'on'> value={d.expose_member_pii ? 'on' : 'off'} onChange={(v) => setD((x) => x && { ...x, expose_member_pii: v === 'on' })}
                        options={[{ value: 'off', label: t('Off') }, { value: 'on', label: t('Shared') }]} />
                    )}
                  </div>
                </div>
              )}
              {m === 'records' && (
                <div className="mod-row nested">
                  <div className="row between">
                    <div>
                      <strong>{t('Visitors')}</strong>
                      <InfoTip text={t('New visitors on service records. Off: attendance numbers only. Names & follow-up: names, how they came and follow-up (with Read & write, agents may record visitors and update follow-up). With contact details: also phone, e-mail and prayer requests — only if the church has visitors’ consent to share them with the AI provider. Details the keep period erased stay gone.')} />
                    </div>
                    {level === 'off' ? <span className="badge">{t('Off')}</span> : (
                      <Seg<VisitorAccess> value={d.visitors ?? 'names'} onChange={(v) => setD((x) => x && { ...x, visitors: v })}
                        options={[{ value: 'off', label: t('Off') }, { value: 'names', label: t('Names & follow-up') }, { value: 'contact', label: t('With contact details') }]} />
                    )}
                  </div>
                </div>
              )}
              {open[m] && (
                <div className="tool-list">
                  {mt.map((x) => {
                    const ex = toolExposed(x, level, pii);
                    return (
                      <div key={x.name} className={`tool${ex ? '' : ' off'}`}>
                        <Icon name={ex ? 'check' : 'x'} style={{ color: ex ? 'var(--ok)' : 'var(--ink-3)' }} />
                        <div>
                          <span className="tname">{x.name}</span>{' '}
                          <span className={`badge ${x.access === 'write' ? 'warn' : ''}`}>{x.access === 'write' ? t('write') : t('read')}</span>
                          {x.requires_pii && <span className="badge danger" style={{ marginLeft: 4 }}>{t('personal data')}</span>}
                          <div className="muted"><strong>{x.title}</strong> — {x.description}</div>
                        </div>
                      </div>
                    );
                  })}
                  {!mt.length && <span className="muted small">{tools.error ?? t('No tools.')}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <SaveBar dirty={dirty} busy={busy} onSave={save} onDiscard={() => cfg.data && setD(cfg.data)}
        message={t('AI access changes are not saved yet: assistants still see the saved settings.')} saveLabel={t('Save AI access')} className="mcp-savebar" />

      <GrantsCard />
      <AuditCard />
    </div>
  );
}

export function GrantsCard() {
  const { t, lang } = useI18n();
  const { data, error, loading, reload } = useApi<Grant[]>('/mcp/grants');
  const { run, busy } = useAction();
  const revoke = async (g: Grant) => {
    if (!confirmAction(`${t('Revoke access for')} ${g.client_name}?`)) return;
    if (await run(() => api.del(`/mcp/grants/${encodeURIComponent(g.grant_id)}`), t('Revoked.'))) reload();
  };
  return (
    <div className="card flush">
      <div className="card-head" style={{ padding: '14px 16px 0' }}><h2>{t('Connected agents')}</h2></div>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : !data?.length ? <Empty title={t('No agents are connected.')} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('Client')}</th><th>{t('User')}</th><th>{t('Access')}</th><th>{t('Connected')}</th><th>{t('Last used')}</th><th>{t('Expires')}</th><th /></tr></thead>
            <tbody>
              {data.map((g) => (
                <tr key={g.grant_id}>
                  <td className="nowrap"><Icon name="bot" width={14} height={14} style={{ verticalAlign: -2 }} /> {g.client_name}</td>
                  <td className="nowrap">{g.user_name}</td>
                  <td>{g.scope.split(' ').map((s) => <span key={s} className={`badge ${s.endsWith('write') ? 'warn' : ''}`} style={{ marginRight: 4 }}>{s.replace('canon:', '')}</span>)}</td>
                  <td className="nowrap small">{fmtStamp(g.created_at, lang)}</td>
                  <td className="nowrap small">{fmtStamp(g.last_used_at, lang)}</td>
                  <td className="nowrap small">{fmtStamp(g.expires_at, lang)}</td>
                  <td className="right"><button className="btn sm danger" onClick={() => revoke(g)} disabled={busy}>{t('Revoke')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export type AuditFilters = { module: string; user: string; client: string; tool: string; result: string; from: string; to: string; q: string };

export type AuditPage = Paged<Audit> & { facets: { users: { id: number; name: string }[]; clients: { id: string; name: string }[]; tools: string[] } };

export function AuditCard() {
  const { t, lang } = useI18n();
  const log = useLogQuery<Audit, AuditFilters>('/mcp/audit', { module: '', user: '', client: '', tool: '', result: '', from: '', to: '', q: '' });
  const { error, loading, reload, filters: f, set } = log;
  const data = log.data as AuditPage | undefined;
  const rows = data?.rows ?? [];
  return (
    <div className="card flush">
      <div className="card-head" style={{ padding: '14px 16px 0' }}>
        <h2>{t('Activity log')}</h2>
        <div className="row">
          <KeepMonths which="mcp_audit_months" />
          <button className="btn ghost sm icon" onClick={reload} aria-label={t('Refresh')} title={t('Refresh')}><Icon name="refresh" /></button>
        </div>
      </div>
      <FilterBar active={log.active} onClear={log.clear} csv={`/api/mcp/audit.csv${log.exportQuery}`}>
        <select className="mini" value={f.module} onChange={(e) => set('module', e.target.value)} aria-label={t('Module')}>
          <option value="">{t('All modules')}</option>
          {MODULES.map((m) => <option key={m} value={m}>{t(MOD_LABEL[m])}</option>)}
        </select>
        <select className="mini" value={f.user} onChange={(e) => set('user', e.target.value)} aria-label={t('User')}>
          <option value="">{t('All users')}</option>
          {data?.facets.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select className="mini" value={f.client} onChange={(e) => set('client', e.target.value)} aria-label={t('Client')}>
          <option value="">{t('All clients')}</option>
          {data?.facets.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="mini" value={f.tool} onChange={(e) => set('tool', e.target.value)} aria-label={t('Tool')}>
          <option value="">{t('All tools')}</option>
          {data?.facets.tools.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select className="mini" value={f.result} onChange={(e) => set('result', e.target.value)} aria-label={t('Result')}>
          <option value="">{t('OK and errors')}</option>
          <option value="ok">{t('OK')}</option>
          <option value="error">{t('Errors only')}</option>
        </select>
        <DateRange from={f.from} to={f.to} onFrom={(v) => set('from', v)} onTo={(v) => set('to', v)} />
        <input className="mini" type="search" placeholder={t('Search arguments…')} value={f.q} onChange={(e) => set('q', e.target.value)} style={{ width: 170 }} />
      </FilterBar>
      {error && <ErrorBox error={error} />}
      {loading && !data ? <Loading /> : !rows.length ? <Empty title={log.active ? t('Nothing matches these filters.') : t('No AI activity yet.')} /> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>{t('Time')}</th><th>{t('User')}</th><th>{t('Client')}</th><th>{t('Tool')}</th><th>{t('Module')}</th><th>{t('Result')}</th><th>{t('Arguments')}</th></tr></thead>
            <tbody>
              {rows.map((a) => (
                <Fragment key={a.id}>
                  <tr>
                    <td className="nowrap small">{fmtStamp(a.at, lang)}</td>
                    <td className="nowrap">{a.user_name ?? '—'}</td>
                    <td className="nowrap">{a.client_name ?? a.client_id ?? '—'}</td>
                    <td className="nowrap"><span className="code">{a.tool}</span></td>
                    <td className="nowrap small">{a.module ? t(MOD_LABEL[a.module as ModuleKey] ?? a.module) : '—'}</td>
                    <td>{a.ok ? <span className="badge ok">{t('OK')}</span> : <span className="badge danger" title={a.error ?? ''}>{t('Error')}</span>}</td>
                    <td><span className="code args" title={a.args ?? ''}>{a.args ?? ''}</span>{!a.ok && a.error && <div className="small" style={{ color: 'var(--danger)' }}>{a.error}</div>}</td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > 0 && <div style={{ padding: '0 16px 12px' }}><Pager page={data.page} size={data.size} total={data.total} onPage={log.setPage} /></div>}
    </div>
  );
}

export interface EndpointInfo { url: string; public_url_set: boolean; public_url: string; trust_proxy: boolean; env_override: boolean }
