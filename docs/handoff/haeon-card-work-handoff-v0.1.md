# 해온카드 작업 인수인계 문서

작성일: 2026-09-15
목적: 새 작업 스레드에서 현재 구현·검증 상태를 빠르게 파악하고 이어서 작업하기 위한 문서

## 1. 프로젝트 기본 정보

- 프로젝트 경로(Windows): C:\study\docker\bookwave-haeon-lab
- 프로젝트 경로(WSL): `/mnt/c/study/docker/bookwave-haeon-lab`
- Git 브랜치: `feat/haeon-lab-baseline`
- 원격 저장소: `https://github.com/chaeeun-dragon/pen_testing`
- 사전 준비 커밋: `6acc978 feat: harden payment flow and prepare incident simulation`
- 시뮬레이션 구현 커밋: `56cda20 feat: add isolated payment server incident simulation`
- 최신 원격 커밋: `88f910f feat: automate card03 detection and demo rehearsal` (원격 push 재확인 대기)
- 개발 환경: WSL Ubuntu 24.04, Docker Compose, Java 21, Spring Boot 3.4.5, MySQL 8.0
- 데이터: 실제 카드·회원·금융망이 아닌 합성 데이터만 사용

현재 시나리오 구성은 북웨이브가 메인 서비스이고 해온카드가 부 시나리오다.
해온카드의 핵심 시나리오는 CARD-03 동시 승인·한도 이중 사용이며, PG 신뢰 경계를
통해 북웨이브와 연결할 수 있다.

프로젝트의 상위 서사는 실제 카드사 침해사고에서 공개된 결제 서버 침입·정보보호
문제의식을 참고한 **합성·격리 재현**이다. CARD-03은 그 사건의 직접 원인이라고
주장하지 않고, 침입 징후 탐지와 분리된 카드 승인 코어 정합성 방어 증거로 유지한다.
상세 범위와 금지 표현은
`docs/scenarios/lottecard-inspired-payment-server-simulation-v0.1.md`를 따른다.

## 2. 현재 아키텍처

```text
브라우저
  ↓ 127.0.0.1:8080
bookwave-app (북웨이브 결제 진입)
  ↓ Docker DNS
mock-pg (PG 어댑터·멱등 처리)
  ↓ Docker DNS / 합성 가맹점 토큰
haeon-card (카드 승인 핵심)
  ↓ JDBC
haeon-card-mysql
```

주요 컨테이너:

- `bookwave-app`: `127.0.0.1:8080->8080`, healthy
- `mock-pg`: `127.0.0.1:8083->8083`, healthy
- `haeon-card`: `127.0.0.1:8084->8084`, healthy
- `haeon-card-mysql`: 내부 전용, healthy
- `bookwave-chatbot`, `bookwave-cover-upload`: 현재 임시 컨테이너

Bookwave의 전용 침입 징후 시뮬레이션 경로는 일반 결제와 별도다.
`POST /internal/v1/lab/incident-simulations/payment-server`는 기본 비활성화 상태이며,
활성화·랩 제어 토큰·합성 실행 ID를 모두 요구한다. 이 경로는 Mock PG·해온카드 API와
해온카드 DB를 호출하지 않고 고정 이벤트만 기록한다.

주요 네트워크:

- `bookwave_front_net`: 브라우저·북웨이브 프론트 구간
- `bookwave_dmz_net`: 북웨이브와 Mock PG 구간
- `haeon_card_net`: Mock PG와 해온카드 승인 구간
- `lab_audit_net`: 증거 수집 구간
- 카드 DB 네트워크는 `internal: true`로 구성

해온카드의 localhost 포트를 사용할 때는 반드시 두 Compose 파일을 함께 사용한다.

```bash
docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card
```

기본 `compose.yaml`만으로 해온카드를 재생성하면 8084 호스트 포트 매핑이 빠질 수
있다. 컨테이너 간 호출은 `http://haeon-card:8084`를 사용하므로 포트 매핑과
내부 통신은 별개다.

## 3. 완료된 구현

### 3.1 해온카드 백엔드

- Spring Boot 승인 API 구현
- 승인·거절 판정
- 카드 상태·가맹점 검증
- 멱등키 중복 요청 처리
- After 경로의 `SELECT ... FOR UPDATE` 행 잠금
- Before 경로의 동시성 취약 상태 재현용 barrier
- `used_amount`, `version` 갱신
- 승인 요청·거래·감사 이벤트 저장
- `correlationId` MDC 로그 출력
- 합성 Bearer 가맹점 토큰 검증

