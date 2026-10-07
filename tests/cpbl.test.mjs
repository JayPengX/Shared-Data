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

const wiki = `== 例行賽 ==
=== 上半球季 ===
{| class = "wikitable" style = "text-align:center"
|-
! width = 40  | 排名
! width = 150 | 隊伍
! width = 50  | 應賽
! width = 50  | 已賽
! width = 50  | 勝場
! width = 50  | 敗場
! width = 50  | 和局
! width = 50  | 勝率
! width = 50  | 勝差
! width = 70  | 淘汰指數
|-
| 1 || [[味全龍]]         ||60||60||39||21||0||{{Winning percentage|39|21}}||–||封王
|-
| 2 || [[富邦悍將]]       ||60||60||34||26||0||{{Winning percentage|34|26}}||5.0||淘汰
|-
| 3 || [[統一7-ELEVEn獅|統一獅]] ||60||60||30||29||1||{{Winning percentage|30|29}}||8.5||淘汰
|-
| 3 || [[台鋼雄鷹]]       ||60||60||30||29||1||{{Winning percentage|30|29}}||8.5||淘汰
|}
{{中華職棒賽程/表頭|上半球季}}
=== 下半球季 ===
{| class = "wikitable"
|-
! 排名
! 隊伍
! 已賽
! 勝場
! 敗場
! 和局
! 勝率
! 勝差
|-
| 1 || [[中信兄弟]] ||0||0||0||0||{{Winning percentage|0|0}}||–
|}`;

test("CPBL's tables from the season's Wikipedia page: each half and the year, by their headers", async () => {
  const { parseWiki, combine } = await import('../cpbl.mjs');
  const tables = parseWiki(wiki, 2026);
  assert.equal(tables.length, 1, 'a table of fewer than four clubs is not one');
  assert.equal(tables[0].title, '2026年 上半季');
  assert.deepEqual(tables[0].rows[2], { rank: 3, en: 'Uni-President Lions', zh: '統一7-ELEVEn獅', gp: 60, w: 30, t: 1, l: 29, pct: '0.508', gb: '8.5', magic: '淘汰' });
  assert.equal(tables[0].rows[0].gb, '-');
  assert.equal(tables[0].rows[1].gb, '5');
  // The league's page has the half on now: it replaces Wikipedia's, and comes first.
  const one = parseStandings(html);
  const official = { ...one, rows: [...one.rows, ...one.rows] };
  const pack = combine(official, tables, 2026);
  assert.equal(pack.half, 'second');
  assert.deepEqual(pack.tables.map(x => x.key), ['second', 'first']);
  assert.equal(pack.tables[0].rows[0].home, '16-0-14');
  assert.equal(combine(null, tables, 2026).half, 'first');
  assert.equal(combine(null, [], 2026), null);
});
