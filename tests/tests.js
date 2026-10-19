// 브라우저에서 도는 테스트. tests/run_tests.py가 헤드리스 Chrome으로 열어 결과를 읽는다.
// 직접 볼 때: python serve.py 후 http://localhost:8000/tests/test.html
import * as L from '../lib/logic.js';
import { createSampleDb } from '../lib/sample-db.js';

const results = [];
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg ? msg + ': ' : ''}expected ${e}, got ${a}`);
}
async function waitFor(cond, msg, timeout = 8000) {
  const start = performance.now();
  for (;;) {
    let v;
    try { v = cond(); } catch { v = false; }
    if (v) return v;
    if (performance.now() - start > timeout) throw new Error(`timeout: ${msg}`);
    await new Promise((r) => setTimeout(r, 30));
  }
}

function fakeQuestions(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}#1`, answer: 1, choices: ['a', 'b', 'c', 'd'], q: `q${i}` }));
}

// ---------- 순수 로직 ----------

test('dateKey는 로컬 날짜를 YYYY-MM-DD로', () => {
  eq(L.dateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('shuffle: 같은 시드면 같은 결과, 원소는 그대로', () => {
  const arr = Array.from({ length: 20 }, (_, i) => i);
  const a = L.shuffle(arr, L.rng(42));
  eq(a, L.shuffle(arr, L.rng(42)));
  eq([...a].sort((x, y) => x - y), arr);
  assert(JSON.stringify(a) !== JSON.stringify(arr), '섞여야 함');
});

test('pickDaily: 같은 날 같은 10문제, 다른 날은 다름, 중복 없음', () => {
  const qs = fakeQuestions(40);
  const d1 = L.pickDaily(qs, '2026-10-19');
  eq(d1.length, 10);
  eq(new Set(d1).size, 10);
  eq(L.pickDaily([...qs].reverse(), '2026-10-19'), d1, '입력 순서와 무관');
  assert(JSON.stringify(L.pickDaily(qs, '2026-10-20')) !== JSON.stringify(d1), '날짜가 바뀌면 달라야 함');
});

test('pickDaily: 문제가 10개보다 적으면 있는 만큼', () => {
  eq(L.pickDaily(fakeQuestions(3), '2026-10-19').length, 3);
});

test('validateCards: 실제 data/cards.json에 오류 없음', async () => {
  const data = await (await fetch('../data/cards.json')).json();
  eq(L.validateCards(data), []);
  const qs = L.collectQuestions(data);
  assert(qs.length >= 10, '하루 10문제를 채울 만큼');
  eq(new Set(qs.map((q) => q.id)).size, qs.length, '문제 id가 모두 다름');
});

test('cards.json: 공식 출제 범위 2과목·30개 세부항목 구조', async () => {
  const data = await (await fetch('../data/cards.json')).json();
  // 2과목 세부항목은 20개지만 'SELECT 문'과 'WHERE 절'을 한 단원으로 묶어 단원은 19개
  eq(data.subjects.map((s) => s.units.length), [10, 19]);
  eq([...new Set(data.subjects.flatMap((s) => s.units.map((u) => u.group)))],
    ['데이터 모델링의 이해', '데이터 모델과 SQL', 'SQL 기본', 'SQL 활용', '관리 구문']);
  const topics = data.subjects.flatMap((s) => s.units.flatMap((u) => u.topics || [u.name]));
  eq(topics.length, 30);
});

// 다 채운 단원. 단원을 채울 때마다 여기에 추가한다.
const DONE_UNITS = [
  '관계형 데이터베이스 개요',
  'SELECT 기본과 WHERE 조건',
  '함수',
  'GROUP BY·HAVING 절',
  'ORDER BY 절',
  '조인',
  '표준 조인',
  '서브쿼리',
  '집합 연산자',
  '그룹 함수',
  '윈도우 함수',
  'Top N 쿼리',
  '계층형 질의와 셀프 조인',
  'PIVOT 절과 UNPIVOT 절',
  '정규 표현식',
  'DML',
  'TCL',
  'DDL',
  'DCL',
  '데이터모델의 이해',
  '엔터티',
];

test('다 채운 단원: 카드 5~8장, 카드마다 모든 항목과 해설 달린 문제 2개', async () => {
  const data = await (await fetch('../data/cards.json')).json();
  const units = data.subjects.flatMap((s) => s.units);
  for (const name of DONE_UNITS) {
    const unit = units.find((u) => u.name === name);
    assert(unit, `단원 없음: ${name}`);
    assert(unit.cards.length >= 5 && unit.cards.length <= 8, `${name}: 카드 ${unit.cards.length}장`);
    for (const c of unit.cards) {
      for (const k of ['summary', 'desc', 'analogy', 'exam']) assert(c[k], `${c.id}: ${k} 없음`);
      // 실행할 SQL이 없는 내용(1과목, DCL 등)은 예시 SQL 대신 표나 글자 그림으로 보여 준다.
      assert(c.sql || c.figures?.length || c.diagram, `${c.id}: 예시 SQL이나 표·그림 없음`);
      assert(c.pitfalls?.length > 0, `${c.id}: pitfalls 없음`);
      // oracle은 실제로 다른 점이 있을 때만 쓴다(없으면 '오라클과 다름' 표시도 안 붙는다).
      eq(c.quiz?.length, 2, `${c.id} 문제 수`);
      for (const q of c.quiz) assert(q.explain, `${c.id}: 해설 없음`);
    }
  }
});

test('validateCards: 겹치는 id, 잘못된 정답 번호, 보기 개수를 잡아냄', () => {
  const bad = { subjects: [{ name: 'S', units: [{ name: 'U', cards: [
    { id: 'a', title: 'A', quiz: [{ q: 'x', choices: ['1', '2', '3'], answer: 5 }] },
    { id: 'a', title: 'B' },
  ] }] }] };
  const errs = L.validateCards(bad).join('\n');
  assert(errs.includes('choices'), errs);
  assert(errs.includes('answer'), errs);
  assert(errs.includes('겹쳐요'), errs);
  eq(L.validateCards({}).length, 1);
});

test('validateCards: 카드 항목의 모양(문자열/배열)을 검사', () => {
  const bad = { subjects: [{ name: 'S', units: [{ name: 'U', group: 1, cards: [
    { id: 'a', title: 'A', summary: ['x'], pitfalls: 'x', oracle: [1] },
  ] }] }] };
  const errs = L.validateCards(bad).join('\n');
  for (const k of ['group', 'summary', 'pitfalls', 'oracle']) assert(errs.includes(k), `${k}: ${errs}`);
  const figs = { subjects: [{ name: 'S', units: [{ name: 'U', cards: [
    { id: 'b', title: 'B', diagram: ['x'], figures: [{ columns: ['가', '나'], rows: [['1', 2], ['1']] }, { columns: [], rows: 'x' }] },
    { id: 'c', title: 'C', figures: [{ title: '좋은 표', columns: ['가'], rows: [['1'], [null], [3]], note: '설명' }], diagram: 'A ── B' },
  ] }] }] };
  const ferrs = L.validateCards(figs);
  assert(ferrs.some((e) => e.includes('cards[0]') && e.includes('diagram')), ferrs.join('\n'));
  assert(ferrs.some((e) => e.includes('figures[0]') && e.includes('칸 수')), ferrs.join('\n'));
  assert(ferrs.some((e) => e.includes('figures[1]') && e.includes('columns')), ferrs.join('\n'));
  assert(ferrs.some((e) => e.includes('figures[1]') && e.includes('rows')), ferrs.join('\n'));
  assert(!ferrs.some((e) => e.includes('cards[1]')), `올바른 표·그림은 통과: ${ferrs.join('\n')}`);
});

test('recordAnswer: 틀리면 오답노트에 쌓이고 맞히면 빠짐', () => {
  const s = L.emptyState();
  const q = { id: 'x#1', answer: 2 };
  eq(L.recordAnswer(s, q, 1, 100), false);
  eq(L.recordAnswer(s, q, 3, 200), false);
  eq(s.wrong['x#1'], { count: 2, last: 200 });
  eq(L.recordAnswer(s, q, 2), true);
  eq(s.wrong, {});
});

test('ensureDaily: 같은 날은 유지, 날짜가 바뀌거나 문제가 지워지면 새로 뽑음', () => {
  const qs = fakeQuestions(15);
  const s = L.emptyState();
  const d = L.ensureDaily(s, qs, '2026-10-19');
  d.answers[d.ids[0]] = 1;
  assert(L.ensureDaily(s, qs, '2026-10-19') === d, '같은 날 유지');
  assert(L.ensureDaily(s, qs, '2026-10-20') !== d, '다음 날 새로');
  const d2 = s.daily;
  const left = qs.filter((q) => q.id !== d2.ids[0]);
  assert(L.ensureDaily(s, left, '2026-10-20') !== d2, '지워진 문제가 있으면 새로');
});

test('ensureDaily: 안 푼 상태에서 문제가 늘면 다시 뽑음', () => {
  const s = L.emptyState();
  eq(L.ensureDaily(s, fakeQuestions(3), '2026-10-19').ids.length, 3);
  eq(L.ensureDaily(s, fakeQuestions(30), '2026-10-19').ids.length, 10);
});

test('wrongQuestions: 카드에서 사라진 문제는 빼고 최근 순', () => {
  const s = L.emptyState();
  s.wrong = { 'c0#1': { count: 1, last: 1 }, 'c1#1': { count: 1, last: 5 }, 'gone#1': { count: 1, last: 9 } };
  eq(L.wrongQuestions(s, fakeQuestions(3)).map((q) => q.id), ['c1#1', 'c0#1']);
});

test('백업: 내보낸 것을 그대로 다시 불러옴', () => {
  const s = L.emptyState();
  s.wrong['a#1'] = { count: 3, last: 7 };
  s.daily = { date: '2026-10-19', ids: ['a#1'], answers: { 'a#1': 2 } };
  s.sql = 'SELECT 1;';
  const text = JSON.stringify(L.makeBackup(s, new Date(0)));
  eq(L.readBackup(text), s);
});

test('백업: 다른 파일·깨진 파일은 거절', () => {
  const throws = (text) => { try { L.readBackup(text); return false; } catch { return true; } };
  assert(throws('not json'), '깨진 JSON');
  assert(throws('{"app":"other","format":1}'), '다른 앱');
  assert(throws('{"app":"sqld-study","format":99}'), '새 버전');
});

test('normalizeState: 이상한 값은 빈 상태로', () => {
  eq(L.normalizeState(null), L.emptyState());
  eq(L.normalizeState({ wrong: [1, 2], daily: { date: 3 }, sql: 5 }), L.emptyState());
});

// ---------- 예제 DB (sql.js) ----------

test('예제 DB: 사원 11명, 부서 4개, 외부 조인으로 사원 없는 부서도 나옴', async () => {
  const SQL = await initSqlJs({ locateFile: (f) => `../vendor/${f}` });
  const db = createSampleDb(SQL);
  eq(db.exec('SELECT COUNT(*) FROM 사원')[0].values, [[11]]);
  eq(db.exec('SELECT COUNT(*) FROM 부서')[0].values, [[4]]);
  const r = db.exec('SELECT d.부서명 FROM 부서 d LEFT JOIN 사원 e ON d.부서번호 = e.부서번호 WHERE e.사원번호 IS NULL');
  eq(r[0].values, [['연구']]);
  db.close();
});

test('예제 카드의 SQL이 모두 예제 DB에서 실행됨', async () => {
  const SQL = await initSqlJs({ locateFile: (f) => `../vendor/${f}` });
  const data = await (await fetch('../data/cards.json')).json();
  for (const s of data.subjects) for (const u of s.units) for (const c of u.cards) {
    if (!c.sql) continue;
    const db = createSampleDb(SQL);
    try { db.exec(c.sql); } catch (e) { throw new Error(`${c.id}: ${e.message}`); }
    db.close();
  }
});

test('카드에 적은 SQLite 쪽 동작이 연습창 엔진(sql.js)에서 사실임', async () => {
  const SQL = await initSqlJs({ locateFile: (f) => `../vendor/${f}` });
  const db = createSampleDb(SQL);
  const one = (sql) => db.exec(sql)[0].values[0];
  eq(one('SELECT 1 + 1'), [2], 'FROM 없이 SELECT');
  eq(one('SELECT 7 / 2, 7 / 2.0'), [3, 3.5], '정수 나눗셈');
  eq(one("SELECT 'A' || NULL, '' IS NULL"), [null, 0], 'NULL 연결, 빈 문자열');
  eq(one("SELECT 'abc' LIKE 'A%'"), [1], 'LIKE 대소문자');
  eq(one('SELECT COUNT(*) FROM 사원 AS e'), [11], '테이블 별칭 AS');
  eq(db.exec('SELECT 급여 * 12 AS 연봉 FROM 사원 WHERE 연봉 > 60000')[0].values.length, 3, 'WHERE에서 별칭');
  eq(one('SELECT COUNT(*) FROM 사원 WHERE 커미션 IS 0'), [1], 'IS 0');
  eq(one('SELECT "과장"'), ['과장'], '큰따옴표를 문자로');
  eq(db.exec('SELECT 이름 직급 FROM 사원')[0].columns, ['직급'], '쉼표 빠진 별칭');
  // 카드 본문에 적은 건수
  eq(one("SELECT COUNT(*) FROM 사원 WHERE 직급 = '사원' OR 직급 = '대리' AND 급여 >= 3900"), [5]);
  eq(one("SELECT COUNT(*) FROM 사원 WHERE (직급 = '사원' OR 직급 = '대리') AND 급여 >= 3900"), [2]);
  eq(one('SELECT COUNT(*) FROM 사원 WHERE 부서번호 NOT IN (10)'), [8]);
  eq(one('SELECT COUNT(*) FROM 사원 WHERE 부서번호 NOT IN (10, NULL)'), [0]);
  eq(one('SELECT COUNT(*) FROM 사원 WHERE 커미션 IS NULL'), [7]);
  eq(one('SELECT COUNT(*) FROM (SELECT DISTINCT 직급, 부서번호 FROM 사원)'), [11]);
  eq(one('SELECT COUNT(*) FROM (SELECT DISTINCT 부서번호 FROM 사원)'), [4]);
  eq(one('SELECT COUNT(DISTINCT 부서번호) FROM 사원'), [3]);
  // 관계형 데이터베이스 개요
  eq(one('PRAGMA foreign_keys'), [0], '외래키 검사 꺼짐');
  db.exec("INSERT INTO 사원 (사원번호, 이름, 부서번호) VALUES (2000, '임시', 99)");
  eq(one('SELECT COUNT(*) FROM 사원 WHERE 부서번호 = 99'), [1], '없는 부서번호도 들어감');
  db.exec("INSERT INTO 사원 (사원번호, 이름, 급여) VALUES (2001, '임시2', '많이')");
  eq(one('SELECT typeof(급여) FROM 사원 WHERE 사원번호 = 2001'), ['text'], 'INTEGER 열에 문자');
  db.exec('DELETE FROM 사원 WHERE 사원번호 >= 2000');
  eq(one('SELECT typeof(이름), typeof(급여), typeof(입사일), typeof(커미션) FROM 사원 WHERE 사원번호 = 1001'), ['text', 'integer', 'text', 'null']);
  eq(one('SELECT COUNT(*) FROM 사원, 부서'), [44], '곱집합 11 × 4');
  // createSampleDb가 채워 둔 REGEXP 연산자(정규 표현식 단원)
  eq(one("SELECT '김대표' REGEXP '^김', '이부장' REGEXP '^김', NULL REGEXP 'a'"), [1, 0, null]);
  eq(one("SELECT COUNT(*) FROM 사원 WHERE 이름 REGEXP '(대리|사원)$'"), [5]);
  for (const bad of ['SELECT UNIQUE 직급 FROM 사원', 'SELECT 이름, DISTINCT 직급 FROM 사원', 'SELECT 사원.이름 FROM 사원 e',
    "INSERT INTO 사원 (사원번호, 이름) VALUES (1001, '중복')", 'INSERT INTO 사원 (사원번호, 이름) VALUES (2002, NULL)']) {
    let failed = false;
    try { db.exec(bad); } catch { failed = true; }
    assert(failed, `오류가 나야 함: ${bad}`);
  }
  db.close();
});

async function seededDb() {
  const SQL = await initSqlJs({ locateFile: (f) => `../vendor/${f}` });
  const db = createSampleDb(SQL);
  return {
    db,
    one: (sql) => db.exec(sql)[0].values[0],
    rows: (sql) => db.exec(sql)[0]?.values || [],
    fails: (sql) => { try { db.exec(sql); return false; } catch { return true; } },
  };
}

test('함수 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, fails } = await seededDb();
  // 문제 정답 중 SQLite로도 계산되는 것
  eq(one("SELECT UPPER(SUBSTR('database', 5, 4))"), ['BASE']);
  eq(one("SELECT SUBSTR('SQLDEVELOPER', -5, 3)"), ['LOP']);
  eq(one("SELECT LENGTH(RTRIM('SQLD  ')) + INSTR('SQLD', 'L')"), [7]);
  eq(one("SELECT LENGTH('SQL 개발'), SUBSTR('SQLD', 2, 2), LTRIM('xxSQLxx', 'x')"), [6, 'QL', 'SQLxx']);
  eq(one('SELECT CEIL(-2.5), FLOOR(-2.5), ROUND(-2.4), CEIL(-3.1), FLOOR(-3.1), CAST(-3.7 AS INTEGER)'), [-2, -3, -2, -3, -4, -3]);
  eq(one('SELECT NULLIF(10, 10), COALESCE(NULL, 3, NULL), IFNULL(NULL, 0), NULLIF(5, 3)'), [null, 3, 0, 5]);
  eq(one("SELECT CASE WHEN 5000 > 3000 THEN 'A' WHEN 5000 > 4000 THEN 'B' ELSE 'C' END"), ['A']);
  // 오라클과 다르다고 적은 SQLite 동작
  eq(one('SELECT ROUND(1234.567, -2), 7 / 0'), [1235, null], '음수 자리 무시, 0으로 나누기');
  eq(one("SELECT date('2024-01-31', '+1 month'), '2' > 10, '2' > '10', typeof('10' + 5)"), ['2024-03-02', 1, 1, 'integer']);
  eq(one("SELECT CONCAT('a', 'b', 'c')"), ['abc'], 'SQLite CONCAT은 여러 인자');
  for (const f of ["INITCAP('a')", "LPAD('7', 3, '0')", "RPAD('7', 3, '0')", 'TRUNC(3.7)', 'MOD(7, 3)', 'NVL(NULL, 0)',
    'NVL2(1, 2, 3)', "DECODE(1, 1, 'a', 'b')", "TO_CHAR(1)", "TO_NUMBER('1')", "TO_DATE('2024-01-01', 'YYYY-MM-DD')",
    "ADD_MONTHS('2024-01-31', 1)", 'SYSDATE', "TRIM(LEADING 'x' FROM 'xxa')"]) {
    assert(fails(`SELECT ${f}`), `SQLite에서 안 돼야 함: ${f}`);
  }
  db.close();
});

test('GROUP BY·HAVING 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  eq(one('SELECT COUNT(*), COUNT(커미션), SUM(커미션), AVG(커미션), COUNT(DISTINCT 직급) FROM 사원'), [11, 4, 1000, 250, 6]);
  eq(one('SELECT ROUND(AVG(COALESCE(커미션, 0)), 1) FROM 사원'), [90.9]);
  eq(one('SELECT SUM(급여 + 커미션), SUM(급여) + SUM(커미션) FROM 사원'), [19100, 52400]);
  eq(one('SELECT COUNT(*), SUM(급여), MAX(급여), AVG(급여) FROM 사원 WHERE 1 = 0'), [0, null, null, null]);
  eq(rows('SELECT 부서번호, COUNT(*) FROM 사원 GROUP BY 부서번호 ORDER BY 부서번호'), [[null, 1], [10, 2], [20, 4], [30, 4]]);
  eq(rows('SELECT 부서번호 FROM 사원 GROUP BY 부서번호 HAVING COUNT(*) >= 3 ORDER BY 1'), [[20], [30]]);
  eq(rows("SELECT 부서번호, COUNT(*), AVG(급여) FROM 사원 WHERE 직급 <> '대표' GROUP BY 부서번호 HAVING AVG(급여) >= 3000 ORDER BY 1"),
    [[10, 1, 3100], [20, 4, 4700], [30, 4, 4525]], '따라가기 카드');
  eq(rows('SELECT 부서번호 FROM 사원 WHERE 급여 >= 4000 GROUP BY 부서번호 HAVING COUNT(*) >= 2').length, 2);
  eq(rows('SELECT 부서번호, 직급 FROM 사원 GROUP BY 부서번호, 직급').length, 11);
  // 오라클과 다르다고 적은 SQLite 동작
  eq(rows('SELECT 부서번호, 이름, COUNT(*) FROM 사원 GROUP BY 부서번호').length, 4, 'GROUP BY에 없는 열 허용');
  eq(rows('SELECT 부서번호 AS d, COUNT(*) FROM 사원 GROUP BY d').length, 4, 'GROUP BY 별칭 허용');
  eq(rows('SELECT 부서번호, COUNT(*) AS 인원 FROM 사원 GROUP BY 부서번호 HAVING 인원 >= 3').length, 2, 'HAVING 별칭 허용');
  assert(fails('SELECT STDDEV(급여) FROM 사원'), 'STDDEV 없음');
  assert(fails('SELECT 부서번호 FROM 사원 WHERE COUNT(*) > 1 GROUP BY 부서번호'), 'WHERE에 집계 함수');
  assert(fails('SELECT COUNT(DISTINCT *) FROM 사원'), 'COUNT(DISTINCT *)');
  db.close();
});

test('ORDER BY 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, rows, fails } = await seededDb();
  db.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('9'), ('10'), ('100'), ('2')");
  eq(rows('SELECT v FROM t ORDER BY v').flat(), ['10', '100', '2', '9'], '문자 정렬');
  db.exec('CREATE TABLE u (부서, 급여); INSERT INTO u VALUES (20, 300), (10, 500), (20, 500), (10, 300)');
  eq(rows('SELECT 부서, 급여 FROM u ORDER BY 급여 DESC, 부서')[0], [10, 500]);
  eq(rows('SELECT DISTINCT 직급 FROM 사원 ORDER BY 직급').flat(), ['과장', '대리', '대표', '부장', '사원', '인턴'], '직급 가나다순');
  const byCase = rows("SELECT 직급 FROM 사원 ORDER BY CASE 직급 WHEN '대표' THEN 1 WHEN '부장' THEN 2 WHEN '과장' THEN 3 WHEN '대리' THEN 4 WHEN '사원' THEN 5 ELSE 9 END, 급여 DESC").flat();
  eq([byCase[0], byCase[10]], ['대표', '인턴']);
  eq(rows('SELECT 부서번호, COUNT(*), AVG(급여) AS 평균급여 FROM 사원 WHERE 부서번호 IS NOT NULL GROUP BY 부서번호 HAVING COUNT(*) >= 2 ORDER BY 평균급여 DESC'),
    [[10, 2, 6050], [20, 4, 4700], [30, 4, 4525]]);
  eq(rows("SELECT 이름 FROM 사원 WHERE 부서번호 = 30 ORDER BY 직급").flat(), ['정과장', '조대리', '박부장', '장사원']);
  // 오라클과 다르다고 적은 SQLite 동작
  const asc = rows('SELECT 커미션 FROM 사원 ORDER BY 커미션').flat();
  eq([asc[0], asc[10]], [null, 500], 'SQLite ASC는 NULL이 맨 앞');
  const desc = rows('SELECT 커미션 FROM 사원 ORDER BY 커미션 DESC').flat();
  eq([desc[0], desc[10]], [500, null], 'SQLite DESC는 NULL이 맨 뒤');
  eq(rows('SELECT 커미션 FROM 사원 ORDER BY 커미션 NULLS LAST').flat()[10], null, 'NULLS LAST');
  eq(rows('SELECT DISTINCT 직급 FROM 사원 ORDER BY 급여').length, 6, 'DISTINCT + 목록에 없는 열');
  eq(rows('SELECT 부서번호, COUNT(*) FROM 사원 GROUP BY 부서번호 ORDER BY 급여').length, 4, 'GROUP BY + 없는 열 정렬');
  assert(fails('SELECT 이름, 급여 FROM 사원 ORDER BY 3'), '위치 번호 범위 초과');
  db.close();
});

