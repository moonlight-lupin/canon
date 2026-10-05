// An approved version of a service's bulletin and slides (?approved=<id>): the outputs are drawn from the copy kept
// when it was approved, not from the service as it is now (server/repo/approvals.ts).
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { fmtDate } from '../components/ui.tsx';
import type { RenderedService } from '../types-client.ts';
import type { BulletinBlock, BulletinTemplate } from '../../shared/presentation.ts';
import type { SlideTheme } from '../../shared/slide-theme.ts';

export interface Approval {
  id: number;
  approved_at: string;
  approved_by: string;
  note: string | null;
  snapshot: { render: RenderedService; bulletin_template: BulletinTemplate | null; blocks: BulletinBlock[]; slide_theme: SlideTheme | null; slide_css: string };
}

/** The approved version asked for in the address, if any (undefined while it loads). */
export function useApproved(serviceId: string | undefined) {
  const [sp] = useSearchParams();
  const approvedId = Number(sp.get('approved')) || null;
  const ap = useApi<Approval>(approvedId ? `/services/${serviceId}/approvals/${approvedId}` : null);
  return { approvedId, approval: ap.data, error: ap.error };
}

/** A line above the output (not printed): which approved version this is. */
export function ApprovedBanner({ approval }: { approval: Approval }) {
  const { t, lang } = useI18n();
  return (
    <div className="out-approved no-print">
      {t('Approved version')} · {fmtDate(approval.approved_at.slice(0, 10), lang)} {approval.approved_at.slice(11, 16)} · {approval.approved_by}
      {approval.note ? ` · ${approval.note}` : ''}
    </div>
  );
}
