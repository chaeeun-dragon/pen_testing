# bookwave-app

북웨이브의 결제 접수 서비스다. 주문·상품 전체를 구현하기 전에 `결제 요청 -> Mock PG -> 결과 반환`의 최소 흐름을 검증하기 위한 뼈대다.

## API

```text
POST /api/v1/payments
GET  /actuator/health
```

## 브라우저 화면

컨테이너가 실행되면 `http://localhost:8080/`에서 해온카드 개인 홈페이지 형태의 화면을
열 수 있다. 카드·혜택·금융·라이프 메뉴와 MY 요약 영역을 제공하며, 빠른 메뉴의
`즉시결제`에서 주문번호·금액·테스트 카드 토큰을 입력하고 결제 요청을 보낼 수 있다.
요청은 같은 출처의 `POST /api/v1/payments`를 호출한다. 실제 카드번호는 사용하지 않으며,
승인 결과의 `paymentId`, `pgTid`, `authorizationNo`, `correlationId`를 모달에서 확인한다.

`같은 요청 다시 보내기` 버튼은 동일한 `merchantRequestId`를 재사용해 멱등 재시도를
눈으로 확인하는 용도다. 실패 시에는 서버가 돌려준 오류 코드와 메시지를 함께 보여준다.

초기 화면은 비로그인 상태의 로그인 폼을 표시한다. 실제 인증 API를 연결할 때 인증 성공
후 프론트에서 `window.haeonCardUi.setLoggedIn(true, {name, cardName})`을 호출하면
`MY 해온` 요약 화면으로 전환된다. 로그아웃 시에는 `setLoggedIn(false)`를 호출한다.

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