test('조인 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  eq(one('SELECT COUNT(*) FROM 급여등급'), [5]);
  eq(rows('SELECT 사원.이름 FROM 사원, 부서 WHERE 사원.부서번호 = 부서.부서번호').length, 10, '등가 조인 10행');
  eq(one('SELECT COUNT(*) FROM 사원, 부서'), [44]);
  eq(rows('SELECT e.이름, d.부서명 FROM 사원 e, 부서 d WHERE e.사원번호 = 1001').length, 4, '김대표 × 4');
  eq(rows("SELECT e.이름 FROM 사원 e, 부서 d WHERE e.부서번호 = d.부서번호 AND d.지역 = '판교'").length, 4);
  const grades = rows('SELECT g.등급, COUNT(*) FROM 사원 e, 급여등급 g WHERE e.급여 BETWEEN g.최저급여 AND g.최고급여 GROUP BY g.등급 ORDER BY 1');
  eq(grades, [[1, 1], [2, 4], [3, 2], [4, 3], [5, 1]], '등급별 인원(빈틈·겹침 없음)');
  eq(one("SELECT g.등급 FROM 사원 e, 급여등급 g WHERE e.급여 BETWEEN g.최저급여 AND g.최고급여 AND e.이름 = '최과장'"), [4]);
  eq(rows('SELECT 1 FROM 사원 e, 부서 d, 급여등급 g WHERE e.부서번호 = d.부서번호 AND e.급여 BETWEEN g.최저급여 AND g.최고급여').length, 10);
  eq(rows('SELECT 1 FROM 사원 e, 부서 d, 급여등급 g WHERE e.부서번호 = d.부서번호').length, 50, '조건 하나 빠짐');
  assert(fails('SELECT 이름, 부서번호 FROM 사원 e, 부서 d WHERE e.부서번호 = d.부서번호'), '모호한 열');
  assert(fails('SELECT 사원.이름 FROM 사원 e, 부서 d WHERE e.부서번호 = d.부서번호'), '별칭 뒤 원래 이름');
  assert(fails('SELECT 1 FROM 사원 e, 부서 d WHERE e.부서번호(+) = d.부서번호'), '(+) 없음');
  eq(rows('SELECT 1 FROM 사원 AS e, 부서 AS d WHERE e.부서번호 = d.부서번호').length, 10, '테이블 별칭 AS 허용');
  db.close();
});

