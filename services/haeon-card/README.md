# 해온카드 승인 코어·회원 포털

Java 21 + Spring Boot 기반의 정상 결제 승인 API와 회원 조회 포털이다. 해온카드 단독 진단 시나리오는 별도 `haeon-merchant-support` 서비스가 담당한다.

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
docker compose exec -T haeon-card-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < /docker-entrypoint-initdb.d/002_haeon_payment_seed.sql'
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

`card_limits.version`은 내부 동시성 제어용 값이며 회원 응답과 화면에
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

결제 기준선 복원은 승인 데이터를 삭제하므로 마이페이지 이용내역도 함께 비워질 수 있다.
화면 내역이 필요하면 `007_portal_history_seed.sql`을 이어서 실행한다. fixture 동작과
데이터 보존 주의사항은 [fixture 안내](../../db/haeon-card/fixtures/README.md)에 정리한다.

## 구현 순서

1. API 계약과 Bearer 가맹점 주체를 확인한다.
2. 합성 fixture로 카드·회원 기준 데이터를 준비한다.
3. 정상 승인·거절·멱등 재시도와 한도 행 잠금을 회귀 검증한다.

승인 코어에는 Before/After 취약 프로파일이 없다. 결제 연동 진단과 웹쉘 세션 시나리오는 [HAEON-DIAG-01](../../docs/scenarios/haeon-diagnostic-api-attack-scenario-v0.2.md)에서 별도 서비스로 수행한다.

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

## 승인·멱등 회귀 확인

아래 명령은 프로젝트 루트에서 실행한다. 카드 승인 회귀는 웹쉘 진단 시나리오와 독립적으로 확인한다.

컨테이너를 처음 올린 뒤에는 다음 스크립트로 정상 왕복과 같은 키 재시도를 확인한다.

```bash
bash tools/haeon-card-smoke.sh
```

`first-response.json`과 `replay-response.json`의 `authorizationId`가 같고, DB에 승인 1건·거래 1건만 남으면 정상이다. 실행 결과는 `evidence/runs/HC-SMOKE-.../`에 저장된다.

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

이 스크립트들은 정상 승인 자료를 DB에 남긴다. 반복 실행 전 카드 거래 이력을 지워도 되는 경우에만 [결제 기준선 fixture](../../db/haeon-card/fixtures/README.md)를 적용한다. 기준선 복원은 회원 포털 표시용 과거 이용내역도 지울 수 있다.
