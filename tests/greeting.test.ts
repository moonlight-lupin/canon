// The dashboard greeting (0.14.1): the great feasts and Sundays have their own; otherwise the time of day or one of
// the season's greetings, the same all day and different from day to day; every phrase is translated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { greetingFor, timeOfDay } from '../shared/greeting.ts';

const at = (iso: string, hour = 10) => new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00`);

test('feasts and Sundays', () => {
  assert.equal(greetingFor(at('2026-12-25')), 'A blessed Christmas');
  assert.equal(greetingFor(at('2027-03-28')), 'Christ is risen', 'Easter Day 2027');
  assert.equal(greetingFor(at('2027-05-16')), 'Peace be with you', 'Pentecost 2027');
  assert.equal(greetingFor(at('2026-10-04')), 'A blessed Lord’s Day', 'an ordinary Sunday');
});

test('weekdays: time of day or the season, the same all day, varied across days', () => {
  assert.equal(timeOfDay(7), 'Good morning');
  assert.equal(timeOfDay(14), 'Good afternoon');
  assert.equal(timeOfDay(21), 'Good evening');
  assert.equal(timeOfDay(2), 'Good evening');
  const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'].map((d) => greetingFor(at(d)));
  assert.ok(new Set(week).size > 1, `varies: ${week.join(' | ')}`);
  for (const d of ['2026-10-06', '2026-12-08', '2027-03-10']) {
    const g = greetingFor(at(d, 8));
    assert.ok(g === greetingFor(at(d, 8)), 'stable');
  }
  // Advent weekdays use Advent's greetings (or the time of day)
  const advent = ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04'].map((d) => greetingFor(at(d, 9)));
  assert.ok(advent.every((g) => ['Good morning', 'Come, Lord Jesus', 'Grace and peace'].includes(g)), advent.join(' | '));
});

test('every greeting is in the Chinese dictionary', () => {
  const src = fs.readFileSync(new URL('../shared/greeting.ts', import.meta.url), 'utf8');
  const phrases = [...new Set([...src.matchAll(/'([A-Z][^']+)'/g)].map((m) => m[1]).filter((p) => !/^[A-Z][a-z]+$/.test(p) || p === 'Grace'))];
  const zh = fs.readFileSync(new URL('../src/i18n/zh.ts', import.meta.url), 'utf8');
  const missing = phrases.filter((p) => !zh.includes(`'${p}'`) && !zh.includes(`"${p}"`));
  assert.deepEqual(missing, []);
});