test('표준 조인 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  eq(rows("SELECT 1 FROM 사원 e JOIN 부서 d ON e.부서번호 = d.부서번호 JOIN 급여등급 g ON e.급여 BETWEEN g.최저급여 AND g.최고급여 WHERE d.지역 = '판교'").length, 4);
  eq(one('SELECT COUNT(*) FROM 사원 JOIN 부서 USING (부서번호)'), [10]);
  eq(one('SELECT COUNT(*) FROM 사원 NATURAL JOIN 부서'), [10]);
  eq(one('SELECT COUNT(*) FROM 부서 d LEFT JOIN 사원 e ON d.부서번호 = e.부서번호'), [11]);
  eq(one('SELECT COUNT(*) FROM 사원 e LEFT JOIN 부서 d ON e.부서번호 = d.부서번호'), [11]);
  eq(one('SELECT COUNT(*) FROM 사원 e RIGHT JOIN 부서 d ON e.부서번호 = d.부서번호'), [11]);
  eq(one('SELECT COUNT(*) FROM 사원 e FULL OUTER JOIN 부서 d ON e.부서번호 = d.부서번호'), [12]);
  eq(rows('SELECT e.이름, d.부서명 FROM 사원 e FULL OUTER JOIN 부서 d ON e.부서번호 = d.부서번호 WHERE e.사원번호 IS NULL OR d.부서번호 IS NULL').length, 2);
  eq(rows('SELECT d.부서명 FROM 부서 d LEFT JOIN 사원 e ON d.부서번호 = e.부서번호 WHERE e.사원번호 IS NULL').flat(), ['연구']);
  eq(one('SELECT COUNT(*) FROM 부서 CROSS JOIN 급여등급'), [20]);
  eq(one("SELECT COUNT(*) FROM 부서 d LEFT JOIN 사원 e ON d.부서번호 = e.부서번호 AND e.직급 = '과장'"), [4]);
  eq(one("SELECT COUNT(*) FROM 부서 d LEFT JOIN 사원 e ON d.부서번호 = e.부서번호 WHERE e.직급 = '과장'"), [2]);
  eq(one("SELECT COUNT(*) FROM 부서 d LEFT JOIN 사원 e ON d.부서번호 = e.부서번호 AND e.직급 = '대리'"), [4]);
  eq(one("SELECT COUNT(*) FROM 부서 d LEFT JOIN 사원 e ON d.부서번호 = e.부서번호 WHERE e.직급 = '대리'"), [2]);
  eq(one("SELECT COUNT(*) FROM 부서 d LEFT JOIN 사원 e ON d.부서번호 = e.부서번호 AND d.지역 = '서울'"), [5], 'ON의 왼쪽 조건은 거르지 않음');
  // 오라클과 다르다고 적은 SQLite 동작
  eq(one('SELECT COUNT(*) FROM 사원 JOIN 부서'), [44], 'ON 없는 JOIN');
  eq(one('SELECT COUNT(*) FROM 사원 e CROSS JOIN 부서 d ON e.부서번호 = d.부서번호'), [10], 'CROSS JOIN + ON');
  eq(rows('SELECT e.부서번호 FROM 사원 e JOIN 부서 d USING (부서번호)').length, 10, 'USING 열에 별칭');
  eq(rows('SELECT e.부서번호 FROM 사원 e NATURAL JOIN 부서 d').length, 10, 'NATURAL 열에 별칭');
  assert(fails('SELECT 1 FROM 사원 NATURAL JOIN 부서 USING (부서번호)'), 'NATURAL + USING');
  assert(fails('SELECT 1 FROM 사원 JOIN 부서 USING 부서번호'), 'USING 괄호');
  db.close();
});

test('서브쿼리 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  eq(rows('SELECT 이름 FROM 사원 WHERE 급여 > (SELECT AVG(급여) FROM 사원)').length, 5, '평균보다 많이 받는 사원');
  eq(rows("SELECT 이름 FROM 사원 WHERE 부서번호 = (SELECT 부서번호 FROM 사원 WHERE 이름 = '최과장')").length, 4);
  eq(rows("SELECT 이름 FROM 사원 WHERE 급여 = (SELECT 급여 FROM 사원 WHERE 이름 = '없는사람')").length, 0, '서브쿼리 0행');
  eq(rows('SELECT 부서번호 FROM 사원 GROUP BY 부서번호 HAVING AVG(급여) > (SELECT AVG(급여) FROM 사원) ORDER BY 1').flat(), [10, 20]);
  eq(rows("SELECT 이름 FROM 사원 WHERE 부서번호 IN (SELECT 부서번호 FROM 부서 WHERE 지역 IN ('판교', '부산'))").length, 8);
  eq(one('SELECT COUNT(*) FROM 사원 WHERE 급여 > (SELECT MIN(급여) FROM 사원 WHERE 부서번호 = 30)'), [8], '> ANY 대신 MIN');
  eq(rows('SELECT 이름 FROM 사원 WHERE 급여 > (SELECT MAX(급여) FROM 사원 WHERE 부서번호 = 30) ORDER BY 급여').flat(), ['이부장', '김대표'], '> ALL 대신 MAX');
  eq(rows('SELECT 이름 FROM 사원 WHERE (부서번호, 급여) IN (SELECT 부서번호, MAX(급여) FROM 사원 GROUP BY 부서번호) ORDER BY 부서번호').flat(), ['김대표', '이부장', '박부장'], '다중열');
  eq(rows('SELECT e.이름 FROM 사원 e WHERE e.급여 > (SELECT AVG(x.급여) FROM 사원 x WHERE x.부서번호 = e.부서번호)').length, 5, '연관 서브쿼리');
  eq(rows('SELECT e.이름 FROM 사원 e WHERE e.급여 > (SELECT AVG(x.급여) FROM 사원 x WHERE x.부서번호 = 부서번호)').length, 4, '바깥 별칭 빠뜨림');
  eq(one('SELECT AVG(급여) FROM 사원 WHERE 부서번호 IS NOT NULL'), [4900]);
  eq(rows('SELECT d.부서명 FROM 부서 d WHERE EXISTS (SELECT 1 FROM 사원 e WHERE e.부서번호 = d.부서번호)').length, 3);
  eq(rows('SELECT d.부서명 FROM 부서 d WHERE NOT EXISTS (SELECT 1 FROM 사원 e WHERE e.부서번호 = d.부서번호)').flat(), ['연구']);
  eq(one('SELECT COUNT(*) FROM 부서 WHERE 부서번호 NOT IN (SELECT 부서번호 FROM 사원)'), [0], 'NOT IN과 NULL');
  eq(rows('SELECT d.부서명 FROM 부서 d JOIN (SELECT 부서번호, COUNT(*) AS 인원 FROM 사원 GROUP BY 부서번호) a ON d.부서번호 = a.부서번호').length, 3, '인라인 뷰 조인');
  eq(rows('SELECT 이름 FROM (SELECT 이름, 급여 * 12 AS 연봉 FROM 사원) t WHERE 연봉 >= 60000').length, 4);
  eq(rows('SELECT e.이름, (SELECT d.부서명 FROM 부서 d WHERE d.부서번호 = e.부서번호) FROM 사원 e').length, 11, '스칼라 서브쿼리는 행 수 유지');
  eq(one('SELECT (SELECT d.부서명 FROM 부서 d WHERE d.부서번호 = e.부서번호) FROM 사원 e WHERE e.사원번호 = 1011'), [null]);
  db.exec('CREATE VIEW 부서별현황 AS SELECT d.부서명, COUNT(e.사원번호) AS 인원 FROM 부서 d LEFT JOIN 사원 e ON d.부서번호 = e.부서번호 GROUP BY d.부서번호, d.부서명');
  eq(rows('SELECT 부서명 FROM 부서별현황 WHERE 인원 >= 2').length, 3);
  eq(one("SELECT 인원 FROM 부서별현황 WHERE 부서명 = '연구'"), [0], 'COUNT(e.사원번호)는 0');
  // 오라클과 다르다고 적은 SQLite 동작
  eq(rows("SELECT 이름 FROM 사원 WHERE 부서번호 = (SELECT 부서번호 FROM 사원 WHERE 직급 = '과장')").length, 4, '여러 행 서브쿼리도 첫 행만 씀');
  eq(rows('SELECT 이름 FROM 사원 WHERE 급여 IN (SELECT 급여 FROM 사원 ORDER BY 급여 DESC)').length, 11, '서브쿼리 안 ORDER BY 허용');
  eq(rows('SELECT * FROM (SELECT 부서번호 FROM 사원 GROUP BY 부서번호) AS a').length, 4, '인라인 뷰 별칭 AS 허용');
  assert(fails('SELECT 이름 FROM 사원 WHERE 급여 > ANY (SELECT 급여 FROM 사원)'), 'ANY 없음');
  assert(fails('SELECT 이름 FROM 사원 WHERE 급여 > ALL (SELECT 급여 FROM 사원)'), 'ALL 없음');
  assert(fails('SELECT 이름 FROM 사원 WHERE 급여 > SOME (SELECT 급여 FROM 사원)'), 'SOME 없음');
  assert(fails('SELECT 이름, (SELECT 이름, 직급 FROM 사원 WHERE 사원번호 = 1001) FROM 사원'), '스칼라 서브쿼리 두 열');
  assert(fails('SELECT 이름 FROM 사원 WHERE 급여 = MAX(급여)'), 'WHERE에 집계 함수');
  assert(fails('CREATE OR REPLACE VIEW v AS SELECT 1'), 'OR REPLACE 없음');
  assert(fails("INSERT INTO 부서별현황 VALUES ('x', 1)"), '뷰는 읽기 전용');
  assert(fails('CREATE VIEW 부서별현황 AS SELECT 1'), '같은 이름 뷰');
  db.close();
});

