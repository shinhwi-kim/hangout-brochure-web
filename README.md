# hangoutBrochure-web

행사(hangout) 일정을 카카오맵 위에 색상별로 찍어주는 원페이지 웹.

## 실행

```bash
# 1) 백엔드를 localhost:8080 에 먼저 띄운다
# 2) 프론트 개발 서버 (의존성 없음, Node 18+)
node server.js          # http://localhost:5173
```

`server.js` 는 정적 파일을 서빙하면서 `/api/*` 요청을 `http://localhost:8080` 으로 프록시한다.
덕분에 백엔드에 CORS 설정을 추가할 필요가 없다. 백엔드 주소가 다르면:

```bash
PORT=3000 BACKEND=http://localhost:9090 node server.js
```

서버 설정은 `.env` 에 두고, 카카오 키는 Git에 올라가지 않는 `.env.local` 에 둔다.
두 파일을 자동으로 읽으며, 같은 항목은 `.env.local` 값이 우선한다. 셸 환경변수는 두 파일보다 우선한다.
`.env.local` 파일을 만들고 카카오 키를 설정한다:

```env
KAKAO_JS_KEY=발급받은_JavaScript_키
```

키 대신 셸 환경변수로 지정해도 된다:

```bash
KAKAO_JS_KEY=발급받은_JavaScript_키 node server.js
```

## 카카오맵 키

[Kakao Developers](https://developers.kakao.com/console/app) 에서 앱을 만들고 **세 가지를 모두** 해야 한다.
하나라도 빠지면 `dapi.kakao.com` 이 401/403 을 돌려주고 지도가 안 뜬다.

1. **앱 설정 > 앱 > 플랫폼 키** 에서 **JavaScript 키**를 `.env.local` 의 `KAKAO_JS_KEY` 에 넣는다.
   `.env.local` 은 Git에 올라가지 않는다. 키를 설정하지 않으면 첫 실행 시 입력창이 뜨고 브라우저 localStorage 에 저장된다.
2. 같은 화면의 **JavaScript SDK 도메인** 에 `http://localhost:5173` 등록
   (스킴·포트까지 정확히 일치해야 한다. `127.0.0.1` 과 `localhost` 는 다른 도메인으로 취급된다)
3. **제품 설정 > 카카오맵 > 사용 설정 > 상태를 [ON]**
   ← 가장 빠뜨리기 쉬운 단계. 1·2 를 다 해도 이게 OFF 면 403 `disabled OPEN_MAP_AND_LOCAL service` 가 난다

### 키/도메인 문제 진단

지도가 안 뜨면 화면에 원인·사용한 키·등록해야 할 도메인이 표시된다. 더 확실하게 보려면 터미널에서:

```bash
curl -s -H "Referer: http://localhost:5173/" \
  "https://dapi.kakao.com/v2/maps/sdk.js?appkey=<JS키>&autoload=false" | head -c 200
```

| 응답 | 원인 |
| --- | --- |
| `does not exist` | 키가 틀림 |
| `disabled OPEN_MAP_AND_LOCAL service` | 위 3번 (카카오맵 사용 설정 OFF) |
| origin/도메인 관련 메시지 | 위 2번 (도메인 미등록·불일치) |
| 자바스크립트 코드 | 정상 |

## 마커 색상 규칙

| 색상 | 상태 | 조건 |
| --- | --- | --- |
| 🔴 빨강 | 곧 종료 | 진행중이면서 **내일 자정까지** 끝나는 행사 |
| 🔵 파랑 | 진행중 | 시작했고 모레 이후에 끝나는 행사 |
| 🟡 노랑 | 곧 시작 | 아직 시작하지 않은 행사 |
| ⚪️ 회색 | 종료됨 | 이미 끝난 행사 (기본 숨김, 범례에서 켤 수 있음) |

범례(좌측 하단)의 각 항목은 클릭하면 해당 상태를 지도/리스트에서 켜고 끌 수 있다.

## 기능

- **기간 필터**: 행사 시작 / 끝 날짜 → `GET /api/hangouts?from=&to=` (cursor 페이지네이션 자동 순회)
- **카테고리 필터**: 체크박스 다중 선택 → `categories` 파라미터 반복 전달
- **오른쪽 리스트**: 지도에 표시 중인 행사의 상태 뱃지 · D-day · 기간 · 장소 · 카테고리
  - `지도 영역만` 체크 시 현재 지도 뷰포트 안의 행사만 리스트에 표시 (지도를 움직이면 자동 갱신)
  - 카드 클릭 → 지도 이동 + 말풍선, 마커 클릭 → 리스트 카드 하이라이트
- 리스트 정렬: 곧 종료 → 진행중 → 곧 시작 → 종료됨, 그 안에서는 임박한 순

## 파일

| 파일 | 역할 |
| --- | --- |
| `index.html` | 단일 페이지 마크업 |
| `styles.css` | 레이아웃 / 마커 핀 / 카드 스타일 |
| `app.js` | API 호출, 상태 판정, 마커·리스트 렌더링 |
| `config.js` | 브라우저 앱 설정 기본값 |
| `server.js` | 정적 서버 + `/api` 프록시 |

## 알려진 백엔드 이슈

`GET /api/hangout-categories` 를 `keyword` 없이 호출하면 500 이 떨어진다
(`:keyword IS NULL` 파라미터 타입 추론 실패 — `HangoutCategoryJpaRepository`).
웹은 이 호출이 실패하면 조회된 행사들의 `categories` 코드로 카테고리 목록을 역산해서 계속 동작한다.
