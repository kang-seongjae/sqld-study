// 순수 로직 모음: DOM·저장소에 의존하지 않아서 tests/에서 그대로 테스트한다.

export const DAILY_COUNT = 10;
export const BACKUP_APP = 'sqld-study';
export const BACKUP_FORMAT = 1;

// 로컬 시간 기준 'YYYY-MM-DD'
export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// FNV-1a: 날짜 문자열을 섞기용 시드로 바꾼다.
export function hashString(s) {
  let h = 2166136261;
  for (const ch of s) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: 같은 시드면 같은 난수열
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rand = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 카드 항목: 요약, 쉬운 설명, 비유, 예시 SQL, 시험 출제 방식 / 헷갈리는 점, 오라클과 다른 점
// diagram은 SQL 대신 쓰는 글자 그림, figures는 표 목록이다(1과목처럼 실행할 SQL이 없는 카드용).
export const CARD_TEXT_FIELDS = ['summary', 'desc', 'analogy', 'sql', 'diagram', 'exam'];
export const CARD_LIST_FIELDS = ['pitfalls', 'oracle'];

const isStringList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

// 표 하나: { "title": "...", "columns": ["열1", "열2"], "rows": [["값", 1], ...], "note": "..." }
function figureErrors(f) {
  if (!f || typeof f !== 'object') return ['표는 { } 객체여야 해요.'];
  const errors = [];
  if (f.title !== undefined && typeof f.title !== 'string') errors.push('title은 "문자열"이어야 해요.');
  if (f.note !== undefined && typeof f.note !== 'string') errors.push('note는 "문자열"이어야 해요.');
  if (!isStringList(f.columns) || !f.columns.length) errors.push('columns는 ["열 이름", ...] 배열이어야 해요.');
  if (!Array.isArray(f.rows)) errors.push('rows는 [[값, ...], ...] 배열이어야 해요.');
  else {
    f.rows.forEach((r, ri) => {
      const ok = Array.isArray(r) && r.every((v) => v === null || ['string', 'number'].includes(typeof v));
      if (!ok) errors.push(`rows[${ri}]는 문자·숫자·null로 된 배열이어야 해요.`);
      else if (isStringList(f.columns) && r.length !== f.columns.length) errors.push(`rows[${ri}]의 칸 수가 columns(${f.columns.length}개)와 달라요.`);
    });
  }
  return errors;
}

// data/cards.json 형식 검사. 사람이 직접 고치는 파일이라 오류 위치를 알려 준다.
export function validateCards(data) {
  if (!data || !Array.isArray(data.subjects)) return ['최상위에 "subjects" 배열이 있어야 해요.'];
  const errors = [];
  const cardIds = new Set();
  const quizIds = new Set();
  data.subjects.forEach((s, si) => {
    const w1 = `subjects[${si}]`;
    if (!s || !s.name) errors.push(`${w1}: name(과목 이름)이 비어 있어요.`);
    if (!s || !Array.isArray(s.units)) { errors.push(`${w1}: units 배열이 필요해요.`); return; }
    s.units.forEach((u, ui) => {
      const w2 = `${w1}.units[${ui}]`;
      if (!u || !u.name) errors.push(`${w2}: name(단원 이름)이 비어 있어요.`);
      if (!u || !Array.isArray(u.cards)) { errors.push(`${w2}: cards 배열이 필요해요.`); return; }
      if (u.group !== undefined && typeof u.group !== 'string') errors.push(`${w2}: group은 "문자열"이어야 해요.`);
      if (u.topics !== undefined && !isStringList(u.topics)) errors.push(`${w2}: topics는 ["문자열", ...] 배열이어야 해요.`);
      u.cards.forEach((c, ci) => {
        const w3 = `${w2}.cards[${ci}]`;
        if (!c || typeof c !== 'object') { errors.push(`${w3}: 카드는 { } 객체여야 해요.`); return; }
        if (!c.id) errors.push(`${w3}: id가 필요해요.`);
        else if (cardIds.has(c.id)) errors.push(`${w3}: id "${c.id}"가 다른 카드와 겹쳐요.`);
        else cardIds.add(c.id);
        if (!c.title) errors.push(`${w3}: title(제목)이 필요해요.`);
        for (const k of CARD_TEXT_FIELDS) {
          if (c[k] !== undefined && typeof c[k] !== 'string') errors.push(`${w3}: ${k}는 "문자열"이어야 해요.`);
        }
        for (const k of CARD_LIST_FIELDS) {
          if (c[k] !== undefined && !isStringList(c[k])) errors.push(`${w3}: ${k}는 ["문자열", ...] 배열이어야 해요.`);
        }
        if (c.figures !== undefined) {
          if (!Array.isArray(c.figures)) errors.push(`${w3}: figures는 [ ] 배열이어야 해요.`);
          else c.figures.forEach((f, fi) => figureErrors(f).forEach((e) => errors.push(`${w3}.figures[${fi}]: ${e}`)));
        }
        if (c.quiz === undefined) return;
        if (!Array.isArray(c.quiz)) { errors.push(`${w3}: quiz는 [ ] 배열이어야 해요.`); return; }
        c.quiz.forEach((q, qi) => {
          const w4 = `${w3}.quiz[${qi}]`;
          if (!q || !q.q) errors.push(`${w4}: q(문제)가 필요해요.`);
          if (!q || !isStringList(q.choices) || q.choices.length !== 4) errors.push(`${w4}: choices는 보기 4개짜리 배열이어야 해요.`);
          if (!q || ![1, 2, 3, 4].includes(q.answer)) errors.push(`${w4}: answer는 정답 번호 1~4 중 하나여야 해요.`);
          const id = q && (q.id || `${c.id}#${qi + 1}`);
          if (id && quizIds.has(id)) errors.push(`${w4}: 문제 id "${id}"가 겹쳐요.`);
          quizIds.add(id);
        });
      });
    });
  });
  return errors;
}

// 문제 id: 따로 안 적으면 '카드id#순번'.
const questionId = (c, q, i) => q.id || `${c.id}#${i + 1}`;

// 모든 카드의 퀴즈를 한 줄로 편다.
export function collectQuestions(data) {
  const out = [];
  for (const s of data.subjects) {
    for (const u of s.units) {
      for (const c of u.cards) {
        (c.quiz || []).forEach((q, i) => out.push({
          id: questionId(c, q, i),
          cardId: c.id,
          cardTitle: c.title,
          subject: s.name,
          unit: u.name,
          q: q.q,
          choices: q.choices,
          answer: q.answer,
          explain: q.explain || '',
        }));
      }
    }
  }
  return out;
}

// 날짜를 시드로 섞어서, 같은 날엔 같은 문제 묶음이 나온다.
export function pickDaily(questions, day, n = DAILY_COUNT) {
  const ids = questions.map((q) => q.id).sort();
  return shuffle(ids, rng(hashString(day))).slice(0, n);
}

// solved: 한 번이라도 맞힌 문제 { id: 맞힌 시각 } (진도율·단원 완료 표시용)
// activity: 오늘 푼 문제 수 { date: 'YYYY-MM-DD', count }
export function emptyState() {
  return { wrong: {}, daily: null, sql: '', solved: {}, activity: { date: '', count: 0 } };
}

// 저장소·백업에서 읽은 값을 믿지 않고 모양을 맞춘다.
export function normalizeState(raw) {
  const s = emptyState();
  if (!raw || typeof raw !== 'object') return s;
  if (raw.wrong && typeof raw.wrong === 'object' && !Array.isArray(raw.wrong)) {
    for (const [id, w] of Object.entries(raw.wrong)) {
      s.wrong[id] = { count: Number(w && w.count) || 1, last: Number(w && w.last) || 0 };
    }
  }
  const d = raw.daily;
  if (d && typeof d.date === 'string' && Array.isArray(d.ids)) {
    s.daily = {
      date: d.date,
      ids: d.ids.filter((x) => typeof x === 'string'),
      answers: d.answers && typeof d.answers === 'object' && !Array.isArray(d.answers) ? { ...d.answers } : {},
    };
  }
  if (typeof raw.sql === 'string') s.sql = raw.sql;
  if (raw.solved && typeof raw.solved === 'object' && !Array.isArray(raw.solved)) {
    for (const [id, t] of Object.entries(raw.solved)) s.solved[id] = Number(t) || 0;
  }
  const a = raw.activity;
  if (a && typeof a.date === 'string' && Number.isFinite(a.count)) s.activity = { date: a.date, count: a.count };
  return s;
}

// 오늘 묶음이 없거나, 날짜가 바뀌었거나, 지워진 문제가 섞여 있으면 새로 뽑는다.
// 아직 하나도 안 풀었는데 문제 수가 늘었으면 다시 뽑는다.
export function ensureDaily(state, questions, day, n = DAILY_COUNT) {
  const valid = new Set(questions.map((q) => q.id));
  const d = state.daily;
  const want = Math.min(n, valid.size);
  const fresh = d && d.date === day && d.ids.length > 0 && d.ids.every((id) => valid.has(id));
  const grown = fresh && Object.keys(d.answers).length === 0 && d.ids.length < want;
  if (!fresh || grown) state.daily = { date: day, ids: pickDaily(questions, day, n), answers: {} };
  return state.daily;
}

// 틀리면 오답노트에 넣고(횟수 +1), 맞히면 빼고 '맞힌 문제'로 남긴다. 오늘 푼 문제 수도 센다.
export function recordAnswer(state, q, choice, now = Date.now()) {
  const correct = choice === q.answer;
  if (correct) {
    delete state.wrong[q.id];
    state.solved[q.id] = now;
  } else {
    state.wrong[q.id] = { count: (state.wrong[q.id]?.count || 0) + 1, last: now };
  }
  const day = dateKey(new Date(now));
  if (state.activity.date !== day) state.activity = { date: day, count: 0 };
  state.activity.count += 1;
  return correct;
}

export function todayCount(state, day = dateKey()) {
  return state.activity.date === day ? state.activity.count : 0;
}

// 단원 진도: 한 번이라도 맞혔고 지금 오답노트에 없는 문제를 '완료'로 센다.
export function unitProgress(state, unit) {
  const ids = unit.cards.flatMap((c) => (c.quiz || []).map((q, i) => questionId(c, q, i)));
  const solved = ids.filter((id) => state.solved[id] && !state.wrong[id]).length;
  return { total: ids.length, solved, done: ids.length > 0 && solved === ids.length };
}

// 전체 진도: 지금 카드에 있는 문제만 센다(지워진 문제의 기록은 무시).
export function overallProgress(state, questions) {
  const solved = questions.filter((q) => state.solved[q.id] && !state.wrong[q.id]).length;
  return { total: questions.length, solved, percent: questions.length ? Math.round((solved / questions.length) * 100) : 0 };
}

// 오답노트에 있고 아직 카드에 남아 있는 문제, 최근에 틀린 순
export function wrongQuestions(state, questions) {
  return questions
    .filter((q) => state.wrong[q.id])
    .sort((a, b) => state.wrong[b.id].last - state.wrong[a.id].last);
}

export function makeBackup(state, now = new Date()) {
  return { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: now.toISOString(), state };
}

export function readBackup(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('JSON 형식이 아니에요.');
  }
  if (!obj || obj.app !== BACKUP_APP) throw new Error('이 앱에서 내보낸 백업 파일이 아니에요.');
  if (typeof obj.format !== 'number' || obj.format > BACKUP_FORMAT) throw new Error('지원하지 않는 백업 버전이에요.');
  return normalizeState(obj.state);
}