test('집합 연산자 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  const d20 = 'SELECT 이름, 직급 FROM 사원 WHERE 부서번호 = 20';
  const mgr = "SELECT 이름, 직급 FROM 사원 WHERE 직급 = '과장'";
  eq(rows(`${d20} UNION ${mgr}`).length, 5, 'UNION');
  eq(rows(`${d20} UNION ALL ${mgr}`).length, 6, 'UNION ALL');
  eq(one("SELECT COUNT(*) FROM 사원 WHERE 부서번호 = 20 OR 직급 = '과장'"), [5], 'OR와 같은 결과');
  eq(rows('SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 2 UNION SELECT 2 UNION SELECT 3').length, 3, '뒤의 UNION이 앞 중복까지 제거');
  eq(rows("SELECT 이름 AS 사람, 급여 FROM 사원 WHERE 부서번호 = 10 UNION SELECT 이름, 급여 FROM 사원 WHERE 부서번호 = 30 ORDER BY 급여 DESC")[0], ['김대표', 9000]);
  eq(db.exec('SELECT 이름 AS 사람 FROM 사원 UNION SELECT 부서명 AS 부서 FROM 부서')[0].columns, ['사람'], '열 이름은 첫 SELECT');
  eq(rows("SELECT 이름 FROM 사원 WHERE 부서번호 = 20 INTERSECT SELECT 이름 FROM 사원 WHERE 직급 = '과장'").flat(), ['최과장']);
  eq(rows('SELECT 부서번호 FROM 사원 INTERSECT SELECT 부서번호 FROM 부서').flat(), [10, 20, 30]);
  eq(rows('SELECT 직급 FROM 사원 WHERE 부서번호 = 20 INTERSECT SELECT 직급 FROM 사원 WHERE 부서번호 = 30').length, 4);
  eq(rows('SELECT 사원번호 FROM 사원 WHERE 부서번호 = 20 INTERSECT SELECT 사원번호 FROM 사원 WHERE 급여 >= 5000').flat(), [1002, 1004]);
  eq(rows("SELECT 이름 FROM 사원 WHERE 부서번호 = 20 EXCEPT SELECT 이름 FROM 사원 WHERE 직급 = '과장'").length, 3, 'EXCEPT');
  eq(rows('SELECT 부서번호 FROM 부서 EXCEPT SELECT 부서번호 FROM 사원').flat(), [40], '부서 - 사원');
  eq(rows('SELECT 부서번호 FROM 사원 EXCEPT SELECT 부서번호 FROM 부서').flat(), [null], '사원 - 부서는 NULL');
  eq(rows('SELECT 부서번호 FROM 사원 UNION SELECT 부서번호 FROM 부서').flat(), [null, 10, 20, 30, 40], 'UNION은 NULL을 한 행으로');
  eq(rows('SELECT * FROM (SELECT 1 AS x UNION ALL SELECT NULL) INTERSECT SELECT * FROM (SELECT NULL UNION ALL SELECT 2)').flat(), [null], 'INTERSECT는 NULL끼리 같다');
  eq(rows('SELECT 1 AS 값 UNION SELECT 2 INTERSECT SELECT 2').flat(), [2], '위에서부터 차례로');
  eq(rows('SELECT 1 AS 값 UNION SELECT * FROM (SELECT 2 INTERSECT SELECT 2)').flat(), [1, 2], '인라인 뷰로 순서 바꾸기');
  eq(rows('SELECT 1 UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 2 EXCEPT SELECT 2').flat(), [1], 'UNION ALL 뒤 차집합');
  // 오라클과 다르다고 적은 SQLite 동작
  eq(rows("SELECT 1 AS 숫자 UNION SELECT '가'").length, 2, '타입이 다른 열도 합침');
  eq(rows('SELECT 이름 AS 사람, 급여 FROM 사원 WHERE 부서번호 = 10 UNION SELECT 이름 AS 성명, 급여 FROM 사원 WHERE 부서번호 = 30 ORDER BY 성명').length, 6, '두 번째 SELECT 별칭으로 정렬');
  assert(fails("SELECT 이름 FROM 사원 MINUS SELECT 이름 FROM 사원 WHERE 직급 = '과장'"), 'MINUS 없음');
  assert(fails('SELECT 1 UNION (SELECT 2 INTERSECT SELECT 2)'), '괄호 묶기 안 됨');
  assert(fails('SELECT 이름, 직급 FROM 사원 UNION SELECT 이름 FROM 사원'), '열 개수 다름');
  assert(fails('SELECT 이름 FROM 사원 WHERE 부서번호 = 10 ORDER BY 이름 UNION SELECT 이름 FROM 사원'), '중간 ORDER BY');
  db.close();
});

test('그룹 함수 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, rows, fails } = await seededDb();
  const f = "FROM 사원 WHERE 직급 IN ('부장', '과장')";
  const detail = `SELECT 부서번호, 직급, COUNT(*) AS 인원, SUM(급여) AS 급여합계 ${f} GROUP BY 부서번호, 직급`;
  const byDept = `SELECT 부서번호, NULL, COUNT(*), SUM(급여) ${f} GROUP BY 부서번호`;
  const byRank = `SELECT NULL, 직급, COUNT(*), SUM(급여) ${f} GROUP BY 직급`;
  const total = `SELECT NULL, NULL, COUNT(*), SUM(급여) ${f}`;
  const order = 'ORDER BY 부서번호 NULLS LAST, 직급 NULLS LAST';
  eq(rows('SELECT 부서번호, SUM(급여) FROM 사원 WHERE 부서번호 IS NOT NULL GROUP BY 부서번호 UNION ALL SELECT NULL, SUM(급여) FROM 사원 WHERE 부서번호 IS NOT NULL'),
    [[10, 12100], [20, 18800], [30, 18100], [null, 49000]], '부서별 합계 + 총계');
  const rollup = rows(`${detail} UNION ALL ${byDept} UNION ALL ${total} ${order}`);
  eq(rollup.length, 7, 'ROLLUP 흉내 7행');
  eq(rollup[2], [20, null, 2, 11500]);
  eq(rollup[6], [null, null, 4, 22500]);
  const cube = rows(`${detail} UNION ALL ${byDept} UNION ALL ${byRank} UNION ALL ${total} ${order}`);
  eq(cube, [[20, '과장', 1, 5000], [20, '부장', 1, 6500], [20, null, 2, 11500], [30, '과장', 1, 4800], [30, '부장', 1, 6200],
    [30, null, 2, 11000], [null, '과장', 2, 9800], [null, '부장', 2, 12700], [null, null, 4, 22500]], 'CUBE 흉내 = 카드의 표');
  eq(rows(`${byDept} UNION ALL ${byRank}`).length, 4, 'GROUPING SETS(부서, 직급) 흉내');
  eq(rows("SELECT CASE WHEN 부서번호 IS NULL THEN '부서 미배정' ELSE 부서번호 || '번 부서' END, COUNT(*), SUM(급여) FROM 사원 GROUP BY 부서번호 UNION ALL SELECT '전체 합계', COUNT(*), SUM(급여) FROM 사원"),
    [['부서 미배정', 1, 2400], ['10번 부서', 2, 12100], ['20번 부서', 4, 18800], ['30번 부서', 4, 18100], ['전체 합계', 11, 51400]], 'GROUPING 표의 값');
  // 오라클과 다르다고 적은 SQLite 동작: 그룹 함수가 하나도 없다
  assert(fails('SELECT 부서번호, COUNT(*) FROM 사원 GROUP BY ROLLUP(부서번호)'), 'ROLLUP 없음');
  assert(fails('SELECT 부서번호, COUNT(*) FROM 사원 GROUP BY CUBE(부서번호)'), 'CUBE 없음');
  assert(fails('SELECT 부서번호, COUNT(*) FROM 사원 GROUP BY GROUPING SETS(부서번호)'), 'GROUPING SETS 없음');
  assert(fails('SELECT GROUPING(부서번호) FROM 사원 GROUP BY 부서번호'), 'GROUPING 없음');
  db.close();
});

test('윈도우 함수 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  // 윈도우 함수란: 행 수 그대로, WHERE 뒤의 행만 본다
  eq(rows('SELECT 이름, AVG(급여) OVER (PARTITION BY 부서번호) FROM 사원').length, 11);
  eq(one('SELECT SUM(급여) OVER () FROM 사원 WHERE 부서번호 IS NOT NULL'), [49000]);
  eq(one('SELECT SUM(급여) FROM 사원'), [51400]);
  // 순위 함수: 20·30번 부서 4명 동점
  eq(rows('SELECT COUNT(*), RANK() OVER (ORDER BY COUNT(*) DESC), DENSE_RANK() OVER (ORDER BY COUNT(*) DESC), ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC, 부서번호) FROM 사원 GROUP BY 부서번호'),
    [[4, 1, 1, 1], [4, 1, 1, 2], [2, 3, 2, 3], [1, 4, 3, 4]]);
  eq(rows('WITH t(v) AS (VALUES (100), (90), (90), (80)) SELECT RANK() OVER (ORDER BY v DESC), DENSE_RANK() OVER (ORDER BY v DESC), ROW_NUMBER() OVER (ORDER BY v DESC) FROM t')[3], [4, 3, 4]);
  // NULL은 SQLite에서 DESC 맨 뒤: 박부장 1위, NULL 7명 공동 5위
  eq(rows("SELECT 이름 FROM (SELECT 이름, RANK() OVER (ORDER BY 커미션 DESC) AS r FROM 사원) WHERE r = 1").flat(), ['박부장']);
  eq(one('SELECT COUNT(*) FROM (SELECT 커미션, RANK() OVER (ORDER BY 커미션 DESC) AS r FROM 사원) WHERE 커미션 IS NULL AND r = 5'), [7]);
  // PARTITION BY
  eq(one('SELECT COUNT(*) FROM (SELECT RANK() OVER (PARTITION BY 부서번호 ORDER BY 급여 DESC) AS r FROM 사원) WHERE r = 1'), [4]);
  eq(rows('SELECT 이름 FROM (SELECT 이름, ROW_NUMBER() OVER (PARTITION BY 부서번호 ORDER BY 급여 DESC) AS r FROM 사원 WHERE 부서번호 IS NOT NULL) WHERE r = 1 ORDER BY 이름').flat(), ['김대표', '박부장', '이부장']);
  // 누적 합계
  const cum = rows('SELECT SUM(급여) OVER (ORDER BY 입사일) FROM 사원').flat();
  eq([cum[0], cum[10]], [9000, 51400]);
  eq(rows('WITH t(v) AS (VALUES (10), (20), (30)) SELECT SUM(v) OVER (ORDER BY v) FROM t').flat(), [10, 30, 60]);
  // ROWS와 RANGE
  eq(rows('SELECT SUM(급여) OVER (ORDER BY 부서번호) FROM 사원 WHERE 부서번호 = 10').flat(), [12100, 12100]);
  eq(rows('SELECT SUM(급여) OVER (ORDER BY 부서번호 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM 사원 WHERE 부서번호 = 10').flat().sort((a, b) => a - b), [9000, 12100]);
  eq(rows('WITH t(v) AS (VALUES (10), (20), (30), (40)) SELECT SUM(v) OVER (ORDER BY v ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING) FROM t').flat(), [30, 60, 90, 70]);
  eq(rows('WITH t(d, s) AS (VALUES (10, 100), (10, 200), (20, 300)) SELECT SUM(s) OVER (ORDER BY d) FROM t').flat(), [300, 300, 600]);
  // LAG, LEAD, FIRST_VALUE, LAST_VALUE
  eq(rows('WITH t(v) AS (VALUES (100), (200), (300)) SELECT LAG(v, 1, 0) OVER (ORDER BY v) FROM t').flat(), [0, 100, 200]);
  eq(rows('SELECT LAG(급여) OVER (ORDER BY 입사일), LEAD(이름) OVER (ORDER BY 입사일) FROM 사원')[0], [null, '이부장']);
  eq(rows('SELECT 이름, LAST_VALUE(이름) OVER (ORDER BY 입사일) FROM 사원').every(([a, b]) => a === b), true, 'LAST_VALUE 기본 범위는 자기 자신');
  eq(one('SELECT LAST_VALUE(이름) OVER (ORDER BY 입사일 ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) FROM 사원'), ['오인턴']);
  // 비율 함수
  eq(rows('SELECT g, COUNT(*) FROM (SELECT NTILE(4) OVER (ORDER BY 급여 DESC) AS g FROM 사원) GROUP BY g'), [[1, 3], [2, 3], [3, 3], [4, 2]]);
  eq(rows('WITH t(v) AS (VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10)) SELECT g, COUNT(*) FROM (SELECT NTILE(3) OVER (ORDER BY v) AS g FROM t) GROUP BY g').map((r) => r[1]), [4, 3, 3]);
  eq(rows('WITH t(v) AS (VALUES (1), (2), (3), (4), (5), (6), (7), (8), (9), (10)) SELECT g, COUNT(*) FROM (SELECT NTILE(4) OVER (ORDER BY v) AS g FROM t) GROUP BY g').map((r) => r[1]), [3, 3, 2, 2]);
  eq(rows('WITH t(v) AS (VALUES (10), (20), (30), (40), (50)) SELECT CUME_DIST() OVER (ORDER BY v), PERCENT_RANK() OVER (ORDER BY v) FROM t')[2], [0.6, 0.5]);
  eq(one('SELECT a, b FROM (SELECT 사원번호, 급여 / SUM(급여) OVER () AS a, ROUND(급여 * 1.0 / SUM(급여) OVER (), 3) AS b FROM 사원) WHERE 사원번호 = 1001'), [0, 0.175], 'SQLite 정수 나눗셈');
  // 오라클과 다르다고 적은 SQLite 동작, 오류
  eq(rows('SELECT LAG(급여) OVER () FROM 사원').length, 11, 'ORDER BY 없는 LAG 허용');
  assert(fails('SELECT RATIO_TO_REPORT(급여) OVER () FROM 사원'), 'RATIO_TO_REPORT 없음');
  assert(fails('SELECT FIRST_VALUE(커미션 IGNORE NULLS) OVER (ORDER BY 입사일) FROM 사원'), 'IGNORE NULLS 없음');
  assert(fails('SELECT 이름 FROM 사원 WHERE ROW_NUMBER() OVER (ORDER BY 급여) = 1'), 'WHERE에 윈도우 함수');
  assert(fails('SELECT RANK(급여) OVER (ORDER BY 급여) FROM 사원'), 'RANK(열)');
  assert(fails('SELECT SUM(급여) OVER (ORDER BY 급여 ROWS BETWEEN CURRENT ROW AND 1 PRECEDING) FROM 사원'), '범위 거꾸로');
  db.close();
});

