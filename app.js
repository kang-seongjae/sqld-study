import * as L from './lib/logic.js';
import { SEED_SQL, TABLE_INFO } from './lib/sample-db.js';

// ?ns=이름 으로 열면 기록을 따로 저장한다(테스트가 실제 기록을 건드리지 않게).
const NS = new URLSearchParams(location.search).get('ns');
const STORE_KEY = NS ? `sqld-study:${NS}` : 'sqld-study';
const UI_KEY = `${STORE_KEY}:ui`;
const DEFAULT_SQL = 'SELECT * FROM 사원;';
const MAX_ROWS = 500;
const TABS = ['cards', 'quiz', 'wrong'];

const $ = (sel) => document.querySelector(sel);
const editor = $('#sql-editor');

let data = { subjects: [] };
let dataErrors = [];
let questions = [];
let qById = new Map();
let state = loadJson(STORE_KEY, L.normalizeState, L.emptyState);
const ui = loadJson(UI_KEY, (v) => ({ subject: v?.subject | 0, unit: v?.unit | 0 }), () => ({ subject: 0, unit: 0 }));
let tab = 'cards';
// 탭별 퀴즈 진행: { ids, idx, answers }. 오늘의 퀴즈의 answers는 state.daily.answers 그 자체라 저장된다.
const sessions = { quiz: null, wrong: null };
let db = null;
let SQL = null;

// ---------- 저장 ----------

function loadJson(key, normalize, fallback) {
  try {
    return normalize(JSON.parse(localStorage.getItem(key)));
  } catch {
    return fallback();
  }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    toast('브라우저에 기록을 저장하지 못했어요.');
  }
}

function saveUi() {
  try {
    localStorage.setItem(UI_KEY, JSON.stringify(ui));
  } catch { /* 화면 위치는 못 저장해도 괜찮다 */ }
}

// ---------- 작은 도우미 ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
}

const isNarrow = () => matchMedia('(max-width: 860px)').matches;

// ---------- 탭 ----------

function setTab(next) {
  tab = TABS.includes(next) ? next : 'cards';
  for (const b of document.querySelectorAll('.tabs [data-tab]')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  }
  for (const t of TABS) $(`#view-${t}`).hidden = t !== tab;
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  render();
}

function render() {
  updateWrongBadge();
  if (tab === 'cards') renderCards();
  else if (tab === 'quiz') renderQuiz();
  else renderWrong();
}

function updateWrongBadge() {
  const n = L.wrongQuestions(state, questions).length;
  const badge = $('#wrong-count');
  badge.textContent = n;
  badge.classList.toggle('zero', n === 0);
}

// ---------- 개념 카드 ----------

function renderCards() {
  const view = $('#view-cards');
  view.replaceChildren();
  if (dataErrors.length) {
    view.append(h('div', { class: 'errors' },
      h('strong', {}, 'data/cards.json에 고칠 곳이 있어요'),
      h('ul', {}, dataErrors.map((e) => h('li', {}, e)))));
    if (!data.subjects.length) return;
  }
  const subjects = data.subjects;
  if (!subjects.length) {
    view.append(h('p', { class: 'empty' }, '아직 카드가 없어요. data/cards.json에 추가해 보세요.'));
    return;
  }
  ui.subject = Math.min(ui.subject, subjects.length - 1);
  const subject = subjects[ui.subject];
  ui.unit = Math.min(ui.unit, Math.max(subject.units.length - 1, 0));
  const unit = subject.units[ui.unit];

  const subjectSel = h('select', {
    id: 'pick-subject',
    onchange: (e) => { ui.subject = +e.target.value; ui.unit = 0; saveUi(); renderCards(); },
  }, subjects.map((s, i) => h('option', { value: i, selected: i === ui.subject }, s.name)));
  const unitSel = h('select', {
    id: 'pick-unit',
    onchange: (e) => { ui.unit = +e.target.value; saveUi(); renderCards(); },
  }, subject.units.map((u, i) => h('option', { value: i, selected: i === ui.unit }, `${u.name} (${u.cards.length})`)));

  view.append(h('div', { class: 'pickers' },
    h('label', {}, '과목', subjectSel),
    h('label', {}, '단원', unitSel)));

  if (!unit || !unit.cards.length) {
    view.append(h('p', { class: 'empty' }, '이 단원에는 아직 카드가 없어요.'));
    return;
  }
  for (const c of unit.cards) {
    const nQuiz = (c.quiz || []).length;
    view.append(h('article', { class: 'card', 'data-card': c.id },
      h('div', { class: 'crumb' }, `${subject.name} › ${unit.name}`),
      h('h3', {}, c.title),
      c.desc && h('p', { class: 'desc' }, c.desc),
      c.sql && h('pre', { class: 'sql' }, h('code', {}, c.sql)),
      h('div', { class: 'card-actions' },
        c.sql && h('button', { type: 'button', class: 'primary', 'data-send': '', onclick: () => sendToEditor(c.sql) }, '연습창으로 보내기 ▶'),
        h('span', { class: 'meta' }, nQuiz ? `퀴즈 ${nQuiz}문제` : '퀴즈 없음'))));
  }
}

