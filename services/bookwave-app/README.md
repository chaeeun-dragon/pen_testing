# bookwave-app

북웨이브의 결제 접수 서비스다. 주문·상품 전체를 구현하기 전에 `결제 요청 -> Mock PG -> 결과 반환`의 최소 흐름을 검증하기 위한 뼈대다.

## API

```text
POST /api/v1/payments
GET  /actuator/health
```

## 브라우저 화면 (연동 확인용 임시 화면)

> `src/main/resources/static/`의 `index.html` · `bookwave.css` · `bookwave.js`는
> **북웨이브 담당자의 실제 화면이 들어오기 전까지 쓰는 자리채움**이다. 해온카드 쪽에서
> 결제를 시작할 가맹점 화면이 필요해 만든 것이고, 도서 목록·가격은 전부 표시용 값이다.
> 실제 화면으로 교체할 때는 이 세 파일을 지우거나 덮어쓰면 된다. `POST /api/v1/payments`
> 백엔드와 해온카드 서비스는 이 파일들에 의존하지 않는다.
> 교체 시 맞춰야 하는 계약은 `docs/handoff/bookwave-merchant-integration-handoff-v0.1.md`에 있다.

컨테이너가 실행되면 `http://localhost:8080/`에서 북웨이브 온라인 서점 화면을 열 수 있다.
도서를 고르면 주문서가 열리고, 결제 금액과 결제 카드를 확인한 뒤 결제를 요청한다.
요청은 같은 출처의 `POST /api/v1/payments`를 호출하며, 결과의 `paymentId`, `pgTid`,
`authorizationNo`, `correlationId`를 주문서에서 바로 확인한다.

결제 시작은 북웨이브만 담당한다. 승인·거절 결과는 해온카드 승인 DB에 기록되고, 회원은
해온카드 홈페이지(`http://localhost:8085/`) 마이페이지의 이용내역에서 같은 승인번호로 확인한다.

`같은 주문 결과 재조회` 버튼은 동일한 `merchantRequestId`를 재사용해 멱등 재시도를
눈으로 확인하는 용도다. 실패 시에는 서버가 돌려준 오류 코드와 메시지를 함께 보여준다.
실제 카드번호는 사용하지 않으며, 주문서의 결제 카드 목록은 합성 카드 토큰을 가리킨다.

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
