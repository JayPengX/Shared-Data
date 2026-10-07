import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SPORTS_LIB ||= '../Quadra-Fixtures/public/lib';
const { espnGames } = await import('../watch.mjs');

test("a scoreboard's games over, as the app's highlights picking reads them; a race weekend's sessions each its own", () => {
  const team = (id, name, short, score, homeAway) => ({ homeAway, team: { id, displayName: name, shortDisplayName: short }, score });
  const data = {
    events: [
      { id: '1', date: '2026-10-07T00:08Z', competitions: [{ status: { type: { state: 'post', name: 'STATUS_FINAL' } }, notes: [{ headline: 'NLDS - Game 3' }], series: { type: 'playoff', summary: 'MIL leads 2-1' }, competitors: [team('25', 'San Diego Padres', 'Padres', '4', 'home'), team('8', 'Milwaukee Brewers', 'Brewers', '3', 'away')] }] },
      { id: '2', date: '2026-10-08T00:08Z', competitions: [{ status: { type: { state: 'pre' } }, competitors: [team('1', 'A', 'A', '', 'home'), team('2', 'B', 'B', '', 'away')] }] },
      { id: '3', date: '2026-10-06T00:08Z', competitions: [{ status: { type: { state: 'post', name: 'STATUS_POSTPONED' } }, competitors: [team('1', 'A', 'A', '', 'home'), team('2', 'B', 'B', '', 'away')] }] }
    ]
  };
  const [g, ...rest] = espnGames(data, 'mlb');
  assert.equal(rest.length, 0);
  assert.deepEqual(g, { id: '1', league: 'mlb', kind: 'match', start: '2026-10-07T00:08Z', status: { state: 'post' }, home: { id: '25', en: 'San Diego Padres', name: 'San Diego Padres', short: 'Padres', score: '4' }, away: { id: '8', en: 'Milwaukee Brewers', name: 'Milwaukee Brewers', short: 'Brewers', score: '3' }, note: 'NLDS - Game 3', series: { summary: 'MIL leads 2-1' } });
  const f1 = espnGames({ events: [{ id: '600060990', name: 'Gulf Air Bahrain Grand Prix', competitions: [{ type: { abbreviation: 'Qual' }, date: '2026-10-03T08:00Z', status: { type: { state: 'post' } } }, { type: { abbreviation: 'Race' }, date: '2026-10-04T07:00Z', status: { type: { state: 'pre' } } }] }] }, 'f1');
  assert.deepEqual(f1.map(x => [x.id, x.sessionKey]), [['600060990~Qual', 'Qual']]);
});
