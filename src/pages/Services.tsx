import { useState } from 'react';
import { hasAnyText } from '../../shared/labels.ts';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs, useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Bi, Empty, ErrorBox, Field, L10nInput, Loading, Modal, PageHead, Seg, fmtDate, nextSunday, today, useAction, useSession } from '../components/ui.tsx';
import { Icon } from '../components/icons.tsx';
import { SeasonChip } from '../components/brand.tsx';
import { CongregationBadge, CongregationField, CongregationFilter, useCongregationFilter } from '../components/Congregations.tsx';
import type { L10n, ServiceFull, ServiceListRow, Template } from '../types-client.ts';

export default function Services() {
  const { t, lang } = useI18n();
  const { canEdit, settings } = useSession();
  const seasons = settings?.season_colours !== false;
  const [params, setParams] = useSearchParams();
  const [when, setWhen] = useState<'upcoming' | 'past'>('upcoming');
  const [cong, setCong, congs] = useCongregationFilter('services');
  const path = when === 'upcoming' ? `/services${qs({ from: today(), congregation: cong })}` : `/services${qs({ to: today(), limit: 100, congregation: cong })}`;
  const { data, error } = useApi<ServiceListRow[]>(path);
  const creating = params.get('new') !== null;
  const nav = useNavigate();

  return (
    <div className="page">
      <PageHead eyebrow={t('Service Planner')} title={t('Services')}>
        <CongregationFilter value={cong} onChange={setCong} list={congs} />
        <Seg value={when} onChange={setWhen} options={[{ value: 'upcoming', label: t('Upcoming') }, { value: 'past', label: t('Past') }]} />
        {canEdit && <button className="btn primary" onClick={() => setParams({ new: '' })}><Icon name="plus" />{t('New service')}</button>}
      </PageHead>
      {error && <ErrorBox error={error} />}
      {!data ? <Loading /> : !data.length ? (
        <div className="card">
          <Empty title={lang === 'zh' ? '尚无聚会程序' : 'Plan your first service'}>
            <p>{lang === 'zh' ? '选择一个模板，系统会自动放入宣召、信经、祝福等礼文。' : 'Pick a template and Canon drops in the call to worship, creed, benediction and the rest.'}</p>
            {canEdit && <button className="btn primary" onClick={() => setParams({ new: '' })}><Icon name="plus" />{t('New service')}</button>}
          </Empty>
        </div>
      ) : (
        <div className="card flush table-wrap">
          <table className="t">
            <thead>
              <tr><th>{t('Date')}</th><th>{t('Title')}</th><th>{t('Preacher')}</th><th className="right">{t('Items')}</th><th className="right">{t('Assigned')}</th><th>{t('Status')}</th></tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id} className="click" onClick={() => nav(`/services/${s.id}`)}>
                  <td className="nowrap">
                    {seasons && <SeasonChip dotOnly date={s.date} season={s.season} className="svc-season" />}
                    <Link to={`/services/${s.id}`} onClick={(e) => e.stopPropagation()}><strong>{fmtDate(s.date, lang)}</strong></Link> <span className="muted">{s.start_time}</span>
                  </td>
                  <td><CongregationBadge id={s.congregation_id} list={congs} /> {s.ref && <span className="badge lapis ref-badge">{s.ref}</span>} <Bi v={s.title} />{hasAnyText(s.sermon_title) && <div className="small muted serif">“{s.sermon_title[lang] || s.sermon_title.en || s.sermon_title.zh}”{s.sermon_ref ? ` · ${s.sermon_ref}` : ''}</div>}</td>
                  <td>{s.preacher}</td>
                  <td className="right">{s.item_count}</td>
                  <td className="right">{s.assigned_count}</td>
                  <td><span className={`badge ${s.status === 'final' ? 'ok' : ''}`}>{t(s.status === 'final' ? 'Final' : 'Draft')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewServiceDialog initialTemplate={Number(params.get('template')) || null} initialCongregation={cong} onClose={() => setParams({})} />}
    </div>
  );
}

export function NewServiceDialog({ onClose, initialTemplate, initialCongregation }: { onClose: () => void; initialTemplate?: number | null; initialCongregation?: number | null }) {
  const { t, lt } = useI18n();
  const nav = useNavigate();
  const { run, busy } = useAction();
  const { data: templates } = useApi<Template[]>('/templates');
  const [date, setDate] = useState(nextSunday(today()));
  const [templateId, setTemplateId] = useState<number | null>(initialTemplate ?? null);
  const [preacher, setPreacher] = useState('');
  const [sermonTitle, setSermonTitle] = useState<L10n>({});
  const [sermonRef, setSermonRef] = useState('');
  const { settings } = useSession();
  const churchDefault = templates?.find((x) => x.id === settings?.default_service_template_id)?.id ?? templates?.find((x) => !x.hidden)?.id ?? null;
  const tid = templateId ?? churchDefault;
  // congregation: chosen here, else the filter's, else the template's
  const [congPick, setCongPick] = useState<number | null | undefined>(undefined);
  const tplCong = templates?.find((x) => x.id === tid)?.congregation_id ?? null;
  const congregation = congPick !== undefined ? congPick : initialCongregation ?? tplCong;

  const create = async () => {
    const r = await run(() => api.post<{ service: ServiceFull; missing: string[] }>('/services', {
      date, template_id: tid === -1 ? null : tid, preacher: preacher || null, sermon_title: sermonTitle, sermon_ref: sermonRef || null, congregation_id: congregation ?? null,
    }));
    if (r) {
      onClose();
      nav(`/services/${r.service.id}`);
    }
  };

  return (
    <Modal title={t('New service')} onClose={onClose} size="lg" footer={
      <>
        <button className="btn" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn primary" onClick={create} disabled={busy}>{t('New service')}</button>
      </>
    }>
      <div className="stack">
        <div className="form-grid">
          <Field label={t('Date')}><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <CongregationField value={congregation} onChange={setCongPick} hint={t('New services start with this congregation’s languages.')} />
          <Field label={t('Preacher')}><input value={preacher} onChange={(e) => setPreacher(e.target.value)} placeholder="Rev. Tan" /></Field>
          <Field label={t('Sermon text')}><input value={sermonRef} onChange={(e) => setSermonRef(e.target.value)} placeholder="Isaiah 6:1-8" /></Field>
        </div>
        <Field label={t('Sermon title')}><L10nInput value={sermonTitle} onChange={setSermonTitle} /></Field>
        <div className="field" style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-2)' }}>{t('Template')}</div>
        <div className="grid cols-2" style={{ gap: 8 }}>
          {(templates ?? []).filter((tp) => !tp.hidden || tp.id === tid).map((tp) => (
            <button key={tp.id} type="button" className="card" onClick={() => setTemplateId(tp.id)}
              style={{ textAlign: 'left', cursor: 'pointer', padding: '12px 14px', borderColor: tid === tp.id ? 'var(--reed)' : undefined, background: tid === tp.id ? 'var(--reed-wash)' : undefined, font: 'inherit', color: 'inherit' }}>
              <div className="row between"><strong className="serif"><Bi v={tp.name} /></strong><span className="small muted">{tp.ref && <span className="badge lapis ref-badge" style={{ marginRight: 6 }}>{tp.ref}</span>}{tp.id === churchDefault && <span className="badge reed" style={{ marginRight: 6 }}>{t('Church default')}</span>}{tp.start_time}</span></div>
              <div className="small muted">{lt(tp.description)}</div>
              <div className="small muted" style={{ marginTop: 4 }}>{tp.items.length} {t('Items').toLowerCase()} · {tp.items.reduce((a, i) => a + i.duration_min, 0)} {t('min')}</div>
            </button>
          ))}
          <button type="button" className="card" onClick={() => setTemplateId(-1)}
            style={{ textAlign: 'left', cursor: 'pointer', padding: '12px 14px', borderColor: templateId === -1 ? 'var(--reed)' : undefined, background: templateId === -1 ? 'var(--reed-wash)' : undefined, font: 'inherit', color: 'inherit' }}>
            <strong className="serif">{t('Blank service')}</strong>
          </button>
        </div>
      </div>
    </Modal>
  );
}
