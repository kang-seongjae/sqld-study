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
  assert(qs.length >= 1, '퀴즈가 하나 이상');
  eq(qs[0].id, 'select-where#1');
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
  eq(d.querySelectorAll('#pick-unit option').length, 3, '단원 3개');
  const sel = d.querySelector('#pick-unit');
  sel.value = '1';
  sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  const card = await waitFor(() => d.querySelector('[data-card="group-by-having"]'), 'GROUP BY 카드');
  card.querySelector('[data-send]').click();
  const editor = d.querySelector('#sql-editor');
  assert(editor.value.startsWith('SELECT 부서번호, COUNT(*)'), '연습창에 SQL이 들어감');
  key(w, editor, 'Enter', { ctrlKey: true });
  const rows = await waitFor(() => d.querySelectorAll('#sql-result tbody tr'), '결과 표');
  eq(rows.length, 2, 'HAVING COUNT(*) >= 3 인 부서 2개');
  eq([...d.querySelectorAll('#sql-result th')].map((th) => th.textContent), ['부서번호', '인원', '평균급여']);
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

  assert(d.querySelector('#view-quiz .progress').textContent.includes('1 / 3'), '문제가 3개라 3문제');
  // 글 입력 중에는 숫자 키를 퀴즈가 가로채지 않음
  key(w, d.querySelector('#sql-editor'), '1');
  assert(!d.querySelector('#view-quiz .feedback'), '연습창 입력 중에는 답하지 않음');

  const q1 = current();
  const wrongKey = String(q1.answer === 1 ? 2 : 1);
  key(w, body, wrongKey);
  assert(d.querySelector('#view-quiz .feedback.bad'), '오답 표시');
  eq(d.querySelector('#wrong-count').textContent, '1');
  key(w, body, 'Enter');
  assert(d.querySelector('#view-quiz .progress').textContent.includes('2 / 3'), 'Enter로 다음 문제');

  // 새로고침해도 이어서 풂
  await reload(f);
  const d2 = f.contentDocument;
  assert(d2.querySelector('#view-quiz .progress').textContent.includes('2 / 3'), '진행 상황 유지');
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