test('Top N 쿼리 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, rows, fails } = await seededDb();
  eq(rows('SELECT 이름 FROM 사원 ORDER BY 급여 DESC LIMIT 3').flat(), ['김대표', '이부장', '박부장']);
  eq(rows('SELECT * FROM (SELECT 이름, 급여 FROM 사원 ORDER BY 급여 DESC) LIMIT 3').map((r) => r[0]), ['김대표', '이부장', '박부장']);
  eq(rows('SELECT 이름 FROM 사원 ORDER BY 급여 DESC LIMIT 3 OFFSET 3').flat(), ['최과장', '정과장', '강대리']);
  eq(rows('SELECT 이름 FROM 사원 ORDER BY 급여 DESC LIMIT 3, 3').flat(), ['최과장', '정과장', '강대리'], 'LIMIT 건너뛸수, 가져올수');
  eq(rows('SELECT 이름 FROM 사원 ORDER BY 급여 DESC LIMIT 4 OFFSET 8').length, 3, '마지막 페이지');
  eq(rows('SELECT 이름 FROM (SELECT 이름, ROW_NUMBER() OVER (ORDER BY 급여 DESC) AS rn FROM 사원) WHERE rn BETWEEN 4 AND 6').flat(), ['최과장', '정과장', '강대리']);
  eq(rows('SELECT 부서번호, 이름 FROM (SELECT 부서번호, 이름, ROW_NUMBER() OVER (PARTITION BY 부서번호 ORDER BY 급여 DESC) AS 순번 FROM 사원 WHERE 부서번호 IS NOT NULL) WHERE 순번 <= 2 ORDER BY 부서번호, 순번'),
    [[10, '김대표'], [10, '한사원'], [20, '이부장'], [20, '최과장'], [30, '박부장'], [30, '정과장']]);
  eq(rows('SELECT 부서번호 FROM (SELECT 부서번호, ROW_NUMBER() OVER (ORDER BY COUNT(*) DESC) AS rn FROM 사원 GROUP BY 부서번호) WHERE rn = 1').length, 1, 'ROW_NUMBER 1위는 하나');
  eq(rows('SELECT 부서번호 FROM (SELECT 부서번호, RANK() OVER (ORDER BY COUNT(*) DESC) AS rk FROM 사원 GROUP BY 부서번호) WHERE rk = 1 ORDER BY 1').flat(), [20, 30], 'RANK 1위는 동점 둘');
  // 오라클·SQL Server 문법은 SQLite에 없음
  assert(fails('SELECT 이름 FROM 사원 WHERE ROWNUM <= 3'), 'ROWNUM 없음');
  assert(fails('SELECT 이름 FROM 사원 ORDER BY 급여 DESC FETCH FIRST 3 ROWS ONLY'), 'FETCH FIRST 없음');
  assert(fails('SELECT 이름 FROM 사원 ORDER BY 급여 DESC OFFSET 3 ROWS FETCH NEXT 3 ROWS ONLY'), 'OFFSET ROWS 없음');
  assert(fails('SELECT TOP 3 이름 FROM 사원'), 'TOP 없음');
  assert(fails('SELECT 이름 FROM 사원 ORDER BY 급여 DESC LIMIT 3 WITH TIES'), 'WITH TIES 없음');
  db.close();
});

