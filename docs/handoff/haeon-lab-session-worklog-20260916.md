# 해온카드 랩 검증·수정·합성데이터 작업 내역

- 작성일: 2026-09-16
- 대상 브랜치: `feat/haeon-lab-baseline`
- 관련 커밋: `d4ed366`(검증 후 수정), `ec83aee`(상세 합성 데이터)
- 실행 환경: `docker compose` (bookwave-app 8080 / mock-pg 8083 / haeon-card 8084 debug)
- 성격: 팀 프로젝트용 모의사이트. 실제 카드번호·CVC·금융망·개인정보를 사용하지 않는 합성 실습.

---

## 0. 개요

본격 테스트 전 "시연처럼" 전체 흐름을 검증하고, 발견한 문제를 수정한 뒤,
CARD-03 동시성 공격 재현(Before/After)을 실측하고, 마지막으로 모의사이트에
합성 회원·카드·거래·포인트·FAQ 데이터를 구현했다. DB는 매 검증 후 실습
기준선(한도 100,000 / 사용 0 / 버전 0)으로 복원했다.

---

## 1. 사전 시연 검증 결과

### 1.1 정상 동작 (시연 가능)

| 항목 | 결과 |
|---|---|
| 사이트 로딩 | `HTTP 200`, 해온카드 랜딩 정상 |
| 정상 결제 승인 | `POST /api/v1/payments` → `APPROVED`, paymentId·pgTid·authorizationNo 발급 |
| 멱등성 재조회 | 동일 Idempotency-Key → 동일 paymentId/pgTid/authNo (중복승인 없음) |
| 한도초과 거절 | 한도 초과 요청 → `DECLINED`/`LIMIT_EXCEEDED`, 승인액 0, 거래 미생성 |
| 입력 검증 | 필수값 누락 → `400 INVALID_REQUEST` |
| 침입 시뮬레이션 차단 | 기본 비활성 → `403 INCIDENT_SIMULATION_DISABLED` |
| 헬스체크 | bookwave·mock-pg `/actuator/health` 200 |
| 신뢰경계 설계 | haeon-card가 merchantNo를 요청 body가 아닌 `Authorization: Bearer` 토큰에서 도출(`resolveMerchantNo`) |

### 1.2 발견 이슈

| ID | 심각도 | 내용 |
|---|---|---|
| A | 중 | 상한 초과 금액(>10,000,000)이 bookwave-app에서 선검증되지 않아 haeon-card `@Max(10000000)` 위반이 mock-pg를 거쳐 `502 UPSTREAM_ERROR(retryable:true)`로 되돌아옴. 영구 오류인데 "재시도 가능"으로 오표기. |
| B | 하 | `index.html`·`haeon.css` 워킹트리 변경이 실제 내용이 아닌 CRLF↔LF 줄바꿈 차이(Windows 에디터 저장). 노이즈 diff 발생. |
| C | 환경 | `compose.debug.yaml` 활성으로 haeon-card가 `127.0.0.1:8084`로 노출. "오직 mock-pg만 haeon-card 호출" 격리 스토리와 상충(포트 점검상 허용 범위이나 시연 시 정리 권장). |
| D | 경미 | `haeon.js`에서 `headerLogin` 클릭 리스너가 62행·116행에 중복 등록. |
| E | 참고 | 검증용 정상결제로 DB used_amount가 변동 → 기준선 복원 완료. |

---

## 2. 코드 수정 (커밋 `d4ed366`)

### A. 결제 금액 상한 검증
- `services/bookwave-app/.../api/PaymentRequest.java`: `amount`에 `@Max(10000000)` 추가(haeon-card와 동일 상한).
- 검증: 99,999,999 → `400 INVALID_REQUEST(retryable:false)` / 경계값 10,000,000 → 승인 로직 도달 / 정상결제 APPROVED 회귀 없음.

### B. 줄바꿈 정규화
- `.gitattributes` 신규(`* text=auto eol=lf` + 셸/SQL LF + 바이너리 제외).
- `index.html`·`haeon.css`를 LF 버전으로 되돌려 노이즈 diff 제거.

