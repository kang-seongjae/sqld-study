import * as L from './lib/logic.js';
import { createSampleDb, TABLE_INFO } from './lib/sample-db.js';
import { highlightSql } from './lib/highlight.js';

// ?ns=이름 으로 열면 기록을 따로 저장한다(테스트가 실제 기록을 건드리지 않게).
const NS = new URLSearchParams(location.search).get('ns');
const STORE_KEY = NS ? `sqld-study:${NS}` : 'sqld-study';
const UI_KEY = `${STORE_KEY}:ui`;
const DEFAULT_SQL = 'SELECT * FROM 사원;';
const MAX_ROWS = 500;
const TABS = ['cards', 'quiz', 'wrong'];

const $ = (sel) => document.querySelector(sel);
const editor = $('#sql-editor');
// 탐색기에서 접어 둔 과목(번호)
const closedSubjects = new Set();

let data = { subjects: [] };
let dataErrors = [];
let questions = [];
let qById = new Map();
let state = loadJson(STORE_KEY, L.normalizeState, L.emptyState);
// 처음 열면 null → 카드가 있는 첫 단원으로 시작한다(loadCards).
let ui = loadJson(UI_KEY, (v) => (v && typeof v === 'object' ? { subject: v.subject | 0, unit: v.unit | 0, card: v.card | 0 } : null), () => null);
let tab = 'cards';
// 탭별 퀴즈 진행: { ids, idx, answers }. 오늘의 퀴즈의 answers는 state.daily.answers 그 자체라 저장된다.
// cards는 지금 보고 있는 카드의 '직접 풀어보기'(cardId가 붙는다).
const sessions = { quiz: null, wrong: null, cards: null };
let db = null;
let SQL = null;
// 카드 예시 SQL을 새 예제 DB에서 돌린 결과. 연습창에서 테이블을 바꿔도 카드 결과는 그대로다.
const exampleCache = new Map();
const EXAMPLE_ROWS = 8;

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
  for (const t of TABS) {
    const view = $(`#view-${t}`);
    view.hidden = t !== tab;
    // 숨은 탭에 버튼(#btn-next 등)이 남아 있으면 포커스·키 처리가 꼬이므로 비운다.
    if (t !== tab) view.replaceChildren();
  }
  if (location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
  render();
}

