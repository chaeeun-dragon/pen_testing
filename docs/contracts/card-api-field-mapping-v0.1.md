# 합성 카드 API 필드 매핑표 v0.1

작성일: 2026-09-14
상태: **로컬 검증용 확정 기준**
범위: 북웨이브 결제 요청과 해온카드 승인 API 사이의 필드·오류·재시도 약속

## 1. 왜 이 문서가 필요한가

팀장님 카드 백엔드 API가 완성되기 전에도, 우리 쪽에서 필드 이름과 자료형을
먼저 고정할 수 있다. 이 문서는 실제 카드사 API가 아니라 **합성 데이터만 쓰는
로컬 기준 API**다. 나중에 실제 팀 API를 연결할 때는 URL과 변환 어댑터만 바꾸고
북웨이브 화면·테스트 데이터·증거 형식은 유지한다.

실제 카드번호, CVC, 금융망 계정은 넣지 않는다.

## 2. 서비스 호출 순서

```text
브라우저/테스트 도구
        |
        | POST /api/v1/payments
        v
bookwave-app:8080
        |
        | POST /internal/v1/pg/charges
        v
mock-pg:8083  (필드 변환 어댑터)
        |
        | POST /internal/v1/authorizations
        v
haeon-card:8084  (승인 판단 원본)
        |
        v
haeon-card-mysql
```

북웨이브는 해온카드에 직접 접근하지 않는다. `mock-pg`가 가맹점 주체와 PG 거래를
관리하고, 해온카드는 최신 한도와 DB 잠금 결과로 승인 여부를 계산한다.

코드에서는 `CardAuthorizationGateway`가 교체 경계다. 현재는
`HaeonCardAuthorizationClient`가 이 인터페이스를 구현한다. 팀장님 API를 받으면
`TeamCardAuthorizationClient`를 같은 인터페이스로 추가하고, 요청·응답 DTO를
매퍼에서 변환한다. `MockPgService`와 북웨이브 외부 API는 그대로 둔다.

## 3. 요청 필드 매핑

| 의미 | 북웨이브 `PaymentRequest` | Mock PG 내부 `AuthorizationRequest` | 해온카드 요청 | 처리 주체 |
|---|---|---|---|---|
| 한 결제를 묶는 ID | `correlationId` | 그대로 전달 | 그대로 전달 | 호출자가 만들고 세 서비스가 로그에 기록 |
| 주문 번호 | `orderNo` | PG 응답에 유지 | 전달하지 않음 | 북웨이브 |
| 같은 결제 재시도 키 | `merchantRequestId` + `Idempotency-Key` | 그대로 전달 | `Idempotency-Key`로 전달 | 북웨이브가 재시도에도 재사용 |
| 가맹점 | 외부 요청에 없음 | `merchantNo=BOOKWAVE-LAB` | 검증용 `merchantNo` | Mock PG 설정·해온카드 DB |
| 결제 수단 | `paymentMethodToken` | `cardToken`으로 이름 변환 | `cardToken` | 합성 토큰만 사용 |
| 결제 금액 | `amount` | 그대로 전달 | 그대로 전달 | 해온카드가 최신 한도와 비교 |
| 통화 | `currency` | 그대로 전달 | 그대로 전달 | 현재 `KRW`만 허용 |
| 요청 지문 | 생성하지 않음 | `requestFingerprint` 생성 | 그대로 전달·저장 | Mock PG가 SHA-256 생성 |
| 요청 시각 | 생성하지 않음 | `requestedAt` 생성 | 그대로 전달 | Mock PG가 UTC 생성 |

### 필드별 규칙

- `correlationId`는 헤더와 JSON 본문 값이 같아야 한다. 다르면 `400 INVALID_CORRELATION_ID`다.
- `merchantRequestId`와 `Idempotency-Key`는 같은 값이어야 한다.
- `paymentMethodToken`은 `card-token-lab-*` 형식의 합성 토큰이다.
- `requestFingerprint`는 정규화된 요청 내용의 SHA-256 hex 64자리다.
- `amount`는 원 단위 양의 정수다. 북웨이브와 Haeon API는 현재 최대 10,000,000원을 검증한다.
  `100,000원`은 CARD-03 `lab` 프로파일의 카드 한도이지 API 입력 상한이 아니다.
- `merchantNo`는 클라이언트가 고르는 값이 아니다. Mock PG 서버 설정의 값을 사용한다.
- `Authorization: Bearer lab-merchant-bookwave`가 있으면 Haeon은 서버 설정의 합성 가맹점 주체를 우선한다.

## 4. 응답 필드 매핑

| 해온카드 `AuthorizationResponse` | Mock PG `PaymentResult` | 북웨이브 화면 | 비고 |
|---|---|---|---|
| `correlationId` | `correlationId` | `correlationId` | 전체 로그 추적용 |
| `authorizationId` | 내부 저장 | 표시하지 않음 | 카드 DB 승인 식별자 |
| `authorizationNo` | `authorizationNo` | 카드 승인번호 | 승인 시 생성 |
| `decision` | `decision` | 승인/거절 배지 | `APPROVED` 또는 `DECLINED` |
| `approvedAmount` | `approvedAmount` | 승인 금액 | 거절이면 `0` |
| `remainingLimit` | 내부 검증용 | 표시하지 않음 | 카드사 내부 증거용 |
| `reasonCode` | `reasonCode` | 거절 사유 | 예: `APPROVED`, `LIMIT_EXCEEDED` |
| `pgTid` | 생성 | PG 거래번호 | Mock PG가 생성 |
| `paymentId` | 생성 | 결제 ID | Mock PG가 생성 |