test('계층형 질의와 셀프 조인 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  const 펼치기 = (cond = '', where = '') => `WITH RECURSIVE 조직(사원번호, 이름, 관리자번호, 레벨, 경로) AS (
    SELECT 사원번호, 이름, 관리자번호, 1, 이름 FROM 사원 WHERE 관리자번호 IS NULL
    UNION ALL
    SELECT e.사원번호, e.이름, e.관리자번호, 조직.레벨 + 1, 조직.경로 || ' > ' || e.이름
    FROM 사원 e JOIN 조직 ON e.관리자번호 = 조직.사원번호 ${cond})
    SELECT 레벨, 이름 FROM 조직 ${where} ORDER BY 경로`;
  // 셀프 조인
  eq(rows('SELECT e.이름, m.이름 FROM 사원 e JOIN 사원 m ON e.관리자번호 = m.사원번호').length, 10);
  eq(rows('SELECT e.이름, m.이름 FROM 사원 e LEFT OUTER JOIN 사원 m ON e.관리자번호 = m.사원번호').length, 11);
  eq(one("SELECT m.이름 FROM 사원 e JOIN 사원 m ON e.관리자번호 = m.사원번호 WHERE e.이름 = '강대리'"), ['최과장']);
  eq(one('SELECT COUNT(*) FROM 사원 e, 사원 m'), [121]);
  eq(rows('SELECT e.이름 FROM 사원 e JOIN 사원 m ON e.관리자번호 = m.사원번호 JOIN 사원 mm ON m.관리자번호 = mm.사원번호').length, 7, '두 단계 위');
  eq(rows('SELECT m.이름, COUNT(*) FROM 사원 e JOIN 사원 m ON e.관리자번호 = m.사원번호 GROUP BY m.사원번호, m.이름 ORDER BY 2 DESC, m.사원번호'),
    [['김대표', 3], ['이부장', 2], ['최과장', 2], ['정과장', 2], ['박부장', 1]]);
  // 계층 구조: 레벨별 인원, 리프 6명
  eq(rows(`SELECT 레벨, COUNT(*) FROM (${펼치기()}) GROUP BY 레벨`), [[1, 1], [2, 3], [3, 3], [4, 4]]);
  eq(rows("SELECT 이름 FROM 사원 e WHERE NOT EXISTS (SELECT 1 FROM 사원 c WHERE c.관리자번호 = e.사원번호) ORDER BY 이름").flat(),
    ['강대리', '오인턴', '윤사원', '장사원', '조대리', '한사원']);
  // 오라클 ORDER SIBLINGS BY 이름과 같은 순서(그림 표)
  eq(rows(펼치기()).map((r) => r[1]), ['김대표', '박부장', '정과장', '장사원', '조대리', '이부장', '오인턴', '최과장', '강대리', '윤사원', '한사원']);
  eq(rows(펼치기()).map((r) => r[0]), [1, 2, 3, 4, 4, 2, 3, 3, 4, 4, 2]);
  // 역방향: 강대리 → 최과장 → 이부장 → 김대표
  eq(rows(`WITH RECURSIVE 결재라인(사원번호, 이름, 관리자번호, 단계) AS (
    SELECT 사원번호, 이름, 관리자번호, 1 FROM 사원 WHERE 이름 = '강대리'
    UNION ALL
    SELECT m.사원번호, m.이름, m.관리자번호, 결재라인.단계 + 1 FROM 사원 m JOIN 결재라인 ON m.사원번호 = 결재라인.관리자번호)
    SELECT 단계, 이름 FROM 결재라인`), [[1, '강대리'], [2, '최과장'], [3, '이부장'], [4, '김대표']]);
  // 경로(SYS_CONNECT_BY_PATH 대신)
  eq(one(`WITH RECURSIVE 조직(사원번호, 이름, 경로) AS (
    SELECT 사원번호, 이름, '/' || 이름 FROM 사원 WHERE 관리자번호 IS NULL
    UNION ALL
    SELECT e.사원번호, e.이름, 조직.경로 || '/' || e.이름 FROM 사원 e JOIN 조직 ON e.관리자번호 = 조직.사원번호)
    SELECT 경로 FROM 조직 WHERE 이름 = '최과장'`), ['/김대표/이부장/최과장']);
  // WHERE와 CONNECT BY 조건 위치
  eq(rows(펼치기('', "WHERE 이름 <> '이부장'")).length, 10, 'WHERE는 한 행만');
  eq(rows(펼치기("WHERE e.이름 <> '이부장'")).length, 6, '재귀 부분 조건은 가지째');
  eq(rows(펼치기("WHERE e.이름 <> '박부장'")).length, 7, '박부장 가지 잘라내기');
  eq(rows(펼치기('', "WHERE 이름 <> '이부장'")).find((r) => r[1] === '최과장')[0], 3, 'WHERE로 빼도 레벨 그대로');
  // 오라클 계층형 문법은 SQLite에 없음, RECURSIVE 없이도 실행
  assert(fails('SELECT 이름, LEVEL FROM 사원 START WITH 관리자번호 IS NULL CONNECT BY PRIOR 사원번호 = 관리자번호'), 'CONNECT BY 없음');
  assert(fails("SELECT SYS_CONNECT_BY_PATH(이름, '/') FROM 사원"), 'SYS_CONNECT_BY_PATH 없음');
  eq(one('WITH 조직(사원번호) AS (SELECT 사원번호 FROM 사원 WHERE 관리자번호 IS NULL UNION ALL SELECT e.사원번호 FROM 사원 e JOIN 조직 ON e.관리자번호 = 조직.사원번호) SELECT COUNT(*) FROM 조직'), [11], 'RECURSIVE 생략');
  db.close();
});

test('PIVOT 절과 UNPIVOT 절 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  eq(rows('SELECT 부서번호, 직급, COUNT(*) FROM 사원 WHERE 부서번호 IS NOT NULL GROUP BY 부서번호, 직급').length, 10, '세로형 10행');
  const cnt = () => ['부장', '과장', '대리', '사원'].map((j) => `COUNT(CASE WHEN 직급 = '${j}' THEN 1 END)`).join(', ');
  eq(rows(`SELECT 부서번호, ${cnt()} FROM 사원 WHERE 부서번호 IS NOT NULL GROUP BY 부서번호 ORDER BY 부서번호`),
    [[10, 0, 0, 0, 1], [20, 1, 1, 1, 1], [30, 1, 1, 1, 1]], 'COUNT로 펼친 표(빈칸 0)');
  const sum = ['부장', '과장', '대리', '사원'].map((j) => `SUM(CASE WHEN 직급 = '${j}' THEN 급여 END)`).join(', ');
  eq(rows(`SELECT 부서번호, ${sum} FROM 사원 WHERE 부서번호 IS NOT NULL GROUP BY 부서번호 ORDER BY 부서번호`),
    [[10, null, null, null, 3100], [20, 6500, 5000, 4000, 3300], [30, 6200, 4800, 3900, 3200]], 'SUM으로 펼친 표(빈칸 NULL)');
  eq(rows("SELECT 부서번호, 이름, COUNT(CASE WHEN 직급 = '부장' THEN 1 END) FROM 사원 WHERE 부서번호 IS NOT NULL GROUP BY 부서번호, 이름").length, 10, '이름까지 행 기준');
  eq(rows("SELECT 부서번호, COUNT(CASE WHEN 직급 = '부장' THEN 1 END), SUM(CASE WHEN 직급 = '부장' THEN 급여 END), SUM(CASE WHEN 직급 = '부장' THEN 급여 ELSE 0 END) FROM 사원 WHERE 부서번호 IS NOT NULL GROUP BY 부서번호 ORDER BY 부서번호"),
    [[10, 0, null, 0], [20, 1, 6500, 6500], [30, 1, 6200, 6200]]);
  eq(one("SELECT COUNT(CASE WHEN 직급 = '부장' THEN 1 ELSE 0 END), AVG(CASE WHEN 직급 = '부장' THEN 급여 ELSE 0 END) FROM 사원 WHERE 부서번호 = 20"), [4, 1625]);
  eq(rows("SELECT 이름, '급여', 급여 FROM 사원 WHERE 부서번호 = 30 UNION ALL SELECT 이름, '커미션', 커미션 FROM 사원 WHERE 부서번호 = 30").length, 8, 'UNPIVOT 대신 UNION ALL');
  eq(rows("SELECT 이름, '급여', 급여 FROM 사원 WHERE 부서번호 = 10 UNION ALL SELECT 이름, '커미션', 커미션 FROM 사원 WHERE 부서번호 = 10").length, 4, 'NULL 남음');
  eq(rows("SELECT 이름, '급여', 급여 FROM 사원 WHERE 부서번호 = 10 UNION ALL SELECT 이름, '커미션', 커미션 FROM 사원 WHERE 부서번호 = 10 AND 커미션 IS NOT NULL").length, 2, 'NULL 뺌');
  // 오라클과 다르다고 적은 SQLite 동작
  assert(fails("SELECT * FROM (SELECT 부서번호, 직급 FROM 사원) PIVOT (COUNT(*) FOR 직급 IN ('부장' AS 부장))"), 'PIVOT 없음');
  assert(fails('SELECT * FROM (SELECT 이름, 급여, 커미션 FROM 사원) UNPIVOT (금액 FOR 항목 IN (급여, 커미션))'), 'UNPIVOT 없음');
  assert(fails("SELECT SUM(DECODE(직급, '부장', 급여)) FROM 사원"), 'DECODE 없음');
  db.close();
});

test('정규 표현식 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  eq(rows("SELECT 이름 FROM 사원 WHERE 이름 REGEXP '^(김|이|박)'").flat(), ['김대표', '이부장', '박부장']);
  eq(one("SELECT COUNT(*) FROM 사원 WHERE 이름 LIKE '김%' OR 이름 LIKE '이%' OR 이름 LIKE '박%'"), [3]);
  eq(one("SELECT COUNT(*) FROM 사원 WHERE 이름 REGEXP '장'"), [5], '일부만 맞아도 참');
  eq(one("SELECT COUNT(*) FROM 사원 WHERE 이름 LIKE '장'"), [0]);
  eq(one("SELECT SUM(이름 REGEXP '장$'), SUM(이름 REGEXP '^.대'), SUM(이름 REGEXP '[강조]'), SUM(이름 REGEXP '^[^김이박]') FROM 사원"), [4, 3, 2, 8]);
  eq(one("SELECT SUM(입사일 REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'), SUM(입사일 REGEXP '^202[2-5]'), SUM(입사일 REGEXP '-0[1-3]-') FROM 사원"), [11, 4, 5]);
  eq(one("SELECT 'ac' REGEXP 'ab*c', 'ac' REGEXP 'ab+c', 'abbc' REGEXP 'ab?c', 'abbbc' REGEXP 'ab{2,3}c', 'abbbbc' REGEXP 'ab{2,3}c'"), [1, 0, 0, 1, 0]);
  eq(one("SELECT 'abcc' REGEXP '^ab*c$', 'ac' REGEXP '^ab*c$', '123-4567' REGEXP '^[0-9]{3}-[0-9]{4}$', '123-456' REGEXP '^[0-9]{3}-[0-9]{4}$'"), [0, 1, 1, 0]);
  eq(one("SELECT COUNT(*) FROM 사원 WHERE 이름 REGEXP '(대리|사원)$'"), [5]);
  eq(one("SELECT '사원대리' REGEXP '(대리|사원)$', '사원대리' REGEXP '^(대리|사원)$', '사원대리' REGEXP '대리|사원$'"), [1, 0, 1]);
  eq(one("SELECT '3.14' REGEXP '^3\\.14$', '3914' REGEXP '^3.14$', '3914' REGEXP '^3\\.14$', 'v152' REGEXP '^v1\\.2$', 'v1.2' REGEXP '^v1\\.2$'"), [1, 1, 0, 0, 1]);
  eq(one("SELECT 'B7' REGEXP '^[A-C][0-9]$', 'A12' REGEXP '^[A-C][0-9]$', 'D5' REGEXP '^[A-C][0-9]$'"), [1, 0, 0]);
  eq(one("SELECT 'SQLD' REGEXP '^sql', 'SQLD' REGEXP '^[Ss][Qq][Ll]', REPLACE('010-1234-5678', '-', '')"), [0, 1, '01012345678']);
  eq(one('SELECT NULL REGEXP \'a\''), [null], 'NULL은 참이 아님');
  // 오라클과 다르다고 적은 SQLite 동작
  eq(one("SELECT '2024' REGEXP '^[[:digit:]]+$', '2024' REGEXP '^\\d+$'"), [0, 1], 'POSIX 클래스는 모름, \\d는 됨');
  for (const f of ["REGEXP_LIKE('a', 'a')", "REGEXP_SUBSTR('a1', '[0-9]')", "REGEXP_INSTR('a1', '[0-9]')", "REGEXP_COUNT('a1', '[0-9]')", "REGEXP_REPLACE('a1', '[0-9]', '')"]) {
    assert(fails(`SELECT ${f}`), `SQLite에서 안 돼야 함: ${f}`);
  }
  assert(fails("SELECT '김대표' REGEXP '('"), '틀린 패턴은 오류');
  db.close();
});

test('DML 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  // INSERT
  db.exec("INSERT INTO 부서 VALUES (50, '기획', '서울'); INSERT INTO 사원 (사원번호, 이름, 직급, 부서번호) VALUES (1012, '신입사', '사원', 50)");
  eq(one('SELECT 급여, 커미션 FROM 사원 WHERE 사원번호 = 1012'), [null, null], '생략한 열은 NULL');
  assert(fails("INSERT INTO 부서 VALUES (60, '기획')"), '값 개수 부족');
  assert(fails("INSERT INTO 사원 (사원번호, 직급) VALUES (1013, '사원')"), 'NOT NULL 이름');
  assert(fails("INSERT INTO 부서 VALUES (10, '법무', '서울')"), '기본키 중복');
  assert(fails("INSERT INTO 부서 VALUES (60, 기획, '서울')"), '따옴표 없는 문자');
  db.exec("INSERT INTO 부서 (부서명, 부서번호) VALUES ('법무', 90)");
  eq(one('SELECT 부서명, 지역 FROM 부서 WHERE 부서번호 = 90'), ['법무', null], '열 순서 바꿔 넣기');
  db.exec("INSERT INTO 부서 VALUES (60, 'A', 'B'), (70, 'C', 'D')");
  eq(one('SELECT COUNT(*) FROM 부서 WHERE 부서번호 IN (60, 70)'), [2], 'SQLite 여러 행 VALUES');
  // INSERT ... SELECT, CTAS
  db.exec('CREATE TABLE 고급여사원 (사원번호 INTEGER, 이름 TEXT, 급여 INTEGER); INSERT INTO 고급여사원 SELECT 사원번호, 이름, 급여 FROM 사원 WHERE 급여 >= 6000');
  eq(rows('SELECT 이름 FROM 고급여사원 ORDER BY 사원번호').flat(), ['김대표', '이부장', '박부장']);
  db.exec('CREATE TABLE 백업 AS SELECT * FROM 사원 WHERE 1 = 0');
  eq(one('SELECT COUNT(*) FROM 백업'), [0], '구조만 복사');
  db.exec('INSERT INTO 백업 SELECT * FROM 사원 WHERE 부서번호 = 20');
  eq(one('SELECT COUNT(*) FROM 백업'), [4]);
  assert(fails('INSERT INTO 백업 VALUES (SELECT * FROM 사원)'), 'VALUES (SELECT ...)');
  db.exec('CREATE TABLE 부서2 AS SELECT * FROM 부서; INSERT INTO 부서2 (부서번호) VALUES (99)');
  eq(one('SELECT COUNT(*) FROM 부서2 WHERE 부서명 IS NULL'), [1], 'SQLite CTAS는 NOT NULL을 복사하지 않음');
  db.close();

  const s = await seededDb();
  s.db.exec('UPDATE 사원 SET 급여 = 급여 + 300 WHERE 부서번호 = 30');
  eq(s.rows('SELECT 급여 FROM 사원 WHERE 부서번호 = 30 ORDER BY 사원번호').flat(), [6500, 5100, 4200, 3500]);
  s.db.exec('UPDATE 사원 SET 커미션 = 100 WHERE 커미션 = NULL');
  eq(s.one('SELECT changes()'), [0], '= NULL은 0행');
  s.db.exec('UPDATE 사원 SET 커미션 = 0 WHERE 커미션 IS NULL');
  eq(s.one('SELECT changes()'), [7], 'IS NULL은 7행');
  s.db.exec('CREATE TABLE t (급여, 커미션); INSERT INTO t VALUES (1000, 200); UPDATE t SET 급여 = 급여 + 커미션, 커미션 = 급여');
  eq(s.one('SELECT 급여, 커미션 FROM t'), [1200, 1000], 'SET 오른쪽은 바꾸기 전 값');
  s.db.close();

  const u = await seededDb();
  u.db.exec("UPDATE 사원 SET 직급 = '과장', 급여 = 급여 + 500 WHERE 이름 = '강대리'; UPDATE 사원 SET 급여 = (SELECT AVG(급여) FROM 사원 WHERE 직급 = '사원') WHERE 사원번호 = 1011");
  eq(u.rows('SELECT 직급, 급여 FROM 사원 WHERE 사원번호 IN (1006, 1011) ORDER BY 사원번호'), [['과장', 4500], ['인턴', 3200]]);
  u.db.exec("UPDATE 사원 SET 급여 = (SELECT 급여 FROM 사원 WHERE 직급 = '없음') WHERE 사원번호 = 1011");
  eq(u.one('SELECT 급여 FROM 사원 WHERE 사원번호 = 1011'), [null], '0행 서브쿼리는 NULL');
  u.db.exec("UPDATE 사원 SET 급여 = (SELECT 급여 FROM 사원 WHERE 직급 = '사원' ORDER BY 사원번호) WHERE 사원번호 = 1011");
  eq(u.one('SELECT 급여 FROM 사원 WHERE 사원번호 = 1011'), [3300], 'SQLite는 여러 행 서브쿼리의 첫 행을 씀');
  u.db.exec("UPDATE 사원 SET 직급 = '부장', 급여 = 7000 WHERE 사원번호 = 9999");
  eq(u.one('SELECT changes(), COUNT(*) FROM 사원'), [0, 11], '없는 행은 0행');
  u.db.close();

  const d = await seededDb();
  d.db.exec('DELETE FROM 사원 WHERE 부서번호 IS NULL; DELETE FROM 급여등급');
  eq(d.one('SELECT (SELECT COUNT(*) FROM 사원), (SELECT COUNT(*) FROM 급여등급)'), [10, 0], 'DELETE 후에도 테이블은 남음');
  assert(d.fails('TRUNCATE TABLE 급여등급'), 'TRUNCATE 없음');
  assert(d.fails('DELETE 사원 WHERE 사원번호 = 1001'), 'FROM 없는 DELETE 안 됨');
  d.db.exec("INSERT INTO 부서 (부서번호, 부서명, 지역) VALUES (20, '플랫폼개발', '판교'), (50, '기획', '서울') ON CONFLICT (부서번호) DO UPDATE SET 부서명 = excluded.부서명, 지역 = excluded.지역");
  eq(d.one('SELECT COUNT(*) FROM 부서'), [5], '업서트: 20 고침, 50 넣음');
  eq(d.one('SELECT 부서명 FROM 부서 WHERE 부서번호 = 20'), ['플랫폼개발']);
  assert(d.fails("MERGE INTO 부서 d USING (SELECT 20 AS 부서번호) s ON (d.부서번호 = s.부서번호) WHEN MATCHED THEN UPDATE SET d.지역 = '서울'"), 'MERGE 없음');
  d.db.close();
});

test('TCL 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  // 트랜잭션으로 묶은 두 UPDATE
  db.exec("BEGIN; UPDATE 사원 SET 커미션 = 커미션 - 200 WHERE 이름 = '박부장'; UPDATE 사원 SET 커미션 = 커미션 + 200 WHERE 이름 = '조대리'; COMMIT");
  eq(rows("SELECT 커미션 FROM 사원 WHERE 이름 IN ('박부장', '조대리') ORDER BY 사원번호").flat(), [300, 400]);
  eq(one('SELECT SUM(커미션) FROM 사원'), [1000], '합계 그대로');
  // ROLLBACK
  db.exec('BEGIN; DELETE FROM 사원 WHERE 부서번호 = 20');
  eq(one('SELECT COUNT(*) FROM 사원'), [7], '삭제 직후');
  db.exec('ROLLBACK');
  eq(one('SELECT COUNT(*) FROM 사원'), [11], '롤백 후');
  // SAVEPOINT
  db.exec('BEGIN; UPDATE 사원 SET 급여 = 급여 + 100 WHERE 부서번호 = 10; SAVEPOINT sp1; DELETE FROM 사원 WHERE 부서번호 = 10; ROLLBACK TO SAVEPOINT sp1; COMMIT');
  eq(rows('SELECT 급여 FROM 사원 WHERE 부서번호 = 10 ORDER BY 사원번호').flat(), [9100, 3200], '저장 지점까지만 되돌림');
  // DDL도 SQLite에서는 롤백됨(오라클과 다름)
  db.exec('BEGIN; UPDATE 사원 SET 급여 = 0 WHERE 사원번호 = 1001; CREATE TABLE 임시 (번호 INTEGER); ROLLBACK');
  eq(one("SELECT (SELECT 급여 FROM 사원 WHERE 사원번호 = 1001), (SELECT COUNT(*) FROM sqlite_master WHERE name = '임시')"), [9100, 0]);
  // 명시적 트랜잭션
  db.exec('BEGIN TRANSACTION; UPDATE 사원 SET 급여 = 1 WHERE 사원번호 = 1001; ROLLBACK');
  eq(one('SELECT 급여 FROM 사원 WHERE 사원번호 = 1001'), [9100]);
  // 따라가기 카드와 문제
  db.exec('CREATE TABLE 메모 (번호 INTEGER); BEGIN; INSERT INTO 메모 VALUES (1); SAVEPOINT a; INSERT INTO 메모 VALUES (2); SAVEPOINT b; INSERT INTO 메모 VALUES (3); ROLLBACK TO SAVEPOINT a; INSERT INTO 메모 VALUES (4); COMMIT');
  eq(rows('SELECT 번호 FROM 메모 ORDER BY 번호').flat(), [1, 4]);
  db.exec('CREATE TABLE t1 (v INTEGER); BEGIN; INSERT INTO t1 VALUES (10); SAVEPOINT s1; INSERT INTO t1 VALUES (20); SAVEPOINT s2; INSERT INTO t1 VALUES (30); ROLLBACK TO SAVEPOINT s2; COMMIT');
  eq(one('SELECT SUM(v) FROM t1'), [30]);
  db.exec('CREATE TABLE t2 (v INTEGER); BEGIN; INSERT INTO t2 VALUES (1); COMMIT; BEGIN; INSERT INTO t2 VALUES (2); SAVEPOINT s; INSERT INTO t2 VALUES (3); ROLLBACK; BEGIN; INSERT INTO t2 VALUES (4); COMMIT');
  eq(rows('SELECT v FROM t2 ORDER BY v').flat(), [1, 4]);
  db.exec('CREATE TABLE t3 (v INTEGER); BEGIN; INSERT INTO t3 VALUES (1); COMMIT; BEGIN; INSERT INTO t3 VALUES (2); INSERT INTO t3 VALUES (3); ROLLBACK');
  eq(rows('SELECT v FROM t3').flat(), [1]);
  assert(!fails('BEGIN; SAVEPOINT a; SAVEPOINT b; ROLLBACK TO SAVEPOINT b; ROLLBACK TO SAVEPOINT a; COMMIT'), 'b → a 순서는 됨');
  assert(!fails('BEGIN; SAVEPOINT a; ROLLBACK TO SAVEPOINT a; ROLLBACK TO SAVEPOINT a; COMMIT'), '같은 지점 두 번');
  // 오라클과 다르다고 적은 SQLite 동작(트랜잭션이 없는 상태에서)
  assert(fails('ROLLBACK'), '트랜잭션 없는 ROLLBACK은 오류');
  assert(fails('COMMIT'), '트랜잭션 없는 COMMIT은 오류');
  assert(fails('COMMIT WORK'), 'WORK 없음');
  assert(!fails('BEGIN; COMMIT TRANSACTION'), 'COMMIT TRANSACTION은 됨');
  assert(!fails('CREATE TABLE r (v); SAVEPOINT s; INSERT INTO r VALUES (1); RELEASE s'), 'RELEASE 있음');
  db.close();

  const e = await seededDb();
  assert(e.fails('BEGIN; SAVEPOINT a; SAVEPOINT b; ROLLBACK TO SAVEPOINT a; ROLLBACK TO SAVEPOINT b'), 'a로 되돌리면 b는 사라짐');
  e.db.close();
});

test('DDL 단원: 카드·문제에 적은 값과 SQLite 동작', async () => {
  const { db, one, rows, fails } = await seededDb();
  // 제약조건 카드: CHECK는 NULL 통과, DEFAULT는 생략할 때만, 조합 UNIQUE
  db.exec("CREATE TABLE 수강신청 (신청번호 INTEGER, 사원번호 INTEGER NOT NULL, 과정명 VARCHAR2(50) NOT NULL, 점수 NUMBER(3) CHECK (점수 BETWEEN 0 AND 100), 상태 VARCHAR2(10) DEFAULT '신청', CONSTRAINT 수강신청_PK PRIMARY KEY (신청번호), CONSTRAINT 수강신청_UK UNIQUE (사원번호, 과정명))");
  db.exec("INSERT INTO 수강신청 (신청번호, 사원번호, 과정명, 점수) VALUES (1, 1008, 'SQL 기초', 85)");
  db.exec("INSERT INTO 수강신청 (신청번호, 사원번호, 과정명) VALUES (2, 1009, 'SQL 기초')");
  eq(rows('SELECT 점수, 상태 FROM 수강신청 ORDER BY 신청번호'), [[85, '신청'], [null, '신청']]);
  assert(fails("INSERT INTO 수강신청 (신청번호, 사원번호, 과정명) VALUES (3, 1008, 'SQL 기초')"), '조합 UNIQUE');
  assert(fails("INSERT INTO 수강신청 (신청번호, 사원번호, 과정명, 점수) VALUES (4, 1010, 'A', 120)"), 'CHECK');
  db.exec('CREATE TABLE d (번호 INTEGER, 점수 INTEGER DEFAULT 0); INSERT INTO d (번호, 점수) VALUES (1, NULL); INSERT INTO d (번호) VALUES (2)');
  eq(rows('SELECT 점수 FROM d ORDER BY 번호').flat(), [null, 0], 'DEFAULT는 생략할 때만');
  db.exec('CREATE TABLE u (a INTEGER UNIQUE); INSERT INTO u VALUES (NULL); INSERT INTO u VALUES (NULL)');
  eq(one('SELECT COUNT(*) FROM u'), [2], 'UNIQUE는 NULL 여러 번');
  // 외래키 카드: 기본은 검사 꺼짐, 켜면 CASCADE·SET NULL·거부, ON UPDATE CASCADE 지원
  db.exec('CREATE TABLE p0 (id INTEGER PRIMARY KEY); CREATE TABLE c0 (id INTEGER, pid INTEGER REFERENCES p0(id) ON DELETE CASCADE); INSERT INTO p0 VALUES (1); INSERT INTO c0 VALUES (10, 1); DELETE FROM p0');
  eq(one('SELECT COUNT(*) FROM c0'), [1], '검사가 꺼져 있으면 CASCADE도 안 됨');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('CREATE TABLE p1 (id INTEGER PRIMARY KEY); CREATE TABLE c1 (id INTEGER, pid INTEGER REFERENCES p1(id) ON DELETE CASCADE); INSERT INTO p1 VALUES (1), (2); INSERT INTO c1 VALUES (10, 1), (11, 1), (12, 2); DELETE FROM p1 WHERE id = 1');
  eq(rows('SELECT id FROM c1').flat(), [12], 'CASCADE');
  db.exec('CREATE TABLE p2 (id INTEGER PRIMARY KEY); CREATE TABLE c2 (id INTEGER, pid INTEGER REFERENCES p2(id) ON DELETE SET NULL); INSERT INTO p2 VALUES (1); INSERT INTO c2 VALUES (10, 1); DELETE FROM p2');
  eq(rows('SELECT pid FROM c2').flat(), [null], 'SET NULL');
  db.exec('CREATE TABLE p3 (id INTEGER PRIMARY KEY); CREATE TABLE c3 (id INTEGER, pid INTEGER REFERENCES p3(id)); INSERT INTO p3 VALUES (1); INSERT INTO c3 VALUES (10, 1)');
  assert(fails('DELETE FROM p3'), '옵션 없으면 부모 삭제 거부');
  assert(fails('INSERT INTO c3 VALUES (11, 99)'), '없는 부모 값 거부');
  db.exec('CREATE TABLE p4 (id INTEGER PRIMARY KEY); CREATE TABLE c4 (id INTEGER, pid INTEGER REFERENCES p4(id) ON UPDATE CASCADE); INSERT INTO p4 VALUES (1); INSERT INTO c4 VALUES (10, 1); UPDATE p4 SET id = 5');
  eq(one('SELECT pid FROM c4'), [5], 'ON UPDATE CASCADE');
  db.exec('PRAGMA foreign_keys = OFF');
  // CTAS 카드: 제약조건이 하나도 안 따라옴, 별칭 없는 식도 컬럼이 됨, WHERE 1 = 2는 빈 테이블
  db.exec("CREATE TABLE src (a INTEGER NOT NULL PRIMARY KEY, b TEXT NOT NULL); INSERT INTO src VALUES (1, 'x'); CREATE TABLE cp AS SELECT * FROM src");
  eq(rows('SELECT "notnull", pk FROM pragma_table_info(\'cp\')'), [[0, 0], [0, 0]], 'NOT NULL·PK 모두 안 따라옴');
  db.exec('CREATE TABLE ex AS SELECT 이름, 급여 * 12 FROM 사원 WHERE 부서번호 = 10');
  eq(rows("SELECT name FROM pragma_table_info('ex')").flat(), ['이름', '급여 * 12']);
  db.exec('CREATE TABLE 빈사원 AS SELECT * FROM 사원 WHERE 1 = 2');
  eq(one('SELECT COUNT(*) FROM 빈사원'), [0]);
  // ALTER 카드: ADD COLUMN·RENAME은 되고 MODIFY·괄호 ADD·ADD CONSTRAINT·RENAME 문장은 안 됨
  db.exec('CREATE TABLE t (a INTEGER, b TEXT); INSERT INTO t VALUES (1, \'x\'); ALTER TABLE t ADD COLUMN c TEXT DEFAULT \'미정\'; ALTER TABLE t RENAME COLUMN b TO bb; ALTER TABLE t DROP COLUMN a');
  eq(rows("SELECT name FROM pragma_table_info('t')").flat(), ['bb', 'c']);
  eq(one('SELECT c FROM t'), ['미정'], '기존 행에 DEFAULT');
  for (const bad of ['ALTER TABLE t MODIFY (c VARCHAR2(100))', 'ALTER TABLE t ADD (d TEXT)',
    'ALTER TABLE t ADD CONSTRAINT t_pk PRIMARY KEY (bb)', 'RENAME t TO t2', 'TRUNCATE TABLE t',
    'DROP TABLE t CASCADE CONSTRAINTS', 'CREATE TABLE 2026_EMP (a INTEGER)', 'CREATE TABLE z (a INTEGER, b TEXT,)']) {
    assert(fails(bad), `SQLite에서 안 돼야 함: ${bad}`);
  }
  // 오라클과 다른 점으로 적은 것: 길이 미검사, TEXT 기본키의 NULL, NOT NULL에 '', 트랜잭션 안 DROP 되돌리기
  db.exec("CREATE TABLE v (a VARCHAR2(5)); INSERT INTO v VALUES ('abcdefghij')");
  eq(one('SELECT length(a) FROM v'), [10]);
  db.exec('CREATE TABLE k (a TEXT PRIMARY KEY, b INTEGER); INSERT INTO k VALUES (NULL, 1); INSERT INTO k VALUES (NULL, 2)');
  eq(one('SELECT COUNT(*) FROM k'), [2]);
  db.exec('CREATE TABLE ik (a INTEGER PRIMARY KEY, b INTEGER); INSERT INTO ik VALUES (NULL, 1)');
  eq(one('SELECT a FROM ik'), [1], 'INTEGER PRIMARY KEY는 자동 번호');
  db.exec("CREATE TABLE nn (a TEXT NOT NULL); INSERT INTO nn VALUES ('')");
  eq(one('SELECT COUNT(*) FROM nn'), [1]);
  db.exec('BEGIN; DROP TABLE nn; ROLLBACK');
  eq(one('SELECT COUNT(*) FROM nn'), [1], 'DROP도 ROLLBACK');
  // DROP/TRUNCATE/DELETE 카드 예시의 건수
  db.exec('CREATE TABLE 임시사원 AS SELECT * FROM 사원; DELETE FROM 임시사원 WHERE 부서번호 = 20');
  eq(one('SELECT COUNT(*) FROM 임시사원'), [7]);
  db.close();
});

test('DCL 단원: SQLite에는 사용자·권한 문장이 없음', async () => {
  const { db, fails } = await seededDb();
  for (const bad of ['CREATE USER kim IDENTIFIED BY pw1234', 'GRANT CREATE SESSION TO kim', 'GRANT SELECT ON 사원 TO kim',
    'REVOKE SELECT ON 사원 FROM kim', 'CREATE ROLE 조회담당', 'GRANT SELECT ON 사원 TO kim WITH GRANT OPTION']) {
    assert(fails(bad), `SQLite에서 안 돼야 함: ${bad}`);
  }
  db.close();
});

// ---------- 실제 앱 화면 (iframe) ----------

async function openApp(ns, width, height, hash = 'cards') {
  for (const k of Object.keys(localStorage)) if (k.startsWith(`sqld-study:${ns}`)) localStorage.removeItem(k);
  const frame = document.createElement('iframe');
  frame.width = width;
  frame.height = height;
  document.getElementById('frames').append(frame);
  await new Promise((r) => { frame.onload = r; frame.src = `../index.html?ns=${ns}#${hash}`; });
  await frame.contentWindow.appReady;
  return frame;
}

