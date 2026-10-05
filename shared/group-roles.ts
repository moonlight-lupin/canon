// Which group roles lead: officer roles are listed first (moderator / chair / leader / teacher, then deputies, then
// secretary / treasurer). Used to sort members and, once, to mark who leads each group (0.12); after that the
// "Leads this group" mark on each member decides (it is what lets a leader record the group's meetings).
const LEAD_RE = /^(moderator|chair(man|person)?|president|leader|head|coordinator|convenor|teacher|主席|会长|组长|议长|团长|主理|负责人|老师|教师)$/i;
const DEPUTY_RE = /^(vice[- ]?(chair|president)|deputy|assistant leader|co-?leader|assistant teacher|副主席|副会长|副组长|副团长|助教)$/i;
const OFFICER_RE = /^(secretary|clerk|treasurer|书记|秘书|文书|财务|司库)$/i;

export const roleRank = (role: string | null | undefined) => {
  const r = (role ?? '').trim();
  if (!r || /^(member|pupil|student|组员|团员|会员|成员|学生)$/i.test(r)) return 9;
  if (LEAD_RE.test(r)) return 0;
  if (DEPUTY_RE.test(r)) return 1;
  if (OFFICER_RE.test(r)) return 2;
  return 5;
};

/** A leader or deputy role (Leader, Chair, Teacher, 组长, 副组长 …). */
export const isLeaderRole = (role: string | null | undefined) => roleRank(role) <= 1;
