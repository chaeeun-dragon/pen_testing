# 해온카드 로컬 API 필드 매핑·호환성 검증 v0.2

작성일: 2026-09-15
범위: 카드사 승인 시나리오 전용
기준 API: 현재 프로젝트에서 만든 합성 해온카드 API
제외 범위: 북웨이브 챗봇·SSRF·업로드 시나리오

## 1. 결론

팀장님 API를 기다리지 않고도 카드사 승인 시나리오 개발을 진행할 수 있도록,
현재 해온카드 API를 **기준 API**로 사용한다. 북웨이브의 결제 서비스는 카드 API를
직접 알지 못하고, Mock PG의 게이트웨이와 매퍼만 알고 있다.

```text
Bookwave PaymentRequest
        │
        ▼
CardAuthorizationMapper
        │  (북웨이브 → 해온카드 요청)
        ▼
CardAuthorizationGateway
        │
        ▼
HaeonCardAuthorizationClient
        │  POST /internal/v1/authorizations
        ▼
해온카드 AuthorizationResponse
        │
        ▼
PaymentResultMapper
        │  (해온카드 응답 → 북웨이브 응답)
        ▼
Bookwave PaymentResult
```

팀장님 API를 받으면 `CardAuthorizationGateway`의 새 구현체와 요청·응답 DTO 매퍼만
추가한다. `PaymentService`, `MockPgService`, 북웨이브 화면과 증거 형식은 그대로
유지하는 것을 목표로 한다.

## 2. 현재 로컬 기준 필드

### 요청 매핑

| 북웨이브 결제 요청 | 해온카드 승인 요청 | 규칙 |
|---|---|---|
| `correlationId` | `correlationId` | 헤더와 본문이 같아야 함 |
| `merchantRequestId` | `merchantRequestId` | `Idempotency-Key`와 같아야 함 |
| `paymentMethodToken` | `cardToken` | `card-token-lab-*` 합성 토큰만 사용 |
| `amount` | `amount` | 원 단위 양의 정수 |
| `currency` | `currency` | 현재 `KRW`만 허용 |
| 설정값 `BOOKWAVE-LAB` | `merchantNo` | 클라이언트가 임의 선택하지 않음 |
| Mock PG 생성값 | `requestFingerprint` | SHA-256 64자리 |
| Mock PG 생성값 | `requestedAt` | UTC 시각 |

### 응답 매핑

| 해온카드 응답 | 북웨이브 결제 응답 | 외부 노출 |
|---|---|---|
| `correlationId` | `correlationId` | 노출 |
| `authorizationNo` | `authorizationNo` | 노출 |
| `decision` | `decision` | 노출 |
| `approvedAmount` | `approvedAmount` | 노출 |
| `reasonCode` | `reasonCode` | 노출 |
| `authorizationId` | 내부 저장·증거 | 북웨이브 화면에는 미노출 |
| `remainingLimit` | 없음 | 카드 내부 정보라 미노출 |
| Mock PG 생성 `paymentId` | `paymentId` | 노출 |
| Mock PG 생성 `pgTid` | `pgTid` | 노출 |

응답 변환은 `PaymentResultMapper`가 담당한다. 카드사가 반환하는 내부 한도 값이
북웨이브 결제 응답으로 새어 나가지 않는지 단위 테스트로 확인한다.

## 3. 호환성 검증 항목

`tools/card-api-contract-check.sh`는 합성 데이터로 다음을 자동 확인한다.

1. 정상 승인: HTTP 200, `APPROVED`, 승인 금액·승인번호 존재
2. 같은 요청 재시도: HTTP 200, 같은 `authorizationId`
3. 한도 초과: HTTP 200, `DECLINED`, `LIMIT_EXCEEDED`, 승인 금액 0
4. 멱등키 충돌: 같은 키에 다른 지문을 보내면 HTTP 409
5. 결과 필드 위조 방어: 요청의 `decision`, `approvedAmount`, `authorizationNo`를 무시
6. 잘못된 가맹점 토큰: HTTP 403, `MERCHANT_NOT_ALLOWED`
7. `mapping-check.json`에 요청·응답 매핑과 내부 한도 미노출 결과 저장

기준선은 합성 카드 DB의 `card_limits.used_amount=0`으로 복원한 후 실행한다.

```bash
docker compose exec -T haeon-card-mysql sh -c \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" \
   < /docker-entrypoint-initdb.d/003_haeon_payment_baseline.sql'

HAEON_CARD_URL=http://172.27.0.4:8084 \
bash tools/card-api-contract-check.sh
```

생성되는 증거 폴더에는 요청·응답 JSON, `mapping-check.json`, `run.json`이 남는다.

## 4. 팀장님 API 교체 절차

팀장님 API를 받으면 다음 순서로 교체한다.

1. URL·인증 방식·요청/응답 JSON을 별도 계약 문서로 고정한다.
2. `TeamCardAuthorizationClient`를 `CardAuthorizationGateway` 구현체로 추가한다.
3. 팀장님 API 요청을 현재 `AuthorizationRequest` 의미로 변환한다.
4. 팀장님 API 응답을 현재 `AuthorizationResult` 의미로 변환한다.
5. 환경 변수로 게이트웨이 구현체와 URL을 선택한다.
6. 승인·재시도·거절·충돌·위조 필드 테스트를 같은 증거 형식으로 재실행한다.
7. 매핑이 바뀐 경우 이 문서, OpenAPI, 예시 JSON을 한 커밋에서 함께 갱신한다.

팀장님 API를 받기 전에는 외부 금융망이나 실제 카드정보를 연결하지 않는다.