### 3.2 북웨이브·Mock PG 연결

- 북웨이브 `POST /api/v1/payments`
- Mock PG의 카드 승인 전달
- 북웨이브 → Mock PG → 해온카드의 결제 결과 반환
- 동일 `Idempotency-Key` 재요청 시 기존 결과 반환
- 동일 `Idempotency-Key` 동시 2건은 상위 서비스에서도 하나의 진행 결과를 공유
- 승인·재조회·거절 화면 구현

### 3.3 프론트엔드

- 카드사 사이트 형태의 UX/UI 구현
- 비로그인 상태에서는 로그인 영역이 표시되도록 반영
- 결제 승인 결과 모달
- 승인·재조회·거절 결과 표시
- 합성 카드 토큰 사용

로그인 화면은 현재 UI만 있고 로그인 API·회원 DB·세션 처리는 아직 구현하지 않았다.

### 3.4 금액 프로파일

`tools/card03-concurrency.sh`에 시나리오 금액 프로파일을 추가했다.

| 변수 | 의미 | 기본값 |
|---|---|---:|
| `LAB_PROFILE` | 서버 Before/After/normal 동작 | `normal` |
| `CARD03_SCENARIO_PROFILE` | 실험 금액 프로파일 | `lab` |
| `CARD03_REQUEST_AMOUNT` | 요청 금액 직접 덮어쓰기 | 프로파일별 기본값 |

프로파일:

- `lab`: 한도 100,000원, 요청 80,000원 × 2
- `demo`: 한도 10,000,000원, 요청 6,000,000원 × 2

`004_card03_demo_reset.sql`은 demo 한도와 사용액을 초기화한다.
`003_card03_reset.sql`은 lab 한도 100,000원과 사용액 0원을 복원한다.

기존 DB 볼륨의 금액 CHECK 제약은 다음 migration으로 한 번 확장했다.

```text
db/haeon-card/fixtures/005_card03_demo_amount_range.sql
```

새로 생성되는 DB는 수정된 `001_haeon_card_schema.sql`을 사용한다.

### 3.5 결제 서버 침입 징후 합성 시뮬레이션

- 전용 비결제 경로와 `INCIDENT_SIMULATION_ENABLED=false` 기본 차단 구현
- 랩 제어 토큰과 `INCIDENT-SIM-` 실행 ID 검증
- 고정 `RECORDED → OBSERVED → OBSERVED → ALERT → BLOCKED → PASS → PASS` 이벤트만 생성
- 실행 ID는 증거·로그 식별자일 뿐 승인 판단이나 권한으로 사용하지 않음
- `tools/payment-server-incident-detection-check.sh`가 같은 `runId`·`correlationId` 범위에서
  S1 관측 → S2 접근 시도 → S3 ALERT → S4 차단·추가 검증 PASS 순서와 미호출을 대사
- 최종 검증 실행: `INCIDENT-SIM-20260916T020000Z`; 이후 정상 흐름 회귀:
  `POST-S1S4-FLOW-20260916T022000Z`

## 4. 탐지 자동화

실행 파일:

```text
tools/card03-detection-check.sh
tools/payment-server-incident-detection-check.sh
```

이 스크립트는 공격을 실행하지 않고, 저장된 서비스 로그와 현재 합성 DB를 검사한다.

검사 항목:

- 카드 한도 초과 승인 합계
- 같은 카드와 `read_limit_version`을 사용한 중복 승인
- 승인 요청과 거래 연결
- 승인 금액과 거래 금액 일치
- `AUTH_COMMITTED` 감사 이벤트 존재
- `used_amount`와 승인 거래 합계 일치
- 서비스별 `correlationId` 연결

### 직접 CARD-03 호출

`card03-concurrency.sh`는 해온카드 내부 승인 API를 직접 호출한다.

```bash
SERVICES_LOG=evidence/runs/<실행ID>/services.log \
CORRELATION_IDS=<승인ID>,<거절ID> \
BASELINE_USED_AMOUNT=0 \
EXPECTED_SERVICES=haeon-card \
bash tools/card03-detection-check.sh
```

### 전체 결제 흐름

북웨이브 → Mock PG → 해온카드 전체 흐름에서는 `EXPECTED_SERVICES`를 생략한다.
기본값이 세 서비스 전체이기 때문이다.

판정 의미:

- `PASS`: 규칙 위반과 로그·DB 연결 오류 없음
- `ALERT`: 한도 초과나 동일 스냅샷 중복 승인 등 탐지 대상 발견
- `FAIL`: 로그·DB·감사 연결이 깨졌거나 필수 서비스 로그가 없음

