# 해온카드 승인 코어

CARD-03 동시 승인·한도 이중 사용 시나리오를 위한 Java 21 + Spring Boot 서비스 뼈대다.

## 현재 범위

- 승인 포트: `8084` (가맹점 전용, 호스트에 게시하지 않음)
- 회원 포털 포트: `8085` (`127.0.0.1:8085`로 게시)
- DB: Compose 내부 `haeon-card-mysql:3306`
- 네트워크: `haeon_card_net`·`lab_audit_net`(내부 전용) + `haeon_card_portal_net`(포털 포트 게시용, 이 서비스만 연결)
- JDBC와 MySQL 드라이버를 포함한 기본 런타임
- `/actuator/health` 제공 (두 포트 모두)
- `/internal/v1/authorizations`는 DB 기준 승인·거절과 승인 거래·감사 기록을 처리한다.
- `/portal/v1/**`와 회원 홈페이지 화면은 조회만 한다. 승인 상태를 바꾸지 않는다.

### 포트별 노출 경계

`PortConfinementFilter`가 요청이 들어온 로컬 포트로 경로를 가른다.

| 포트 | 응답하는 경로 | 404로 막는 경로 |
|---|---|---|
| 8084 (승인) | `/internal/**`, `/actuator/**` | `/portal/**`, 회원 화면 정적 파일 |
| 8085 (포털) | `/portal/**`, 회원 화면, `/actuator/**` | `/internal/**` |

포털 포트가 호스트에 열려 있어도 가맹점 승인 API는 그 포트로 도달하지 못한다.
승인 API는 여전히 `mock-pg`만 내부망으로 호출한다.

현재 요청 호환성을 위해 `merchantNo` 본문을 받지만, `Authorization: Bearer lab-merchant-bookwave`가 있으면 서버 설정의 합성 가맹점 주체를 사용한다. 실제 인증 비밀은 사용하지 않는다.

이미 생성된 MySQL 볼륨에는 init 파일이 다시 실행되지 않는다. 그런 경우에는 증거를 보존한 뒤 다음처럼 fixture를 한 번 적용한다.

```bash
docker compose exec -T haeon-card-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < /docker-entrypoint-initdb.d/002_card03_baseline.sql'
```

`haeon-card` 요청이 `403 MERCHANT_NOT_ALLOWED`를 반환하면 인증 토큰보다 기준 fixture 누락을 먼저 확인한다. 기존 볼륨에서는 위 명령을 실행한 뒤 smoke test를 다시 수행한다.

## 회원 포털 (마이페이지)

화면은 두 개다.

| 주소 | 화면 | 내용 |
|---|---|---|
| `/` | 홈 | 카드·혜택·금융·라이프 안내, 우측 MY 패널의 로그인과 요약 |
| `/mypage` | 마이페이지 | 회원 정보, 카드별 이용한도·이용금액·잔여한도, 최근 승인·거절 이용내역 |

회원 조회 영역은 랜딩에 두지 않는다. 상단 `MY` 메뉴·빠른 메뉴·MY 패널 버튼이 모두 `/mypage`로
이동하고, 로그아웃 상태로 들어오면 그 화면에서 바로 로그인한다. 성공하면 주소를 옮기지 않고
같은 자리에서 조회 화면으로 바뀐다. `/mypage`는 `PortalViewConfig`가 `mypage.html`로 연결한다.

결제 시작 화면은 어느 쪽에도 없다. 결제는 북웨이브(`http://localhost:8080/`)에서만 시작하며,
그 결과가 해온카드 승인 DB에 기록되어 마이페이지에 나타난다.

화면 점검은 실제 브라우저로 도는 `bash tools/portal-ui-check.sh`를 쓴다.

### 합성 로그인 계정

| 로그인 아이디 | 비밀번호 | 회원 | 보유 카드 |
|---|---|---|---|
| `haeon01` | `Haeon!2026` | 김해온 (HC-MEMBER-001) | `**** 0001` 해온 플러스(주), `**** 0002` 해온 데일리, `**** 0003` 해온 트래블 |
| `haeon02` | `Haeon!2026` | 이해온 (HC-MEMBER-002) | `**** 0011` 해온 데일리 |