function sendToEditor(sql) {
  editor.value = sql;
  state.sql = sql;
  save();
  if (isNarrow()) $('#practice').scrollIntoView({ behavior: 'smooth', block: 'start' });
  editor.focus({ preventScroll: true });
  editor.classList.remove('flash');
  void editor.offsetWidth; // 애니메이션을 다시 시작하려고 리플로우
  editor.classList.add('flash');
}

// ---------- 퀴즈 공통 ----------

function currentSession() {
  return tab === 'quiz' || tab === 'wrong' ? sessions[tab] : null;
}

function currentQuestion(s) {
  return s && s.idx < s.ids.length ? qById.get(s.ids[s.idx]) : null;
}

function answer(choice) {
  const s = currentSession();
  const q = currentQuestion(s);
  if (!q || s.answers[q.id] != null) return;
  s.answers[q.id] = choice;
  L.recordAnswer(state, q, choice);
  save();
  render();
  $('#btn-next')?.focus({ preventScroll: true });
}

function next() {
  const s = currentSession();
  if (!s || s.idx >= s.ids.length) return;
  s.idx += 1;
  render();
}

function renderSession(view, s, { title, onDone }) {
  const q = currentQuestion(s);
  if (!q) {
    onDone(view, s);
    return;
  }
  const picked = s.answers[q.id];
  const done = picked != null;
  view.append(
    h('div', { class: 'quiz-head' },
      h('span', { class: 'progress' }, `${title} ${s.idx + 1} / ${s.ids.length}`),
      h('span', { class: 'crumb' }, `${q.subject} › ${q.unit} › ${q.cardTitle}`)),
    h('p', { class: 'question' }, q.q),
    h('ol', { class: 'choices' }, q.choices.map((text, i) => {
      const n = i + 1;
      let cls = '';
      if (done && n === q.answer) cls = 'correct';
      else if (done && n === picked) cls = 'wrong';
      return h('li', {}, h('button', {
        type: 'button', class: cls, disabled: done, 'data-choice': n, onclick: () => answer(n),
      }, h('kbd', {}, n), h('span', {}, text)));
    })));
  if (done) {
    const ok = picked === q.answer;
    view.append(h('div', { class: `feedback ${ok ? 'ok' : 'bad'}` },
      h('p', {}, h('strong', {}, ok ? '정답이에요!' : `틀렸어요. 정답은 ${q.answer}번이에요.`),
        ok ? '' : ' 오답노트에 담았어요.'),
      q.explain && h('p', {}, q.explain)));
    view.append(h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', id: 'btn-next', onclick: next },
        s.idx + 1 < s.ids.length ? '다음 문제' : '결과 보기', ' ', h('kbd', {}, 'Enter'))));
  } else {
    view.append(h('p', { class: 'hint' }, '숫자 키 1~4로 답을 고를 수 있어요.'));
  }
}

function scoreOf(s) {
  return s.ids.filter((id) => s.answers[id] === qById.get(id)?.answer).length;
}

// ---------- 오늘의 퀴즈 ----------

function dailySession() {
  const daily = L.ensureDaily(state, questions, L.dateKey());
  save();
  const s = sessions.quiz;
  if (s && s.answers === daily.answers && s.ids === daily.ids) return s;
  const firstOpen = daily.ids.findIndex((id) => daily.answers[id] == null);
  sessions.quiz = { ids: daily.ids, answers: daily.answers, idx: firstOpen === -1 ? daily.ids.length : firstOpen };
  return sessions.quiz;
}