### C. haeon-card 내부 격리 복원
- 기본 `compose.yaml`로 haeon-card 재생성 → 호스트 포트 매핑 제거.
- 검증: `localhost:8084` 외부 접근 차단(HTTP 000), 내부 결제 흐름(8080→mock-pg→haeon-card) 유지.
- 주: CARD-03 재현 시에는 `card03-concurrency.sh`가 호스트에서 8084를 직접 호출하므로 debug 프로파일을 다시 사용한다.

### D. 로그인 리스너 중복 정리
- `services/bookwave-app/.../static/haeon.js`: `headerLogin` 중복 리스너 제거, 아이디 탭 리셋을 로그아웃 상태 분기로 통합(단일 리스너).

---

## 3. CARD-03 Before/After 동시성 공격 재현 검증

- 프로파일: `demo` (한도 10,000,000 / 6,000,000원 × 2 동시 요청)
- 도구: `tools/card03-concurrency.sh`, `tools/card03-detection-check.sh`

### 3.1 Before — 취약(초과 승인 재현)
- 설정: `LAB_PROFILE=before`, `BEFORE_BARRIER_ENABLED=true`
- 실행: `HC03-BEFORE-20260916T065211Z`

| 증거 | 결과 |
|---|---|
| 응답 A / B | 둘 다 `APPROVED` 6,000,000 |
| `card_limits` | used **12,000,000 > 한도 10,000,000**, version=2 |
| `authorization_requests` | 두 건 모두 `read_used_amount=0`, `read_limit_version=0` (동일 pre-state 읽은 경합) |
| 거래/감사 | tx 2건·합계 12,000,000 / 감사 APPROVED 2 |
| 탐지 | **`ALERT`** (alerts=2: 한도초과 + 동일 스냅샷 중복승인, failures=0) |

### 3.2 After — 통제(차단)
- 설정: `LAB_PROFILE=after`, `BEFORE_BARRIER_ENABLED=false`
- 실행: `HC03-AFTER-20260916T065330Z`

| 증거 | 결과 |
|---|---|
| 응답 A / B | A `APPROVED` 6,000,000 / B `DECLINED` `LIMIT_EXCEEDED` |
| `card_limits` | used **6,000,000 ≤ 한도**, version=1 |
| `authorization_requests` | A: read_used=0/v0 → B: read_used=6,000,000/v1 (A 커밋 후 최신값 재판정으로 거절) |
| 거래/감사 | tx 1건·합계 6,000,000 / 감사 APPROVED 1·DECLINED 1 |
| 탐지 | **`PASS`** (alerts=0, failures=0, 9개 검사 전부 PASS) |

### 3.3 판정 — 최종 합격 기준 4/4 충족
1. Before에서 한도 이중 사용 재현
2. After에서 한도 초과 승인 차단
3. 로그·DB로 차이 설명 가능(`read_limit_version` 스냅샷 차이)
4. 탐지: Before `ALERT` / After `PASS`

증거 위치: `evidence/runs/HC03-BEFORE-*`, `evidence/runs/HC03-AFTER-*`, `evidence/runs/DETECT-*`

---

## 4. 합성 데이터 구현 (커밋 `ec83aee`, 프론트 전용)

구현 계층: 프론트 전용(백엔드/DB 변경 없음). 데이터는 `haeon.js`의 `SYNTHETIC`
객체에 집약, 렌더는 기존 `infoDialog`와 디자인 토큰 재사용. 자격증명·실데이터
미사용의 모의사이트 성격 유지.

