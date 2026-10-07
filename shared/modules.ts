// Optional parts of Canon (0.13): a church turns each on or off during onboarding or in Settings → Modules. A part
// that is off is hidden from the sidebar and its tabs, refused by the server and absent from AI agents' tools;
// turning it off keeps its data, so turning it on again brings everything back. The lending library and the asset
// register (0.15) start switched off: a church turns them on when it wants them, as does book-keeping (0.17).

export const OPTIONAL_MODULES = ['meetings', 'volunteers', 'visitor_form', 'lending', 'equipment', 'bookkeeping'] as const;
export type OptionalModule = (typeof OPTIONAL_MODULES)[number];
export type ModuleSwitches = Record<OptionalModule, boolean>;

export const DEFAULT_MODULES: ModuleSwitches = { meetings: true, volunteers: true, visitor_form: true, lending: false, equipment: false, bookkeeping: false };

export const OPTIONAL_LABEL: Record<OptionalModule, { name: string; description: string }> = {
  meetings: { name: 'Meetings and calendar', description: 'Fellowship meetings, cell groups, Sunday school and one-off meetings with their records, recurring meetings, and the church calendar.' },
  volunteers: { name: 'Volunteers and rota', description: 'Serving teams, rota roles, who serves at each service, away dates, reminders and the serving report.' },
  visitor_form: { name: 'Visitor form', description: 'The form new visitors fill in on their phones (QR codes on the bulletin and slides), reviewed before it joins the record.' },
  lending: { name: 'Lending library', description: 'The church’s books, DVDs and curricula lent to members: a catalogue with numbered copies and QR labels, loans with due dates, and reminders by e-mail.' },
  equipment: { name: 'Asset register', description: 'The church’s equipment and property: where each item is, who looks after it, what it cost, its condition, photos and receipts, and maintenance.' },
  bookkeeping: { name: 'Book-keeping', description: 'The church’s double-entry books: a chart of accounts, funds, journals, verified offerings drafted into the books, bank statements matched, closed periods, and the income and expenditure, balance sheet and fund reports.' },
};

/** The API paths (relative to /api) of each part. Reading the rota's teams and roles stays open: other pages use them. */
const API: Record<OptionalModule, RegExp> = {
  meetings: /^\/(meetings|events|calendar)(\/|$)|^\/groups\/\d+\/meetings-ahead$/,
  volunteers: /^\/(rota|unavailability|assignments|email\/log)(\/|$)|^\/(teams|roles)\/|^\/services\/\d+\/(assignments|reminders|warnings)(\/|$)|^\/reports\/serving$/,
  visitor_form: /^\/(visitor-cards|visitor-form-settings)(\/|$)|^\/services\/\d+\/(visitor-form|visitor-cards)(\/|$)/,
  lending: /^\/lending(\/|$)|^\/csv\/books(\/|$)/,
  equipment: /^\/equipment(\/|$)|^\/csv\/equipment(\/|$)/,
  bookkeeping: /^\/bookkeeping(\/|$)/,
};
const WRITE_ONLY: Partial<Record<OptionalModule, RegExp>> = { volunteers: /^\/(teams|roles)$/ };

/** Which switched-off part a request belongs to, or null. */
export function moduleOff(method: string, path: string, on: Partial<ModuleSwitches> | undefined): OptionalModule | null {
  for (const m of OPTIONAL_MODULES) {
    if (on?.[m] !== false) continue;
    if (API[m].test(path)) return m;
    if (method !== 'GET' && WRITE_ONLY[m]?.test(path)) return m;
  }
  return null;
}

/** Whether a page of the web app belongs to a switched-off part. */
export function pageOff(pathname: string, on: Partial<ModuleSwitches> | undefined): boolean {
  if (on?.meetings === false && /^\/(meetings|calendar)(\/|$)/.test(pathname)) return true;
  if (on?.volunteers === false && /^\/volunteers(\/|$)/.test(pathname)) return true;
  if (on?.lending === false && /^\/lending(\/|$)/.test(pathname)) return true;
  if (on?.equipment === false && /^\/equipment(\/|$)/.test(pathname)) return true;
  if (on?.bookkeeping === false && /^\/bookkeeping(\/|$)/.test(pathname)) return true;
  return false;
}
