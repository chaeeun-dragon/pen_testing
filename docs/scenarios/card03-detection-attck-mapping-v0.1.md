# CARD-03 공격 단계별 탐지 지점과 MITRE ATT&CK 매핑

작성일: 2026-09-15
대상: 북웨이브 결제 흐름과 해온카드 합성 승인 API
범위: 동일 카드에 승인 요청을 동시에 보내 한도를 두 번 쓰는 상황
데이터: 실제 카드번호·CVC·금융망을 사용하지 않고 합성 토큰만 사용

> 범위 주의: CARD-03은 실제 카드사 침해사고의 결제 서버 침입 또는 웹쉘을 재현하는
> 시나리오가 아니다. 정상 형식의 동시 승인 요청에 대한 카드 승인 코어의 무결성
> 방어를 검증한다. 실제 사건 참고, 합성 침입 시뮬레이션의 후속 범위 및 발표 표현은
> [실제 카드사 침해사고 착안 결제 서버 침해 시뮬레이션과 CARD-03 연결](lottecard-inspired-payment-server-simulation-v0.1.md)을 따른다.

## 1. 이 문서의 목적

CARD-03에서는 “두 요청이 거의 같은 순간에 들어오면 카드 한도를 두 번 계산할 수
있는가?”를 확인한다. 공격 성공 여부는 화면만으로 판단하지 않고 다음 다섯 가지를
서로 맞춰서 확인한다.

- 승인 요청이 몇 번 들어왔는가
- 각 요청이 한도를 읽은 시점의 값은 무엇이었는가
- 북웨이브 → Mock PG → 해온카드 로그의 `correlationId`가 이어지는가
- 각 요청의 승인·거절 결과가 무엇인가
- DB의 `used_amount`와 `version`이 결과와 맞는가

현재 구조는 다음과 같다.

```text
브라우저
  ↓ POST /api/v1/payments
북웨이브(bookwave-app)
  ↓ POST /api/v1/payments
Mock PG(mock-pg)
  ↓ POST /internal/v1/authorizations
해온카드(haeon-card)
  ↓ JDBC
해온카드 MySQL
```

모든 서비스 로그는 Spring MDC 접두사 `corr=<correlationId>`와 `key=value` 이벤트
필드로 출력한다. `correlationId`와 `runId`를 별도 JSON 필드라고 가정하지 않는다.
실행 묶음 `runId`는 증거 폴더와 `run.json`에서 관리하며, 원시 카드·결제 토큰은 로그에
남기지 않는다.

## 2. 단계별 탐지 지점

### 2.1 단계 1 — 승인 요청이 들어온 순간

**무슨 일이 일어나는가**
사용자가 결제를 누르면 북웨이브가 결제 요청을 만든다. 공격 재현에서는 같은 카드
토큰으로 짧은 시간 안에 두 요청을 보낸다.

**확인할 로그**

- 서비스: `bookwave-app`
- 이벤트 예: `payment_requested`
- 필드: MDC `corr`, `orderNo`, `merchantRequestId`, `amount`,
  `paymentMethod=synthetic_card`

**탐지 포인트**

- 짧은 시간 안에 같은 합성 결제수단 유형으로 요청이 반복되는가. 실제 토큰의 동일성은
  해온카드 DB의 `card_id`로 확인한다.
- 서로 다른 주문인데 같은 `merchantRequestId`가 재사용되는가
- 요청의 `amount`와 다음 서비스로 전달된 금액이 달라지는가
- `correlationId`가 없거나 요청마다 새 값으로 끊기는가

### 2.2 단계 2 — PG 신뢰 경계를 통과하는 순간

**무슨 일이 일어나는가**
Mock PG는 북웨이브 요청을 해온카드 승인 요청으로 전달한다. 이 구간은 “누가
승인을 요청했는지”를 확인하는 경계다.

**확인할 로그**

- 서비스: `mock-pg`
- 이벤트 예: `authorization_forward`
- 필드: MDC `corr`, `merchantNo`, `merchantRequestId`, `amount`,
  `paymentMethod=synthetic_card`, `targetService=haeon-card`

**탐지 포인트**

- 북웨이브 로그와 `correlationId`가 같은가
- `merchantNo=BOOKWAVE-LAB`이 예상한 값인가
- Mock PG가 아닌 다른 컨테이너가 해온카드로 직접 요청하지 않았는가
- 승인 결과나 가맹점 번호를 요청 본문에서 그대로 믿고 있지 않은가

### 2.3 단계 3 — 카드 한도를 읽는 순간

