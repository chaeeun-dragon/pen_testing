# mock-pg

북웨이브와 해온카드 사이의 합성 결제 중계 서비스다. 실제 PG나 금융망에 연결하지 않는다.

## 책임

- 북웨이브 결제 요청을 받는다.
- `BOOKWAVE-LAB` 합성 가맹점 번호를 서버 설정에서 선택한다.
- `pgTid`와 `paymentId`를 발급한다.
- 해온카드의 승인 API만 호출한다.
- 같은 `merchantRequestId` 재시도는 기존 결과를 반환한다.
- 카드 내부 값(`remainingLimit`)은 북웨이브 응답에 노출하지 않는다.

## API

```text
POST /internal/v1/pg/charges
GET  /actuator/health
GET  /internal/v1/pg/health
```

요청에는 다음 헤더가 필요하다.

```http
X-Correlation-Id: corr-20260909-0001
Idempotency-Key: BW-REQ-0001
```

`Idempotency-Key`는 본문의 `merchantRequestId`와 같아야 한다. 카드번호·CVC 대신 `card-token-lab-*`만 사용한다.

## 로컬 실행

```bash
mvn spring-boot:run
curl http://localhost:8083/actuator/health
```

해온카드 주소는 `HAEON_CARD_BASE_URL`로 바꾼다. Compose 안에서는 기본값이 `http://haeon-card:8084`다.

## 현재 제한

- 멱등 결과는 프로세스 메모리에만 저장한다. 재시작 후 보존이 필요해지면 전용 PG 거래 저장소를 추가한다.
- `before/after` 오류 주입 훅은 아직 켜지지 않는다. 정상 왕복을 통과한 뒤 별도 테스트 프로파일로 추가한다.
- 내부 서비스 인증(mTLS·서비스 토큰)은 격리된 로컬 랩 기준선 이후에 추가한다.
