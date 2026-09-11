# 해온카드 승인 코어

CARD-03 동시 승인·한도 이중 사용 시나리오를 위한 Java 21 + Spring Boot 서비스 뼈대다.

## 현재 범위

- 포트: `8084`
- DB: Compose 내부 `haeon-card-mysql:3306`
- 네트워크: 기본 실행 시 `haeon_card_net`·`lab_audit_net` 내부 전용
- JDBC와 MySQL 드라이버를 포함한 기본 런타임
- `/actuator/health` 제공
- `/internal/v1/authorizations`는 DB 기준 승인·거절과 승인 거래·감사 기록을 처리한다.

현재 요청 호환성을 위해 `merchantNo` 본문을 받지만, `Authorization: Bearer lab-merchant-bookwave`가 있으면 서버 설정의 합성 가맹점 주체를 사용한다. 실제 인증 비밀은 사용하지 않는다.

이미 생성된 MySQL 볼륨에는 init 파일이 다시 실행되지 않는다. 그런 경우에는 증거를 보존한 뒤 다음처럼 fixture를 한 번 적용한다.

```bash
docker compose exec -T haeon-card-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < /docker-entrypoint-initdb.d/002_card03_baseline.sql'
```

`haeon-card` 요청이 `403 MERCHANT_NOT_ALLOWED`를 반환하면 인증 토큰보다 기준 fixture 누락을 먼저 확인한다. 기존 볼륨에서는 위 명령을 실행한 뒤 smoke test를 다시 수행한다.

## 구현 순서

1. API 계약과 Bearer 가맹점 주체를 확정한다.
2. 기존 H0 DDL의 7개 테이블에 합성 fixture를 넣는다.
3. 정상 승인 트랜잭션을 구현한다.
4. `before` 프로파일에서 읽기 장벽과 재검사 없는 증가를 재현한다.
5. 기본 `normal`/`after` 프로파일에서 `card_limits` 행 잠금과 최신 한도 기준 판정을 확인한다.

실제 카드번호·CVC·금융망 자격증명은 사용하지 않는다. `before` 장벽은 정상 왕복 확인 후 동시 요청 실습에서만 켠다.

## localhost:8084 디버깅

기본 `compose.yaml`에서는 Haeon 카드에 호스트 포트를 게시하지 않는다. 결제 흐름은
`mock-pg -> haeon-card` 내부 Docker DNS(`http://haeon-card:8084`)로 동작해야 하며,
이 구성이 서비스 간 신뢰 경계를 보존한다.

Docker Engine/WSL에서 `internal` 네트워크에만 붙은 컨테이너는 `ports`를 적어도
호스트 리스너가 만들어지지 않는 경우가 있다. 호스트에서 브라우저나 `curl`로
직접 확인해야 할 때만 디버그 오버라이드를 사용한다. 오버라이드는 Haeon만 별도
디버그 네트워크에 잠시 연결하고, 다른 서비스는 그 네트워크에 연결하지 않는다.

```bash
docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card

curl --max-time 5 http://127.0.0.1:8084/actuator/health
```

디버깅이 끝나면 내부 전용 기본 구성으로 되돌린다.

```bash
docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  rm -sf haeon-card
docker compose --env-file .env up -d haeon-card
```

기본 구성에서 상태를 확인할 때는 임시 컨테이너를 `haeon_card_net`에 붙인다.

```bash
docker run --rm --network haeon_card_net busybox:1.36 \
  wget -qO- http://haeon-card:8084/actuator/health
```

`LAB_PROFILE=before`와 `BEFORE_BARRIER_ENABLED=true` 조합은 같은 카드에 동시에 들어오는 두 요청 A/B에만 사용한다. 일반 요청을 한 건만 보내면 장벽 제한 시간 후 실패하므로, 운영 프로파일이나 기본 `normal`에 켜지 않는다.

## CARD-03 실행 순서

아래 명령은 프로젝트 루트(`/mnt/c/study/docker/bookwave-haeon-lab`)에서 실행한다.

기본 `normal`과 `after`는 한도 행을 `SELECT ... FOR UPDATE`로 잠근 뒤 최신 값을 기준으로 판정한다. `after`는 개선된 동작을 구분해 기록하기 위한 프로파일 이름이며, 일반 승인 흐름과 같은 안전한 잠금 경로를 사용한다.

### 정상 승인·멱등 smoke test

컨테이너를 처음 올린 뒤에는 동시성보다 먼저 다음 스크립트로 정상 왕복과 같은 키 재시도를 확인한다.

```bash
bash tools/haeon-card-smoke.sh
```

`first-response.json`과 `replay-response.json`의 `authorizationId`가 같고, DB에 승인 1건·거래 1건만 남으면 정상이다. 실행 결과는 `evidence/runs/HC-SMOKE-.../`에 저장된다.

### 1) 기준선 복원

```bash
docker compose exec -T haeon-card-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < /docker-entrypoint-initdb.d/003_card03_reset.sql'
```

### 2) Before 재현

두 요청을 동시에 보내야 하므로, 먼저 카드 서비스를 실습 프로파일로 다시 올린다.

```bash
LAB_PROFILE=before BEFORE_BARRIER_ENABLED=true \
  docker compose --env-file .env up -d --build haeon-card
LAB_PROFILE=before bash tools/card03-concurrency.sh
```

두 응답이 모두 `APPROVED`여도 실습상 예상 결과다. 초기 한도 100,000원보다 큰 160,000원이 `card_limits.used_amount`에 기록되는지 확인한다.

### 3) After 확인

```bash
docker compose exec -T haeon-card-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < /docker-entrypoint-initdb.d/003_card03_reset.sql'
LAB_PROFILE=after BEFORE_BARRIER_ENABLED=false \
  docker compose --env-file .env up -d --build haeon-card
LAB_PROFILE=after bash tools/card03-concurrency.sh
```

두 요청 중 하나만 승인되고, 다른 요청은 `LIMIT_EXCEEDED`가 되어 사용액이 80,000원에 머무르는 것이 기대 결과다.

### 4) 증거 확인

```bash
docker compose exec -T haeon-card-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" -e \
  "SELECT card_id, limit_amount, used_amount, version FROM card_limits; \
   SELECT status, decision_code, COUNT(*) AS count FROM authorization_requests GROUP BY status, decision_code; \
   SELECT COALESCE(SUM(amount), 0) AS approved_total FROM card_transactions;"'
```

요청 응답과 `run.json`은 `evidence/runs/HC03-.../requests/`에 남는다. 로그의 `event=limit_read`에서 `mode=before|after`를, 승인 확정 로그에서 같은 `correlationId`를 확인한다.