Before에서는 `ALERT`가 정상적인 기대 결과이고, After에서는 `PASS`가 기대 결과다.

## 5. 실제 검증 결과

### 5.1 고액 demo Before

증거 폴더:

```text
evidence/runs/CARD03-DEMO-BEFORE-20260915T050500Z/
```

확인 결과:

- 6,000,000원 요청 두 건 모두 승인
- 최종 사용액 12,000,000원
- 한도 10,000,000원 초과
- 같은 한도 스냅샷 중복 승인 탐지
- 탐지 결과: `ALERT`, `alerts=2`, `failures=0`

결과 파일:

```text
evidence/runs/CARD03-DEMO-BEFORE-20260915T050500Z/detection/result.json
```

### 5.2 고액 demo After

증거 폴더:

```text
evidence/runs/CARD03-DEMO-SMOKE-20260915T/
```

확인 결과:

- 6,000,000원 1건 승인
- 6,000,000원 1건 `LIMIT_EXCEEDED` 거절
- 최종 사용액 6,000,000원
- 최종 버전 1
- 승인 거래 1건
- 탐지 결과: `PASS`

결과 파일:

```text
evidence/runs/CARD03-DEMO-SMOKE-20260915T/detection/result.json
```

이 실행은 해온카드 내부 API 직접 호출이므로 탐지 점검 시
`EXPECTED_SERVICES=haeon-card`를 사용했다.

### 5.3 북웨이브 전체 결제 흐름

증거 폴더:

```text
evidence/runs/OBS-FLOW-20260915T110000Z/
```

확인 결과:

- 1,000원 승인
- 같은 요청 재조회 응답이 최초 응답과 동일
- 100,000원 요청은 `LIMIT_EXCEEDED` 거절
- 북웨이브·Mock PG·해온카드 로그에서 `correlationId` 확인
- 기준선 DB: 사용액 0원, 버전 0, 승인·거래·감사 건수 0
- 실행 후 DB: 사용액 1,000원, 버전 1, 승인 1건, 거절 1건

### 5.4 기존 CARD-03 Before/After

기존 소액 공격 재현 증거도 보존되어 있다.

```text
evidence/runs/CARD03-BEFORE-20260915T005643Z/
evidence/runs/CARD03-AFTER-20260915T005920Z/
```

## 6. 주요 문서·스크립트 목록

### 시나리오·탐지

- `docs/scenarios/card03-before-after-evidence-v0.1.md`
- `docs/scenarios/card03-detection-attck-mapping-v0.1.md`
- `docs/scenarios/card03-demo-profile-v0.1.md`
- `docs/scenarios/card03-demo-rehearsal-checklist-v0.1.md`

### DB fixture

- `db/haeon-card/fixtures/002_card03_baseline.sql`
- `db/haeon-card/fixtures/003_card03_reset.sql`
- `db/haeon-card/fixtures/004_card03_demo_reset.sql`
- `db/haeon-card/fixtures/005_card03_demo_amount_range.sql`
- `db/haeon-card/init/001_haeon_card_schema.sql`

### 실행 도구

- `tools/haeon-card-smoke.sh`: 해온카드 기본 승인·멱등 테스트
- `tools/payment-flow-contract-check.sh`: 북웨이브 전체 결제·재조회 테스트
- `tools/card03-concurrency.sh`: CARD-03 동시 요청
- `tools/card03-detection-check.sh`: 탐지 규칙 자동 점검
- `tools/card-api-contract-check.sh`: 카드 API 계약 확인

## 7. 새 스레드에서 바로 실행할 명령

### 7.1 환경 확인

```bash
cd /mnt/c/study/docker/bookwave-haeon-lab
docker compose ps bookwave-app mock-pg haeon-card haeon-card-mysql
```

### 7.2 기존 볼륨의 demo 금액 범위 적용(최초 1회)

기존 `haeon-card-mysql` 볼륨을 사용하는 경우에만 실행한다. 새로 만든 DB는 수정된
schema를 사용하므로 생략할 수 있다.

```bash
docker compose --env-file .env exec -T haeon-card-mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  < db/haeon-card/fixtures/005_card03_demo_amount_range.sql
```

### 7.3 기본 기준선 복원

```bash
docker compose --env-file .env exec -T haeon-card-mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  < db/haeon-card/fixtures/003_card03_reset.sql
```

### 7.4 demo Before

