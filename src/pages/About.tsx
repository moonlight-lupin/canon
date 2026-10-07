// About Canon: what it is, version, licence and credits for bundled content and software.
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { PageHead } from '../components/ui.tsx';
import { ReedMark } from '../components/icons.tsx';
import { Tagline } from '../components/brand.tsx';

interface About { name: string; version: string; license: string; schema: number; node: string }

// `what` is translated with t() (locales/<code>/ui.json)
const CREDITS: { what: string; source: string; licence: string; url?: string }[] = [
  { what: 'King James Version (1769)', source: 'scrollmapper/bible_databases', licence: 'Public domain', url: 'https://github.com/scrollmapper/bible_databases' },
  { what: 'Chinese Union Version 和合本 (1919)', source: 'scrollmapper/bible_databases; Simplified via OpenCC', licence: 'Public domain', url: 'https://github.com/scrollmapper/bible_databases' },
  { what: 'Westminster Confession and Catechisms (1647)', source: 'NonlinearFruit/Creeds.json', licence: 'Public domain', url: 'https://github.com/NonlinearFruit/Creeds.json' },
  { what: 'Hymns, psalms and historic liturgy in the starter library', source: 'Texts written before 1929 and historic creeds', licence: 'Public domain' },
];

const SOFTWARE = ['React', 'Vite', 'Express', 'Node.js (node:sqlite)', 'Model Context Protocol SDK', 'zod', 'dnd-kit', 'docx', 'nodemailer', 'qrcode', 'OpenCC (opencc-js)'];

export default function AboutPage() {
  const { t } = useI18n();
  const { data } = useApi<About>('/about');
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <PageHead eyebrow={t('About')} title="Canon" />
      <div className="stack">
        <section className="card stack">
          <div className="row" style={{ gap: 14, alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <ReedMark className="brand-mark" />
            <div className="stack tight">
              <Tagline />
              <p style={{ margin: 0 }}>
                {t('Canon is a local-first system for churches: service planning with bulletins and slides, member and co-worker registers, groups, a volunteer rota, and a permission-controlled MCP server for AI assistants. It is multilingual and self-hosted — on an office PC, the church’s own server or any Docker host — so the church’s data stays under the church’s control.')}
              </p>
              <p className="small muted" style={{ margin: 0 }}>
                {t('The name comes from the Greek κανών — a measuring reed, a rule (Ezek 40:3; Gal 6:16).')}
              </p>
            </div>
          </div>
          <table className="t" style={{ maxWidth: 420 }}>
            <tbody>
              <tr><td className="muted">{t('Version')}</td><td>{data?.version ?? '…'}</td></tr>
              <tr><td className="muted">{t('Licence')}</td><td>{data?.license ?? 'MIT'}</td></tr>
              <tr><td className="muted">{t('Database schema')}</td><td>{data?.schema ?? '…'}</td></tr>
              <tr><td className="muted">Node.js</td><td>{data?.node ?? '…'}</td></tr>
              <tr><td className="muted">{t('Source code')}</td><td><a href="https://github.com/moonlight-lupin/canon" target="_blank" rel="noreferrer">github.com/moonlight-lupin/canon</a></td></tr>
            </tbody>
          </table>
        </section>

        <section className="card stack">
          <h2>{t('Content credits')}</h2>
          <div className="table-wrap">
            <table className="t">
              <tbody>
                {CREDITS.map((c) => (
                  <tr key={c.what}>
                    <td><strong>{t(c.what)}</strong><div className="small muted">{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.source}</a> : c.source}</div></td>
                    <td className="nowrap"><span className="badge ok">{c.licence}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {t('Hymns, Bible versions and images that your church adds remain under their owners’ copyright — use them under your own licences (e.g. CCLI).')}
          </p>
          <p className="small muted" style={{ margin: 0 }}>
            {t('Public domain depends on the country: in the United Kingdom the King James Version remains under the Crown’s perpetual rights, and hymns first published before 1929 are public domain in the United States, but where copyright lasts 70 years after the author’s death some words, translations or arrangements may still be in copyright.')}
          </p>
        </section>

        <section className="card stack">
          <h2>{t('Software')}</h2>
          <p className="small" style={{ margin: 0 }}>
            {t('Canon is released under the MIT licence and is built with these open-source projects:')}{' '}
            {SOFTWARE.join(' · ')}
          </p>
        </section>

        <section className="card stack">
          <h2>{t('Privacy')}</h2>
          <p className="small" style={{ margin: 0 }}>
            {t('Member data is stored only in your own Canon database (data/canon.db, or the Docker data volume). Share links never include contact details; AI assistants see only the modules an administrator opens in Settings → AI / MCP, and every call is logged.')}
          </p>
        </section>
      </div>
    </div>
  );
}