**무슨 일이 일어나는가**
해온카드는 승인 가능 여부를 판단하려고 `card_limits`의 현재 사용액과 버전을
읽는다. 취약 상태에서는 두 요청이 모두 `used_amount=0`과 `version=0`인 같은
스냅샷을 읽을 수 있다.

**확인할 로그**

- 서비스: `haeon-card`
- 이벤트 예: `limit_read`
- 필드: `correlationId`, `cardId`, `readUsedAmount`, `readLimitVersion`,
  `amount`, `mode`

**탐지 포인트**

- 거의 같은 시간에 같은 카드가 같은 `readLimitVersion`으로 여러 번 읽혔는가
- 두 요청의 `readUsedAmount + amount`가 각각 한도 안에 있지만,
  두 요청을 합치면 한도를 넘는가
- `readLimitVersion`이 커밋 시점의 최신 `version`보다 과거인가
- 한도 조회 로그와 승인 커밋 로그 사이에 비정상적으로 긴 간격이 있는가

### 2.4 단계 4 — 승인·거절 결과를 커밋하는 순간

**무슨 일이 일어나는가**
해온카드는 한도 검사 후 승인 또는 거절을 저장하고, 승인된 경우 사용액과 버전을
갱신한다.

**확인할 로그**

- 서비스: `haeon-card`
- 이벤트 예: `auth_committed`
- 필드: `correlationId`, `authId`, `merchantRequestId`, `decision`,
  `decisionCode`, `approvedAmount`, `authorizationNo`

**탐지 포인트**

- 같은 카드에 같은 짧은 시간대에 승인 결과가 두 건 이상 생겼는가
- `decision=APPROVED`인데 `approvedAmount=0`이거나, 거절인데 금액이 남아 있는가
- `authorization_requests`의 결과와 `card_transactions`가 일치하는가
- 승인 합계가 한도보다 큰가

### 2.5 단계 5 — 북웨이브가 최종 결과를 보여주는 순간

**무슨 일이 일어나는가**
Mock PG가 받은 카드 승인 결과를 북웨이브에 돌려주고, 북웨이브가 사용자 화면에
승인 또는 거절을 표시한다.

**확인할 로그**

- 서비스: `mock-pg`, `bookwave-app`
- 이벤트 예: `pg_charge_completed`, `payment_completed`
- 필드: MDC `corr`, `orderNo`, `paymentId`, `pgTid`, `decision`, `reasonCode`,
  `approvedAmount`, `authorizationNo`

**탐지 포인트**

- 세 서비스의 같은 `correlationId`가 하나의 요청 흐름을 끝까지 연결하는가
- 북웨이브 화면의 결과와 해온카드 DB의 결과가 같은가
- 같은 `Idempotency-Key` 재조회가 새 승인 건을 만들지 않는가
- 카드사는 거절했는데 북웨이브가 승인으로 표시하는 불일치가 있는가

## 3. 증거로 남길 DB 항목

### 3.1 핵심 테이블

| 테이블 | 확인할 컬럼 | 의미 |
|---|---|---|
| `card_limits` | `limit_amount`, `used_amount`, `version` | 한도·사용액·동시성 버전 |
| `authorization_requests` | `status`, `decision_code`, `read_used_amount`, `read_limit_version` | 승인 요청이 읽은 값과 최종 판단 |
| `card_transactions` | `auth_id`, `amount`, `status` | 실제 승인 거래 |
| `audit_events` | `event_uuid`, `event_type`, `correlation_id` | 감사 추적용 이벤트 |

### 3.2 최소 검증 쿼리

아래 쿼리는 합성 DB에서만 실행한다.

```sql
SELECT card_id, limit_amount, used_amount, version
FROM card_limits;

SELECT status, decision_code, COUNT(*) AS count
FROM authorization_requests
GROUP BY status, decision_code;

SELECT auth_id, amount, status
FROM card_transactions
ORDER BY transaction_id;

SELECT event_uuid, event_type, correlation_id
FROM audit_events
ORDER BY created_at;
```

## 4. 이번 실행에서 확인된 결과

### 4.1 Before — 취약 상태 재현

증거 폴더: `evidence/runs/CARD03-BEFORE-20260915T005643Z/`

- 80,000원 요청 두 건이 모두 승인됨
- 두 요청이 `readUsedAmount=0.00`, `readLimitVersion=0`을 읽음
- `used_amount=160000.00`, `version=2`
- 승인 두 건의 합계가 한도 100,000원을 초과함

이 결과는 두 요청이 같은 오래된 한도 스냅샷을 사용했다는 것을 보여준다.

