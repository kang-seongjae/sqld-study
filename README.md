> 공부하면서 만드는 중이라 내용에 틀린 부분이 있을 수 있어요.

# SQLD 공부

노트북 브라우저에서 쓰는 SQLD 공부 앱이에요. 서버 없이 돌고, 기록은 브라우저에만 저장돼요.

바로 쓰기: https://kang-seongjae.github.io/sqld-study/

화면은 코드 에디터처럼 생겼어요. 왼쪽 탐색기에서 단원을 고르고, 가운데에서 카드를 읽고, 오른쪽 SQL 연습창에서 직접 실행해 봐요.

- **개념 카드**: 과목 → 단원 → 카드. 예시 SQL은 버튼 한 번으로 오른쪽 연습창에 들어가요.
- **오늘의 퀴즈**: 하루 10문제를 섞어서 내요. 숫자 키 `1`~`4`로 답하고 `Enter`로 다음 문제.
- **오답노트**: 틀린 문제가 모이고, 다시 맞히면 빠져요.
- **SQL 연습**: 브라우저 안의 SQLite(sql.js)에 `사원`, `부서`, `급여등급` 예제 테이블. `Ctrl+Enter`로 실행해요. 오라클과 문법이 다를 수 있어요.
- **백업**: 위쪽 버튼으로 기록을 JSON 파일로 내보내고 불러와요.

## 열기

```
python serve.py
```

브라우저에서 http://localhost:8000 을 열어요. 한 번 열면 그 뒤로는 인터넷이 없어도 열려요.
(`index.html`을 더블클릭해서 `file://`로 열면 카드와 SQL 엔진을 읽지 못해요.)

## 카드 추가

`data/cards.json`을 고치고 `sw.js`의 `VERSION`을 올려요. 자세한 형식은 [data/README.md](data/README.md).

## 함께 쓴 것

- [sql.js](https://github.com/sql-js/sql.js) 1.10.3 (MIT 라이선스, `vendor/LICENSE-sql.js.txt`): 브라우저 안에서 도는 SQLite
- [D2Coding](https://github.com/naver/d2-coding-font) 1.3.2 (SIL Open Font License 1.1, `fonts/OFL.txt`): 고정폭 글꼴

## 테스트

```
python tests/run_tests.py          # 테스트
python tests/run_tests.py --shots  # 테스트 + screenshots/ 에 스크린샷
```
