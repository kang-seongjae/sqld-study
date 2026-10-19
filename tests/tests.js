// 브라우저에서 도는 테스트. tests/run_tests.py가 헤드리스 Chrome으로 열어 결과를 읽는다.
// 직접 볼 때: python serve.py 후 http://localhost:8000/tests/test.html
import * as L from '../lib/logic.js';
import { SEED_SQL } from '../lib/sample-db.js';

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
];

test('다 채운 단원: 카드 5~8장, 카드마다 모든 항목과 해설 달린 문제 2개', async () => {
  const data = await (await fetch('../data/cards.json')).json();
  const units = data.subjects.flatMap((s) => s.units);
  for (const name of DONE_UNITS) {
    const unit = units.find((u) => u.name === name);
    assert(unit, `단원 없음: ${name}`);
    assert(unit.cards.length >= 5 && unit.cards.length <= 8, `${name}: 카드 ${unit.cards.length}장`);
    for (const c of unit.cards) {
      for (const k of ['summary', 'desc', 'analogy', 'sql', 'exam']) assert(c[k], `${c.id}: ${k} 없음`);
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
  const db = new SQL.Database();
  db.exec(SEED_SQL);
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
    const db = new SQL.Database();
    db.exec(SEED_SQL);
    try { db.exec(c.sql); } catch (e) { throw new Error(`${c.id}: ${e.message}`); }
    db.close();
  }
});

test('카드에 적은 SQLite 쪽 동작이 연습창 엔진(sql.js)에서 사실임', async () => {
  const SQL = await initSqlJs({ locateFile: (f) => `../vendor/${f}` });
  const db = new SQL.Database();
  db.exec(SEED_SQL);
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
  const db = new SQL.Database();
  db.exec(SEED_SQL);
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
  eq(d.querySelectorAll('#pick-unit optgroup').length, 3, '2과목 주요항목 3개');
  eq(d.querySelectorAll('#pick-unit option').length, 19, '2과목 단원 19개');
  const sel = d.querySelector('#pick-unit');
  sel.value = [...sel.options].find((o) => o.textContent.startsWith('GROUP BY')).value;
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
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
  eq(card().dataset.card, 'rdb-database', '카드가 있는 첫 단원의 첫 카드');
  const sel = d.querySelector('#pick-unit');
  sel.value = [...sel.options].find((o) => o.textContent.startsWith('SELECT 기본과 WHERE')).value;
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
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