### 4.2 After — 행 잠금과 최신 값 재판정

증거 폴더: `evidence/runs/CARD03-AFTER-20260915T005920Z/`

- 80,000원 요청 한 건은 승인됨
- 나머지 한 건은 `LIMIT_EXCEEDED`로 거절됨
- 최종 `used_amount=80000.00`, `version=1`
- 승인 합계가 한도를 넘지 않음

### 4.3 프론트엔드 흐름 증거

- API·DB·로그: `evidence/runs/FRONTEND-FLOW-012903/`
- 브라우저 승인·재조회·거절 관찰: `evidence/runs/FRONTEND-BROWSER-013346/`

브라우저 테스트에서는 승인, 같은 요청 재조회, 한도 초과 거절을 확인했다. 이
자료의 합성 ID는 화면 흐름을 설명하기 위한 값이며 실제 카드 정보가 아니다.

### 4.4 정상 상태 재실행 증거

최종 확인 폴더: `evidence/runs/OBS-FLOW-20260915T110000Z/`

- `db-before.txt`: 한도 100,000원, 사용액 0원, 승인·거래·감사 건수 0건
- `first-response.json`: 1,000원 승인
- `replay-response.json`: 같은 `Idempotency-Key` 재조회. 최초 응답과 동일
- `decline-response.json`: 100,000원 요청 거절, `LIMIT_EXCEEDED`
- `services.log`: 북웨이브·Mock PG·해온카드 로그 원본
- `correlation-log-lines.txt`: 두 결제 흐름의 `correlationId` 추출본
- `db-after.txt`: 사용액 1,000원, 버전 1, 승인 1건, 거절 1건

이번 실행에서 확인된 `correlationId`는 다음과 같다.

- 승인·재조회: `OBS-FLOW-20260915T110000Z-CORR`
- 거절: `OBS-FLOW-20260915T110000Z-DECLINE-CORR`

세 서비스 로그 모두에서 두 ID를 확인했으며, 승인 재조회는 새 승인 거래를
만들지 않았다.

## 5. 운영·실습용 탐지 규칙

아래 수치는 이번 실습에서 결과를 찾기 위한 기준이다. 실제 운영 환경에 그대로
적용하지 말고 서비스 특성에 맞게 조정한다.

1. `SUM(card_transactions.amount)`이 `card_limits.limit_amount`보다 크면 즉시 경고
2. 같은 카드에서 짧은 시간 안에 승인 두 건 이상이 같은
   `read_limit_version`으로 발생하면 동시성 의심
3. `authorization_requests.status=APPROVED`인데 거래가 없거나,
   거래가 있는데 승인 요청이 없으면 데이터 불일치 경고
4. 북웨이브 → Mock PG → 해온카드 중 한 곳이라도 `correlationId`가 끊기면 추적성
   경고
5. 해온카드가 `MERCHANT_NOT_ALLOWED`(HTTP 403)를 반환하면 신뢰 경계 위반 시도로 기록

### 5.1 자동 점검기

반복 검증을 위해 tools/card03-detection-check.sh를 추가했다. 이 스크립트는
공격을 실행하지 않고, **지정한 `correlationId` 또는 `merchantRequestId` 범위만**
저장된 로그와 합성 DB에서 읽어 다음 파일을 만든다. 실행 전 `used_amount`는
`BASELINE_USED_AMOUNT`로 함께 넘겨 과거 실행 데이터와 섞이지 않게 한다.

- result.json: PASS, ALERT, FAIL 결과
- summary.txt: 사람이 읽는 요약
- findings.txt: 규칙별 판정
- db-summary.tsv: DB 조회 결과
- correlation-report.tsv: 서비스별 correlationId 연결 결과

card03-concurrency.sh처럼 해온카드 내부 API를 직접 호출한 경우에는
EXPECTED_SERVICES=haeon-card를 지정한다. 북웨이브 → Mock PG → 해온카드 전체
흐름을 검사할 때는 EXPECTED_SERVICES를 생략한다. 기본값이 세 서비스 전체이기
때문이다.

## 6. MITRE ATT&CK 매핑

ATT&CK 매핑은 “비슷해 보이는 기법을 모두 붙이는 작업”이 아니다. 실제로 관찰한
행동과 시나리오의 목적에 맞는 항목만 붙이고, 필요한 전제가 없으면 미매핑으로
남긴다.

