// Public, read-only order of service: the team's share link (/share/…, with who is serving) and the attendees'
// bulletin link (/b/…, without the serving team). No session; names only, no contact details.
// The team's page also shows the planner's notes (the service's and each item's) and who serves next week (0.15.7).
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Loading, Seg } from '../components/ui.tsx';
import { ReedMark } from '../components/icons.tsx';
import { SeasonChip, Tagline, logoUrl, useLogo } from '../components/brand.tsx';
import { UI_LANGS, isChinese } from '../../shared/languages.ts';
import type { L10n, RenderedService } from '../types-client.ts';
import {
  Bi, ItemContent, LABEL, biText, formatDate, hasAny, hasContent, itemSubtitles, langOptions, langsFor, modeFor,
  timeRange, type LangMode,
} from './content.tsx';
import { ANNOUNCEMENTS_KEY, weeklySections } from '../../shared/presentation.ts';
import { isNumberedLine } from './bulletin-order.tsx';
import { servingOnLabel } from '../../shared/labels.ts';
import './outputs.css';

function useNarrow(q = '(max-width: 640px)') {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export default function Share({ attendee = false }: { attendee?: boolean }) {
  const { token } = useParams();
  const { t, lang, setLang } = useI18n();
  const [r, setR] = useState<RenderedService | null>(null);
  const [err, setErr] = useState<{ status: number; message: string } | null>(null);
  const [modeSel, setMode] = useState<LangMode | null>(null);
  const [openAll, setOpenAll] = useState(false);
  const narrow = useNarrow();
  const logoVersion = useLogo();

  useEffect(() => {
    let live = true;
    api
      .get<RenderedService>(`/${attendee ? 'bulletin' : 'share'}/${encodeURIComponent(token ?? '')}`)
      .then((d) => live && setR(d))
      .catch((e: Error) => live && setErr({ status: e instanceof ApiError ? e.status : 0, message: e.message }));
    return () => {
      live = false;
    };
  }, [token, attendee]);

  useEffect(() => {
    if (r) document.title = `${biText(r.title, [lang])} — ${r.date}`;
  }, [r, lang]);

  const mode: LangMode = modeSel ?? (r ? modeFor(r.languages) : 'both');
  const langs = useMemo(() => langsFor(mode, r?.languages ?? ['en']), [mode, r]);
  const layout = langs.length > 1 && langs.length < 3 && !narrow ? r?.layout ?? 'parallel' : 'stacked';

  const teams = useMemo(() => {
    const out: { team: L10n; rows: RenderedService['roster'] }[] = [];
    for (const row of r?.roster ?? []) {
      const k = biText(row.team, r!.languages);
      let g = out.find((x) => biText(x.team, r!.languages) === k);
      if (!g) out.push((g = { team: row.team, rows: [] }));
      g.rows.push(row);
    }
    return out;
  }, [r]);

  if (err) {
    return (
      <div className="sh-root">
        <div className="sh-error">
          <ReedMark className="sh-mark" />
          <h1>{err.status === 404 ? t('This link is no longer active') : t('Could not load this service')}</h1>
          <p className="muted">
            {err.status === 404
              ? t('The share link may have been turned off or replaced. Please ask the service coordinator for a new link.')
              : err.message}
          </p>
        </div>
      </div>
    );
  }
  if (!r) return <Loading />;

  return (
    <div className="sh-root">
      <header className="sh-head">
        <div className="sh-top">
          <div className="sh-brand">
            {r.has_logo && logoVersion && <img className="sh-logo" src={logoUrl(logoVersion)} alt="" />}
            <div className="sh-church"><Bi v={r.church.name} langs={langs} sep=" · " /></div>
          </div>
          {r.languages.length > 1 && (
            <div className="row">
              <Seg<LangMode>
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  // the page chrome follows when the language has a translated interface
                  if (m !== 'both' && UI_LANGS.includes(m)) setLang(m);
                  else if (m !== 'both' && !isChinese(m)) setLang('en');
                }}
                options={langOptions(r.languages, t)}
              />
            </div>
          )}
        </div>
        <h1 className="sh-title"><Bi v={r.title} langs={langs} sep=" " /></h1>
        <div className="sh-date">
          {formatDate(r.date, langs)} · {timeRange(r)}
          {r.season.color && <SeasonChip date={r.date} season={r.season.key} className="sh-season" />}
        </div>
        {(r.preacher || hasAny(r.sermon_title)) && (
          <div className="sh-sermon">
            {hasAny(r.sermon_title) && <span className="sh-stitle"><Bi v={r.sermon_title} langs={langs} sep=" · " /></span>}
            {hasAny(r.sermon_ref) && <span className="muted"> ({biText(r.sermon_ref, langs.slice(0, 1))})</span>}
            {r.preacher && <div className="muted">{r.preacher}</div>}
          </div>
        )}
        {hasAny(r.theme) && <div className="sh-theme"><Bi v={r.theme} langs={langs} sep=" · " /></div>}
        <div className="reed-rule" aria-hidden="true" />
      </header>

      {r.notes?.trim() && (
        <section className="sh-notes">
          <div className="sh-sec-head"><h2><Bi v={LABEL.teamNotes} langs={langs} sep=" · " /></h2></div>
          {r.notes.split(/\r?\n/).filter((x) => x.trim()).map((ln, i) => <p key={i}>{ln.trim()}</p>)}
        </section>
      )}

      <section>
        <div className="sh-sec-head">
          <h2><Bi v={LABEL.orderOfService} langs={langs} sep=" · " /></h2>
          <button className="btn sm ghost" onClick={() => setOpenAll((o) => !o)}>{openAll ? t('Hide all words') : t('Show all words')}</button>
        </div>
        <ol className="sh-list">
          {r.items.map((it) => {
            if (it.kind === 'section') {
              return (
                <li key={it.id} className="sh-section">
                  <Bi v={it.title} langs={langs} sep=" · " />
                </li>
              );
            }
            const content = hasContent(it, langs);
            const subs = itemSubtitles(it, r, langs);
            const head = (
              <div className="sh-item-head">
                <span className="sh-time">{it.start}</span>
                <span className="sh-item-main">
                  <span className="sh-item-title"><Bi v={it.title} langs={langs} /></span>
                  {subs.map((s, i) => <span key={i} className="sh-item-sub"><Bi v={s} langs={langs} sep=" · " /></span>)}
                  {it.leader && <span className="sh-item-who">{it.leader}</span>}
                  {it.notes?.trim() && <span className="sh-item-note">{it.notes.trim()}</span>}
                </span>
                {content && <span className="sh-toggle" aria-hidden="true" />}
              </div>
            );
            return (
              <li key={it.id} className="sh-item">
                {content ? (
                  <details open={openAll || undefined} key={`${it.id}-${openAll}`}>
                    <summary>{head}</summary>
                    <div className="sh-words bl-doc">
                      <ItemContent item={it} langs={langs} layout={layout} />
                    </div>
                  </details>
                ) : (
                  head
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* the bulletin's weekly sections (announcements, a pastor's note …), as typed for this service */}
      {weeklySections(r.bulletin.options.page_layout).map((w) => {
        const v = r.bulletin.content?.[w.key];
        const present = langs.filter((l) => v?.[l]?.trim());
        if (!present.length) return null;
        const heading = Object.keys(w.heading).length ? w.heading : w.announcements ? LABEL.announcements : null;
        return (
          <section key={w.key} className="sh-weekly" data-key={w.key === ANNOUNCEMENTS_KEY ? 'announcements' : w.key}>
            {heading && <div className="sh-sec-head"><h2><Bi v={heading} langs={langs} sep=" · " /></h2></div>}
            {present.map((l) => (
              <div key={l} className="sh-weekly-lang" lang={l}>
                {v![l]!.split(/\r?\n/).filter((x) => x.trim()).map((ln, i) => (
                  <p key={i} className={`bl-an${isNumberedLine(ln) ? ' num' : ''}`}>{ln.trim()}</p>
                ))}
              </div>
            ))}
          </section>
        );
      })}

      {teams.length > 0 && (
        <section>
          <div className="sh-sec-head"><h2><Bi v={LABEL.servingToday} langs={langs} sep=" · " /></h2></div>
          <div className="sh-teams">
            {teams.map((g) => (
              <div key={biText(g.team, r.languages)} className="sh-team">
                <div className="sh-team-name"><Bi v={g.team} langs={langs} sep=" · " /></div>
                {g.rows.map((row, i) => (
                  <div key={i} className="sh-team-row">
                    <span className="muted"><Bi v={row.role} langs={langs} /></span>
                    <span>{row.people.join(', ')}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}

      {!!r.next_roster?.roles.length && (
        <section>
          <div className="sh-sec-head"><h2>{langs.map((l) => servingOnLabel(r.next_roster!.date, l)).filter((x, i, a) => a.indexOf(x) === i).join(' · ')}</h2></div>
          <div className="sh-teams">
            <div className="sh-team">
              {r.next_roster.roles.map((row, i) => (
                <div key={i} className="sh-team-row">
                  <span className="muted"><Bi v={row.role} langs={langs} /></span>
                  <span>{row.people.map((p) => [...new Set(langs.map((l) => p[l]?.trim()).filter(Boolean))].join(' ')).join(', ')}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {r.notices.length > 0 && <div className="sh-notices">{r.notices.map((n, i) => <div key={i}>{n}</div>)}</div>}
      <footer className="sh-foot">
        <Tagline lang={UI_LANGS.includes(lang) ? lang : 'en'} />
        <span className="sh-foot-brand"><ReedMark className="sh-mark-sm" /> Canon{!attendee && <> · {t('Read-only view for the service team')}</>}</span>
      </footer>
    </div>
  );
}
