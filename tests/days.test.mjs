import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonDays } from '../sports.mjs';

test("a season's game days: from its start across both year packs, as Taipei dates, a postponed game left out", () => {
  const events = [
    { date: '2026-04-12T23:30Z' }, // last season
    { date: '2026-10-21T23:30Z' }, // 10/22 in Taipei
    { date: '2026-10-22T02:00Z' },
    { date: '2027-04-11T19:00Z' },
    { date: '2026-11-03T00:00Z', status: { type: { name: 'STATUS_POSTPONED' } } }
  ];
  assert.deepEqual(seasonDays(events, Date.parse('2026-10-02T00:00Z')), ['2026-10-22', '2027-04-12']);
});
