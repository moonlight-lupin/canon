// Book-keeping (0.17.0): what every book-keeping screen shares — the chart, funds and tags loaded once, money in
// cents shown and typed as amounts, and the account / fund / tag pickers.
import { createContext, useContext } from 'react';
import { useI18n } from '../../i18n.tsx';
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, type AccountType, type BkAccount, type BkFund, type BkJournal, type BkTag, type BookkeepingSettings, type JournalKind } from '../../../shared/bookkeeping.ts';

export interface Overview {
  settings: BookkeepingSettings;
  currency: string;
  offering_funds: string[];
  started: boolean;
  drafts: number;
  offering_drafts: number;
  money: { account_id: number; code: string; name: BkAccount['name']; amount: number }[];
  opening: BkJournal | null;
  kinds: Record<JournalKind, string>;
}

export interface Books {
  overview: Overview;
  accounts: BkAccount[];
  funds: BkFund[];
  projects: BkTag[];
  ministries: BkTag[];
  canEdit: boolean;
  reload: () => void;
  /** go to another tab, e.g. the journals with a filter */
  go: (tab: string, params?: Record<string, string>) => void;
}
export const BooksCtx = createContext<Books>(null!);
export const useBooks = () => useContext(BooksCtx);

/** 123456 → "1,234.56" */
export const fmtMoney = (cents: number | null | undefined) =>
  cents == null ? '' : ((cents + 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Negative amounts in brackets, as accounts show them. */
export const fmtSigned = (cents: number | null | undefined) => (cents == null ? '' : cents < 0 ? `(${fmtMoney(-cents)})` : fmtMoney(cents));
/** "1,234.5" → 123450; '' → 0; not a number → null */
export function parseMoney(s: string): number | null {
  const t = s.replace(/[,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  if (!t) return 0;
  if (!/^-?\d*(\.\d{0,2})?$/.test(t) || t === '-' || t === '.') return null;
  return Math.round(Number(t) * 100);
}
/** Cents for a CSV cell: 123450 → "1234.50" */
export const csvMoney = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2));

/** "1100 Bank — current account" */
export function useNames() {
  const { lt } = useI18n();
  const { accounts, funds, projects, ministries } = useBooks();
  const acc = new Map(accounts.map((a) => [a.id, a]));
  const fund = new Map(funds.map((f) => [f.id, f]));
  return {
    account: (id: number | null | undefined) => {
      const a = id ? acc.get(id) : undefined;
      return a ? `${a.code} ${lt(a.name)}` : '';
    },
    fund: (id: number | null | undefined) => {
      const f = id ? fund.get(id) : undefined;
      return f ? lt(f.name) : '';
    },
    fundCode: (id: number | null | undefined) => (id ? fund.get(id)?.code ?? '' : ''),
    project: (id: number | null | undefined) => lt(projects.find((p) => p.id === id)?.name),
    ministry: (id: number | null | undefined) => lt(ministries.find((p) => p.id === id)?.name),
  };
}

/** An account picker, grouped by type; inactive accounts only when already chosen. */
export function AccountSelect({ value, onChange, types, kinds, exclude, empty, disabled, label }: {
  value: number | null | undefined; onChange: (id: number | null) => void; types?: AccountType[]; kinds?: string[]; exclude?: number; empty?: string; disabled?: boolean; label?: string;
}) {
  const { t, lt } = useI18n();
  const { accounts } = useBooks();
  const ok = (a: BkAccount) => a.id !== exclude && (a.active || a.id === value) && (!types || types.includes(a.type)) && (!kinds || kinds.includes(a.kind));
  return (
    <select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value) || null)} disabled={disabled} aria-label={label ?? t('Account')}>
      <option value="">{empty ?? t('Choose an account…')}</option>
      {ACCOUNT_TYPES.filter((ty) => !types || types.includes(ty)).map((ty) => {
        const list = accounts.filter((a) => a.type === ty && ok(a));
        return list.length ? (
          <optgroup key={ty} label={t(ACCOUNT_TYPE_LABEL[ty])}>
            {list.map((a) => <option key={a.id} value={a.id}>{a.code} {lt(a.name)}</option>)}
          </optgroup>
        ) : null;
      })}
    </select>
  );
}

export function FundSelect({ value, onChange, empty, disabled }: { value: number | null | undefined; onChange: (id: number | null) => void; empty?: string; disabled?: boolean }) {
  const { t, lt } = useI18n();
  const { funds } = useBooks();
  return (
    <select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value) || null)} disabled={disabled} aria-label={t('Fund‖books')}>
      <option value="">{empty ?? t('Choose a fund…')}</option>
      {funds.filter((f) => f.active || f.id === value).map((f) => <option key={f.id} value={f.id}>{f.code} {lt(f.name)}</option>)}
    </select>
  );
}

export function TagSelect({ kind, value, onChange, disabled }: { kind: 'projects' | 'ministries'; value: number | null | undefined; onChange: (id: number | null) => void; disabled?: boolean }) {
  const { t, lt } = useI18n();
  const b = useBooks();
  const list = b[kind];
  return (
    <select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value) || null)} disabled={disabled} aria-label={kind === 'projects' ? t('Project') : t('Ministry')}>
      <option value="">{kind === 'projects' ? t('No project') : t('No ministry')}</option>
      {list.filter((x) => x.active || x.id === value).map((x) => <option key={x.id} value={x.id}>{lt(x.name)}</option>)}
    </select>
  );
}

/** A typed amount: keeps what is typed while editing, gives cents (null when it is not a number). */
export function MoneyInput({ cents, onChange, disabled, label, allowNegative }: { cents: number; onChange: (c: number) => void; disabled?: boolean; label?: string; allowNegative?: boolean }) {
  return (
    <input
      className="bk-money" inputMode="decimal" disabled={disabled} aria-label={label}
      defaultValue={cents ? (cents / 100).toFixed(2) : ''}
      key={cents}
      onBlur={(e) => {
        const c = parseMoney(e.target.value);
        if (c === null || (!allowNegative && c < 0)) {
          e.target.value = cents ? (cents / 100).toFixed(2) : '';
          return;
        }
        e.target.value = c ? (c / 100).toFixed(2) : '';
        if (c !== cents) onChange(c);
      }}
    />
  );
}

/** Month names for "the financial year ends in …". */
export const monthName = (m: number, lang: string) => new Date(Date.UTC(2000, m - 1, 1)).toLocaleDateString(lang, { month: 'long', timeZone: 'UTC' });
