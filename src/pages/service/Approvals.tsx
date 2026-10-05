// The service planner: approving the bulletin and slides as they are now, and the approved versions kept (each can
// be opened again exactly; Canon says when the service has changed since the last approval).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Field, Modal, fmtDate, useAction } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';

type ApprovalRow = { id: number; approved_at: string; approved_by: string; note: string | null; current: boolean };

export function ApprovalsButton({ sid, canEdit }: { sid: number; canEdit: boolean }) {
  const { t } = useI18n();
  const list = useApi<ApprovalRow[]>(`/services/${sid}/approvals`);
  const [open, setOpen] = useState(false);
  const latest = list.data?.[0];
  const label = !latest ? t('Approve') : latest.current ? t('Approved') : t('Changed since approved');
  if (!canEdit && !latest) return null;
  return (
    <>
      <button className={`btn sm ${latest && !latest.current ? 'warn' : 'ghost'}`} onClick={() => setOpen(true)}
        title={t('Approve the bulletin and slides as they are now, and open earlier approved versions')}>
        <Icon name="check" />{label}
      </button>
      {open && <ApprovalsDialog sid={sid} canEdit={canEdit} list={list.data ?? []} reload={list.reload} onClose={() => setOpen(false)} />}
    </>
  );
}

function ApprovalsDialog({ sid, canEdit, list, reload, onClose }: { sid: number; canEdit: boolean; list: ApprovalRow[]; reload: () => void; onClose: () => void }) {
  const { t, lang } = useI18n();
  const { run, busy } = useAction();
  const [note, setNote] = useState('');
  const approve = () => run(async () => {
    await api.post(`/services/${sid}/approvals`, { note: note.trim() || null });
    setNote('');
    reload();
  }, t('Approved.'));
  return (
    <Modal title={t('Approved versions')} onClose={onClose} footer={<button className="btn" onClick={onClose}>{t('Close')}</button>}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>{t('Approving keeps a copy of the bulletin and slides as they are now — the words, order, people and templates — so that version can be printed or projected again exactly, even after the service changes. Pictures are not copied.')}</p>
        {canEdit && (
          <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={t('Note (optional)')}><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('e.g. checked by the pastor')} style={{ width: 260 }} /></Field>
            <button className="btn primary" onClick={approve} disabled={busy}><Icon name="check" />{t('Approve this version')}</button>
          </div>
        )}
        {!list.length ? <p className="muted small" style={{ margin: 0 }}>{t('Not approved yet.')}</p> : (
          <table className="t">
            <thead><tr><th>{t('Approved')}</th><th>{t('By')}</th><th /><th /></tr></thead>
            <tbody>
              {list.map((a, i) => (
                <tr key={a.id}>
                  <td className="nowrap">{fmtDate(a.approved_at.slice(0, 10), lang)} {a.approved_at.slice(11, 16)}{a.note && <div className="small muted">{a.note}</div>}</td>
                  <td>{a.approved_by}</td>
                  <td>{i === 0 && (a.current ? <span className="badge ok">{t('Current')}</span> : <span className="badge warn">{t('Changed since')}</span>)}</td>
                  <td className="right nowrap">
                    <Link className="btn sm" to={`/services/${sid}/bulletin?approved=${a.id}`}><Icon name="print" />{t('Bulletin')}</Link>{' '}
                    <Link className="btn sm" to={`/services/${sid}/slides?approved=${a.id}`} target="_blank"><Icon name="monitor" />{t('Slides')}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Modal>
  );
}
