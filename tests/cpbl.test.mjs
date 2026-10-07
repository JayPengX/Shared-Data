import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStandings } from '../cpbl.mjs';

const row = (rank, zh, gp, wtl, pct, gb, magic, rest) => `<tr><td class="sticky"><div class="sticky_wrap"><div class="rank">${rank}</div><div class="team-w-trophy"><a href="/team?TeamNo=X">${zh}</a></div></div></td><td class="num">${gp}</td><td class="num">${wtl}</td><td class="num">${pct}</td><td class="num">${gb}</td><td class="num">${magic}</td><td class="num">&nbsp;</td><td class="num">7-0-5</td>${rest}</tr>`;
const html = `<div class="DistTitle"><h3>2026年 下半季<span class="en"></span></h3></div>
<div class="RecordTable"><table><tr><th class="sticky"><div class="rank">排名</div><div>球隊</div></th><th class="num">出賽數</th><th class="num">勝-和-敗</th><th class="num">勝率</th><th class="num">勝差</th><th class="num">淘汰指數</th><th class="num">中信兄弟</th><th class="num">統一7-ELEVEn獅</th><th class="num">主場戰績</th><th class="num">客場戰績</th><th>連勝/連敗</th><th class="num">近十場戰績</th></tr>
${row(1, '中信兄弟', 60, '36-0-24', '0.6', '-', '', '<td class="num">16-0-14</td><td class="num">20-0-10</td><td>敗1</td><td class="num">6-0-4</td>')}
${row(2, '統一7-ELEVEn獅', 60, '34-1-25', '0.576', '1.5', 'E', '<td class="num">16-0-14</td><td class="num">18-1-11</td><td>勝6</td><td class="num">9-0-1</td>')}
</table></div>`;

test("CPBL's table as its page publishes it: the half, each club's record, its games behind and its elimination", () => {
  const t = parseStandings(html);
  assert.equal(t.title, '2026年 下半季');
  assert.equal(t.year, 2026);
  assert.equal(t.half, 'second');
  assert.deepEqual(t.rows[1], { rank: 2, en: 'Uni-President Lions', zh: '統一7-ELEVEn獅', gp: 60, w: 34, t: 1, l: 25, pct: '0.576', gb: '1.5', magic: 'E', home: '16-0-14', away: '18-1-11', streak: '勝6', last10: '9-0-1' });
  assert.equal(t.rows[0].en, 'CTBC Brothers');
  assert.deepEqual(parseStandings('<html>not the page</html>').rows, []);
});
