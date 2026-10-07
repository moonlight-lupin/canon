// 0.16.0: translations live in locales/<code>/ (see CONTRIBUTING-TRANSLATIONS.md). The generated files are up to date,
// placeholders match, Simplified and Traditional Chinese follow each other both ways, and a language with a
// ui.json is an interface language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, codeStrings, placeholders, plan, stale, syncChineseGuide, syncChineseUi, syncPair } from '../scripts/i18n-lib.ts';
import { UI_LOCALES, UI_FALLBACK } from '../shared/locales.generated.ts';
import { UI_LANGS, langInfo } from '../shared/languages.ts';

test('`npm run i18n` has been run: the English list, the generated file and Chinese are up to date', () => {
  assert.deepEqual(stale(plan()), [], 'run npm run i18n and commit what it changes');
});

test('every translation keeps the placeholders ({n}, {name} …) of its English phrase', () => {
  const p = plan();
  const used = codeStrings();
  for (const code of UI_LOCALES.filter((c) => c !== 'en')) assert.deepEqual(check(code, p.catalogue, used).badPlaceholders, [], code);
  assert.equal(placeholders('Added {n} of {total}'), '{n} {total}');
});

test('a language with locales/<code>/ui.json is an interface language, with the badge', () => {
  for (const c of ['en', 'zh', 'zh-Hant']) assert.ok(UI_LOCALES.includes(c) && UI_LANGS.includes(c) && langInfo(c).ui, c);
  assert.ok(!UI_LANGS.includes('ms') || UI_LOCALES.includes('ms'));
  assert.equal(UI_FALLBACK['zh-Hant'], 'zh');
});

test('Simplified ⇄ Traditional: whichever side was edited, the other follows; both edited by hand, both stay', () => {
  // new on one side: converted
  assert.deepEqual(syncPair('设置', undefined, undefined), ['设置', '設置']);
  assert.deepEqual(syncPair(undefined, '說明', undefined), ['说明', '說明']);
  const prev: [string, string] = ['旧的', '舊的'];
  // Simplified edited: Traditional follows
  assert.deepEqual(syncPair('新的', '舊的', prev), ['新的', '新的']);
  // Traditional edited: Simplified follows
  assert.deepEqual(syncPair('旧的', '軟體', prev), ['软体', '軟體']);
  // both edited by hand: both stay (e.g. a Taiwan word chosen on purpose)
  assert.deepEqual(syncPair('软件', '軟體', prev), ['软件', '軟體']);
  // removed from one side, the other unchanged: gone from both
  assert.equal(syncPair(undefined, '舊的', prev), null);
  // a whole dictionary
  const r = syncChineseUi({ Save: '保存', Help: '帮助' }, { Help: '說明' }, { ui: { Help: ['帮助', '幫助'] } });
  assert.equal(r.hant.Save, '保存');
  assert.equal(r.zh.Help, '说明', 'the Traditional edit came back to Simplified');
  assert.deepEqual(r.state.ui.Help, ['说明', '說明']);
});

test('the user guide: the Chinese file that was edited is converted into the other', () => {
  const first = syncChineseGuide('# 指南\n设置', null, undefined);
  assert.match(first.hant, /設置/);
  const edited = syncChineseGuide('# 指南\n设置', first.hant.replace('設置', '設定'), first.state);
  assert.equal(edited.zh, '# 指南\n设定', 'a Traditional edit flows back');
  const both = syncChineseGuide('# 指南\n设置甲', first.hant.replace('設置', '設定乙'), first.state);
  assert.ok(both.note, 'both edited: left for a person to bring together');
});
