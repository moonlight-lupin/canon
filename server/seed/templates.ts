// Seed service templates. Items reference library entries by key (song_key / text_key),
// so templates survive re-seeding. Roles are English ServiceRole names, matched when a
// service is created from the template.

import type { ItemKind, L10n, Template, TemplateItem } from '../../shared/types.ts';

export type SeedTemplate = Omit<Template, 'id'> & { key: string };

type Extra = Omit<TemplateItem, 'kind' | 'title' | 'duration_min'>;

function item(kind: ItemKind, title: L10n, duration_min: number, extra: Extra = {}): TemplateItem {
  return { kind, title, duration_min, ...extra };
}

function section(en: string, zh: string): TemplateItem {
  return { kind: 'section', title: { en, zh }, duration_min: 0, on_slides: false };
}

// ------------------------------------------------------------ shared building blocks

const GATHER = (): TemplateItem => section('God Gathers His People', '神招聚祂的子民');
const RENEW = (): TemplateItem => section('God Renews His People', '神更新祂的子民');
const SPEAK = (): TemplateItem => section('God Speaks to His People', '神向祂的子民说话');
const SEND = (): TemplateItem => section('God Sends His People', '神差遣祂的子民');

const prelude = (min = 5): TemplateItem =>
  item('music', { en: 'Prelude', zh: '序乐' }, min, { role: 'Musician', on_slides: false });

const postlude = (min = 3): TemplateItem =>
  item('music', { en: 'Postlude', zh: '殿乐' }, min, { role: 'Musician', on_slides: false });

const announcements = (min = 5): TemplateItem =>
  item('announcements', { en: 'Announcements', zh: '家事报告' }, min, {
    role: 'Elder on Duty',
    in_bulletin: true,
    on_slides: false,
  });

const hymnSlot = (en: string, zh: string, min = 4, notes?: string): TemplateItem =>
  item('song', { en, zh }, min, { role: 'Liturgist', ...(notes ? { notes } : {}) });

const song = (song_key: string, en: string, zh: string, min = 4): TemplateItem =>
  item('song', { en, zh }, min, { song_key, role: 'Liturgist' });

const reading = (en: string, zh: string, min = 3, scripture_ref?: string): TemplateItem =>
  item('scripture', { en, zh }, min, {
    role: 'Scripture Reader',
    ...(scripture_ref ? { scripture_ref } : { notes: 'Set the reference for this Lord’s Day.' }),
  });

const offeringWithDoxology = (): TemplateItem[] => [
  item('offering', { en: 'Offering', zh: '奉献' }, 4, { role: 'Ushers', on_slides: false }),
  song('doxology', 'Doxology', '三一颂', 1),
  item('text', { en: 'Offertory Prayer', zh: '奉献祷告' }, 1, { text_key: 'offertory-prayer', role: 'Elder on Duty' }),
];

// ------------------------------------------------------------ templates

