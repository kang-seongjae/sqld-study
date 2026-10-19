# SQLD 공부 앱

서버 없이 브라우저에서만 도는 SQLD 공부용 정적 웹 앱. 주 사용 환경은 노트북 브라우저, 폰은 위아래로 쌓이는 보조 화면.
기록은 브라우저 localStorage에만 저장하고, 백업은 JSON 파일로 내보내기/불러오기.

## 구조

- `index.html`, `style.css`, `app.js`: 화면과 동작. 왼쪽 패널(개념 카드·오늘의 퀴즈·오답노트 탭), 오른쪽 SQL 연습창
- `lib/logic.js`: 퀴즈 뽑기·오답노트·백업·카드 검사 같은 순수 로직(DOM 없음). 로직은 여기에 두고 테스트한다
- `lib/sample-db.js`: 예제 테이블(사원, 부서, 급여등급) 생성 SQL과 `createSampleDb()`.
  연습창·카드 결과·테스트는 모두 `createSampleDb()`로 DB를 만든다(REGEXP 연산자용 `regexp()` 함수를 여기서 등록).
- `data/cards.json`: 카드와 퀴즈 내용. 형식은 `data/README.md`
- `lib/highlight.js`: SQL 문법 색칠(연습창과 카드 예시 SQL이 함께 씀)
- `vendor/sql-wasm.js`, `vendor/sql-wasm.wasm`: sql.js 1.10.3 (오프라인용으로 저장소에 포함, CDN 사용 금지)
- `fonts/`: D2Coding 1.3.2 원본 TTF와 라이선스(OFL 1.1). 'D2Coding'은 예약 글꼴 이름이라 파일을 고치거나 서브셋하지 않는다(`fonts/README.md`)

## 화면(코드 에디터 테마)

- 왼쪽 탐색기(과목 → 단원 트리) | 가운데 탭(개념 카드·오늘의 퀴즈·오답노트) | 오른쪽 SQL 연습창(줄 번호·문법 색, 터미널 출력) | 아래 상태 표시줄.
  1100px 미만에서는 연습창이 아래로, 860px 이하(폰)에서는 모두 위아래로 쌓이고 탐색기는 ☰로 접는다.
- 색은 `style.css`의 `:root` 변수로만 쓴다. 새 색을 넣으면 `tests/tests.js`의 대비 검사(4.5:1)에 짝을 추가한다.
- 진도는 `state.solved`(한 번이라도 맞힌 문제)와 오답노트로 계산한다. 단원 완료 = 단원의 모든 문제를 맞혔고 오답노트에 남은 것이 없음.
- 디자인을 바꿀 때는 `python tests/shots.py before` → 수정 → `python tests/shots.py after`로 `screenshots/compare.html`에서 전후를 비교한다.
- `sw.js`: 오프라인 캐시(캐시 우선)
- `serve.py`: 로컬 정적 서버. `python serve.py` → http://localhost:8000

## 규칙: 앱 파일을 바꾸면 sw.js의 VERSION을 올린다

- 서비스 워커가 캐시를 먼저 쓰므로, VERSION을 안 올리면 브라우저는 옛 파일을 계속 보여 준다.
- 앱 파일 = `sw.js`의 `ASSETS`에 있는 모든 파일. **`data/cards.json`도 포함**(카드만 추가해도 올린다).
- 올리는 방법: `const VERSION = 'v1'` → `'v2'`처럼 숫자를 1 올린다. 한 커밋에 한 번이면 충분.
- 새 앱 파일을 추가하면 `ASSETS`에도 넣는다. 안 넣으면 인터넷 없이 열 때 깨진다.
- `python tests/run_tests.py`가 둘 다 검사한다(마지막 커밋 이후 앱 파일이 바뀌었는데 VERSION이 같으면 실패).

## 테스트

- `python tests/run_tests.py` : 정적 검사 + 헤드리스 Chrome으로 `tests/test.html` 실행(로직, sql.js, 실제 화면 iframe 테스트)
- `python tests/run_tests.py --shots` : 위에 더해 `screenshots/`에 노트북(1440)·폰(390) 스크린샷. 폴더는 git에 안 올림
- Node 없이 Python + Chrome(또는 Edge)만 필요. 경로가 다르면 `CHROME` 환경 변수
- 앱을 `?ns=이름`으로 열면 localStorage 키가 분리되고 서비스 워커를 등록하지 않는다(테스트·스크린샷용)
- 커밋 전에 테스트를 돌린다

## 주의

- 화면 문구는 한국어 존댓말(~해요). 카드 본문은 교재처럼 평서체(~다).
- 카드 내용: 교재·기출 문장을 옮기지 말고 직접 쓴 문장과 문제만. 오라클과 SQLite가 다른 점은 카드의 `oracle` 항목에 적는다.
  카드에 적은 SQLite 동작·건수는 `tests/tests.js`의 sql.js 검사에 함께 넣는다.
- 과목·단원은 SQLD 공식 출제 범위(dataq.or.kr) 그대로 둔다. 단원 이름을 바꿀 땐 `topics`에 공식 세부항목 이름을 남긴다.
- SQL 연습은 SQLite라서 오라클 문법(`(+)` 조인, `ROWNUM`, `DECODE`, `NVL` 등)이 안 될 수 있다. 화면 안내 문구를 지우지 않는다.
- 배포는 아직 하지 않는다(사용자 요청 전까지).
