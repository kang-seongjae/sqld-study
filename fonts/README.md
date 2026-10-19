# 글꼴

## D2Coding (고정폭, 한글 지원)

- 파일: `D2Coding-Ver1.3.2-20180524.ttf` (Regular, 원본 그대로, 수정·서브셋하지 않음)
- 출처: NAVER D2Coding 공식 저장소 릴리스 VER1.3.2 (2018-06-01)
  https://github.com/naver/d2-coding-font/releases/tag/VER1.3.2
  배포 압축 파일 `D2Coding-Ver1.3.2-20180524.zip` 안의 `D2Coding/D2Coding-Ver1.3.2-20180524.ttf`
- SHA-256: `8b1b23e5de4dff652fb0b938528150d2f531edfda281d3944618b655711aba84`
- 라이선스: SIL Open Font License 1.1 (전문: `OFL.txt`)
  - 글꼴 파일 안의 라이선스 항목(name ID 13)에도 "licensed under the SIL Open Font License, Version 1.1"이라고 적혀 있다.
  - OFL은 글꼴을 다른 소프트웨어와 함께 묶어 배포하는 것을 허용한다. 조건: 라이선스 전문을 함께 둘 것, 글꼴만 따로 팔지 말 것.
  - 'D2Coding'은 예약된 글꼴 이름(Reserved Font Name)이라, 글꼴을 고친 파일(서브셋·변환 포함)은 이 이름을 쓸 수 없다.
    그래서 원본 파일을 바꾸지 않고 그대로 둔다.
- 앱에서는 `style.css`의 `@font-face`로 코드·SQL에만 쓴다. `sw.js`가 캐시해서 인터넷이 없어도 나온다.

## 나눔고딕 · 개구 (design-note 디자인)

- 파일(원본 그대로, 수정·서브셋하지 않음)
  - `NanumGothic-Regular.ttf`, `NanumGothic-Bold.ttf`: 본문
  - `Gaegu-Bold.ttf`: 제목에만 쓰는 손글씨
- 출처: google/fonts 저장소 `ofl/nanumgothic`(원 제작 NHN Corporation), `ofl/gaegu`(The Gaegu Project Authors)
  https://github.com/google/fonts/tree/main/ofl/nanumgothic
  https://github.com/google/fonts/tree/main/ofl/gaegu
- SHA-256
  - `NanumGothic-Regular.ttf` `76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31`
  - `NanumGothic-Bold.ttf` `f96298f9fb18e364d2370f4c3ce948ac67a2b61af992d7234bc15c42b033c674`
  - `Gaegu-Bold.ttf` `cc38a4af9506a45254d1ce07c589ec473d9e5f0be319e5a77b17c214903f8c1c`
- 라이선스: 둘 다 SIL Open Font License 1.1 (전문: `OFL-Nanum.txt`, `OFL-Gaegu.txt`, google/fonts에 함께 있는 파일)
  - 개구는 파일 안 라이선스 항목(name ID 13)에 OFL 1.1이 적혀 있고 예약 글꼴 이름이 없다.
  - 나눔고딕은 그 항목에 저작권자만 적혀 있지만 google/fonts에서 OFL로 배포되고, 'Nanum' 등이 예약 글꼴 이름이라 원본을 고치지 않는다.
