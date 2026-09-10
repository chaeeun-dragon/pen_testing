# API 오류 카탈로그 v0.1

이 문서는 `api-contract-v0.1.md`에서 사용하는 오류 코드의 쉬운 설명과 처리 방법을 정리한다.

| 오류 코드 | HTTP | 설명 | 다시 시도 |
|---|---:|---|---|
| `INVALID_REQUEST` | 400 | 필수값 누락, 금액 0 이하, 통화 오류 | 수정 후 다시 요청 |
| `INVALID_CORRELATION_ID` | 400 | 헤더와 본문의 추적 ID가 다름 | 아니오 |
| `MISSING_IDEMPOTENCY_KEY` | 400 | 중복 방지 키가 없음 | 키를 넣고 다시 요청 |
| `MERCHANT_NOT_ALLOWED` | 403 | 등록되지 않은 가맹점 | 아니오 |
| `IDEMPOTENCY_CONFLICT` | 409 | 같은 키에 다른 주문·금액이 사용됨 | 아니오 |
| `DUPLICATE_REQUEST` | 409 | 이미 처리한 요청과 충돌 | 기존 결과 조회 |
| `UPSTREAM_ERROR` | 502 | 다음 서비스가 잘못된 응답을 반환 | 정책에 따라 1회 |
| `UPSTREAM_UNAVAILABLE` | 503 | 다음 서비스와 연결되지 않음 | 같은 키로 1회 |
| `BEFORE_BARRIER_TIMEOUT` | 503 | Before 동시성 실습의 짝 요청이 제한 시간 안에 오지 않음 | 실습 설정 확인 후 다시 실행 |
| `INTERNAL_ERROR` | 500 | 예상하지 못한 내부 오류 | 로그 확인 후 결정 |

## 처리 원칙

1. 오류 응답에도 `correlationId`를 반드시 넣는다.
2. 같은 `Idempotency-Key`로 재시도한다. 새 키를 만들면 중복 결제를 만들 수 있다.
3. 4xx는 요청을 고친 뒤 다시 요청한다.
4. 5xx는 최대 1회만 재시도하고, 계속 실패하면 실행을 중단하고 증거를 남긴다.
5. 실제 카드정보나 비밀값을 오류 메시지에 넣지 않는다.
