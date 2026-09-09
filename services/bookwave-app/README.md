# bookwave-app

북웨이브의 결제 접수 서비스다. 주문·상품 전체를 구현하기 전에 `결제 요청 -> Mock PG -> 결과 반환`의 최소 흐름을 검증하기 위한 뼈대다.

## API

```text
POST /api/v1/payments
GET  /actuator/health
```

요청 헤더:

```http
X-Correlation-Id: corr-20260909-0001
Idempotency-Key: BW-REQ-0001
```

요청 본문:

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

## 실행

Compose 안에서는 Mock PG 주소가 `http://mock-pg:8083`으로 자동 설정된다.

```bash
docker compose --env-file .env build bookwave-app
docker compose --env-file .env up -d bookwave-app
curl http://localhost:8080/actuator/health
```

해온카드 승인 API가 아직 없는 경우에는 Mock PG가 503 또는 502 오류를 반환할 수 있다. 이는 북웨이브가 결제 결과를 추측하지 않고 흐름을 중단하는 정상적인 기준 동작이다.

## 현재 제한

- 주문 상태와 멱등 결과는 메모리에만 저장한다. Bookwave DDL이 확정되면 저장소를 `bookwave-mysql`로 교체한다.
- 결제 콜백·환불·취소는 이 뼈대 범위에 포함하지 않는다.
- 실제 카드번호·CVC·금융망은 사용하지 않는다.