| ATT&CK | 이번 시나리오 판단 | 이유와 증거 |
|---|---|---|
| [T1565.003 Runtime Data Manipulation](https://attack.mitre.org/techniques/T1565/003/) | 조건부·가장 가까운 매핑 | 공격자가 DB를 직접 수정한 것은 아니지만, 동시에 읽은 오래된 런타임 상태로 승인 결과와 사용액의 무결성이 달라졌다. `CARD03-BEFORE`의 두 승인, `used_amount=160000.00`을 근거로 “비즈니스 상태 무결성 훼손”으로 설명할 수 있다. SQL 변조로 단정하지 않는다. |
| [T1657 Financial Theft](https://attack.mitre.org/techniques/T1657/) | 조건부 | 실제 금전 이득을 얻는 공격으로 확장할 때만 적용한다. 현재 실습은 합성 금액으로 한도 이중 사용을 보여주는 검증이며, 실제 자금 탈취는 확인하지 않았다. |
| [T1078 Valid Accounts](https://attack.mitre.org/techniques/T1078/) | 미매핑 | 테스트에는 사전에 설정한 합성 Bearer 토큰을 사용했다. 탈취된 정상 계정이나 자격 증명을 이용했다는 증거가 없다. |
| [T1190 Exploit Public-Facing Application](https://attack.mitre.org/techniques/T1190/) | 미매핑 | 이번 실행은 로컬 Docker 내부 흐름에서 합성 요청을 보낸 것이다. 인터넷 공개 애플리케이션의 취약점 악용은 재현하지 않았다. |

### 6.1 발표·보고서에 사용할 한 줄 요약

> CARD-03은 동시 요청이 같은 한도 스냅샷을 읽어 결제 상태의 무결성을 흔드는
> 시나리오다. 이번 실습에서 직접 확인한 것은 한도 이중 승인과 DB 상태 불일치이며,
> 실제 계정 탈취나 외부 공개 서비스 침투는 포함하지 않는다.

### 6.2 매핑을 확정하는 조건

- `T1565.003`: Before 증거와 런타임 상태 불일치를 최종 보고서에 함께 제시할 때
- `T1657`: 승인된 금액이 실제 공격자의 경제적 이익으로 이어지는 별도 흐름을
  구현·증명할 때
- `T1078`: 테스트 계정이 실제로 탈취되었다는 초기 침투 단계와 증거가 추가될 때
- `T1190`: 인터넷 공개 엔드포인트에 대한 취약점 악용을 별도 승인받아 재현할 때

## 7. Docker Compose를 다시 만들어야 하는가

지금은 **새 Compose 프로젝트를 만들 필요가 없다.** 현재 컨테이너가 healthy이고,
로그 조회·DB 조회·탐지 규칙 검증은 실행 중인 컨테이너로 할 수 있다.

| 상황 | 필요한 작업 |
|---|---|
| 로그·DB 결과만 확인 | 재생성 불필요. `docker compose logs`, `docker compose exec` 사용 |
| Java/정적 파일을 수정해 이미지가 바뀜 | 해당 서비스만 `build` 후 `up -d` |
| `compose.yaml`, 포트, 네트워크를 수정함 | 해당 서비스 `--force-recreate` |
| 해온카드 localhost:8084 포트가 필요함 | `compose.yaml`과 `compose.debug.yaml`을 함께 사용 |
| Before/After 프로파일을 바꿈 | 해온카드만 프로파일을 넣어 재생성한 뒤 normal로 복원 |

해온카드 포트 매핑을 유지하면서 재생성해야 할 때는 프로젝트 루트에서 다음처럼
실행한다.

```bash
docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card
```

단순히 기본 `compose.yaml`만으로 해온카드를 재생성하면 8084 호스트 매핑이 빠질 수
있다. 내부 Docker DNS 호출(`http://haeon-card:8084`)은 포트 매핑과 별개로 정상
동작하므로, 탐지 문서 작성과 내부 결제 흐름 검증 때문에 Compose를 새로 만들
필요는 없다.

## 8. 다음 작업

1. 현재 정상 상태에서 승인·재조회·거절 흐름의 로그와 DB 결과를 한 번 더 저장
2. `correlationId` 누락·금액 불일치·승인 합계 초과 규칙을 체크 스크립트로 자동화
3. 카드사 시나리오의 탐지 결과를 최종 보고서와 증거 목록에 연결
4. 이후 WBS 7.2의 메인 북웨이브 공격 재현으로 이동할 때, CARD-03 자료와
   북웨이브 자료를 별도 시나리오로 구분
5. 결제 서버 침입 징후 시뮬레이션을 구현하기 전에는 `simulation=true`, 합성 데이터,
   외부 미노출이라는 범위를 먼저 문서·실행 계약에 고정