| 항목 | 내용 |
|---|---|
| 로그인 이후 화면 | 합성 데모 로그인(입력값 미전송), `localStorage` 세션 유지·복원, 로그아웃 시 제거 |
| 회원·카드 요약 | MY 패널에 이번달 이용금액·결제예정·이용가능한도·주카드 표시. "카드관리"에서 보유 카드 3장(브랜드·유형·결제일·혜택·사용률) |
| 거래 내역 | "이용내역 조회"에서 결제 16건(일자·시각·카테고리·카드·할부·금액·상태 pill·적립 P) + 승인 합계 통계 |
| 해온 포인트 | 보유 잔액(128,450P) + 적립·사용 내역 5건 |
| FAQ | 7문항 아코디언(`details/summary`), 데이터 합성·자격증명 미전송 안내 포함 |

변경 파일: `haeon.js`(+154), `haeon.css`(+47), `index.html`(자산 버전 `v=20260916-2`)

검증: `node --check` 문법 통과, 헤드리스 DOM(jsdom) 스모크 **24/24 PASS**
(로그인·요약값·거래 16건·통계·할부/포인트 배지·카드 메타·혜택·포인트 잔액/내역·FAQ 7개·로그아웃).

---

## 5. 커밋·원격 현황

| 커밋 | 내용 | 원격 반영 |
|---|---|---|
| `d4ed366` | A(상한검증)·B(.gitattributes/CRLF)·D(리스너 정리) | 반영됨 |
| `ec83aee` | 상세 합성 회원 데이터 | 반영됨 |

- `git ls-remote origin` 실측: `refs/heads/feat/haeon-lab-baseline = ec83aee` → 로컬=원격 동기화(ahead 0).
- 미추적 파일: `중간발표_프로젝트이해_퀘스트.html`(발표 자료, 커밋 대상 아님).

---

## 6. 남은 작업 / TODO

- [ ] (선택) PR 생성: `gh pr create --base main --head feat/haeon-lab-baseline`
- [ ] (선택) 로그인 후 화면 확장: 청구서(명세서), 프로필 편집 등
- [ ] (선택) 합성 데이터의 백엔드 API/Bookwave DB 영속화 — 모의해킹 공격면(인증우회·IDOR) 확장이 필요할 때
- [ ] 시연 촬영 전: `003_card03_reset.sql`로 기준선 복원 + `LAB_PROFILE=normal` 복원 + 8084 격리 확인

---

## 부록 A. 재현 명령 요약

```bash
# 데모 기준선 복원
docker exec -i bookwave-haeon-lab-haeon-card-mysql-1 \
  sh -c 'mysql -uroot -proot_lab_only haeon_card' \
  < db/haeon-card/fixtures/004_card03_demo_reset.sql

# Before 재현
LAB_PROFILE=before BEFORE_BARRIER_ENABLED=true \
  docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card
LAB_PROFILE=before BEFORE_BARRIER_ENABLED=true CARD03_SCENARIO_PROFILE=demo \
  RUN_ID=HC03-BEFORE-<ts> bash tools/card03-concurrency.sh

# 탐지 (services.log는 haeon-card 로그 캡처본)
SERVICES_LOG=<detection>/services.log \
CORRELATION_IDS=<RUN_ID>-A,<RUN_ID>-B \
BASELINE_USED_AMOUNT=0 EXPECTED_SERVICES=haeon-card \
  bash tools/card03-detection-check.sh

# After 재현: LAB_PROFILE=after BEFORE_BARRIER_ENABLED=false 로 동일 반복 → 탐지 PASS 기대

# 촬영 후 정리
docker exec -i bookwave-haeon-lab-haeon-card-mysql-1 \
  sh -c 'mysql -uroot -proot_lab_only haeon_card' \
  < db/haeon-card/fixtures/003_card03_reset.sql
LAB_PROFILE=normal BEFORE_BARRIER_ENABLED=false \
  docker compose --env-file .env up -d --force-recreate haeon-card
```

## 부록 B. 프론트 합성 데이터 스모크 검증

`jsdom`으로 헤드리스 DOM 검증(24건). 핵심 셀렉터: `.history-row`(16),
`.card-row`(3), `.point-row`(5), `.faq-item`(7), `#mySpent`/`#myAvailable`,
`localStorage['haeon.session']`.