북웨이브에는 `remainingLimit`을 전달하지 않는다. 카드 내부 한도 계산 정보가 외부
서비스로 불필요하게 노출되지 않도록 한다.

## 5. 요청에 넣으면 안 되는 값

다음 값은 카드사가 계산하는 결과이므로 요청 DTO에 넣거나 신뢰하지 않는다.

```json
{
  "decision": "APPROVED",
  "approvedAmount": 999999,
  "remainingLimit": 999999,
  "authorizationNo": "AUTH-FORGED"
}
```

공격 실습에서는 위와 같은 값이 들어와도 Haeon이 DB와 트랜잭션 결과만 사용해
판정하는지 확인한다. 이 값들을 요청에서 받아들이면 PG-카드 신뢰 경계 실습의
핵심 통제가 사라진다.

## 6. 최소 요청·응답 예시

### 요청

```json
{
  "correlationId": "corr-20260914-0001",
  "merchantNo": "BOOKWAVE-LAB",
  "merchantRequestId": "BW-REQ-0001",
  "cardToken": "card-token-lab-001",
  "amount": 10000,
  "currency": "KRW",
  "requestFingerprint": "0000000000000000000000000000000000000000000000000000000000000000",
  "requestedAt": "2026-09-14T05:00:00Z"
}
```

### 승인 응답

```json
{
  "correlationId": "corr-20260914-0001",
  "authorizationId": 1,
  "authorizationNo": "AUTH-LAB-0001",
  "decision": "APPROVED",
  "approvedAmount": 10000,
  "remainingLimit": 90000,
  "reasonCode": "APPROVED"
}
```

### 정상 거절 응답

```json
{
  "correlationId": "corr-20260914-0002",
  "authorizationId": 2,
  "decision": "DECLINED",
  "approvedAmount": 0,
  "remainingLimit": 0,
  "reasonCode": "LIMIT_EXCEEDED"
}
```

## 7. 오류·재시도 계약

| 상황 | HTTP | 코드 | 재시도 |
|---|---:|---|---|
| 헤더·본문 correlation ID 불일치 | 400 | `INVALID_CORRELATION_ID` | 아니오 |
| 필수값·금액·형식 오류 | 400 | `INVALID_REQUEST` | 아니오 |
| 가맹점 토큰 불일치 | 403 | `MERCHANT_NOT_ALLOWED` | 아니오 |
| 같은 키에 다른 요청 | 409 | `IDEMPOTENCY_CONFLICT` | 아니오 |
| 해온카드 연결 실패 | 503 | `UPSTREAM_UNAVAILABLE` | 1회 |
| 해온카드 5xx | 502 | `UPSTREAM_ERROR` | 1회 |
| 한도 초과 | 200 | `DECLINED / LIMIT_EXCEEDED` | 같은 결제 재시도 가능 |

네트워크 오류 뒤에는 새 `merchantRequestId`를 만들지 않는다. 같은 키로 다시
보내야 중복 승인을 막을 수 있다.

Haeon API를 직접 재조회한 멱등 응답에서는 카드 한도를 다시 읽지 않으므로
`remainingLimit`이 `null`일 수 있다. 승인번호·판정·승인 금액·사유는 최초 응답과
같아야 하며, PG와 북웨이브에는 `remainingLimit`을 전달하지 않는다.

## 8. 팀장님 API로 교체할 때

1. 팀장님 API의 URL을 환경 변수로 받는다.
2. `PaymentRequest -> 팀장 API 요청` 변환 어댑터를 추가한다.
3. 응답을 현재 `PaymentResult` 형태로 변환한다.
4. 승인·거절·재시도 계약 테스트를 그대로 실행한다.
5. 필드가 바뀌면 이 문서와 `openapi.yaml`을 같은 커밋에서 수정한다.

현재 기준 환경 변수:

```text
HAEON_CARD_BASE_URL=http://haeon-card:8084
```

실제 금융기관 API나 실제 카드정보로 교체하지 않는다. 팀장님 API도 먼저 합성
환경에서 연결하고, 프로젝트 범위 밖의 외부 망은 사용하지 않는다.

## 9. 인수 조건

- 정상 승인 요청이 계약 필드와 일치한다.
- 같은 키 재시도는 동일 승인번호와 동일 결과를 반환한다.
- 같은 키에 다른 금액을 넣으면 `409 IDEMPOTENCY_CONFLICT`다.
- 요청의 `decision`·`approvedAmount`·`remainingLimit`을 조작해도 결과가 바뀌지 않는다.
- 승인·거절 응답의 `correlationId`가 요청과 같다.
- 북웨이브·Mock PG·Haeon 로그에서 같은 `correlationId`를 검색할 수 있다.