async function reload(frame) {
  await new Promise((r) => { frame.onload = r; frame.contentWindow.location.reload(); });
  await frame.contentWindow.appReady;
}

// 과목 목록을 돌며 이름이 prefix로 시작하는 단원을 찾아 고른다.
function pickUnit(frame, prefix) {
  const w = frame.contentWindow;
  const d = frame.contentDocument;
  const subjects = d.querySelector('#pick-subject');
  for (const opt of [...subjects.options]) {
    subjects.value = opt.value;
    subjects.dispatchEvent(new w.Event('change', { bubbles: true }));
    const units = d.querySelector('#pick-unit');
    const found = [...units.options].find((o) => o.textContent.startsWith(prefix));
    if (found) {
      units.value = found.value;
      units.dispatchEvent(new w.Event('change', { bubbles: true }));
      return;
    }
  }
  throw new Error(`단원 없음: ${prefix}`);
}

function key(win, target, k, opts = {}) {
  target.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
}

test('화면: 노트북 너비에서는 카드와 연습창이 나란히', async () => {
  const f = await openApp('e2e-wide', 1280, 800);
  const d = f.contentDocument;
  const left = d.querySelector('.panel-left').getBoundingClientRect();
  const right = d.querySelector('.panel-right').getBoundingClientRect();
  assert(left.right <= right.left, '왼쪽 패널이 오른쪽 패널의 왼쪽에');
  assert(Math.abs(left.top - right.top) < 2, '위쪽이 나란히');
  assert(d.querySelector('.notice').textContent.includes('오라클과 문법이 다를 수 있어요'), '오라클 안내');
});

