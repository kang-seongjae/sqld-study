// SQL 문법 색칠: 문자열을 토큰으로 나누고, 토큰마다 class를 붙인 HTML을 만든다.
// 연습창과 카드의 예시 SQL이 함께 쓴다. 완벽한 파서가 아니라 '읽기 좋게 색칠'이 목적이다.

const KEYWORDS = new Set(`
  SELECT FROM WHERE AND OR NOT IN IS NULL AS ON JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL USING
  GROUP BY HAVING ORDER ASC DESC NULLS FIRST LAST LIMIT OFFSET FETCH NEXT ROWS ROW ONLY TIES WITH RECURSIVE
  UNION ALL INTERSECT EXCEPT MINUS DISTINCT UNIQUE BETWEEN LIKE ESCAPE EXISTS ANY SOME CASE WHEN THEN ELSE END
  INSERT INTO VALUES UPDATE SET DELETE MERGE MATCHED CONFLICT DO NOTHING EXCLUDED
  CREATE TABLE VIEW INDEX SEQUENCE ALTER ADD MODIFY DROP RENAME TO COLUMN TRUNCATE CONSTRAINT PRIMARY FOREIGN KEY
  REFERENCES CHECK DEFAULT CASCADE RESTRICT REPLACE TEMP TEMPORARY IF
  BEGIN TRANSACTION COMMIT ROLLBACK SAVEPOINT RELEASE WORK GRANT REVOKE ROLE USER PUBLIC OPTION ADMIN IDENTIFIED
  OVER PARTITION RANGE PRECEDING FOLLOWING UNBOUNDED CURRENT ROLLUP CUBE GROUPING SETS PIVOT UNPIVOT FOR INCLUDE EXCLUDE NULLS
  START CONNECT PRIOR LEVEL SIBLINGS NOCYCLE ROWNUM DUAL REGEXP GENERATED IDENTITY PRAGMA
  INTEGER INT NUMBER NUMERIC VARCHAR VARCHAR2 CHAR TEXT REAL DATE TIMESTAMP BLOB BOOLEAN
  TRUE FALSE
`.trim().split(/\s+/));

// 순서가 중요하다: 앞의 규칙이 먼저 맞춰진다.
const RULES = [
  ['comment', /--[^\n]*/y],
  ['comment', /\/\*[\s\S]*?(?:\*\/|$)/y],
  ['string', /'(?:[^']|'')*'?/y],
  ['ident', /"(?:[^"]|"")*"?/y],
  ['number', /\d+(?:\.\d+)?/y],
  ['word', /[A-Za-z_\u0080-￿][A-Za-z0-9_$#\u0080-￿]*/y],
  ['op', /<>|!=|<=|>=|\|\||[-+*/%=<>(),.;]/y],
  ['space', /\s+/y],
];

export function tokenizeSql(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let hit = null;
    for (const [type, re] of RULES) {
      re.lastIndex = i;
      const m = re.exec(text);
      if (m && m[0].length) { hit = [type, m[0]]; break; }
    }
    if (!hit) hit = ['plain', text[i]];
    let [type, value] = hit;
    if (type === 'word') {
      if (KEYWORDS.has(value.toUpperCase())) type = 'keyword';
      else if (/^\s*\(/.test(text.slice(i + value.length))) type = 'func';
      else type = 'plain';
    }
    const last = out[out.length - 1];
    if (last && last.type === type && (type === 'plain' || type === 'space')) last.text += value;
    else out.push({ type, text: value });
    i += value.length;
  }
  return out;
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function highlightSql(text) {
  return tokenizeSql(text).map(({ type, text: t }) => (type === 'plain' || type === 'space'
    ? escapeHtml(t)
    : `<span class="tok-${type}">${escapeHtml(t)}</span>`)).join('');
}
