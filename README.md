# SQLD 공부

노트북 브라우저에서 쓰는 SQLD 공부 앱이에요. 서버 없이 돌고, 기록은 브라우저에만 저장돼요.

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

## 테스트

```
python tests/run_tests.py          # 테스트
python tests/run_tests.py --shots  # 테스트 + screenshots/ 에 스크린샷
```
