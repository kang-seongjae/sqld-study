// SQL 연습창의 예제 테이블. '초기화'를 누르면 이 상태로 돌아간다.
// NULL·관리자 관계·사원 없는 부서를 일부러 넣어 두었다(외부 조인, 셀프 조인, NULL 연습용).
export const SEED_SQL = `
CREATE TABLE 부서 (
  부서번호 INTEGER PRIMARY KEY,
  부서명   TEXT NOT NULL,
  지역     TEXT
);

CREATE TABLE 사원 (
  사원번호   INTEGER PRIMARY KEY,
  이름       TEXT NOT NULL,
  직급       TEXT,
  관리자번호 INTEGER REFERENCES 사원(사원번호),
  입사일     TEXT,
  급여       INTEGER,
  커미션     INTEGER,
  부서번호   INTEGER REFERENCES 부서(부서번호)
);

INSERT INTO 부서 VALUES
  (10, '경영지원', '서울'),
  (20, '개발',     '판교'),
  (30, '영업',     '부산'),
  (40, '연구',     '대전');

INSERT INTO 사원 VALUES
  (1001, '김대표', '대표',  NULL, '2015-03-02', 9000, NULL, 10),
  (1002, '이부장', '부장',  1001, '2016-07-11', 6500, NULL, 20),
  (1003, '박부장', '부장',  1001, '2017-01-09', 6200, 500,  30),
  (1004, '최과장', '과장',  1002, '2018-04-23', 5000, NULL, 20),
  (1005, '정과장', '과장',  1003, '2019-02-18', 4800, 300,  30),
  (1006, '강대리', '대리',  1004, '2020-09-01', 4000, NULL, 20),
  (1007, '조대리', '대리',  1005, '2021-05-17', 3900, 200,  30),
  (1008, '윤사원', '사원',  1004, '2022-11-07', 3300, NULL, 20),
  (1009, '장사원', '사원',  1005, '2023-03-06', 3200, 0,    30),
  (1010, '한사원', '사원',  1001, '2024-01-02', 3100, NULL, 10),
  (1011, '오인턴', '인턴',  1002, '2025-07-01', 2400, NULL, NULL);

-- 비등가 조인(급여가 어느 범위에 드는지) 연습용
CREATE TABLE 급여등급 (
  등급     INTEGER PRIMARY KEY,
  최저급여 INTEGER NOT NULL,
  최고급여 INTEGER NOT NULL
);

INSERT INTO 급여등급 VALUES
  (1,    0,  2999),
  (2, 3000,  3999),
  (3, 4000,  4999),
  (4, 5000,  6999),
  (5, 7000, 99999);
`;

// 연습창·카드 결과·테스트가 모두 이 함수로 예제 DB를 만든다.
// SQLite의 X REGEXP Y 연산자는 regexp(Y, X) 함수를 부르는데 기본으로는 비어 있어서,
// 자바스크립트 정규 표현식으로 채워 둔다(정규 표현식 단원 연습용).
export function createSampleDb(SQL) {
  const db = new SQL.Database();
  db.create_function('regexp', (pattern, value) => {
    if (pattern == null || value == null) return null;
    return new RegExp(String(pattern)).test(String(value)) ? 1 : 0;
  });
  db.exec(SEED_SQL);
  return db;
}

// 화면의 '예제 테이블 구조' 안내용
export const TABLE_INFO = [
  { name: '사원', columns: ['사원번호', '이름', '직급', '관리자번호', '입사일', '급여', '커미션', '부서번호'] },
  { name: '부서', columns: ['부서번호', '부서명', '지역'] },
  { name: '급여등급', columns: ['등급', '최저급여', '최고급여'] },
];