export const SEED_TEMPLATES: SeedTemplate[] = [
  {
    key: 'lords-day-morning',
    name: { en: "Lord's Day Morning Worship", zh: '主日早堂崇拜' },
    description: {
      en: 'Full Reformed order of morning worship: gathering, renewal, the Word, and sending.',
      zh: '完整的改革宗主日早堂崇拜程序：招聚、更新、听道与差遣。',
    },
    service_type: 'lords_day',
    start_time: '10:00',
    items: [
      prelude(),
      GATHER(),
      item('text', { en: 'Call to Worship', zh: '宣召' }, 2, { text_key: 'call-psalm-95', role: 'Liturgist' }),
      item('text', { en: 'Prayer of Invocation', zh: '祈祷' }, 2, { text_key: 'invocation-prayer', role: 'Liturgist' }),
      hymnSlot('Hymn of Praise', '赞美诗'),

      RENEW(),
      item('text', { en: 'Reading of the Law', zh: '宣读律法' }, 2, { text_key: 'summary-of-the-law', role: 'Liturgist' }),
      item('text', { en: 'Prayer of Confession', zh: '认罪祷告' }, 2, { text_key: 'confession-psalm-51', role: 'Liturgist' }),
      item('text', { en: 'Assurance of Pardon', zh: '赦罪的确据' }, 1, { text_key: 'assurance-1-john-1', role: 'Liturgist' }),
      hymnSlot('Psalm or Hymn of Thanksgiving', '感恩诗篇／诗歌'),
      item('text', { en: 'Confession of Faith', zh: '信仰告白' }, 2, { text_key: 'apostles-creed', role: 'Liturgist' }),

      SPEAK(),
      reading('Old Testament Reading', '旧约读经'),
      reading('New Testament Reading', '新约读经'),
      item('prayer', { en: 'Pastoral Prayer', zh: '牧祷' }, 6, { role: 'Prayer Leader' }),
      item('text', { en: "The Lord's Prayer", zh: '主祷文' }, 1, { text_key: 'lords-prayer', role: 'Prayer Leader' }),
      ...offeringWithDoxology(),
      item('text', { en: 'Prayer for Illumination', zh: '求圣灵光照' }, 1, { text_key: 'prayer-for-illumination', role: 'Preacher' }),
      item('sermon', { en: 'Sermon', zh: '证道' }, 35, { role: 'Preacher' }),

      SEND(),
      hymnSlot('Hymn of Response', '回应诗歌'),
      item('text', { en: 'Benediction', zh: '祝福' }, 1, { text_key: 'benediction-aaronic', role: 'Preacher' }),
      song('gloria-patri', 'Gloria Patri', '荣耀颂', 1),
      postlude(),
      announcements(),
    ],
  },

  {
    key: 'lords-supper',
    name: { en: "Lord's Day Worship with the Lord's Supper", zh: '主日崇拜（守圣餐）' },
    description: {
      en: "Morning worship with the Nicene Creed and the celebration of the Lord's Supper after the sermon.",
      zh: '主日早堂崇拜，诵念尼西亚信经，并于证道后守圣餐。',
    },
    service_type: 'lords_supper',
    start_time: '10:00',
    items: [
      prelude(),
      GATHER(),
      item('text', { en: 'Call to Worship', zh: '宣召' }, 2, { text_key: 'call-psalm-100', role: 'Liturgist' }),
      item('text', { en: 'Prayer of Invocation', zh: '祈祷' }, 2, { text_key: 'invocation-prayer', role: 'Liturgist' }),
      hymnSlot('Hymn of Praise', '赞美诗'),

      RENEW(),
      item('text', { en: 'Reading of the Law', zh: '宣读律法' }, 3, { text_key: 'ten-commandments', role: 'Liturgist' }),
      item('text', { en: 'Prayer of Confession', zh: '认罪祷告' }, 2, { text_key: 'confession-psalm-51', role: 'Liturgist' }),
      item('text', { en: 'Assurance of Pardon', zh: '赦罪的确据' }, 1, { text_key: 'assurance-isaiah-1', role: 'Liturgist' }),
      hymnSlot('Psalm or Hymn of Thanksgiving', '感恩诗篇／诗歌'),
      item('text', { en: 'Confession of Faith', zh: '信仰告白' }, 3, { text_key: 'nicene-creed', role: 'Liturgist' }),

      SPEAK(),
      reading('Old Testament Reading', '旧约读经'),
      reading('New Testament Reading', '新约读经'),
      item('prayer', { en: 'Pastoral Prayer', zh: '牧祷' }, 5, { role: 'Prayer Leader' }),
      ...offeringWithDoxology(),
      item('text', { en: 'Prayer for Illumination', zh: '求圣灵光照' }, 1, { text_key: 'prayer-for-illumination', role: 'Preacher' }),
      item('sermon', { en: 'Sermon', zh: '证道' }, 30, { role: 'Preacher' }),

      section("God Nourishes His People: The Lord's Supper", '神喂养祂的子民：圣餐'),
      item('text', { en: "Invitation to the Lord's Table", zh: '圣餐的邀请与劝勉' }, 3, {
        text_key: 'lords-supper-invitation',
        role: 'Preacher',
      }),
      item('text', { en: 'Words of Institution', zh: '设立圣餐的话' }, 2, { text_key: 'words-of-institution', role: 'Preacher' }),
      item('prayer', { en: 'Prayer of Consecration', zh: '祝谢祷告' }, 3, {
        role: 'Preacher',
        notes: 'Thanksgiving, and setting apart the bread and the cup.',
      }),
      item('text', { en: "The Lord's Prayer", zh: '主祷文' }, 1, { text_key: 'lords-prayer', role: 'Preacher' }),
      item('sacrament', { en: 'Distribution of the Bread and the Cup', zh: '分饼分杯' }, 8, {
        role: 'Communion Servers',
        on_slides: false,
      }),
      song('when-i-survey', 'Communion Hymn', '圣餐诗歌', 4),
      item('text', { en: 'Thanksgiving after Communion', zh: '圣餐后的感恩' }, 2, {
        text_key: 'communion-thanksgiving-psalm-103',
        role: 'Liturgist',
      }),

      SEND(),
      hymnSlot('Hymn of Response', '回应诗歌'),
      item('text', { en: 'Benediction', zh: '祝福' }, 1, { text_key: 'benediction-apostolic', role: 'Preacher' }),
      song('gloria-patri', 'Gloria Patri', '荣耀颂', 1),
      postlude(),
      announcements(),
    ],
  },

  {
    key: 'evening-worship',
    name: { en: "Lord's Day Evening Worship", zh: '主日晚堂崇拜' },
    description: {
      en: 'A simpler evening service of about an hour: psalm-singing, catechism, the Word and prayer.',
      zh: '约一小时的简短晚堂崇拜：唱诗篇、要理问答、听道与祷告。',
    },
    service_type: 'evening',
    start_time: '18:00',
    items: [
      prelude(3),
      GATHER(),
      item('text', { en: 'Call to Worship', zh: '宣召' }, 1, { text_key: 'call-isaiah-6', role: 'Liturgist' }),
      item('text', { en: 'Votum and Salutation', zh: '宣召与问安' }, 1, { text_key: 'votum-salutation', role: 'Liturgist' }),
      song('psalm-100-old-hundredth', 'Psalm of Praise', '诗篇颂赞'),
      item('prayer', { en: 'Opening Prayer', zh: '祈祷' }, 2, { role: 'Liturgist' }),
      item('text', { en: 'Catechism', zh: '要理问答' }, 3, {
        text_key: 'westminster-shorter-catechism-1-4',
        role: 'Liturgist',
        notes: 'Replace with the catechism questions for this week.',
      }),
      hymnSlot('Hymn', '诗歌'),

      SPEAK(),
      reading('Scripture Reading', '读经'),
      item('text', { en: 'Prayer for Illumination', zh: '求圣灵光照' }, 1, { text_key: 'prayer-for-illumination', role: 'Preacher' }),
      item('sermon', { en: 'Sermon', zh: '证道' }, 25, { role: 'Preacher' }),

      SEND(),
      item('prayer', { en: 'Prayers of Intercession', zh: '代祷' }, 5, { role: 'Prayer Leader' }),
      song('abide-with-me', 'Closing Hymn', '结束诗歌'),
      item('text', { en: 'Benediction', zh: '祝福' }, 1, { text_key: 'benediction-hebrews-13', role: 'Preacher' }),
      announcements(2),
    ],
  },

  {
    key: 'baptism',
    name: { en: "Lord's Day Worship with Baptism", zh: '主日崇拜（施行洗礼）' },
    description: {
      en: 'Morning worship with the sacrament of baptism administered after the sermon.',
      zh: '主日早堂崇拜，于证道后施行洗礼圣礼。',
    },
    service_type: 'baptism',
    start_time: '10:00',
    items: [
      prelude(),
      GATHER(),
      item('text', { en: 'Call to Worship', zh: '宣召' }, 2, { text_key: 'call-psalm-24', role: 'Liturgist' }),
      item('text', { en: 'Prayer of Invocation', zh: '祈祷' }, 2, { text_key: 'invocation-prayer', role: 'Liturgist' }),
      hymnSlot('Hymn of Praise', '赞美诗'),

      RENEW(),
      item('text', { en: 'Reading of the Law', zh: '宣读律法' }, 2, { text_key: 'summary-of-the-law', role: 'Liturgist' }),
      item('text', { en: 'Prayer of Confession', zh: '认罪祷告' }, 2, { text_key: 'confession-psalm-51', role: 'Liturgist' }),
      item('text', { en: 'Assurance of Pardon', zh: '赦罪的确据' }, 1, { text_key: 'assurance-psalm-103', role: 'Liturgist' }),
      hymnSlot('Psalm or Hymn of Thanksgiving', '感恩诗篇／诗歌'),

      SPEAK(),
      reading('Old Testament Reading', '旧约读经'),
      reading('New Testament Reading', '新约读经'),
      item('prayer', { en: 'Pastoral Prayer', zh: '牧祷' }, 5, { role: 'Prayer Leader' }),
      item('text', { en: "The Lord's Prayer", zh: '主祷文' }, 1, { text_key: 'lords-prayer', role: 'Prayer Leader' }),
      ...offeringWithDoxology(),
      item('text', { en: 'Prayer for Illumination', zh: '求圣灵光照' }, 1, { text_key: 'prayer-for-illumination', role: 'Preacher' }),
      item('sermon', { en: 'Sermon', zh: '证道' }, 30, { role: 'Preacher' }),

      section('God Receives His People: Holy Baptism', '神接纳祂的子民：洗礼'),
      item('text', { en: 'Institution of Baptism', zh: '洗礼的设立与应许' }, 2, { text_key: 'baptism-institution', role: 'Preacher' }),
      item('text', { en: 'Confession of Faith', zh: '信仰告白' }, 2, {
        text_key: 'apostles-creed',
        role: 'Liturgist',
        notes: 'The congregation confesses the faith into which the child is baptized.',
      }),
      item('text', { en: 'Baptismal Vows', zh: '洗礼誓约' }, 4, { text_key: 'baptism-vows', role: 'Preacher' }),
      item('sacrament', { en: 'Administration of Baptism', zh: '施洗' }, 3, {
        role: 'Preacher',
        notes: 'Elder on duty assists; enter the name(s) of those being baptized.',
        on_slides: false,
      }),
      item('prayer', { en: 'Prayer for the Baptized and Their Family', zh: '为受洗者及其家庭祷告' }, 2, { role: 'Preacher' }),

      SEND(),
      song('the-churchs-one-foundation', 'Hymn of Response', '回应诗歌'),
      item('text', { en: 'Benediction', zh: '祝福' }, 1, { text_key: 'benediction-aaronic', role: 'Preacher' }),
      song('gloria-patri', 'Gloria Patri', '荣耀颂', 1),
      postlude(),
      announcements(),
    ],
  },

  {
    key: 'lessons-and-carols',
    name: { en: 'Nine Lessons and Carols', zh: '九篇经课与圣诞诗歌' },
    description: {
      en: 'Christmas service of nine Scripture lessons, from the Fall to the Word made flesh, with carols.',
      zh: '圣诞节礼拜：从人的堕落到道成肉身的九篇经课，穿插圣诞诗歌。',
    },
    service_type: 'special',
    start_time: '18:00',
    items: [
      prelude(),
      GATHER(),
      song('once-in-royal-davids-city', 'Processional Carol', '进堂诗歌'),
      item('text', { en: 'Votum and Salutation', zh: '宣召与问安' }, 1, { text_key: 'votum-salutation', role: 'Liturgist' }),
      item('prayer', { en: 'Bidding Prayer', zh: '开会祷告' }, 3, { role: 'Liturgist' }),
      item('text', { en: "The Lord's Prayer", zh: '主祷文' }, 1, { text_key: 'lords-prayer', role: 'Liturgist' }),

      section('The Promise of a Saviour', '救主的应许'),
      reading('First Lesson: The Fall', '第一课：人的堕落', 3, 'Genesis 3:8-19'),
      song('o-come-o-come-emmanuel', 'Carol', '诗歌'),
      reading('Second Lesson: The Promise to Abraham', '第二课：神向亚伯拉罕的应许', 2, 'Genesis 22:15-18'),
      hymnSlot('Carol', '诗歌'),
      reading('Third Lesson: The Prince of Peace', '第三课：和平之君', 2, 'Isaiah 9:2-7'),
      item('music', { en: 'Choir Anthem', zh: '诗班献诗' }, 4, { role: 'Musician', on_slides: false }),
      reading('Fourth Lesson: The Branch from Jesse', '第四课：耶西的枝子', 3, 'Isaiah 11:1-9'),
      song('o-little-town-of-bethlehem', 'Carol', '诗歌'),

      section('The Saviour Is Born', '救主降生'),
      reading('Fifth Lesson: The Annunciation', '第五课：天使报信', 3, 'Luke 1:26-38'),
      hymnSlot('Carol', '诗歌'),
      reading('Sixth Lesson: The Birth of Jesus', '第六课：耶稣降生', 2, 'Luke 2:1-7'),
      song('silent-night', 'Carol', '诗歌'),
      reading('Seventh Lesson: The Shepherds', '第七课：牧羊人', 2, 'Luke 2:8-16'),
      song('hark-the-herald', 'Carol', '诗歌'),
      reading('Eighth Lesson: The Wise Men', '第八课：东方博士', 3, 'Matthew 2:1-12'),
      hymnSlot('Carol', '诗歌'),
      reading('Ninth Lesson: The Word Made Flesh', '第九课：道成肉身', 3, 'John 1:1-14'),
      song('o-come-all-ye-faithful', 'Carol', '诗歌'),

      SEND(),
      item('prayer', { en: 'Closing Prayer', zh: '结束祷告' }, 2, { role: 'Preacher' }),
      item('text', { en: 'Benediction', zh: '祝福' }, 1, { text_key: 'benediction-apostolic', role: 'Preacher' }),
      song('joy-to-the-world', 'Recessional Carol', '退堂诗歌'),
      postlude(),
    ],
  },
];