test('화면: 폰 너비에서는 위아래로 쌓임, 가로 스크롤 없음', async () => {
  const f = await openApp('e2e-narrow', 390, 844);
  const d = f.contentDocument;
  const left = d.querySelector('.panel-left').getBoundingClientRect();
  const right = d.querySelector('.panel-right').getBoundingClientRect();
  assert(right.top >= left.bottom, '연습창이 카드 아래에');
  assert(d.documentElement.scrollWidth <= 390, `가로 넘침 ${d.documentElement.scrollWidth}`);
});

test('카드: 단원을 바꾸고, 예시 SQL을 연습창으로 보내고, Ctrl+Enter로 실행', async () => {
  const f = await openApp('e2e-cards', 1280, 800);
  const w = f.contentWindow;
  const d = f.contentDocument;
  pickUnit(f, 'GROUP BY');
  eq(d.querySelectorAll('#pick-unit optgroup').length, 3, '2과목 주요항목 3개');
  eq(d.querySelectorAll('#pick-unit option').length, 19, '2과목 단원 19개');
  await waitFor(() => d.querySelector('[data-card="group-aggregate"]'), 'GROUP BY 단원 첫 카드');
  [...d.querySelectorAll('.card-nav button')].find((b) => b.textContent.includes('HAVING')).click();
  const card = await waitFor(() => d.querySelector('[data-card="group-by-having"]'), '카드 목록에서 HAVING 카드로');
  card.querySelector('[data-send]').click();
  const editor = d.querySelector('#sql-editor');
  assert(editor.value.startsWith('SELECT 부서번호, COUNT(*)'), '연습창에 SQL이 들어감');
  key(w, editor, 'Enter', { ctrlKey: true });
  const rows = await waitFor(() => d.querySelectorAll('#sql-result tbody tr'), '결과 표');
  eq(rows.length, 2, 'HAVING COUNT(*) >= 3 인 부서 2개');
  eq([...d.querySelectorAll('#sql-result th')].map((th) => th.textContent), ['부서번호', '인원', '평균급여']);
});

test('카드 화면: 처음엔 SELECT 단원, 항목별 구역, 실행 결과, ←→ 이동, 직접 풀어보기', async () => {
  const data = await (await fetch('../data/cards.json')).json();
  const byText = new Map(L.collectQuestions(data).map((q) => [q.q, q]));
  const f = await openApp('e2e-card-view', 1280, 900);
  const w = f.contentWindow;
  const d = f.contentDocument;
  const card = () => d.querySelector('#view-cards .card');
  eq(card().dataset.card, 'model-what', '처음 열면 카드가 있는 첫 단원(1과목 데이터모델의 이해)의 첫 카드');
  pickUnit(f, 'SELECT 기본과 WHERE');
  eq(card().dataset.card, 'select-basic', '단원을 바꾸면 그 단원 첫 카드');
  assert(d.querySelector('.scope').textContent.includes('SELECT 문, WHERE 절'), '출제 범위 표시');
  eq(d.querySelectorAll('.card-nav button').length, 8);
  eq([...card().querySelectorAll('.sec-title')].map((e) => e.textContent),
    ['쉽게 풀어 보면', '비유로 이해하기', '예시 SQL', '헷갈리기 쉬운 점', '오라클과 SQLite가 달라요', '시험에서는 이렇게 물어요']);
  assert(card().querySelector('.summary'), '한 줄 요약');
  assert(card().querySelector('.tag-oracle'), '오라클 차이 표시');
  await waitFor(() => card().querySelectorAll('.example-result tbody tr').length === 8, '실행 결과 표(8행까지)');
  assert(card().querySelector('.example-result').textContent.includes('11행 중 8행'), '잘린 행 수 안내');

  key(w, d.body, 'ArrowRight');
  eq(card().dataset.card, 'select-order', '→ 다음 카드');
  key(w, d.body, 'ArrowLeft');
  eq(card().dataset.card, 'select-basic', '← 이전 카드');

  const q = byText.get(card().querySelector('.card-quiz .question').textContent);
  key(w, d.body, String(q.answer));
  assert(card().querySelector('.card-quiz .feedback.ok'), '카드 안에서 숫자 키로 답');
  key(w, d.body, 'Enter');
  assert(card().querySelector('.card-quiz .progress').textContent.includes('2 / 2'), '두 번째 문제');
  const q2 = byText.get(card().querySelector('.card-quiz .question').textContent);
  key(w, d.body, String(q2.answer === 1 ? 2 : 1));
  eq(d.querySelector('#wrong-count').textContent, '1', '카드에서 틀려도 오답노트에');
});

test('카드 화면: 표(figures)가 있는 카드는 표와 그림 구역에 표를 그린다', async () => {
  const f = await openApp('e2e-figure', 1280, 900);
  const w = f.contentWindow;
  const d = f.contentDocument;
  pickUnit(f, '그룹 함수');
  [...d.querySelectorAll('.card-nav button')].find((b) => b.textContent.includes('CUBE')).click();
  const card = d.querySelector('#view-cards .card');
  eq(card.dataset.card, 'grp-cube');
  const titles = [...card.querySelectorAll('.sec-title')].map((e) => e.textContent);
  assert(titles.indexOf('표와 그림으로 보기') === titles.indexOf('비유로 이해하기') + 1, titles.join(', '));
  const fig = card.querySelector('.sec-figure figure');
  assert(fig.querySelector('figcaption').textContent.includes('CUBE'), '표 제목');
  eq(fig.querySelectorAll('tbody tr').length, 9, '표의 행');
  eq(fig.querySelectorAll('td.null').length, 6, 'null 칸은 NULL로 표시');
  assert(fig.querySelector('.figure-note'), '표 아래 설명');
});

test('SQL: 오류는 빨간 메시지로, 수정문은 바뀐 행 수로, 초기화하면 원래대로', async () => {
  const f = await openApp('e2e-sql', 1280, 800);
  const w = f.contentWindow;
  const d = f.contentDocument;
  const editor = d.querySelector('#sql-editor');
  editor.value = 'SELECT * FROM 없는테이블;';
  key(w, editor, 'Enter', { ctrlKey: true });
  assert(d.querySelector('#sql-result .result-error'), '오류 메시지');
  editor.value = 'DELETE FROM 사원 WHERE 부서번호 = 20;';
  d.querySelector('#btn-run').click();
  assert(d.querySelector('#sql-result').textContent.includes('바뀐 행: 4'), d.querySelector('#sql-result').textContent);
  editor.value = 'SELECT COUNT(*) FROM 사원;';
  d.querySelector('#btn-reset-db').click();
  eq(d.querySelector('#sql-result td').textContent, '11');
});

test('퀴즈: 숫자 키로 답하고, 틀리면 오답노트, 다시 맞히면 빠짐', async () => {
  const data = await (await fetch('../data/cards.json')).json();
  const byText = new Map(L.collectQuestions(data).map((q) => [q.q, q]));
  const f = await openApp('e2e-quiz', 1280, 800, 'quiz');
  const w = f.contentWindow;
  const d = f.contentDocument;
  const body = d.body;
  const current = () => byText.get(d.querySelector('#view-quiz .question').textContent);

  assert(d.querySelector('#view-quiz .progress').textContent.includes('1 / 10'), '하루 10문제');
  // 글 입력 중에는 숫자 키를 퀴즈가 가로채지 않음
  key(w, d.querySelector('#sql-editor'), '1');
  assert(!d.querySelector('#view-quiz .feedback'), '연습창 입력 중에는 답하지 않음');

  const q1 = current();
  const wrongKey = String(q1.answer === 1 ? 2 : 1);
  key(w, body, wrongKey);
  assert(d.querySelector('#view-quiz .feedback.bad'), '오답 표시');
  eq(d.querySelector('#wrong-count').textContent, '1');
  key(w, body, 'Enter');
  assert(d.querySelector('#view-quiz .progress').textContent.includes('2 / 10'), 'Enter로 다음 문제');

  // 새로고침해도 이어서 풂
  await reload(f);
  const d2 = f.contentDocument;
  assert(d2.querySelector('#view-quiz .progress').textContent.includes('2 / 10'), '진행 상황 유지');
  eq(d2.querySelector('#wrong-count').textContent, '1', '오답노트 유지');

  // 오답노트에서 다시 맞히면 빠짐
  d2.querySelector('[data-tab="wrong"]').click();
  eq(d2.querySelectorAll('#view-wrong .wrong-item').length, 1);
  d2.querySelector('#btn-retry-wrong').click();
  key(f.contentWindow, d2.body, String(q1.answer));
  assert(d2.querySelector('#view-wrong .feedback.ok'), '정답 표시');
  eq(d2.querySelector('#wrong-count').textContent, '0');
});

// ---------- 실행 ----------

const out = document.getElementById('out');
for (const t of tests) {
  try {
    await t.fn();
    results.push(`PASS ${t.name}`);
  } catch (e) {
    results.push(`FAIL ${t.name} :: ${e.message}`);
  }
}
const failed = results.filter((r) => r.startsWith('FAIL')).length;
out.textContent = `${results.join('\n')}\n\n${tests.length - failed} passed, ${failed} failed`;
out.dataset.status = failed ? 'fail' : 'pass';
document.getElementById('frames').remove();
