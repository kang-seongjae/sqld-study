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
export const CARD_TEXT_FIELDS = ['summary', 'desc', 'analogy', 'sql', 'exam'];
export const CARD_LIST_FIELDS = ['pitfalls', 'oracle'];

const isStringList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

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

// 모든 카드의 퀴즈를 한 줄로 편다. id를 따로 안 적으면 '카드id#순번'.
export function collectQuestions(data) {
  const out = [];
  for (const s of data.subjects) {
    for (const u of s.units) {
      for (const c of u.cards) {
        (c.quiz || []).forEach((q, i) => out.push({
          id: q.id || `${c.id}#${i + 1}`,
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

export function emptyState() {
  return { wrong: {}, daily: null, sql: '' };
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

// 틀리면 오답노트에 넣고(횟수 +1), 맞히면 뺀다.
export function recordAnswer(state, q, choice, now = Date.now()) {
  const correct = choice === q.answer;
  if (correct) delete state.wrong[q.id];
  else state.wrong[q.id] = { count: (state.wrong[q.id]?.count || 0) + 1, last: now };
  return correct;
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
