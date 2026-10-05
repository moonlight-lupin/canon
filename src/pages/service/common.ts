// The service planner: item kinds (icon and label) and clock-time helpers, shared by its parts and by templates.
import type { IconName } from '../../components/icons.tsx';
import type { ItemKind, L10n, ServiceFull } from '../../types-client.ts';

export const KIND_ICON: Record<ItemKind, IconName> = {
  section: 'section', song: 'music', scripture: 'scroll', text: 'text', sermon: 'mic', prayer: 'pray',
  sacrament: 'cup', offering: 'gift', announcements: 'megaphone', music: 'music', other: 'dots',
};

export const KIND_LABEL: Record<ItemKind, L10n> = {
  section: { en: 'Section', zh: '段落' },
  song: { en: 'Hymn', zh: '诗歌' },
  scripture: { en: 'Scripture Reading', zh: '读经' },
  text: { en: 'Liturgy', zh: '礼文' },
  sermon: { en: 'Sermon', zh: '讲道' },
  prayer: { en: 'Prayer', zh: '祷告' },
  sacrament: { en: 'Sacrament', zh: '圣礼' },
  offering: { en: 'Offering', zh: '奉献' },
  announcements: { en: 'Announcements', zh: '报告' },
  music: { en: 'Music', zh: '音乐' },
  other: { en: 'Item', zh: '项目' },
};

export const KINDS = Object.keys(KIND_LABEL) as ItemKind[];

export const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export const fmtMin = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

export type Assignment = ServiceFull['assignments'][number] & { email?: string | null };