function renderQuiz() {
  const view = $('#view-quiz');
  view.replaceChildren();
  if (!questions.length) {
    sessions.quiz = null;
    view.append(h('p', { class: 'empty' }, '아직 퀴즈가 없어요. data/cards.json의 카드에 "quiz"를 추가해 보세요.'));
    return;
  }
  const s = dailySession();
  renderSession(view, s, {
    title: '오늘의 퀴즈',
    onDone: (v) => {
      v.append(
        h('h3', {}, `오늘의 퀴즈 끝! (${L.dateKey()})`),
        h('p', { class: 'score' }, `${scoreOf(s)} / ${s.ids.length}`),
        s.ids.length < L.DAILY_COUNT && h('p', { class: 'hint' },
          `지금은 퀴즈가 ${questions.length}문제뿐이라 ${s.ids.length}문제만 나왔어요. 카드에 퀴즈를 더 붙이면 하루 ${L.DAILY_COUNT}문제까지 나와요.`),
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () => {
            for (const id of s.ids) delete s.answers[id];
            s.idx = 0;
            save();
            render();
          } }, '같은 문제 다시 풀기'),
          h('button', { type: 'button', class: 'primary', onclick: () => setTab('wrong') }, '오답노트 보기')));
    },
  });
}

// ---------- 오답노트 ----------

function renderWrong() {
  const view = $('#view-wrong');
  view.replaceChildren();
  const s = sessions.wrong;
  if (s) {
    renderSession(view, s, {
      title: '오답 다시 풀기',
      onDone: (v) => {
        v.append(
          h('h3', {}, '다시 풀기 끝!'),
          h('p', { class: 'score' }, `${scoreOf(s)} / ${s.ids.length}`),
          h('p', { class: 'hint' }, '맞힌 문제는 오답노트에서 빠졌어요.'),
          h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: () => { sessions.wrong = null; render(); } }, '오답노트로 돌아가기')));
      },
    });
    return;
  }
  const list = L.wrongQuestions(state, questions);
  if (!list.length) {
    view.append(h('p', { class: 'empty' }, '오답노트가 비어 있어요. 틀린 문제는 여기에 모이고, 다시 맞히면 빠져요.'));
    return;
  }
  view.append(h('div', { class: 'row', style: 'margin: 0 0 14px' },
    h('button', { type: 'button', class: 'primary', id: 'btn-retry-wrong', onclick: () => {
      sessions.wrong = { ids: L.shuffle(list.map((q) => q.id)), idx: 0, answers: {} };
      render();
    } }, `오답 ${list.length}문제 다시 풀기`)));
  for (const q of list) {
    const w = state.wrong[q.id];
    view.append(h('div', { class: 'wrong-item' },
      h('div', { class: 'crumb' }, `${q.subject} › ${q.unit} › ${q.cardTitle} · ${w.count}번 틀림`),
      h('p', {}, h('strong', {}, q.q)),
      h('p', { class: 'hint' }, `정답: ${q.answer}. ${q.choices[q.answer - 1]}`)));
  }
}

// ---------- SQL 연습 ----------

function renderSchema() {
  $('#schema-list').replaceChildren(...TABLE_INFO.map((t) =>
    h('p', { class: 'schema-table' }, h('strong', {}, t.name), ' ', h('code', {}, `(${t.columns.join(', ')})`))));
}

function resetDb() {
  if (db) db.close();
  db = new SQL.Database();
  db.exec(SEED_SQL);
}

function showResult(...nodes) {
  $('#sql-result').replaceChildren(...nodes);
}

function resultTable({ columns, values }) {
  const shown = values.slice(0, MAX_ROWS);
  return [
    h('p', { class: 'result-msg' }, values.length > MAX_ROWS ? `${values.length}행 중 ${MAX_ROWS}행만 보여요` : `${values.length}행`),
    h('div', { class: 'table-wrap' }, h('table', { class: 'result' },
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', {}, c)))),
      h('tbody', {}, shown.map((row) => h('tr', {}, row.map((v) => {
        if (v === null) return h('td', { class: 'null' }, 'NULL');
        return h('td', { class: typeof v === 'number' ? 'num' : null }, String(v));
      })))))),
  ];
}