function render() {
  updateWrongBadge();
  renderTree();
  updateStatus();
  // 제목 줄: 카드 탭은 열린 카드의 경로(renderCards에서), 다른 탭은 탭 이름
  if (tab !== 'cards') $('#title-path').textContent = tab === 'quiz' ? `오늘의 퀴즈 / ${L.dateKey()}` : '오답노트';
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

// ---------- 상태 표시줄 ----------

function updateStatus() {
  const p = L.overallProgress(state, questions);
  $('#st-progress').textContent = `진도 ${p.percent}% (${p.solved}/${p.total})`;
  $('#st-wrong').textContent = `오답 ${L.wrongQuestions(state, questions).length}`;
  $('#st-today').textContent = `오늘 푼 문제 ${L.todayCount(state)}`;
}

// ---------- 탐색기(과목 → 단원 트리) ----------

function renderTree() {
  const tree = $('#tree');
  if (!data.subjects.length || !ui) { tree.replaceChildren(); return; }
  const items = [];
  data.subjects.forEach((s, si) => {
    const open = !closedSubjects.has(si);
    items.push(h('button', {
      type: 'button',
      class: 'tree-subject',
      'aria-expanded': String(open),
      'data-subject': si,
      onclick: () => { if (open) closedSubjects.add(si); else closedSubjects.delete(si); renderTree(); },
    }, h('span', { class: 'caret', 'aria-hidden': 'true' }, open ? '▾' : '▸'), h('span', {}, s.name)));
    if (!open) return;
    s.units.forEach((u, i) => {
      if (u.group && (i === 0 || s.units[i - 1].group !== u.group)) items.push(h('div', { class: 'tree-group' }, u.group));
      const p = L.unitProgress(state, u);
      const mark = p.done ? h('span', { class: 'tree-mark done', title: '공부 완료' }, '✓')
        : p.solved > 0 ? h('span', { class: 'tree-mark partial', title: '공부 중' }, '◐')
          : h('span', { class: 'tree-mark' });
      items.push(h('button', {
        type: 'button',
        class: `tree-unit${u.cards.length ? '' : ' empty-unit'}`,
        'data-subject': si,
        'data-unit': i,
        'data-done': p.done ? 'true' : null,
        'aria-current': si === ui.subject && i === ui.unit ? 'true' : null,
        title: `카드 ${u.cards.length}장 · 문제 ${p.solved}/${p.total} 맞힘${p.done ? ' · 공부 완료' : ''}`,
        onclick: () => openUnit(si, i),
      },
      h('span', { class: 'file-icon', 'aria-hidden': 'true' }, '≡'),
      h('span', { class: 'tree-name' }, u.name),
      h('span', { class: 'tree-count' }, String(u.cards.length)),
      mark));
    });
  });
  tree.replaceChildren(...items);
}

function openUnit(si, i) {
  ui.subject = si;
  ui.unit = i;
  ui.card = 0;
  saveUi();
  if (isNarrow()) setTreeOpen(false);
  if (tab !== 'cards') setTab('cards');
  else render();
  $('.panel-left').scrollTo({ top: 0 });
}

function setTreeOpen(open) {
  $('#app').classList.toggle('tree-hidden', !open);
  $('#btn-tree').setAttribute('aria-expanded', String(open));
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
  const { subject, unit, card } = currentPlace();
  $('#title-path').textContent = [subject.name, unit?.name, card?.title].filter(Boolean).join(' / ');
  if (unit) {
    view.append(h('p', { class: 'scope' }, '출제 범위: ',
      [unit.group, (unit.topics || [unit.name]).join(', ')].filter(Boolean).join(' › ')));
  }

  if (!unit || !unit.cards.length) {
    view.append(h('p', { class: 'empty' }, '이 단원에는 아직 카드가 없어요. data/cards.json에 추가해 보세요.'));
    return;
  }
  const cards = unit.cards;
  view.append(h('ol', { class: 'card-nav', 'aria-label': '이 단원의 카드' }, cards.map((c, i) =>
    h('li', {}, h('button', {
      type: 'button',
      'aria-current': i === ui.card ? 'true' : null,
      onclick: () => goCard(i),
    }, `${i + 1}. ${c.title}`)))));
  view.append(renderCard(cards[ui.card], subject, unit));
  view.append(h('div', { class: 'card-pager' },
    h('button', { type: 'button', id: 'btn-prev-card', disabled: ui.card === 0, onclick: () => goCard(ui.card - 1) }, '← 이전 카드'),
    h('span', { class: 'meta' }, `${ui.card + 1} / ${cards.length}`),
    h('button', { type: 'button', id: 'btn-next-card', disabled: ui.card === cards.length - 1, onclick: () => goCard(ui.card + 1) }, '다음 카드 →')));
}

// 저장된 위치가 카드 파일과 안 맞으면(카드를 지웠을 때 등) 범위 안으로 당긴다.
function currentPlace() {
  const subjects = data.subjects;
  ui.subject = Math.min(Math.max(ui.subject, 0), subjects.length - 1);
  const subject = subjects[ui.subject];
  ui.unit = Math.min(Math.max(ui.unit, 0), Math.max(subject.units.length - 1, 0));
  const unit = subject.units[ui.unit];
  ui.card = Math.min(Math.max(ui.card, 0), Math.max((unit?.cards.length || 1) - 1, 0));
  return { subject, unit, card: unit?.cards[ui.card] };
}

function goCard(i) {
  const { unit } = currentPlace();
  if (!unit || i < 0 || i >= unit.cards.length) return;
  ui.card = i;
  saveUi();
  render();
  $('.panel-left').scrollTo({ top: 0 });
  if (isNarrow()) $('.card-nav').scrollIntoView({ block: 'start' });
}

function section(cls, title, ...body) {
  return h('section', { class: `sec ${cls}` }, h('h4', { class: 'sec-title' }, title), ...body);
}

function renderCard(c, subject, unit) {
  const oracle = c.oracle || [];
  const card = h('article', { class: 'card', 'data-card': c.id },
    h('div', { class: 'crumb' }, `${subject.name} › ${unit.name}`),
    h('h3', {}, c.title, oracle.length > 0 && h('span', { class: 'tag-oracle' }, '오라클과 다름')),
    c.summary && h('p', { class: 'summary' }, c.summary),
    c.desc && section('sec-desc', '쉽게 풀어 보면', h('p', { class: 'desc' }, c.desc)),
    c.analogy && section('sec-analogy', '비유로 이해하기', h('p', {}, c.analogy)),
    (c.figures?.length > 0 || c.diagram) && section('sec-figure', '표와 그림으로 보기',
      (c.figures || []).map(figureNodes),
      c.diagram && h('pre', { class: 'diagram' }, c.diagram)),
    c.sql && section('sec-sql', '예시 SQL',
      codeBlock(c.sql),
      h('div', { class: 'card-actions' },
        h('button', { type: 'button', class: 'primary', 'data-send': '', onclick: () => sendToEditor(c.sql) }, '연습창으로 보내기 ▶')),
      h('div', { class: 'example-result' }, h('p', { class: 'sub-title' }, '예제 테이블에서 실행한 결과'), exampleResultNodes(c.sql))),
    c.pitfalls?.length > 0 && section('sec-pitfalls', '헷갈리기 쉬운 점', h('ul', {}, c.pitfalls.map((p) => h('li', {}, p)))),
    oracle.length > 0 && section('sec-oracle', '오라클과 SQLite가 달라요', h('ul', {}, oracle.map((p) => h('li', {}, p)))));

  const ids = questions.filter((q) => q.cardId === c.id).map((q) => q.id);
  if (c.exam || ids.length) {
    const quizBox = h('div', { class: 'card-quiz' });
    if (ids.length) {
      if (sessions.cards?.cardId !== c.id) sessions.cards = { cardId: c.id, ids, idx: 0, answers: {} };
      const s = sessions.cards;
      renderSession(quizBox, s, {
        title: '직접 풀어보기',
        onDone: (v) => {
          v.append(
            h('p', {}, h('strong', {}, `직접 풀어보기 ${scoreOf(s)} / ${s.ids.length}`), ' 맞혔어요. 틀린 문제는 오답노트에 담겼어요.'),
            h('div', { class: 'row' },
              h('button', { type: 'button', onclick: () => { sessions.cards = null; renderCards(); } }, '다시 풀기'),
              ui.card + 1 < unit.cards.length && h('button', { type: 'button', class: 'primary', onclick: () => goCard(ui.card + 1) }, '다음 카드 →')));
        },
      });
    }
    card.append(section('sec-exam', '시험에서는 이렇게 물어요', c.exam && h('p', {}, c.exam), quizBox));
  }
  return card;
}

// 카드의 예시 SQL: 줄마다 나눠 줄 번호(CSS counter)와 문법 색을 붙인다.
function codeBlock(sql) {
  const code = h('code', {});
  code.innerHTML = sql.split('\n').map((line) => `<span class="line">${highlightSql(line) || ' '}</span>`).join('');
  return h('pre', { class: 'sql' }, code);
}

// 1과목처럼 SQL 대신 표로 설명하는 카드용. 실행 결과 표와 같은 모양으로 그린다.
function figureNodes(f) {
  return h('figure', { class: 'figure' },
    f.title && h('figcaption', { class: 'sub-title' }, f.title),
    h('div', { class: 'table-wrap' }, h('table', { class: 'result' },
      h('thead', {}, h('tr', {}, f.columns.map((c) => h('th', {}, c)))),
      h('tbody', {}, f.rows.map((row) => h('tr', {}, row.map((v) => (v === null
        ? h('td', { class: 'null' }, 'NULL')
        : h('td', {}, String(v))))))))),
    f.note && h('p', { class: 'figure-note' }, f.note));
}

function exampleResultNodes(sql) {
  if (!SQL) return h('p', { class: 'result-msg' }, 'SQL 엔진을 불러오는 중이에요…');
  if (!exampleCache.has(sql)) {
    let ref;
    try {
      ref = createSampleDb(SQL);
      exampleCache.set(sql, { sets: ref.exec(sql), changes: ref.getRowsModified() });
    } catch (err) {
      exampleCache.set(sql, { error: err.message });
    } finally {
      ref?.close();
    }
  }
  const r = exampleCache.get(sql);
  if (r.error) return h('p', { class: 'result-error' }, `오류: ${r.error}`);
  if (!r.sets.length) return h('p', { class: 'result-msg' }, `실행했어요. 바뀐 행: ${r.changes}`);
  return r.sets.flatMap((set) => resultTable(set, EXAMPLE_ROWS));
}

function sendToEditor(sql) {
  setEditorText(sql);
  state.sql = sql;
  save();
  if (isNarrow()) $('#practice').scrollIntoView({ behavior: 'smooth', block: 'start' });
  editor.focus({ preventScroll: true });
  const box = $('.code-editor');
  box.classList.remove('flash');
  void box.offsetWidth; // 애니메이션을 다시 시작하려고 리플로우
  box.classList.add('flash');
}

// ---------- 연습창 에디터: 투명한 textarea 아래에 색칠한 사본과 줄 번호를 겹쳐 둔다 ----------

function setEditorText(text) {
  editor.value = text;
  syncEditor();
}

function syncEditor() {
  const text = editor.value;
  // 끝에 줄바꿈이 있으면 마지막 빈 줄도 높이를 갖도록 한 칸을 더 둔다.
  $('#editor-hl').innerHTML = highlightSql(text) + (text.endsWith('\n') || !text ? ' ' : '');
  const lines = text.split('\n').length;
  $('#editor-gutter').textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  syncEditorScroll();
}

function syncEditorScroll() {
  const pre = $('.code-hl');
  pre.scrollTop = editor.scrollTop;
  pre.scrollLeft = editor.scrollLeft;
  $('#editor-gutter').scrollTop = editor.scrollTop;
}

// ---------- 퀴즈 공통 ----------

function currentSession() {
  if (tab === 'cards') {
    const s = sessions.cards;
    return s && data.subjects.length && s.cardId === currentPlace().card?.id ? s : null;
  }
  return sessions[tab];
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
  db = createSampleDb(SQL);
}

function showResult(...nodes) {
  $('#sql-result').replaceChildren(...nodes);
}

function resultTable({ columns, values }, max = MAX_ROWS) {
  const shown = values.slice(0, max);
  return [
    h('p', { class: 'result-msg' }, values.length > max ? `${values.length}행 중 ${max}행만 보여요` : `${values.length}행`),
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
      showResult(...sets.flatMap((set) => resultTable(set)));
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
    if (tab === 'cards') renderCards(); // 카드의 '실행한 결과'를 채운다
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
    setEditorText(state.sql || DEFAULT_SQL);
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
  if (tab === 'cards' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && data.subjects.length) {
    e.preventDefault();
    goCard(ui.card + (e.key === 'ArrowRight' ? 1 : -1));
    return;
  }
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
  if (!ui) {
    ui = { subject: 0, unit: 0, card: 0 };
    data.subjects.some((s, si) => s.units.some((u, ui2) => {
      if (!u.cards.length) return false;
      ui = { subject: si, unit: ui2, card: 0 };
      return true;
    }));
  }
}

async function start() {
  renderSchema();
  setEditorText(state.sql || DEFAULT_SQL);
  let t;
  editor.addEventListener('input', () => {
    syncEditor();
    clearTimeout(t);
    t = setTimeout(() => { state.sql = editor.value; save(); }, 400);
  });
  editor.addEventListener('scroll', syncEditorScroll);
  // 폰에서는 탐색기를 접은 채로 시작한다.
  setTreeOpen(!isNarrow());
  $('#btn-tree').addEventListener('click', () => setTreeOpen($('#app').classList.contains('tree-hidden')));
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
