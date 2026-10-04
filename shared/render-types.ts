import type { CoverOptions, ItemKind, L10n, Lang, Posture, Season } from './types.ts';
import type { BulletinBlock, BulletinFull, BulletinOptions } from './presentation.ts';

export interface Line {
  who: 'L' | 'C' | 'A' | null; // leader / congregation / all / plain
  text: string;
}
/** Paragraphs of lines. A blank line in the source starts a new paragraph. */
export type Paras = Line[][];

export interface RenderedVerse {
  chapter: number;
  verse: number;
  text: string;
}

/** A QR code, picture or note (bulletin block) projected on a slide after an item. */
export interface RenderedSlideBlock {
  id: number;
  kind: 'qr' | 'image' | 'text';
  /** qr / image: caption under the code, completed for the service languages */
  caption: L10n;
  /** text: the note, completed for the service languages */
  text?: L10n;
  /** image: a picture has been uploaded (GET /api/assets/bulletin-block-<id>) */
  has_image: boolean;
  /** qr: what the code opens (GET /api/bulletin-blocks/<id>/qr.svg draws it) */
  value?: string;
  /** cache key for the picture / QR URL (changes when the block changes) */
  v: string;
  /** text: bold (default) or normal */
  bold?: boolean;
}

export interface RenderedItem {
  id: number;
  kind: ItemKind;
  title: L10n;
  /** secondary label: hymn title, formatted scripture reference, text title, sermon title */
  subtitle: L10n;
  start: string;
  end: string;
  duration_min: number;
  role_name: L10n | null;
  /** people assigned to the item's role, or the free-text leader */
  leader: string | null;
  /** the leader per service language, with honorifics ("陈以诺传道" / "Ps. Chen Yi Nuo"); free-text leaders are the same in every language */
  leader_l10n?: L10n;
  /** what the congregation does during the item */
  posture?: Posture | null;
  /** a library text's own title (creeds, catechisms), used to bracket it in the bulletin: 【尼西亚信经】 */
  text_title?: L10n;
  notes: string | null;
  in_bulletin: boolean;
  on_slides: boolean;
  /** the item's own bulletin choice: null = follow the bulletin template */
  bulletin_text: 'full' | 'title' | null;
  /** what the bulletin prints: true = the words, false = title / reference only, 'first_stanza' (hymns) */
  bulletin_full: BulletinFull;
  song?: {
    id: number;
    title: L10n;
    author: string | null;
    composer: string | null;
    tune: string | null;
    meter: string | null;
    public_domain: boolean;
    copyright: string | null;
    ccli: string | null;
    /** hymnal number shown with the title, e.g. { abbr: "HP", number: "123" } (the item's hymnal, else the song's first) */
    number?: { abbr: string; number: string; hymnal: L10n };
    /** stanzas in singing order */
    stanzas: { label: string; text: L10n }[];
  };
  scripture?: {
    ref: L10n;
    /** per language: translation code + verses (empty if the reference is invalid or the Bible is not imported) */
    passages: Partial<Record<Lang, { translation: string; verses: RenderedVerse[] }>>;
    error?: string;
  };
  /** responsive / liturgical text per language */
  paras?: Partial<Record<Lang, Paras>>;
  /** QR codes / pictures / notes shown on one slide after the item's own (deleted blocks are left out) */
  slide_blocks: RenderedSlideBlock[];
  /** this item's own slide background (a picture block), else the template's */
  slide_bg?: { id: number; v: string } | null;
}

export interface RenderedService {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  title: L10n;
  theme: L10n;
  preacher: string | null;
  sermon_title: L10n;
  sermon_ref: L10n;
  languages: Lang[];
  layout: 'parallel' | 'stacked';
  status: string;
  church: { name: L10n; address: string; contact: string; ccli_license: string };
  items: RenderedItem[];
  roster: { team: L10n; role: L10n; people: string[]; /** each person per language, with honorifics */ people_l10n?: L10n[] }[];
  /** the next service (by date, the same service type when there is one): its date and every role with people */
  next_roster?: { service_id: number; date: string; roles: { role: L10n; people: L10n[] }[] } | null;
  /** every serving role's name (for table headings when nobody is assigned) */
  role_names?: L10n[];
  /** songs under copyright that need a licence notice */
  notices: string[];
  notes: string | null;
  /** liturgical season (override or computed) and its accent colour; colour is null when season colours are off */
  season: { key: Season; name: L10n; color: string | null };
  /** bulletin cover: style resolved from the service, else the church default; verse text resolved per language */
  cover: Omit<CoverOptions, 'style'> & { style: 'plain' | 'cross' | 'logo' | 'verse' | 'banner'; verse?: { ref: L10n; text: L10n } };
  /** a church logo has been uploaded (GET /api/assets/logo) */
  has_logo: boolean;
  /**
   * bulletin template in effect (service → church default → "Full words booklet") and its options (the page
   * layout's headings and fixed texts completed for the service languages), plus what its sections print:
   *  - content: the weekly texts per section key (service.bulletin_content, completed); announcements fall back to
   *    the body of the Announcements item for services written before weekly sections existed;
   *  - announcements_from_item: that fallback was used;
   *  - blocks: the QR codes / pictures / notes the layout prints (captions and notes completed).
   */
  bulletin: {
    template_id: number | null;
    name: L10n;
    options: BulletinOptions;
    content?: Record<string, L10n>;
    announcements_from_item?: boolean;
    blocks?: BulletinBlock[];
  };
  /** slide theme in effect (service → church default → Ink); its CSS is GET /api/slide-themes/:id/css */
  slide_theme_id: number | null;
}
