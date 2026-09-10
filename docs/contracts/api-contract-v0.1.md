# 북웨이브 · Mock PG · 해온카드 API 계약서 v0.1

작성일: 2026-09-09  
상태: **확정 초안 - 구현 기준**  
대상: WSL2 Ubuntu + Docker Compose + Java/Spring 실습 환경

## 1. 이 문서의 역할

이 문서는 서비스 사이에 오가는 요청과 응답을 미리 약속한 문서다. 구현 담당자가 달라도 이 약속을 지키면 각 서비스를 따로 개발하고 나중에 연결할 수 있다.

이번 버전은 정상 결제 왕복을 먼저 구현하기 위한 최소 계약이다. OD-02-X의 Before/After 변형은 이 계약을 깨지 않고, Mock PG의 실습 프로파일과 검증 결과로 추가한다.

### 확정한 방향

- 서비스는 별도 Spring Boot 애플리케이션과 별도 컨테이너로 둔다.
- 코드는 하나의 Git 저장소(모노레포)에 함께 둘 수 있다.
- 결제는 `북웨이브 -> Mock PG -> 해온카드` 순서의 동기식 왕복으로 시작한다.
- 실제 카드번호·CVC·금융망은 사용하지 않고 합성 토큰만 사용한다.
- 카드 승인 여부는 해온카드가 직접 계산한다. 요청자가 `decision` 값을 정하지 않는다.
- `correlationId`로 세 서비스의 로그를 연결하고, `merchantRequestId`로 중복 승인을 막는다.
- 결제 콜백과 비동기 재처리는 정상 왕복이 통과한 뒤 다음 버전에서 추가한다.

## 2. 서비스와 호출 방향

```text
사용자/테스트 도구
        |
        v
bookwave-app:8080
        |
        | POST /internal/v1/pg/charges
        v
mock-pg:8083
        |
        | POST /internal/v1/authorizations
        v
haeon-card:8084
        |
        v
haeon-card-mysql (내부 전용)
```

북웨이브는 해온카드 DB를 직접 읽거나 쓰지 않는다. Mock PG만 해온카드 API를 호출하며, 해온카드는 자신의 DB만 관리한다.

## 3. 공통 통신 규칙

| 항목 | 계약 |
|---|---|
| 형식 | JSON, UTF-8 |
| 금액 | `amount`는 원 단위 양의 정수. 예: 10,000원은 `10000` |
| 시간 | ISO-8601 UTC. 예: `2026-09-09T05:00:00Z` |
| 추적 | 모든 요청·응답에 `X-Correlation-Id` 헤더와 `correlationId`를 사용 |
| 중복 방지 | `Idempotency-Key`와 `merchantRequestId`를 같은 값으로 사용 |
| 합성 데이터 | `card-token-lab-*`, `BOOKWAVE-LAB`, `PG-LAB-*` 형식 사용 |
| 비밀정보 | 카드번호, CVC, API 키, 실제 계정 비밀번호를 요청·응답·로그에 넣지 않음 |
| 인증 | 현재는 격리된 로컬 랩. 실제 서비스 전환 시 mTLS 또는 서비스 토큰을 별도 추가 |

### 필수 헤더

```http
Content-Type: application/json
X-Correlation-Id: corr-20260909-0001
Idempotency-Key: BW-REQ-0001
Authorization: Bearer lab-merchant-bookwave
```

헤더와 본문의 `correlationId`가 다르면 `400 INVALID_CORRELATION_ID`로 거절한다. `Idempotency-Key`가 필요한 API에서 누락되면 `400 MISSING_IDEMPOTENCY_KEY`로 거절한다.

## 4. API 1 - 북웨이브 결제 접수

### `POST /api/v1/payments`

호출자: 사용자·테스트 도구  
소유자: `bookwave-app:8080`  
목적: 주문에 대한 결제를 접수하고 Mock PG를 호출한다.

### 요청

```json
{
  "correlationId": "corr-20260909-0001",
  "orderNo": "BW-ORDER-0001",
  "merchantRequestId": "BW-REQ-0001",
  "amount": 10000,
  "currency": "KRW",
  "paymentMethodToken": "card-token-lab-001"
}
```

규칙:

- `orderNo`는 북웨이브가 만들며 한 주문에서 재사용하지 않는다.
- `merchantRequestId`는 재시도해도 같은 값을 유지한다.
- `paymentMethodToken`은 합성 토큰이다. 원본 카드정보의 대체물이 아니다.
- `merchantNo`와 `decision`은 이 외부 요청에 넣지 않는다. 가맹점 정보는 Mock PG가 서버 설정으로 선택한다.

### 응답 - 승인

HTTP `200 OK`

```json
{
  "correlationId": "corr-20260909-0001",
  "orderNo": "BW-ORDER-0001",
  "paymentId": "PAY-LAB-0001",
  "pgTid": "PG-LAB-0001",
  "decision": "APPROVED",
  "approvedAmount": 10000,
  "authorizationNo": "AUTH-LAB-0001"
}
```

### 응답 - 정상 거절

HTTP `200 OK`

