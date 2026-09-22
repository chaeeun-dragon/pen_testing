# 북웨이브 ↔ 해온카드 연동 인계 v0.1

작성일: 2026-09-17
작성 주체: 해온카드(카드사) 담당
받는 사람: 북웨이브(가맹점) 담당
관련 계약: `docs/contracts/api-contract-v0.1.md`, `docs/contracts/openapi.yaml`,
`docs/contracts/haeon-card-portal-api-v0.1.md`

이 문서는 **북웨이브 쪽 구현을 교체할 때 무엇을 버려도 되고 무엇을 맞춰야 하는지** 한 장으로
정리한다. 계약 원문은 위 문서들이고, 여기서는 연동 지점만 골라 적는다.

---

## 0. 한 줄 요약

Git 브랜치·worktree·폴더 소유·Compose 통합 순서는 [북웨이브·PG·해온카드 통합 작업 가이드](bookwave-pg-haeon-integration-guide-v0.1.md)를 먼저 따른다. 이 문서는 그 뒤에 지켜야 하는 북웨이브 결제 계약과 교체 범위를 다룬다.

결제를 시작하는 쪽은 북웨이브뿐이다. 북웨이브는 `mock-pg`에만 요청을 보내고, 해온카드는
`mock-pg`에서 온 요청만 승인한다. 승인 결과는 해온카드 DB에 남고, 회원은 해온카드 회원
포털(`8085`)에서 그 결과를 조회한다. 북웨이브는 해온카드 DB나 승인 API를 직접 만지지 않는다.

```text
회원 (브라우저)
   |                                         \
   | 결제 시작                                  \  로그인·조회
   v                                            v
bookwave-app:8080                        haeon-card:8085 (회원 포털)
        |                                       |
        | POST /internal/v1/pg/charges          | GET /portal/v1/me/...
        v                                       |
mock-pg:8083                                    |
        |                                       |
        | POST /internal/v1/authorizations      |
        v                                       v
haeon-card:8084 (승인) ------------------> haeon-card-mysql (내부 전용)
```

---

## 1. 지금 저장소에 있는 북웨이브 코드의 상태

| 대상 | 상태 | 교체 시 |
|---|---|---|
| `services/bookwave-app/src/main/java/**` | 기존 구현 그대로 (이번 작업에서 변경 없음) | 필요하면 통째로 교체 가능 |
| `services/bookwave-app/src/main/resources/static/**` | **해온카드 담당이 만든 임시 자리채움 화면** | 지우거나 덮어쓰면 됨 |
| `services/bookwave-app/src/test/**` | 기존 테스트 그대로 | 교체 시 함께 판단 |

임시 화면(`index.html` / `bookwave.css` / `bookwave.js`)의 도서 목록·가격·베스트셀러는
전부 지어낸 표시용 값이다. 해온카드 쪽에서 "결제를 시작할 가맹점 화면"이 필요해 만든 것이고,
백엔드와 해온카드 서비스는 이 파일들에 의존하지 않는다.

```bash
# 실제 화면으로 교체할 때
rm services/bookwave-app/src/main/resources/static/{index.html,bookwave.css,bookwave.js}
# 그 자리에 북웨이브 화면을 넣고
docker compose --env-file .env build bookwave-app
docker compose --env-file .env up -d bookwave-app
```

화면을 아예 두지 않아도 백엔드 계약 시험은 `tools/payment-flow-contract-check.sh`로 돈다.

---

## 2. 반드시 맞춰야 하는 연동 계약

| 항목 | 값 | 강제하는 곳 |
|---|---|---|
| 호출 경로 | 북웨이브 → `mock-pg` → 해온카드. 북웨이브가 해온카드를 **직접 호출하지 않는다** | Compose 네트워크(`card_net` 내부 전용). 북웨이브는 이 망에 붙지 않는다 |
| 가맹점 인증 | `Authorization: Bearer <HAEON_MERCHANT_TOKEN>` (mock-pg가 붙임) | `ApprovalService.resolveMerchantNo` |
| 가맹점 식별 | `MOCK_PG_MERCHANT_NO=BOOKWAVE-LAB` + `merchants` 테이블의 같은 `merchant_no` 행 | 해온카드 DB FK |
| 카드 토큰 | `^card-token-lab-[A-Za-z0-9_-]+$`, `cards.card_token`에 실재해야 함 | 세 서비스 `@Pattern` + FK |
| 금액 | 1 이상 10,000,000 이하 **정수** | 3장 참고 |
| 통화 | `KRW`만 | 세 서비스 `@Pattern` + DB CHECK |
| 추적 | `X-Correlation-Id` 헤더 = 본문 `correlationId` (`[A-Za-z0-9_-]{8,80}`) | 헤더·본문 불일치 시 `400 INVALID_CORRELATION_ID` |
| 멱등 | `Idempotency-Key` 헤더 = 본문 `merchantRequestId` (`[A-Za-z0-9_-]{1,80}`) | 불일치 시 `400 INVALID_IDEMPOTENCY_KEY` |

