// Book-keeping (0.17.0, optional module): the church's double-entry books. Before the books start, the treasurer
// chooses the start date and financial year (and the church chart of accounts); then the overview, journals, bank
// statements, reports, and the chart of accounts and funds. Reading needs the role's Book-keeping access; changes need
// edit; posted journals are never changed (a reversal corrects them).
import { useSearchParams } from 'react-router-dom';
import { useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { ErrorBox, Loading, PageHead, useSession } from '../../components/ui.tsx';
import type { BkAccount, BkFund, BkTag } from '../../../shared/bookkeeping.ts';
import { BooksCtx, type Books, type Overview } from './common.tsx';
import { OverviewTab, SetupForm } from './Overview.tsx';
import { JournalsTab } from './Journals.tsx';
import { ChartTab } from './Chart.tsx';
import { BankTab } from './Bank.tsx';
import { ReportsTab } from './BkReports.tsx';
import { ClaimsTab } from './Claims.tsx';
import '../resources/resources.css';
import './bookkeeping.css';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'journals', label: 'Journals' },
  { key: 'bank', label: 'Bank' },
  { key: 'claims', label: 'Claims' },
  { key: 'reports', label: 'Reports' },
  { key: 'chart', label: 'Accounts and funds' },
] as const;
type Tab = (typeof TABS)[number]['key'];

export default function Bookkeeping() {
  const { t } = useI18n();
  const { can } = useSession();
  const canEdit = can('bookkeeping', 'edit');
  const [sp, setSp] = useSearchParams();
  const overview = useApi<Overview>('/bookkeeping');
  const accounts = useApi<BkAccount[]>('/bookkeeping/accounts');
  const funds = useApi<BkFund[]>('/bookkeeping/funds');
  const projects = useApi<BkTag[]>('/bookkeeping/tags/projects');
  const ministries = useApi<BkTag[]>('/bookkeeping/tags/ministries');
  const tab = (TABS.find((x) => x.key === sp.get('tab'))?.key ?? 'overview') as Tab;
  const reload = () => {
    overview.reload();
    accounts.reload();
    funds.reload();
    projects.reload();
    ministries.reload();
  };
  const error = overview.error ?? accounts.error ?? funds.error;
  const ready = overview.data && accounts.data && funds.data && projects.data && ministries.data;
  const books: Books | null = ready ? {
    overview: overview.data!, accounts: accounts.data!, funds: funds.data!, projects: projects.data!, ministries: ministries.data!, canEdit, reload,
    go: (to, params) => setSp({ tab: to, ...params }),
  } : null;
  return (
    <div className="page bk-page">
      <PageHead eyebrow={t('Finance')} title={t('Book-keeping')} sub={t('The church’s books: journals, the bank, funds and reports.')} />
      {error && <ErrorBox error={error} />}
      {!books ? (!error && <Loading />) : (
        <BooksCtx.Provider value={books}>
          {!books.overview.started ? (
            canEdit ? <SetupForm /> : <div className="callout">{t('The books haven’t been started yet: the treasurer starts them here.')}</div>
          ) : (
            <>
              <div className="tabs no-print" role="tablist">
                {TABS.map((x) => (
                  <button key={x.key} role="tab" aria-selected={tab === x.key} className={tab === x.key ? 'on' : ''} onClick={() => setSp({ tab: x.key }, { replace: true })}>
                    {t(x.label)}
                    {x.key === 'journals' && books.overview.drafts > 0 && <span className="badge warn" style={{ marginLeft: 6 }}>{books.overview.drafts}</span>}
                  </button>
                ))}
              </div>
              {tab === 'overview' && <OverviewTab />}
              {tab === 'journals' && <JournalsTab />}
              {tab === 'bank' && <BankTab />}
              {tab === 'claims' && <ClaimsTab />}
              {tab === 'reports' && <ReportsTab />}
              {tab === 'chart' && <ChartTab />}
            </>
          )}
        </BooksCtx.Provider>
      )}
    </div>
  );
}