```json
{
  "correlationId": "corr-20260909-0001",
  "orderNo": "BW-ORDER-0001",
  "paymentId": "PAY-LAB-0001",
  "pgTid": "PG-LAB-0001",
  "decision": "DECLINED",
  "approvedAmount": 0,
  "reasonCode": "LIMIT_EXCEEDED"
}
```

북웨이브는 `APPROVED`일 때만 주문을 결제 완료로 바꾼다. `DECLINED`는 실패가 아니라 카드사가 정상적으로 거절한 업무 결과다.

## 5. API 2 - Mock PG 결제 전달

### `POST /internal/v1/pg/charges`

호출자: `bookwave-app`  
소유자: `mock-pg:8083`  
목적: 북웨이브 결제를 PG 거래로 만들고 해온카드 승인 API를 호출한다.

### 요청

```json
{
  "correlationId": "corr-20260909-0001",
  "orderNo": "BW-ORDER-0001",
  "merchantRequestId": "BW-REQ-0001",
  "amount": 10000,
  "currency": "KRW",
  "paymentMethodToken": "card-token-lab-001"
}
```

Mock PG 내부 규칙:

1. 서버 설정에서 가맹점 ID를 `BOOKWAVE-LAB`으로 선택한다.
2. `pgTid`를 한 번 발급하고 재시도에는 같은 거래를 조회한다.
3. `paymentMethodToken`을 해온카드용 `cardToken`으로 매핑한다.
4. `requestFingerprint`를 합성해 승인 요청에 넣는다. DB의 `request_fingerprint`로 저장한다.
5. 해온카드의 응답을 검증한 뒤 북웨이브용 응답을 만든다.

### 응답

북웨이브 결제 접수 응답과 같은 구조를 반환한다. `remainingLimit` 같은 카드 내부 정보는 북웨이브에 노출하지 않는다.

```json
{
  "correlationId": "corr-20260909-0001",
  "orderNo": "BW-ORDER-0001",
  "paymentId": "PAY-LAB-0001",
  "pgTid": "PG-LAB-0001",
  "decision": "APPROVED",
  "approvedAmount": 10000,
  "authorizationNo": "AUTH-LAB-0001"
}
```

## 6. API 3 - 해온카드 승인 요청

### `POST /internal/v1/authorizations`

호출자: `mock-pg`  
소유자: `haeon-card:8084`  
목적: 카드 한도를 확인하고 승인 원본을 만든다.

### 요청

```json
{
  "correlationId": "corr-20260909-0001",
  "merchantNo": "BOOKWAVE-LAB",
  "merchantRequestId": "BW-REQ-0001",
  "cardToken": "card-token-lab-001",
  "amount": 10000,
  "currency": "KRW",
  "requestFingerprint": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "requestedAt": "2026-09-09T05:00:00Z"
}
```

### 요청에서 금지하는 값

```json
{
  "decision": "APPROVED",
  "usedAmount": 0,
  "remainingLimit": 999999
}
```

위 값이 요청에 들어와도 해온카드는 승인 판단에 사용하지 않는다. 서비스 설정, DB의 최신 한도, 트랜잭션 잠금 결과만 사용한다.

### 응답 - 승인

```json
{
  "correlationId": "corr-20260909-0001",
  "authorizationId": 1,
  "authorizationNo": "AUTH-LAB-0001",
  "decision": "APPROVED",
  "approvedAmount": 10000,
  "remainingLimit": 90000,
  "reasonCode": "APPROVED"
}
```

### 응답 - 거절

```json
{
  "correlationId": "corr-20260909-0001",
  "authorizationId": 1,
  "decision": "DECLINED",
  "approvedAmount": 0,
  "reasonCode": "LIMIT_EXCEEDED"
}
```

`remainingLimit`은 카드 내부 검증과 실습 증거용 값이다. Mock PG는 이를 저장할 수 있지만 북웨이브 응답에는 전달하지 않는다.

API의 `merchantNo`는 현재 v0.1 호환을 위한 합성 가맹점 번호다. `Authorization: Bearer lab-merchant-bookwave`가 있으면 해온카드는 서버 설정의 가맹점 주체를 우선 사용한다. 다음 계약 버전에서는 Bearer 주체를 필수로 하고 `merchantNo` 본문을 제거한다.

## 7. 공통 상태와 오류

### 업무 결과

| 값 | 뜻 |
|---|---|
| `APPROVED` | 한도와 검증을 통과한 승인 |
| `DECLINED` | 한도 초과 등 정상적인 업무 거절 |
| `DUPLICATE` | 같은 요청 키가 이미 처리됨 |
| `MISMATCH_QUARANTINED` | PG 결과와 카드 결과가 달라 격리함 |

### 기술·검증 오류