function runEditor() {
  const sql = editor.value.trim();
  if (!sql) return;
  if (!db) {
    showResult(h('p', { class: 'result-msg' }, 'SQL 엔진을 아직 불러오는 중이에요. 잠시 뒤에 다시 실행해 주세요.'));
    return;
  }
  try {
    const sets = db.exec(sql);
    if (!sets.length) {
      showResult(h('p', { class: 'result-msg' }, `실행했어요. 바뀐 행: ${db.getRowsModified()}`));
    } else {
      showResult(...sets.flatMap(resultTable));
    }
  } catch (err) {
    showResult(h('p', { class: 'result-error' }, `오류: ${err.message}`));
  }
}

async function initDb() {
  try {
    SQL = await initSqlJs({ locateFile: (f) => `vendor/${f}` });
    resetDb();
    runEditor();
  } catch (err) {
    showResult(h('p', { class: 'result-error' }, `SQL 엔진을 불러오지 못했어요: ${err.message}`));
  }
}

// ---------- 백업 ----------

function exportBackup() {
  const blob = new Blob([JSON.stringify(L.makeBackup(state), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `sqld-backup-${L.dateKey()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('백업 파일을 내려받았어요.');
}

async function importBackup(file) {
  try {
    const next = L.readBackup(await file.text());
    const n = Object.keys(next.wrong).length;
    if (!confirm(`지금 기록을 이 백업으로 바꿀까요?\n(오답노트 ${n}문제)`)) return;
    state = next;
    save();
    sessions.quiz = null;
    sessions.wrong = null;
    editor.value = state.sql || DEFAULT_SQL;
    render();
    toast('백업을 불러왔어요.');
  } catch (err) {
    toast(`불러오지 못했어요: ${err.message}`);
  }
}

// ---------- 키보드 ----------

function onKeydown(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    runEditor();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  // 글을 입력하는 중에는 숫자 키를 가로채지 않는다.
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const s = currentSession();
  const q = currentQuestion(s);
  if (!q) return;
  if (/^[1-4]$/.test(e.key)) {
    e.preventDefault();
    answer(Number(e.key));
  } else if (e.key === 'Enter' && s.answers[q.id] != null && e.target.tagName !== 'BUTTON') {
    // 버튼에 포커스가 있으면 브라우저가 알아서 누르므로 두 번 넘어가지 않게 건너뛴다.
    e.preventDefault();
    next();
  }
}

// ---------- 시작 ----------

async function loadCards() {
  try {
    const res = await fetch('data/cards.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    dataErrors = L.validateCards(json);
    if (Array.isArray(json?.subjects)) data = json;
    // 형식이 틀린 카드가 있어도 읽을 수 있는 부분은 보여 준다.
    data.subjects = data.subjects.filter((s) => s && Array.isArray(s.units))
      .map((s) => ({ ...s, units: s.units.filter((u) => u && Array.isArray(u.cards)) }));
    questions = dataErrors.length ? [] : L.collectQuestions(data);
    if (dataErrors.length) dataErrors.push('오류를 고치기 전까지 퀴즈는 쉬어요.');
  } catch (err) {
    dataErrors = [`data/cards.json을 읽지 못했어요: ${err.message}`];
  }
  qById = new Map(questions.map((q) => [q.id, q]));
}

async function start() {
  renderSchema();
  editor.value = state.sql || DEFAULT_SQL;
  let t;
  editor.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { state.sql = editor.value; save(); }, 400);
  });
  document.addEventListener('keydown', onKeydown);
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));
  $('#btn-run').addEventListener('click', runEditor);
  $('#btn-reset-db').addEventListener('click', () => {
    if (!SQL) return;
    resetDb();
    toast('예제 테이블을 처음 상태로 되돌렸어요.');
    runEditor();
  });
  $('#btn-export').addEventListener('click', exportBackup);
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (f) importBackup(f);
  });
  window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));

  const dbReady = initDb();
  await loadCards();
  setTab(location.hash.slice(1));
  await dbReady;

  if ('serviceWorker' in navigator && !NS && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 캐시 없이도 앱은 돈다 */ });
  }
}

// 테스트가 준비 완료를 기다릴 수 있게 열어 둔다.
window.appReady = start();
