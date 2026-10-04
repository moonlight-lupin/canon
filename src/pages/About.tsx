// About Canon: what it is, version, licence and credits for bundled content and software.
import { useApi } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { PageHead } from '../components/ui.tsx';
import { ReedMark } from '../components/icons.tsx';
import { Tagline } from '../components/brand.tsx';

interface About { name: string; version: string; license: string; schema: number; node: string }

const CREDITS: { what: string; zh: string; source: string; licence: string; url?: string }[] = [
  { what: 'King James Version (1769)', zh: '英王钦定本', source: 'scrollmapper/bible_databases', licence: 'Public domain', url: 'https://github.com/scrollmapper/bible_databases' },
  { what: 'Chinese Union Version 和合本 (1919)', zh: '和合本（简 / 繁）', source: 'scrollmapper/bible_databases; Simplified via OpenCC', licence: 'Public domain', url: 'https://github.com/scrollmapper/bible_databases' },
  { what: 'Westminster Confession and Catechisms (1647)', zh: '威斯敏斯特信条与教理问答', source: 'NonlinearFruit/Creeds.json', licence: 'Public domain', url: 'https://github.com/NonlinearFruit/Creeds.json' },
  { what: 'Hymns, psalms and historic liturgy in the starter library', zh: '资料库中的诗歌、诗篇与历史礼文', source: 'Texts written before 1929 and historic creeds', licence: 'Public domain' },
];

const SOFTWARE = ['React', 'Vite', 'Express', 'Node.js (node:sqlite)', 'Model Context Protocol SDK', 'zod', 'dnd-kit', 'docx', 'nodemailer', 'qrcode', 'OpenCC (opencc-js)'];

export default function AboutPage() {
  const { t, lang } = useI18n();
  const { data } = useApi<About>('/about');
  const zh = lang === 'zh' || lang === 'zh-Hant';
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
                {zh
                  ? 'Canon 是为教会设计的本地优先系统：崇拜程序与程序单、投影、会友与同工名册、小组、事奉表，以及供 AI 助手使用、权限可控的 MCP 服务器。支持多种语言；可安装在办公室电脑、自己的服务器或 Docker 上，资料始终由教会自己掌管。'
                  : 'Canon is a local-first system for churches: service planning with bulletins and slides, member and co-worker registers, groups, a volunteer rota, and a permission-controlled MCP server for AI assistants. It is multilingual and self-hosted — on an office PC, the church’s own server or any Docker host — so the church’s data stays under the church’s control.'}
              </p>
              <p className="small muted" style={{ margin: 0 }}>
                {zh
                  ? '“Canon”一词源自希腊文 κανών，意为量度的芦苇、准则（结 40:3；加 6:16）。'
                  : 'The name comes from the Greek κανών — a measuring reed, a rule (Ezek 40:3; Gal 6:16).'}
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
                    <td><strong>{zh ? c.zh : c.what}</strong><div className="small muted">{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.source}</a> : c.source}</div></td>
                    <td className="nowrap"><span className="badge ok">{c.licence}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            {zh
              ? '教会自行加入的诗歌、圣经译本与图片，其版权归原作者所有；请依照您的授权（如 CCLI）使用。'
              : 'Hymns, Bible versions and images that your church adds remain under their owners’ copyright — use them under your own licences (e.g. CCLI).'}
          </p>
        </section>

        <section className="card stack">
          <h2>{t('Software')}</h2>
          <p className="small" style={{ margin: 0 }}>
            {zh ? 'Canon 以 MIT 许可证发布，并使用以下开源软件：' : 'Canon is released under the MIT licence and is built with these open-source projects:'}{' '}
            {SOFTWARE.join(' · ')}
          </p>
        </section>

        <section className="card stack">
          <h2>{t('Privacy')}</h2>
          <p className="small" style={{ margin: 0 }}>
            {zh
              ? '会友资料只存放在您自己的 Canon 数据库中（data/canon.db，或 Docker 的数据卷）。分享链接不含联系方式；AI 助手只能看到管理员在“设置 → AI / MCP”中开放的模块，所有调用都有记录。'
              : 'Member data is stored only in your own Canon database (data/canon.db, or the Docker data volume). Share links never include contact details; AI assistants see only the modules an administrator opens in Settings → AI / MCP, and every call is logged.'}
          </p>
        </section>
      </div>
    </div>
  );
}
