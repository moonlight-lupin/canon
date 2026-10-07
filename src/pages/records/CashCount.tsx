// Records: the cash count by denomination, signing it, and the printable declaration.
import { dateLocale } from '../../../shared/languages.ts';
import { FitToScreen } from '../../components/onscreen.ts';
import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../../api.ts';
import { useI18n } from '../../i18n.tsx';
import { Bi, ErrorBox, Loading, fmtDate, useSession } from '../../components/ui.tsx';
import { Icon } from '../../components/icons.tsx';
import { CONG_LABEL, useCongregations } from '../../components/Congregations.tsx';
import {
  DENOMINATIONS, METHOD_LABEL, OFFERING_METHODS, cashTotal, denomLabel, foreignCounted, foreignCurrencies, methodTotal,
  money,
} from '../../../shared/records.ts';
import type { ServiceFull } from '../../types-client.ts';
import type { Rec } from './RecordEditor.tsx';
import '../records.css';

/** Sign with a finger, pen or mouse; reports the drawing as a PNG data URL (null when cleared). */
export function SignaturePad({ onChange }: { onChange: (png: string | null) => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLCanvasElement>(null);
  const last = useRef<[number, number] | null>(null);
  const [blank, setBlank] = useState(true);
  const at = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const c = e.currentTarget;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
  };
  const stroke = (from: [number, number], to: [number, number]) => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.strokeStyle = '#1e2430';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(...from);
    g.lineTo(...to);
    g.stroke();
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    last.current = p;
    stroke(p, [p[0] + 0.1, p[1] + 0.1]);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const p = at(e);
    stroke(last.current, p);
    last.current = p;
  };
  const up = () => {
    if (!last.current) return;
    last.current = null;
    setBlank(false);
    onChange(ref.current?.toDataURL('image/png') ?? null);
  };
  const clear = () => {
    const c = ref.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setBlank(true);
    onChange(null);
  };
  return (
    <div className="sig-pad">
      <canvas ref={ref} width={600} height={200} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label={t('Signature pad')} />
      {blank && <span className="sig-hint">{t('Sign here')}</span>}
      <button type="button" className="btn sm ghost" onClick={clear} disabled={blank}>{t('Clear')}</button>
    </div>
  );
}

