// A small sample service (public-domain words) used by the theme and bulletin-template previews, so they are
// drawn by the real slide and bulletin renderers exactly as the projector / printer will show them.
import type { L10n, Lang, Line, Paras, RenderedItem, RenderedService } from '../types-client.ts';
import { DEFAULT_BULLETIN_OPTIONS } from '../../shared/presentation.ts';
import { seasonInfo } from '../../shared/season.ts';

/** Languages the samples are written in. */
export const SAMPLE_LANGS: Lang[] = ['en', 'zh', 'zh-Hant'];

/** Up to two of the church's languages that the samples cover (falls back to English + Chinese). */
export function sampleLangs(church: Lang[]): Lang[] {
  const ls = church.filter((l) => SAMPLE_LANGS.includes(l)).slice(0, 2);
  return ls.length ? ls : ['en', 'zh'];
}

const paras = (body: string): Paras =>
  body.split(/\n\s*\n/).map((p) =>
    p.split('\n').filter((l) => l.trim()).map((l): Line => {
      const m = l.match(/^\s*([LCA]):\s?(.*)$/);
      return m ? { who: m[1] as Line['who'], text: m[2] } : { who: null, text: l.trim() };
    }),
  );
const parasBy = (b: L10n, langs: Lang[]) => Object.fromEntries(langs.filter((l) => b[l]).map((l) => [l, paras(b[l]!)]));

const DOXOLOGY: L10n = {
  en: 'Praise God, from whom all blessings flow;\nPraise him, all creatures here below;\nPraise him above, ye heavenly host;\nPraise Father, Son, and Holy Ghost. Amen.',
  zh: '赞美真神万福之根，\n世上万民都当颂扬，\n天上万军也当赞美，\n赞美圣父、圣子、圣灵。阿们。',
  'zh-Hant': '讚美真神萬福之根，\n世上萬民都當頌揚，\n天上萬軍也當讚美，\n讚美聖父、聖子、聖靈。阿們。',
};
const HOLY: { label: string; text: L10n }[] = [
  { label: '1', text: { en: 'Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to thee;\nHoly, holy, holy! merciful and mighty!\nGod in three Persons, blessed Trinity!' } },
  { label: '2', text: { en: 'Holy, holy, holy! All the saints adore thee,\nCasting down their golden crowns around the glassy sea;\nCherubim and seraphim falling down before thee,\nWhich wert, and art, and evermore shalt be.' } },
  { label: '3', text: { en: 'Holy, holy, holy! though the darkness hide thee,\nThough the eye of sinful man thy glory may not see;\nOnly thou art holy; there is none beside thee,\nPerfect in power, in love, and purity.' } },
];
const PSALM_23: Record<string, { translation: string; verses: string[] }> = {
  en: { translation: 'KJV', verses: ['The LORD is my shepherd; I shall not want.', 'He maketh me to lie down in green pastures: he leadeth me beside the still waters.', "He restoreth my soul: he leadeth me in the paths of righteousness for his name's sake."] },
  zh: { translation: 'CUVS', verses: ['耶和华是我的牧者，我必不致缺乏。', '他使我躺卧在青草地上，领我在可安歇的水边。', '他使我的灵魂苏醒，为自己的名引导我走义路。'] },
  'zh-Hant': { translation: 'CUVT', verses: ['耶和華是我的牧者，我必不致缺乏。', '他使我躺臥在青草地上，領我在可安歇的水邊。', '他使我的靈魂甦醒，為自己的名引導我走義路。'] },
};
const CALL: L10n = {
  en: 'L: O come, let us sing unto the LORD:\nC: Let us make a joyful noise to the rock of our salvation.\nL: Let us come before his presence with thanksgiving,\nC: And make a joyful noise unto him with psalms.',
  zh: 'L: 来啊，我们要向耶和华歌唱，\nC: 向拯救我们的磐石欢呼！\nL: 我们要来感谢他，\nC: 用诗歌向他欢呼！',
  'zh-Hant': 'L: 來啊，我們要向耶和華歌唱，\nC: 向拯救我們的磐石歡呼！\nL: 我們要來感謝他，\nC: 用詩歌向他歡呼！',
};
const CREED: L10n = {
  en: 'A: I believe in God the Father Almighty, Maker of heaven and earth:\n\nA: And in Jesus Christ his only Son our Lord;\nA: who was conceived by the Holy Ghost, born of the Virgin Mary;\nA: suffered under Pontius Pilate, was crucified, dead, and buried …',
  zh: 'A: 我信上帝，全能的父，创造天地的主。\n\nA: 我信我主耶稣基督，上帝的独生子；\nA: 因着圣灵感孕，从童贞女马利亚所生；\nA: 在本丢彼拉多手下受难，被钉于十字架，受死，埋葬……',
  'zh-Hant': 'A: 我信上帝，全能的父，創造天地的主。\n\nA: 我信我主耶穌基督，上帝的獨生子；\nA: 因著聖靈感孕，從童貞女馬利亞所生；\nA: 在本丟彼拉多手下受難，被釘於十字架，受死，埋葬……',
};
const PRAYER: L10n = {
  en: 'Almighty God, unto whom all hearts be open, all desires known, and from whom no secrets are hid: cleanse the thoughts of our hearts by the inspiration of thy Holy Spirit. Amen.',
  zh: '全能的上帝，万人的心你都察看，万人的愿望你都知道，任何隐秘的事都不能向你隐藏：求你借着圣灵的感动，洁净我们心中的意念。阿们。',
  'zh-Hant': '全能的上帝，萬人的心你都察看，萬人的願望你都知道，任何隱祕的事都不能向你隱藏：求你藉著聖靈的感動，潔淨我們心中的意念。阿們。',
};