비밀번호는 `SHA-256(salt || password)` hex로만 저장한다. 세션 토큰도 원문이 아니라 해시를
`member_sessions`에 넣는다. 합성 계정 전용이며 실제 개인정보·자격증명은 쓰지 않는다.

### 조회 API

```text
POST   /portal/v1/sessions          로그인 -> sessionToken 발급
DELETE /portal/v1/sessions          로그아웃 (Authorization: Bearer <sessionToken>)
GET    /portal/v1/me                회원 정보
GET    /portal/v1/me/cards          보유 카드와 한도·사용액·잔여한도
GET    /portal/v1/me/transactions   최근 승인·거절 내역 (?limit=, 기본 20, 최대 100)
```

조회 대상 회원은 항상 세션 토큰에서 나온다. 요청 본문이나 질의 문자열로 회원·카드를
지정할 수 없으므로, 로그인한 회원에 연결된 카드와 그 카드의 승인 내역만 응답한다.

```bash
TOKEN=$(curl -s -X POST http://localhost:8085/portal/v1/sessions \
  -H 'Content-Type: application/json' \
  -d '{"loginId":"haeon01","password":"Haeon!2026"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["sessionToken"])')

curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8085/portal/v1/me/cards
curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:8085/portal/v1/me/transactions?limit=20'
```

`card_limits.version`은 CARD-03 증거·운영 확인용으로만 DB에 보관하며 회원 응답과 화면에
넣지 않는다. 이용한도·사용액·잔여한도는 회원 화면에 그대로 표시한다.

### 포털 스키마와 합성 데이터

기존 볼륨에는 init 파일이 다시 실행되지 않으므로 한 번만 직접 적용한다. 세 파일 모두
재실행해도 결과가 같다.

```bash
for f in db/haeon-card/init/004_portal_schema.sql \
         db/haeon-card/fixtures/006_portal_seed.sql \
         db/haeon-card/fixtures/007_portal_history_seed.sql; do
  docker exec -i bookwave-haeon-lab-haeon-card-mysql-1 \
    sh -c 'mysql -uroot -proot_lab_only haeon_card' < "$f"
done
```

CARD-03 기준선 복원(`003`/`004`)은 승인 데이터를 모두 지우므로 마이페이지 이용내역도
함께 비워진다. 화면 내역이 다시 필요하면 `007_portal_history_seed.sql`을 이어서 실행한다.
이 시드는 `haeon01`의 과거 승인 13건·거절 3건(총 16건)과 카드 한도 사용액을 함께 복원한다.
기준선 복원은 `card-token-lab-001`의 한도만 실습 값으로 되돌리고, 나머지 카드의 한도는
그대로 둔 채 사용액만 0으로 맞춘다.

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

### 카드 API 계약 확인

필드 매핑과 인증·멱등 경계를 한 번에 확인하려면 다음 스크립트를 실행한다.
디버그 포트를 쓰지 않는 기본 구성에서는 `HAEON_CARD_URL`을 Haeon 컨테이너가
있는 내부 주소로 지정한다.

```bash
HAEON_CARD_URL=http://localhost:8084 \
  bash tools/card-api-contract-check.sh
```

다음 결과를 확인한다.

- 첫 요청이 HTTP 200이고 `decision`·`authorizationId`가 존재함
- 같은 `Idempotency-Key` 재시도가 같은 `authorizationId`를 반환함
- 잘못된 Bearer 토큰이 HTTP 403 `MERCHANT_NOT_ALLOWED`가 됨
- 실행 증거가 `evidence/runs/CARD-CONTRACT-.../`에 저장됨

이 스크립트는 정상 승인 1건을 DB에 남기므로, 반복 실행 전 필요하면 기준 fixture를
다시 적용한다.

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
