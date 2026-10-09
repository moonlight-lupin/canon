// The in-app Guide's Markdown renderer: structure, and that raw HTML / unsafe links are never interpreted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse, renderBlocks, renderMarkdown, safeHref, sections, slugify } from '../src/guide/markdown.ts';

const html = (md: string) => renderToStaticMarkup(createElement('div', null, ...renderMarkdown(md)));

test('raw HTML in the source is escaped, not rendered', () => {
  const out = html('Hello <script>alert(1)</script> & <img src=x onerror=alert(2)>\n\n**<b>bold</b>**\n\n- <iframe src="x">');
  assert.ok(!/<script|<img|<iframe|<b>/i.test(out), out);
  assert.match(out, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &lt;img/);
  assert.match(out, /<strong>&lt;b&gt;bold&lt;\/b&gt;<\/strong>/);
});

test('unsafe link targets become plain text; safe ones are links', () => {
  const out = html('[evil](javascript:alert(1)) [data](data:text/html,x) [svc](/services) [web](https://example.org) [top](#getting-started)');
  assert.ok(!/javascript:|data:text/i.test(out), out);
  assert.match(out, /evil/);
  assert.match(out, /<a href="\/services">svc<\/a>/);
  assert.match(out, /<a href="https:\/\/example.org" target="_blank" rel="noreferrer noopener">web<\/a>/);
  assert.match(out, /<a href="#getting-started">top<\/a>/);
  assert.equal(safeHref('//evil.example'), null);
  assert.equal(safeHref(' JAVASCRIPT:x'), null);
});

test('headings, lists, emphasis, code, quotes and tables', () => {
  const out = html('# Title\n\n## Every week\n\n1. Open **Services**\n2. Press *New* and `Save`\n   - nested tip\n\n> **Tip:** be careful\n\n| A | B |\n|---|---|\n| 1 | 2 |');
  assert.match(out, /<h1 id="title">Title<\/h1>/);
  assert.match(out, /<h2 id="every-week">Every week<\/h2>/);
  assert.match(out, /<ol><li>Open <strong>Services<\/strong><\/li><li>Press <em>New<\/em> and <code>Save<\/code><ul><li>nested tip<\/li><\/ul><\/li><\/ol>/);
  assert.match(out, /<blockquote><p><strong>Tip:<\/strong> be careful<\/p><\/blockquote>/);
  assert.match(out, /<th>A<\/th><th>B<\/th>.*<td>1<\/td><td>2<\/td>/);
});

test('slugs keep CJK text; sections split at h2 / h3 with searchable text', () => {
  assert.equal(slugify('崇拜程序 **单**'), '崇拜程序-单');
  const blocks = parse('# Guide\n\nIntro\n\n## Plan\n\nUse the **planner**.\n\n### Hymns\n\nPick a hymn.\n\n## Print\n\nPrint it.');
  const s = sections(blocks);
  assert.deepEqual(s.map((x) => x.heading?.text ?? null), [null, 'Plan', 'Hymns', 'Print']);
  assert.equal(s[2].parent, 'Plan');
  assert.match(s[1].haystack, /use the planner/);
});

test('an explicit {#anchor} on a heading sets its id and is not shown', async () => {
  const { parse } = await import('../src/guide/markdown.ts');
  const [h] = parse('### 投影模板 {#slide-templates}');
  assert.deepEqual(h, { type: 'heading', level: 3, text: '投影模板', id: 'slide-templates' });
});

test('flow charts (0.19.6): a fenced block marked flow, one step per line, who in brackets, the ways a step can go side by side', () => {
  const src = ['```flow', '[Claimant] Signs and **submits**', '', '[Approver] Approves | Sends it back | Rejects', 'Paid', '```'].join('\n');
  const blocks = parse(src);
  assert.equal(blocks.length, 1);
  const b = blocks[0];
  assert.equal(b.type, 'flow');
  if (b.type !== 'flow') return;
  assert.equal(b.steps.length, 3, 'blank lines are not steps');
  assert.deepEqual(b.steps[0].boxes, [{ who: 'Claimant', text: 'Signs and **submits**' }]);
  assert.deepEqual(b.steps[1].boxes.map((x) => [x.who, x.text]), [['Approver', 'Approves'], [null, 'Sends it back'], [null, 'Rejects']]);
  assert.deepEqual(b.steps[2].boxes, [{ who: null, text: 'Paid' }]);
  const html = renderToStaticMarkup(createElement('div', null, ...renderBlocks(blocks)));
  assert.match(html, /class="flow"/);
  assert.match(html, /class="flow-step flow-branch"/);
  assert.equal(html.match(/class="flow-arrow"/g)?.length, 2, 'an arrow between steps');
  assert.match(html, /<strong>submits<\/strong>/, 'inline markup in the boxes');
  assert.ok(!html.includes('<pre>'), 'not shown as code');
  // other fenced blocks stay code; search finds a flow's words
  assert.equal(parse('```\n[x] a | b\n```')[0].type, 'code');
  assert.match(sections(blocks)[0].haystack, /approver approves/);
});