const T = (en: string, zh: string, hant: string): L10n => ({ en, zh, 'zh-Hant': hant });

function item(id: number, start: string, kind: RenderedItem['kind'], title: L10n, extra: Partial<RenderedItem> = {}): RenderedItem {
  return {
    id, kind, title, subtitle: {}, start, end: start, duration_min: 3, role_name: null, leader: null, notes: null,
    in_bulletin: true, on_slides: true, bulletin_text: null, bulletin_full: true, slide_blocks: [], ...extra,
  };
}

/** The sample service in the given languages. `churchName` and `seasonColours` come from Settings. */
export function sampleService(langs: Lang[], churchName: L10n, seasonColours: boolean): RenderedService {
  const today = new Date().toISOString().slice(0, 10);
  const season = seasonInfo(today);
  const pick = (v: L10n): L10n => Object.fromEntries(Object.entries(v).filter(([l]) => langs.includes(l) || l === 'en'));
  const passages = Object.fromEntries(langs.filter((l) => PSALM_23[l]).map((l) => [l, { translation: PSALM_23[l].translation, verses: PSALM_23[l].verses.map((text, i) => ({ chapter: 23, verse: i + 1, text })) }]));
  const items: RenderedItem[] = [
    item(1, '10:00', 'section', T('Approach', '敬拜赞美', '敬拜讚美'), { duration_min: 0 }),
    item(2, '10:00', 'text', T('Call to Worship', '宣召', '宣召'), { leader: 'Elder Tan', leader_l10n: T('Elder Tan', '陈长老', '陳長老'), posture: 'stand', subtitle: T('Psalm 95:1–2', '诗篇 95:1–2', '詩篇 95:1–2'), paras: parasBy(CALL, langs) }),
    item(3, '10:03', 'song', T('Hymn', '诗歌', '詩歌'), {
      posture: 'stand',
      subtitle: T('HP 1 · Holy, Holy, Holy! Lord God Almighty', 'HP 1 · 圣哉，圣哉，圣哉', 'HP 1 · 聖哉，聖哉，聖哉'),
      song: {
        number: { abbr: 'HP', number: '1', hymnal: T('Hymns of Praise', '赞美诗', '讚美詩') },
        id: 1, title: T('Holy, Holy, Holy! Lord God Almighty', '圣哉，圣哉，圣哉', '聖哉，聖哉，聖哉'), author: 'Reginald Heber', composer: 'John B. Dykes',
        tune: 'NICAEA', meter: '11.12.12.10', public_domain: true, copyright: null, ccli: null, stanzas: HOLY,
      },
    }),
    item(4, '10:08', 'text', T('Confession of Faith', '信仰宣告', '信仰宣告'), {
      posture: 'stand', subtitle: T("The Apostles' Creed", '使徒信经', '使徒信經'), text_title: T("The Apostles' Creed", '使徒信经', '使徒信經'), paras: parasBy(CREED, langs),
    }),
    item(5, '10:11', 'scripture', T('Scripture Reading', '读经', '讀經'), {
      leader: 'Mrs Lim', leader_l10n: T('Sis. Grace Lim', '林美恩姐妹', '林美恩姊妹'), posture: 'sit',
      subtitle: T('Psalm 23:1–3', '诗篇 23:1–3', '詩篇 23:1–3'),
      scripture: { ref: T('Psalm 23:1–3', '诗篇 23:1–3', '詩篇 23:1–3'), passages },
    }),
    item(6, '10:14', 'prayer', T('Prayer of Confession', '认罪祷告', '認罪禱告'), { paras: parasBy(PRAYER, langs) }),
    item(7, '10:18', 'sermon', T('Sermon', '讲道', '講道'), { leader: 'Rev. Lee', leader_l10n: T('Rev. Lee', '李牧师', '李牧師'), subtitle: T('The Good Shepherd', '好牧人', '好牧人'), duration_min: 30 }),
    item(8, '10:48', 'song', T('Doxology', '三一颂', '三一頌'), {
      subtitle: T('Doxology', '三一颂', '三一頌'),
      posture: 'stand',
      song: { id: 2, title: T('Doxology', '三一颂', '三一頌'), author: 'Thomas Ken', composer: null, tune: 'OLD HUNDREDTH', meter: 'L.M.', public_domain: true, copyright: null, ccli: null, stanzas: [{ label: '1', text: DOXOLOGY }] },
    }),
    item(9, '10:52', 'announcements', T('Announcements', '报告', '報告'), {
      paras: parasBy(T(
        '1. Prayer meeting after the service in the hall.\n2. Bible study on Wednesday at 8pm.',
        '1. 聚会后在礼堂有祷告会。\n2. 周三晚上8点查经。',
        '1. 聚會後在禮堂有禱告會。\n2. 週三晚上8點查經。',
      ), langs),
    }),
  ];
  for (const it of items) {
    it.title = pick(it.title);
    it.subtitle = pick(it.subtitle);
  }
  return {
    id: 0,
    date: today,
    start_time: '10:00',
    end_time: '11:30',
    title: pick(T("Lord's Day Worship", '主日崇拜', '主日崇拜')),
    theme: pick(T('The Lord is my shepherd', '耶和华是我的牧者', '耶和華是我的牧者')),
    preacher: 'Rev. Lee',
    sermon_title: pick(T('The Good Shepherd', '好牧人', '好牧人')),
    sermon_ref: pick(T('John 10:11–18', '约翰福音 10:11–18', '約翰福音 10:11–18')),
    languages: langs,
    layout: 'parallel',
    status: 'final',
    church: { name: churchName, address: '', contact: '', ccli_license: '' },
    items,
    roster: [
      { team: T('Hospitality', '接待', '接待'), role: T('Usher', '招待员', '招待員'), people: ['Bro. Yu', 'Bro. Ouyang'], people_l10n: [T('Bro. Yu', '俞弟兄', '俞弟兄'), T('Bro. Ouyang', '欧阳弟兄', '歐陽弟兄')] },
      { team: T('Hospitality', '接待', '接待'), role: T('Welcome', '迎宾员', '迎賓員'), people: ['Sis. Hsu'], people_l10n: [T('Sis. Hsu', '许姐妹', '許姊妹')] },
    ],
    next_roster: {
      service_id: 0,
      date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
      roles: [
        { role: T('Preacher', '讲员', '講員'), people: [T('Ps. Chen', '卢传道', '盧傳道')] },
        { role: T('Liturgist', '主席', '主席'), people: [T('Bro. Tan', '陈弟兄', '陳弟兄')] },
        { role: T('Musician', '司琴', '司琴'), people: [T('Sis. Ong', '王姐妹', '王姊妹')] },
      ],
    },
    role_names: [T('Usher', '招待员', '招待員'), T('Welcome', '迎宾员', '迎賓員'), T('Preacher', '讲员', '講員'), T('Liturgist', '主席', '主席'), T('Musician', '司琴', '司琴'), T('Scripture Reader', '读经员', '讀經員')],
    notices: [],
    notes: null,
    season: { key: season.key, name: season.name, color: seasonColours ? season.color : null },
    cover: { style: 'plain' },
    has_logo: false,
    bulletin: { template_id: null, name: {}, options: DEFAULT_BULLETIN_OPTIONS },
    slide_theme_id: null,
  };
}