```bash
docker compose --env-file .env exec -T haeon-card-mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  < db/haeon-card/fixtures/004_card03_demo_reset.sql

LAB_PROFILE=before BEFORE_BARRIER_ENABLED=true \
  docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card

LAB_PROFILE=before BEFORE_BARRIER_ENABLED=true \
CARD03_SCENARIO_PROFILE=demo \
bash tools/card03-concurrency.sh
```

### 7.5 demo After

```bash
docker compose --env-file .env exec -T haeon-card-mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  < db/haeon-card/fixtures/004_card03_demo_reset.sql

LAB_PROFILE=after BEFORE_BARRIER_ENABLED=false \
  docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card

LAB_PROFILE=after BEFORE_BARRIER_ENABLED=false \
CARD03_SCENARIO_PROFILE=demo \
bash tools/card03-concurrency.sh
```

### 7.6 탐지 점검과 normal 복원

```bash
SERVICES_LOG=evidence/runs/<실행ID>/services.log \
CORRELATION_IDS=<A-ID>,<B-ID> \
BASELINE_USED_AMOUNT=0 \
EXPECTED_SERVICES=haeon-card \
bash tools/card03-detection-check.sh

docker compose --env-file .env exec -T haeon-card-mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  < db/haeon-card/fixtures/003_card03_reset.sql

LAB_PROFILE=normal BEFORE_BARRIER_ENABLED=false \
  docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card
```

## 8. 현재 Git 상태 주의사항

현재 작업 트리에 다음 사용자 작업이 남아 있을 수 있다.

- 추적되지 않음: `중간발표_프로젝트이해_퀘스트.html`

이 파일은 인수인계 시 임의로 되돌리거나 커밋하지 않는다. 커밋할 때는 반드시
`git add -- <명시적 파일 목록>`을 사용한다. `evidence/runs/`는 `.gitignore` 대상이다.

## 9. 남은 작업

우선순위 순서:

1. [ ] 체크리스트 기준으로 시연 리허설 1회 완료
2. [ ] 영상 촬영용 demo 금액·화면·터미널 표시 범위 확정
3. [ ] Before `ALERT`와 After `PASS` 증거를 최종 폴더로 정리
4. [ ] 전체 결제 흐름에서 세 서비스 `correlationId` 연결 재확인
5. [ ] 네트워크 격리와 8084 포트 매핑 최종 점검
6. [ ] 팀장 API를 받으면 API 계약서 필드와 endpoint를 비교해 교체
7. [ ] 로그인 DB/API와 북웨이브 영속 DB 필요 여부 결정
8. [ ] 챗봇·표지 업로드 임시 컨테이너를 실제 서비스로 교체할지 결정
9. [ ] 공격 단계별 탐지 결과와 MITRE ATT&CK 매핑 최종 확정
10. [ ] 최종 시나리오 보고서·증거 목록·발표용 영상 정리
11. [x] 실제 웹쉘이 아닌 결제 서버 침입 징후의 고정 합성 시뮬레이션(S1~S4)을
    구현하고 ALERT·차단·PASS 증거를 추가

## 10. MITRE ATT&CK 현재 판단

현재 CARD-03에서 직접 확인한 것은 합성 결제 요청의 동시성으로 인한 한도 무결성
문제다.

- `T1565.003 Runtime Data Manipulation`: 가장 가까운 조건부 매핑. SQL 직접 변조로
  단정하지 않는다.
- `T1657 Financial Theft`: 실제 공격자의 금전 이익까지 구현·증명할 때만 적용
- `T1078 Valid Accounts`: 합성 토큰만 사용했으므로 현재 미매핑
- `T1190 Exploit Public-Facing Application`: 외부 공개 서비스 침투를 재현하지 않아
  현재 미매핑

새로운 초기 침투나 실제 자격 증명 탈취를 구현하지 않는다면 현재 매핑을 억지로
확장하지 않는다.

## 11. 작업 원칙

- 실제 카드번호·CVC·개인정보·실제 PG 자격증명을 사용하지 않는다.
- 시연 전에는 반드시 기준선 DB를 복원하고 실행 ID를 기록한다.
- Before 결과를 숨기거나 편집으로 대체하지 않고, After와 나란히 제시한다.
- `correlationId`, 승인·거절 결과, `used_amount`, `version`을 함께 증명한다.
- 팀장 API가 오면 기존 합성 API를 즉시 삭제하지 말고 계약·필드·오류 코드를 먼저
  비교한 뒤 adapter 또는 endpoint 설정으로 교체한다.