> **승인 여부는 해온카드가 정한다.** 요청 본문에 `decision`을 넣어도 무시된다.
> 본문의 `merchantNo`도 v0.1 호환용 필드일 뿐, 실제 가맹점 주체는 Bearer 토큰에서만 나온다.

### 요청 예시 (북웨이브 → 자기 자신의 `/api/v1/payments`)

```http
POST /api/v1/payments
Content-Type: application/json
X-Correlation-Id: BW-FLOW-20260917-0001
Idempotency-Key: BW-REQ-20260917-0001
```

```json
{
  "correlationId": "BW-FLOW-20260917-0001",
  "orderNo": "BW-ORDER-20260917-0001",
  "merchantRequestId": "BW-REQ-20260917-0001",
  "amount": 21000,
  "currency": "KRW",
  "paymentMethodToken": "card-token-lab-001"
}
```

### 응답 (200)

```json
{
  "correlationId": "BW-FLOW-20260917-0001",
  "orderNo": "BW-ORDER-20260917-0001",
  "paymentId": "PAY-LAB-889fb609050d",
  "pgTid": "PG-LAB-8dfb0ee7a47b",
  "decision": "APPROVED",
  "approvedAmount": 21000,
  "authorizationNo": "AUTH-HC-106f062768ad4e8c",
  "reasonCode": "APPROVED"
}
```

`decision`이 `DECLINED`면 `approvedAmount`는 `0`이고 `reasonCode`는 `LIMIT_EXCEEDED`
또는 `CARD_BLOCKED`다. **거절은 HTTP 200이다.** 오류가 아니라 정상 판정 결과다.

---

## 3. 금액 상한은 북웨이브가 먼저 막아야 한다

`mock-pg`의 `amount`에는 상한 검증이 없다. 상한은 **북웨이브(`@Max(10000000)`)**와
**해온카드(`@Max` + DB CHECK)** 두 곳에만 있다.

북웨이브가 선검증을 빼면 10,000,000 초과 요청이 해온카드까지 내려가 DB CHECK 위반이 되고,
`mock-pg`를 거치며 `502 UPSTREAM_ERROR` + `retryable: true`로 되돌아온다. 영구 오류인데
"재시도 가능"으로 잘못 표기되는 상태다(이전 세션 이슈 A, 커밋 `d4ed366`에서 선검증 추가).

교체 구현에서도 **상한 선검증을 유지**하고, 초과 시 `400 INVALID_REQUEST` /
`retryable: false`로 돌려주기를 권한다.

---

## 4. 오류 코드

| HTTP | errorCode | retryable | 상황 |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | false | 필수값 누락, 형식 위반, 금액 상한 초과 |
| 400 | `INVALID_CORRELATION_ID` | false | 헤더와 본문의 `correlationId` 불일치 |
| 400 | `MISSING_IDEMPOTENCY_KEY` | false | `Idempotency-Key` 헤더 없음 |
| 400 | `INVALID_IDEMPOTENCY_KEY` | false | 헤더와 `merchantRequestId` 불일치 |
| 409 | `IDEMPOTENCY_CONFLICT` | false | 같은 키에 다른 주문·금액 |
| 502 | `UPSTREAM_ERROR` | 상황별 | 다음 서비스의 응답 오류 |
| 503 | `UPSTREAM_UNAVAILABLE` | true | 다음 서비스 연결 불가 |
| 500 | `INTERNAL_ERROR` | false | 내부 오류 |

본문 모양:

```json
{ "correlationId": "...", "errorCode": "INVALID_REQUEST", "message": "...", "retryable": false }
```

주문 상태는 북웨이브 쪽 `OrderStatus`로 `PAYMENT_PENDING` → `PAID` / `PAYMENT_DECLINED` /
`PAYMENT_UNKNOWN`을 쓴다. 상류 호출이 실패하면 결과를 추측하지 않고 `PAYMENT_UNKNOWN`으로
남기는 것이 현재 기준 동작이다.

---

## 5. 멱등 재시도 규칙

같은 `merchantRequestId`로 다시 보내면 세 서비스 모두 **처음 결과를 그대로** 돌려준다.
`paymentId` · `pgTid` · `authorizationNo`가 바뀌지 않아야 정상이고, 해온카드에 승인·거래가
두 건 생기면 안 된다.

- 재시도할 때 `merchantRequestId`를 새로 만들면 **별개 결제**가 된다. 화면에서 "다시 시도"를
  만들 때 주의한다.
- 같은 키에 금액이나 주문번호를 바꿔 보내면 `409 IDEMPOTENCY_CONFLICT`다.

---

## 6. 해온카드 쪽에서 결과를 확인하는 법

북웨이브 결제가 성공하면 해온카드 회원 포털에서 같은 승인번호로 보인다.