| HTTP | 오류 코드 | 뜻 |
|---:|---|---|
| 400 | `INVALID_REQUEST` | 필수값·형식·금액 오류 |
| 400 | `INVALID_CORRELATION_ID` | 헤더와 본문 ID 불일치 |
| 400 | `MISSING_IDEMPOTENCY_KEY` | 중복 방지 키 누락 |
| 403 | `MERCHANT_NOT_ALLOWED` | 허용하지 않은 가맹점 |
| 409 | `IDEMPOTENCY_CONFLICT` | 같은 키에 다른 금액·주문을 사용 |
| 409 | `DUPLICATE_REQUEST` | 이미 처리된 요청의 충돌 |
| 502 | `UPSTREAM_ERROR` | 다음 서비스 응답 오류 |
| 503 | `UPSTREAM_UNAVAILABLE` | 다음 서비스 연결 불가 |
| 503 | `BEFORE_BARRIER_TIMEOUT` | Before 동시성 실습의 짝 요청이 제한 시간 안에 오지 않음 |
| 500 | `INTERNAL_ERROR` | 예상하지 못한 내부 오류 |

오류 응답 형식:

```json
{
  "correlationId": "corr-20260909-0001",
  "errorCode": "IDEMPOTENCY_CONFLICT",
  "message": "같은 요청 키에 다른 금액이 사용되었습니다.",
  "retryable": false
}
```

## 8. 재시도와 타임아웃

- 북웨이브는 네트워크 오류가 발생해도 같은 `Idempotency-Key`로 최대 1회 재시도한다.
- Mock PG는 해온카드에 동일한 `merchantRequestId`를 전달한다.
- 같은 키와 같은 내용이면 최초 결과를 다시 반환한다.
- 같은 키와 다른 금액이면 `409 IDEMPOTENCY_CONFLICT`다.
- 연결 타임아웃은 2초, 전체 요청 타임아웃은 5초로 시작한다.
- 5xx 재시도는 1회만 허용하고, 4xx 업무 오류는 재시도하지 않는다.
- 타임아웃 뒤에 승인 여부가 불확실하면 새 키를 만들지 말고 기존 키로 조회 API를 추가할 때까지 `PENDING_REVIEW`로 기록한다.

## 9. 로그와 증거 계약

모든 서비스는 다음 필드를 구조화 로그에 남긴다.

```json
{
  "runId": "ODX-20260909-001",
  "correlationId": "corr-20260909-0001",
  "service": "mock-pg",
  "event": "authorization_forward",
  "merchantRequestId": "BW-REQ-0001",
  "pgTid": "PG-LAB-0001",
  "decision": "APPROVED",
  "synthetic": true
}
```

- `runId`는 실행 묶음, `correlationId`는 한 결제 왕복을 뜻한다.
- 카드번호·CVC·실제 개인정보는 기록하지 않는다.
- `evidence`는 업무 DB가 아니라 실행 로그와 manifest를 보관하는 곳이다.
- 실행 전 프로파일, Git 커밋, Compose 설정 해시를 manifest에 남긴다.

## 10. OD-02-X Before/After 확장 규칙

정상 계약을 먼저 통과한 뒤, 실습 제어기가 `LAB_PROFILE=before` 또는 `after`를 설정한다.

### Before

- 승인된 랩에서만 오류 주입을 켠다.
- PG 결과와 카드 결과를 일부러 다르게 만드는 테스트 훅을 사용한다.
- 어떤 값이 달랐는지 `pgDecision`, `cardDecision`, `amount`, `correlationId`를 증거에 남긴다.

### After

- 카드 결과를 최종 판단의 기준으로 삼는다.
- 금액·가맹점·요청 키 불일치를 격리한다.
- 불일치 거래를 북웨이브에 승인으로 전달하지 않는다.
- `MISMATCH_QUARANTINED`와 감사 이벤트를 남긴다.

Before/After 훅은 외부 요청자가 보내는 `decision` 필드가 아니다. Compose 환경 변수와 테스트 실행 스크립트로만 켠다.

## 11. 구현 순서와 인수 조건

1. `haeon-card`에 `/actuator/health`와 승인 API를 만든다.
2. Mock PG가 합성 요청을 받아 해온카드로 전달한다.
3. 북웨이브가 Mock PG를 호출하고 주문 상태를 업데이트한다.
4. 정상 승인·거절을 각각 1회 실행한다.
5. 세 서비스 로그에서 같은 `correlationId`를 확인한다.
6. 같은 `merchantRequestId` 재시도 시 중복 승인이 생기지 않는지 확인한다.
7. 그 다음에만 OD-02-X Before/After를 켠다.

### v0.1 완료 기준

- 정상 승인과 정상 거절의 HTTP 응답이 계약과 일치한다.
- 카드 승인 API 요청에 `decision`이 없어도 동작한다.
- 같은 요청 키의 재시도 결과가 한 건으로 유지된다.
- 북웨이브에서 해온카드 DB로 직접 연결할 수 없다.
- 로그만으로 `runId -> correlationId -> orderNo/pgTid/authNo`를 따라갈 수 있다.

## 12. 변경 규칙

- API 경로, 필드명, 상태값을 바꿀 때는 이 문서와 `openapi.yaml`을 먼저 함께 수정한다.
- 구현 코드가 문서보다 앞서지 않게 한다.
- 하위 호환이 필요한 변경은 `v0.2`로 올리고, 기존 필드를 바로 삭제하지 않는다.
- 해온카드 DDL 변경은 API 계약 변경과 별도로 검토한다.
- 실제 금융기관·PG의 운영 API를 연결하지 않는다.