/** Notes and coins: count × value = subtotal. */
export function CashCount({ currency, cash, onChange }: { currency: string; cash: Record<string, number>; onChange: (c: Record<string, number>) => void }) {
  const { t } = useI18n();
  const den = DENOMINATIONS[currency] ?? DENOMINATIONS.SGD;
  const row = (d: number) => {
    const n = cash[String(d)] ?? 0;
    return (
      <tr key={d}>
        <td className="right">{denomLabel(d, currency)}</td>
        <td>×</td>
        <td><input type="number" min={0} inputMode="numeric" style={{ width: 90 }} value={n || ''} onChange={(e) => onChange({ ...cash, [String(d)]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></td>
        <td className="right muted">{n ? money(n * d, currency) : ''}</td>
      </tr>
    );
  };
  return (
    <div className="rec-cash">
      <table className="t"><thead><tr><th className="right">{t('Banknotes')}</th><th /><th>{t('Count')}</th><th className="right">{t('Subtotal')}</th></tr></thead><tbody>{den.notes.map(row)}</tbody></table>
      <table className="t"><thead><tr><th className="right">{t('Coins')}</th><th /><th>{t('Count')}</th><th className="right">{t('Subtotal')}</th></tr></thead><tbody>{den.coins.map(row)}</tbody></table>
    </div>
  );
}

// ================================================================= the printable declaration

export function CashDeclaration() {
  const { id } = useParams();
  const sid = Number(id);
  const { t, lt, lang } = useI18n();
  const { settings } = useSession();
  const congs = useCongregations();
  const svc = useApi<ServiceFull>(`/services/${sid}`);
  const rec = useApi<Rec>(`/services/${sid}/record`);
  const r = rec.data;
  const den = r ? DENOMINATIONS[r.currency] ?? DENOMINATIONS.SGD : null;
  const counters = useMemo(() => {
    const named = (r?.counters ?? []).filter((c) => c.trim());
    return [...named, ...Array(Math.max(0, 3 - named.length)).fill('')];
  }, [r]);
  const signed = r?.signatures ?? [];
  if (svc.error || rec.error) return <ErrorBox error={(svc.error ?? rec.error)!} />;
  if (!svc.data || !r || !den) return <Loading />;
  const s = svc.data;
  const cur = r.currency;
  const c = congs.find((x) => x.id === s.congregation_id);
  // a printed form for an auditor: the reader's language, with English after it
  // a printed form for an auditor: the reader's language, with English after it. `key` names the phrase to
  // translate when the English word alone is ambiguous ("Note" here is a banknote); `vars` fill {cur}
  const both = (en: string, key = en, vars: Record<string, string> = {}) => {
    const fill = (x: string) => Object.entries(vars).reduce((a, [k, v]) => a.replaceAll(`{${k}}`, v), x);
    const tr = fill(t(key));
    return lang === 'en' || t(key) === key ? fill(en) : `${tr} ${fill(en)}`;
  };
  const line = (d: number) => {
    const n = r.cash[String(d)] ?? 0;
    return <tr key={d}><td className="right">{denomLabel(d, cur)}</td><td className="right">{n || '—'}</td><td className="right">{n ? money(n * d, cur) : '—'}</td></tr>;
  };
  return (
    <div className="decl">
      <div className="decl-bar no-print">
        <Link className="btn sm ghost" to={`/records/${sid}`}><Icon name="chevronLeft" />{t('Back')}</Link>
        <button className="btn sm primary" onClick={() => window.print()}><Icon name="print" />{t('Print')}</button>
      </div>
      <FitToScreen className="decl-page">
        <h1>{lt(settings?.church_name ?? { en: 'Church' })}</h1>
        <h2>{both('Offering Count Declaration')}</h2>
        <table className="decl-meta">
          <tbody>
            <tr><th>{both('Service')}</th><td><Bi v={s.title} /></td></tr>
            <tr><th>{both('Date')}</th><td>{fmtDate(s.date, lang)} · {s.start_time}</td></tr>
            {c && <tr><th>{lt(CONG_LABEL)}</th><td>{lt(c.name)}</td></tr>}
            <tr><th>{both('Currency')}</th><td>{cur}</td></tr>
            <tr><th>{both('Date counted')}</th><td>{fmtDate(r.counted_on ?? s.date, lang)}</td></tr>
          </tbody>
        </table>

        <h3>{both('Cash count')}</h3>
        <div className="decl-cash">
          <table><thead><tr><th className="right">{both('Note', 'Banknote (cash count)')}</th><th className="right">{both('Count', 'Number of notes (cash count)')}</th><th className="right">{both('Amount')}</th></tr></thead><tbody>{den.notes.map(line)}</tbody></table>
          <table><thead><tr><th className="right">{both('Coin', 'Coin (cash count)')}</th><th className="right">{both('Count', 'Number of coins (cash count)')}</th><th className="right">{both('Amount')}</th></tr></thead><tbody>{den.coins.map(line)}</tbody></table>
        </div>
        <p className="decl-total">{both('Total cash counted')}: <strong>{money(cashTotal(r.cash), cur, true)}</strong></p>

        {foreignCurrencies(r.offerings, cur).map((fc) => {
          const f = r.foreign_cash?.[fc] ?? {};
          const fd = DENOMINATIONS[fc];
          const fline = (dn: number) => {
            const n = f.cash?.[String(dn)] ?? 0;
            return n ? <tr key={dn}><td className="right">{denomLabel(dn, fc)}</td><td className="right">{n}</td><td className="right">{money(n * dn, fc)}</td></tr> : null;
          };
          return (
            <div key={fc}>
              <h3>{both('Cash in {cur}', 'Cash in {cur}', { cur: fc })}</h3>
              {fd && f.cash && Object.values(f.cash).some(Boolean) && (
                <table className="decl-methods"><thead><tr><th className="right">{both('Note / coin', 'Note / coin (cash count)')}</th><th className="right">{both('Count', 'Number (cash count)')}</th><th className="right">{both('Amount')}</th></tr></thead><tbody>{[...fd.notes, ...fd.coins].map(fline)}</tbody></table>
              )}
              <p className="decl-total">{both('Total {cur} cash counted', 'Total {cur} cash counted', { cur: fc })}: <strong>{money(foreignCounted(f), fc, true)}</strong>
                {f.converted != null && <> · {both('Value in {cur} once exchanged', 'Value in {cur} once exchanged', { cur })}: {money(f.converted, cur, true)}</>}</p>
            </div>
          );
        })}

        <h3>{both('Offerings by method')}</h3>
        <table className="decl-methods">
          <tbody>
            {OFFERING_METHODS.filter((m) => r.offerings.some((l) => l.method === m && (l.currency ?? cur) === cur)).map((m) => (
              <tr key={m}><th>{t(METHOD_LABEL[m])}</th><td className="right">{money(methodTotal(r.offerings, m, cur, cur), cur)}</td></tr>
            ))}
            <tr className="sum"><th>{both('Total offerings')}</th><td className="right">{money(methodTotal(r.offerings, undefined, cur, cur), cur, true)}</td></tr>
            {foreignCurrencies(r.offerings, cur).map((fc) => (
              <tr key={fc} className="sum"><th>{both('Total offerings in {cur} (not converted)', 'Total offerings in {cur} (not converted)', { cur: fc })}</th><td className="right">{money(methodTotal(r.offerings, undefined, fc, cur), fc, true)}</td></tr>
            ))}
          </tbody>
        </table>

        <p className="decl-text">
          {lang === 'en'
            ? `We, the undersigned, declare that we counted the cash offering of the above service together, that the count above is correct, and that the cash was handled and kept as the church requires.`
            : `我们以下签名的同工声明：我们一同点算了上述聚会的现金奉献，以上点算正确无误，并已按教会规定处理及保管现金。 We, the undersigned, declare that we counted the cash offering of the above service together, that the count above is correct, and that the cash was handled and kept as the church requires.`}
        </p>
        <table className="decl-sign">
          <thead><tr><th>{both('Name')}</th><th>{both('Signature')}</th><th>{both('Date')}</th></tr></thead>
          <tbody>
            {signed.length
              ? signed.map((g) => <tr key={g.name}><td>{g.name}</td><td className="decl-sig">{g.via === 'account' ? <span className="small">{both('Approved in Canon from own account')}</span> : <img src={g.image} alt="" />}</td><td>{new Date(g.signed_at).toLocaleString(dateLocale(lang), { dateStyle: 'medium', timeStyle: 'short' })}</td></tr>)
              : counters.map((n, i) => <tr key={i}><td>{n}</td><td /><td>{n ? fmtDate(r.counted_on ?? s.date, lang, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</td></tr>)}
          </tbody>
        </table>
        {r.verified_at && (signed.length
          ? <p className="small muted">{both('Signed on screen in Canon; the signatures belong to the count above.')}</p>
          : <p className="small muted">{both('Marked as verified in Canon by')} {r.verified_by}, {new Date(r.verified_at).toLocaleString(dateLocale(lang))}</p>)}
      </FitToScreen>
    </div>
  );
}