```bash
TOKEN=$(curl -s -X POST http://localhost:8085/portal/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"loginId":"haeon01","password":"Haeon!2026"}' \
  | python3 -c 'import json,sys;print(json.load(sys.stdin)["sessionToken"])')

curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:8085/portal/v1/me/transactions?limit=5'
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8085/portal/v1/me/cards
```

이용내역의 가맹점명은 `merchants.name` 값이다. 가맹점명을 바꾸고 싶으면
`merchants` 행의 `name`만 고치면 되고, `merchant_no`(`BOOKWAVE-LAB`)는 인증 주체이므로
바꾸려면 `MOCK_PG_MERCHANT_NO`·`HAEON_MERCHANT_NO`와 DB 행을 함께 맞춰야 한다.

포털 조회 API는 **로그인 세션의 회원에 연결된 카드만** 돌려준다. 북웨이브가 이 API를
호출할 일은 없다. 회원 본인이 브라우저로 쓰는 화면 전용이다.

### 북웨이브 화면에서 해온카드로 보내고 싶다면

회원 포털 주소는 `http://<host>:8085/`이고 마이페이지는 `#mypage` 앵커다.
현재 임시 화면은 `bookwave.js`의 `PORTAL_PORT` 상수로 이 주소를 만든다. 포트를 바꾸려면
`HAEON_PORTAL_PORT`(`.env`)와 함께 맞춘다.

---

## 7. 합성 카드 토큰과 회원

| 카드 토큰 | 표시 | 소유 회원 | 한도 |
|---|---|---|---|
| `card-token-lab-001` | 해온 플러스 `**** 0001` (주) | `HC-MEMBER-001` 김해온 | 100,000 합성 결제 기준값 |
| `card-token-lab-002` | 해온 데일리 `**** 0002` | `HC-MEMBER-001` | 3,000,000 |
| `card-token-lab-003` | 해온 트래블 `**** 0003` | `HC-MEMBER-001` | 2,000,000 |
| `card-token-lab-011` | 해온 데일리 `**** 0011` | `HC-MEMBER-002` 이해온 | 1,500,000 |

- `card-token-lab-001`은 카드 API·결제 왕복 회귀용 합성 카드다. 진단 시나리오는 전용 `lab_` 자료를 사용한다.
  **일반 결제 시연에는 `002`를 쓰는 편이 안정적이다.**
- 새 카드가 필요하면 `db/haeon-card/fixtures/006_portal_seed.sql`에 추가한다. 카드 행과
  `card_limits` 행을 **같이** 만들어야 하고, 한도 행이 없으면 승인이 거부된다.
- 포털 로그인 계정은 `haeon01` / `haeon02`, 비밀번호는 둘 다 `Haeon!2026` (합성 값).

---

## 8. 교체 후 확인 체크리스트

```bash
# 1) 전체 왕복 + 멱등 + 세 서비스 correlationId 연결
bash tools/payment-flow-contract-check.sh

# 2) 카드 API 계약 (8084 디버그 포트 필요)
docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card
HAEON_CARD_URL=http://localhost:8084 bash tools/card-api-contract-check.sh

# 3) 포트·네트워크 경계
bash tools/network-port-security-check.sh
```

- [ ] 정상 결제가 `APPROVED`로 돌아오고 `authorizationNo`가 채워진다
- [ ] 같은 `merchantRequestId` 재시도에서 `paymentId`·`pgTid`·`authorizationNo`가 그대로다
- [ ] 한도 초과가 HTTP 200 + `DECLINED` / `LIMIT_EXCEEDED`로 온다 (오류 아님)
- [ ] 금액 10,000,001이 `400 INVALID_REQUEST` / `retryable:false`로 막힌다
- [ ] 필수값 누락이 `400 INVALID_REQUEST`다
- [ ] 북웨이브 컨테이너가 `card_net`에 붙어 있지 않다
- [ ] 해온카드 마이페이지 이용내역에 같은 승인번호가 보이고 잔여한도가 줄어 있다
- [ ] `network-port-security-check.sh`가 `PASS`다

---

## 9. 바꿀 때 같이 고쳐야 하는 문서

| 바꾸는 것 | 함께 고칠 문서 |
|---|---|
| 결제 API 경로·필드·상태값 | `docs/contracts/api-contract-v0.1.md` + `docs/contracts/openapi.yaml` |
| 포털 조회 API | `docs/contracts/haeon-card-portal-api-v0.1.md` + `openapi.yaml` |
| 가맹점 번호·토큰 | `.env.example`, `compose.yaml`, `006_portal_seed.sql` |
| 카드 토큰·한도 | `db/haeon-card/fixtures/006_portal_seed.sql`, 시연 런북 |
| 호스트 포트 | `.env.example`, `compose.yaml`, `tools/network-port-security-check.sh` |

계약 변경은 코드보다 문서를 먼저 고친다. 하위 호환이 필요한 변경은 `v0.2`로 올리고 기존
필드를 바로 지우지 않는다.
