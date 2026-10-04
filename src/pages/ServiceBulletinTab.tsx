// Service planner → "Bulletin" tab: the weekly sections of the service's bulletin template (announcements first,
// then e.g. a pastor's note), typed per service and saved to service.bulletin_content (debounced PATCH).
// Services written before weekly sections existed kept their announcements in the Announcements item's body: that
// text is shown pre-filled here until it is saved (the item's body is never deleted automatically).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, ErrorBox, L10nInput, Loading, useSession, useToast } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { hasAnyText } from '../../shared/labels.ts';
import { ANNOUNCEMENTS_KEY, weeklySections, type BulletinTemplate } from '../../shared/presentation.ts';
import type { L10n, ServiceFull } from '../types-client.ts';

/** Drop empty languages and empty sections before saving. */
function tidy(c: Record<string, L10n>): Record<string, L10n> {
  const out: Record<string, L10n> = {};
  for (const [k, v] of Object.entries(c)) {
    const l = Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => x?.trim()));
    if (Object.keys(l).length) out[k] = l;
  }
  return out;
}

export function ServiceBulletinTab({ svc, canEdit, onContent }: { svc: ServiceFull; canEdit: boolean; onContent: (c: Record<string, L10n>) => void }) {
  const { t, lt } = useI18n();
  const { settings } = useSession();
  const toast = useToast();
  const { data: templates, error } = useApi<BulletinTemplate[]>('/bulletin-templates');
  // the template the service prints with: its own choice → the church default → "Full words booklet"
  const tpl = useMemo(() => {
    if (!templates) return null;
    return (
      templates.find((x) => x.id === svc.bulletin_template_id) ??
      templates.find((x) => x.id === settings?.default_bulletin_template_id) ??
      templates.find((x) => x.builtin === 'full') ??
      templates[0] ??
      null
    );
  }, [templates, svc.bulletin_template_id, settings?.default_bulletin_template_id]);
  const weekly = useMemo(() => weeklySections(tpl?.options.page_layout), [tpl]);

  const [content, setContent] = useState<Record<string, L10n>>(() => ({ ...(svc.bulletin_content ?? {}) }));
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saved'>('idle');
  const timer = useRef<number | null>(null);
  const latest = useRef(content);
  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const body = tidy(latest.current);
    try {
      await api.patch(`/services/${svc.id}`, { bulletin_content: body });
      onContent(body);
      setSaving('saved');
    } catch (e) {
      toast((e as Error).message, true);
      setSaving('idle');
    }
  }, [svc.id, onContent, toast]);
  // save what is still waiting when the tab closes
  useEffect(() => () => {
    if (timer.current) void save();
  }, [save]);
  const change = (key: string, v: L10n) => {
    const next = { ...latest.current, [key]: v };
    latest.current = next;
    setContent(next);
    setSaving('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), 800);
  };

  // the old place of the announcements: the body of the Announcements item
  const annItem = svc.items.find((it) => it.kind === 'announcements' && hasAnyText(it.body ?? undefined));
  const moved = !hasAnyText(content[ANNOUNCEMENTS_KEY]) && annItem ? annItem.body ?? {} : null;

  if (error) return <ErrorBox error={error} />;
  if (!templates) return <Loading />;

  return (
    <div className="card stack" style={{ maxWidth: 860 }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div className="eyebrow">{t('Bulletin template')}</div>
          <strong>{tpl ? <Bi v={tpl.name} /> : '—'}</strong>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {saving === 'pending' && <span className="small muted">{t('Saving…')}</span>}
          {saving === 'saved' && <span className="small muted"><Icon name="check" width={13} height={13} style={{ verticalAlign: -2 }} /> {t('Saved.')}</span>}
          <Link className="btn sm" to={`/services/${svc.id}/bulletin`}><Icon name="print" />{t('Bulletin')}</Link>
        </div>
      </div>
      {!weekly.length ? (
        <div className="callout">
          {t('This template has no weekly sections')}. {t('Add an Announcements or Weekly text section to its page layout to type them here each week.')}{' '}
          <Link to="/bulletin-templates">{t('Bulletin templates')} →</Link>
        </div>
      ) : (
        weekly.map((w) => {
          const prefilled = w.announcements && moved;
          const value = prefilled ? moved! : content[w.key] ?? {};
          const heading = lt(w.heading) || t(w.announcements ? 'Announcements' : 'Weekly text');
          return (
            <div key={w.key} className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{heading}</strong>
                <span className="field-hint">{t('Numbered lines print as a list')}</span>
              </div>
              {prefilled && (
                <div className="callout row" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <span>{t('Moved from the item')} “{lt(annItem!.title)}” — {t('save to keep')}.</span>
                  {canEdit && <button className="btn sm primary" onClick={() => change(w.key, { ...moved! })}>{t('Save')}</button>}
                </div>
              )}
              <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
                <L10nInput multiline rows={6} value={value} onChange={(v) => change(w.key, v)} />
              </fieldset>
            </div>
          );
        })
      )}
    </div>
  );
}
