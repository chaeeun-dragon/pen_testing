# 해온카드 회원 포털 조회 API 계약서 v0.1

작성일: 2026-09-17
상태: **구현 기준**
대상 서비스: `haeon-card` (회원 포털 커넥터, 기본 포트 `8085`)
선행 문서: `docs/contracts/api-contract-v0.1.md`(결제 승인 왕복), `docs/contracts/openapi.yaml`

## 1. 이 문서의 역할

회원이 브라우저로 여는 해온카드 마이페이지가 사용하는 **조회 전용** API를 정한다.
결제 승인·거절·재조회는 기존 `/internal/v1/authorizations` 계약을 그대로 쓰고, 이 문서는
그 결과를 회원 관점에서 읽는 방법만 다룬다.

고정한 방향:

- 결제를 시작하는 곳은 북웨이브뿐이다. 이 API는 승인 상태를 만들거나 바꾸지 않는다.
- 조회 대상 회원은 **항상 로그인 세션**에서 나온다. 요청 본문·질의 문자열로 회원이나
  카드를 고를 수 없다.
- 실제 카드번호·CVC·개인정보는 저장하지도 응답하지도 않는다. 카드번호는 끝 네 자리
  마스킹만 내보낸다.
- `card_limits.version`은 CARD-03 증거·운영 확인용으로 DB에만 보관하고 회원 응답에는
  넣지 않는다. 이용한도·사용액·잔여한도는 회원 화면에 그대로 표시한다.

## 2. 포트 경계

| 포트 | 응답하는 경로 | 404로 막는 경로 | 호스트 게시 |
|---|---|---|---|
| 8084 (승인) | `/internal/**`, `/actuator/**` | `/portal/**`, 회원 화면 | 안 함 (`compose.debug.yaml`에서만) |
| 8085 (포털) | `/portal/**`, 회원 화면, `/actuator/**` | `/internal/**` | `127.0.0.1:8085` |

애플리케이션이 요청의 로컬 포트를 보고 경로를 가른다(`PortConfinementFilter`).
포털 포트가 호스트에 열려 있어도 가맹점 승인 API는 그 포트로 도달하지 못한다.

## 3. 인증

| 항목 | 계약 |
|---|---|
| 방식 | 로그인으로 받은 세션 토큰을 `Authorization: Bearer <sessionToken>`으로 보낸다 |
| 토큰 | 32바이트 난수의 base64url 문자열 |
| 저장 | 서버는 원문을 저장하지 않고 `SHA-256(token)` hex만 `member_sessions`에 넣는다 |
| 비밀번호 | `SHA-256(salt ‖ password)` hex로만 저장한다. 원문·해시를 로그와 증거 파일에 남기지 않는다 |
| 만료 | 기본 30분(`PORTAL_SESSION_TTL_MINUTES`). 만료·로그아웃 세션은 없는 것으로 취급한다 |
| 실패 응답 | 아이디 없음과 비밀번호 불일치를 같은 본문으로 돌려 계정 존재 여부를 흘리지 않는다 |

> 합성 실습 계정 전용이다. 실제 서비스라면 bcrypt/argon2 같은 느린 해시와 로그인 시도
> 제한을 함께 둔다. 현재 버전에는 시도 횟수 제한이 없다.

## 4. API

### 4.1 `POST /portal/v1/sessions` — 로그인

요청:

```json
{ "loginId": "haeon01", "password": "Haeon!2026" }
```

응답 `200`:

```json
{
  "sessionToken": "3nS1p0rTaL...",
  "expiresAt": "2026-09-17T02:46:41Z",
  "member": {
    "memberNo": "HC-MEMBER-001",
    "displayName": "김해온",
    "joinedAt": "2026-09-10T03:28:04Z",
    "cardCount": 3
  }
}
```

### 4.2 `DELETE /portal/v1/sessions` — 로그아웃

`Authorization` 헤더의 세션을 즉시 무효화하고 `204`를 돌려준다. 토큰이 이미 없거나
만료되었어도 `204`다.

### 4.3 `GET /portal/v1/me` — 회원 정보

응답 `200`은 위 `member` 객체와 같다.

### 4.4 `GET /portal/v1/me/cards` — 내 카드 한도 조회

응답 `200`:

```json
{
  "member": { "memberNo": "HC-MEMBER-001", "displayName": "김해온", "joinedAt": "...", "cardCount": 3 },
  "cards": [
    {
      "maskedNumber": "**** **** **** 0002",
      "cardName": "해온 데일리",
      "brand": "Mastercard",
      "cardType": "신용",
      "paymentDay": 25,
      "benefitSummary": "주요 쇼핑몰 10% · 외식·배달 5% · 모든 가맹점 2%",
      "primary": true,
      "status": "NORMAL",
      "limitAmount": 3000000,
      "usedAmount": 290700,
      "remainingAmount": 2709300
    }
  ],
  "totalLimitAmount": 5100000,
  "totalUsedAmount": 1570700,
  "totalRemainingAmount": 3529300
}
```

| 필드 | 근거 |
|---|---|
| `limitAmount` | `card_limits.limit_amount` |
| `usedAmount` | `card_limits.used_amount` (확정 승인 합계) |
| `remainingAmount` | `limitAmount - usedAmount`, 0 아래로 내려가지 않는다 |
| `maskedNumber` | `cards.card_last4`만 사용. 카드 토큰은 응답하지 않는다 |

정렬은 주 이용 카드 우선, 그다음 `card_id` 오름차순이다.

### 4.5 `GET /portal/v1/me/transactions` — 내 거래내역 조회

질의 변수 `limit`은 기본 20, 최대 100으로 잘린다. `limit < 1`은 `400 INVALID_REQUEST`다.

응답 `200`:

```json
{
  "member": { "...": "..." },
  "transactions": [
    {
      "authorizationNo": "AUTH-HC-0f2a91c3d8b47e15",
      "occurredAt": "2026-09-17T02:18:41Z",
      "merchantName": "북웨이브",
      "cardName": "해온 플러스",
      "maskedNumber": "**** 0001",
      "amount": 5000000,
      "status": "DECLINED",
      "reasonCode": "LIMIT_EXCEEDED"
    }
  ],
  "approvedCount": 2,
  "approvedAmount": 22000,
  "declinedCount": 1
}
```

- 대상은 `authorization_requests.status`가 `APPROVED` 또는 `DECLINED`인 확정 건이다.
  트랜잭션 안에서만 쓰는 `REQUESTED`는 나오지 않는다.
- 정렬은 `COALESCE(decided_at, requested_at)` 내림차순, 같으면 `auth_id` 내림차순이다.
- `reasonCode`는 `APPROVED` / `LIMIT_EXCEEDED` / `CARD_BLOCKED`다.
- 합계 세 값은 **이번 응답에 담긴 건**을 기준으로 계산한다. 전체 기간 합계가 아니다.

## 5. 오류

| HTTP | errorCode | 상황 |
|---|---|---|
| 400 | `INVALID_REQUEST` | 필수값 누락, 형식 위반, `limit < 1` |
| 401 | `INVALID_CREDENTIALS` | 아이디 없음 또는 비밀번호 불일치 (구분하지 않는다) |
| 401 | `SESSION_REQUIRED` | Bearer 토큰 없음, 만료, 로그아웃됨 |
| 404 | `NOT_FOUND` | 그 포트에 열려 있지 않은 경로 |
| 500 | `INTERNAL_ERROR` | 서버 내부 오류 |

본문은 결제 API와 같은 `ErrorResponse` 모양이다.

```json
{ "correlationId": "portal", "errorCode": "SESSION_REQUIRED", "message": "로그인이 필요합니다.", "retryable": false }
```

포털 요청에는 `X-Correlation-Id`를 요구하지 않으므로 `correlationId`는 고정값 `portal`이다.

## 6. 데이터 근거

| 대상 | 테이블 |
|---|---|
| 회원·로그인 | `card_members` (`login_id`, `password_salt`, `password_hash`) |
| 세션 | `member_sessions` (`token_hash`, `expires_at`, `revoked_at`) |
| 카드 표시 정보 | `cards` (`card_name`, `brand`, `card_type`, `payment_day`, `benefit_summary`, `is_primary`) |
| 한도 | `card_limits` (`limit_amount`, `used_amount`) |
| 거래내역 | `authorization_requests` + `merchants` + `cards` |

스키마는 `db/haeon-card/init/004_portal_schema.sql`, 합성 데이터는
`db/haeon-card/fixtures/006_portal_seed.sql`과 `007_portal_history_seed.sql`이다.

## 7. 변경 규칙

- 경로·필드·상태값을 바꾸면 이 문서와 `openapi.yaml`을 먼저 함께 고친다.
- 회원 범위 제한(세션의 `memberId`로만 조회)은 이 API의 불변 조건이다. 요청 값으로 회원을
  고르는 변경은 받지 않는다.
- `card_limits.version`을 회원 응답에 추가하지 않는다.
