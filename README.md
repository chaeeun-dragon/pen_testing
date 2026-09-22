# Bookwave · Mock PG · Haeon Card 실습 환경

> **2026-09-22 해온카드 시나리오:** [결제 연동 진단 API → 웹쉘 세션 → 자료 전송 시나리오](docs/scenarios/haeon-diagnostic-api-attack-scenario-v0.2.md)를 기준으로 가맹점 진단·탐지·대응 흐름을 구현했다. 현재 Docker의 북웨이브는 팀원의 사이트와 별개인 임시 연동용이며, 사용자 담당 범위는 해온카드다.
> **구현:** `haeon-merchant-support`(가맹점 진단·제한 세션), `haeon-lab-receiver`(내부 자료 수신), `haeon-lab-gateway`(로컬 대상·콘솔 게이트웨이), `haeon-attack-console`(시나리오 실행·로그 화면)가 연결되어 있다. 해온카드 공격 콘솔은 `haeon-attack.localhost:8090` 또는 `127.0.0.1:8094`에서 연다. 콘솔 백엔드는 내부 실습 API만 호출하며 제어 토큰을 브라우저에 보내지 않는다. 명령행 검증은 `bash tools/haeon-diagnostic-lab.sh normal|before|after|respond|verify|reset`을 사용할 수 있다.

### 별도 공격 콘솔

공격 콘솔에서 정상 진단, Before 흐름, 수동 대응, After 차단 검증을 순서대로 실행한다. 왼쪽 메뉴의 북웨이브와 PG 항목은 각각 독립된 시나리오를 위한 자리이며 아직 실행 API에 연결하지 않았다.

```bash
# 콘솔과 해온카드 대상 서비스 기동
docker compose --env-file .env up -d --build haeon-lab-gateway
docker compose --env-file .env ps haeon-attack-console haeon-lab-gateway

# 브라우저에서 연다
# http://haeon-attack.localhost:8090/
# 또는 http://127.0.0.1:8094/
```

실행 화면에서 **정상 진단 → Before 공격 흐름 → 대응 실행 → After 차단 검증**을 선택한다. Before 실행에서는 합성 자료 조회와 내부 수신 결과가 단계 로그에 나타난다. After 실행은 차단 결과를 확인하고 선행 후속 동작을 실행하지 않는다. 공격 콘솔 서비스는 내부 Docker 네트워크에만 연결하고, 게이트웨이는 loopback 주소에만 포트를 공개한다. 콘솔의 시나리오 목록·실행 단계·이벤트 타임라인은 북웨이브와 PG 시나리오 및 이후 BAS 검증 항목을 각각 독립적으로 추가할 수 있도록 분리했다.

### 북웨이브·PG 통합 준비

팀장이 만든 북웨이브와 Mock PG는 현재 해온카드 기준선을 직접 수정하지 않고 별도 Git worktree에서 합친다. 브랜치 기준점, 폴더 소유, Compose 경계, 환경 변수, 결제·진단 회귀 순서는 [북웨이브·PG·해온카드 통합 작업 가이드](docs/handoff/bookwave-pg-haeon-integration-guide-v0.1.md)를 따른다.

### 해온카드 진단 시나리오

```bash
# 해온카드 구성만 기동
docker compose --env-file .env up -d --build haeon-lab-gateway

# 정상 업무와 Before/After 검증
bash tools/haeon-diagnostic-lab.sh normal
bash tools/haeon-diagnostic-lab.sh before
bash tools/haeon-diagnostic-lab.sh after

# Before 실행의 수동 대응·이벤트 확인
RUN_ID=HAEON-DIAG-<실행ID> bash tools/haeon-diagnostic-lab.sh respond
RUN_ID=HAEON-DIAG-<실행ID> bash tools/haeon-diagnostic-lab.sh verify

# 합성 실행·세션·보호 안내만 정리한다. 결제 데이터와 evidence/runs는 유지된다.
bash tools/haeon-diagnostic-lab.sh reset
```

가맹점 정상 화면은 `http://haeon.localhost:8090/merchant` 또는 `http://127.0.0.1:8090/merchant`에서 연다. 실습 제어 API는 `127.0.0.1:8092`에만 게시되며 `X-Lab-Control-Token`이 필요하다. 내부 수신기에는 호스트 포트가 없다. 모든 합성자료는 `HC-MEMBER-001`에 연결된 20건이며, 대응 후 회원 포털 `http://127.0.0.1:8085/mypage`의 보호 안내에서 확인 상태를 기록한다.

기존 MySQL 볼륨을 재사용하면 `009_lab_diagnostic_schema.sql`, `009_lab_diagnostic_seed.sql`, `010_lab_support_grants.sql`을 root 합성 비밀번호로 한 번 적용한다. 새 볼륨에서는 Compose init 순서로 자동 적용된다.

브라우저 기준 회귀 점검은 다음 명령으로 실행한다. 두 도구 모두 합성 계정만 사용하며, 가맹점 로그인·정상 진단·공격 콘솔 기준선 실행의 화면 증거와 해시를 `evidence/runs/`에 남긴다.

```bash
bash tools/portal-ui-check.sh
bash tools/merchant-console-ui-check.sh
python3 tools/haeon-ux-scenario-check.py --faults
```

이 폴더는 WSL2에서 실행할 Docker Compose 기준선이다. 현재 `bookwave-app`과 `mock-pg`는 Java 21 + Spring Boot 최소 뼈대가 연결되어 있고, `haeon-card`는 Java 21 + Spring Boot·JDBC 기반 승인 코어 뼈대까지 생성되었다. 챗봇·표지 업로드 서비스는 실제 서비스 이미지로 교체하기 전의 Java 런타임 대기 상태다.

## 시작

```bash
cp .env.example .env
docker compose --env-file .env config
docker compose --env-file .env up -d
docker compose --env-file .env ps
```

Windows 파일시스템보다 WSL Linux 파일시스템 안에 프로젝트를 두고 실행하는 것을 권장한다. `docker compose config`가 먼저 성공해야 한다.

## 고정한 경계

- `bookwave-chatbot`과 `bookwave-cover-upload`는 같은 Compose 프로젝트와 `dmz_net`을 사용하지만 컨테이너는 분리한다.
- `mock-pg`만 `card_net`에 연결되며, 북웨이브 서비스는 `haeon-card`를 직접 호출하지 않는다.
- `haeon-card-mysql`과 `bookwave-mysql`은 소유자를 분리한다.
- DB 포트는 호스트에 공개하지 않는다. 앱 포트는 로컬호스트에만 바인딩한다.
- `haeon-card`의 승인 API(`8084`)는 내부 전용이며, localhost 직접 확인은 `compose.debug.yaml`을 사용할 때만 허용한다.
- `haeon-card`의 회원 포털(`8085`)만 호스트에 공개한다. 포트별 경로 제한으로 포털 포트에서는 승인 API가 열리지 않는다.
- 결제 시작은 북웨이브(`8080`)만 담당한다. 해온카드 화면에는 결제 시작 기능을 두지 않는다.
- 포털 조회 API는 로그인 세션의 회원에 연결된 카드와 그 카드의 승인 내역만 반환한다.
- 카드 API 필드 매핑과 계약 테스트 기준은 `docs/contracts/card-api-field-mapping-v0.1.md`에 정리한다.
- 로컬 카드 API 호환성·승인·거절·재시도 검증은 `docs/contracts/card-api-compatibility-check-v0.2.md`와 `tools/card-api-contract-check.sh`를 기준으로 한다.
- 전체 결제 왕복 계약 테스트는 `tools/payment-flow-contract-check.sh`로 실행한다.
- `ERROR_INJECTION_ENABLED=true`는 승인된 Before 실습에서만 사용한다.
- 실제 금융망, 실제 카드번호·CVC, 실제 기업 자격증명은 넣지 않는다.

## 다음 교체 지점

1. `bookwave-chatbot`과 `bookwave-cover-upload`의 대기 명령을 각 실습 이미지로 교체한다. `bookwave-app`, `mock-pg`, `haeon-card`는 Spring Boot 뼈대가 연결되어 있다.
2. `bookwave-cover-upload`는 우선 Java/Spring 실습 서비스로 시작한다. SCN-05B를 레거시 동작으로 재현하기로 확정할 때만 Apache/PHP 전용 이미지로 교체한다.
3. 해온카드 컨테이너에 H0 DDL 기준 합성 fixture와 API 계약 smoke test를 붙인다. 정상 프로파일은 DB 기준 승인·거절과 승인 거래·감사 기록을 처리한다.
4. 해온카드 진단 API 시나리오는 북웨이브·PG 실행 없이 단독으로 확인한다. 정상 결제 왕복 계약은 별도 회귀 검증으로 유지한다.

## Mock PG만 먼저 확인하기

```bash
docker compose --env-file .env build mock-pg
docker compose --env-file .env up -d mock-pg
curl http://localhost:8083/actuator/health
```

정상 프로파일에서는 `/internal/v1/authorizations`가 DB 기준 승인·거절을 반환한다. 해온카드 가맹점 진단 흐름은 [공격 시나리오](docs/scenarios/haeon-diagnostic-api-attack-scenario-v0.2.md)에서 별도로 확인한다.

카드 API 자체의 필드 매핑과 호환성(승인·멱등 재시도·한도 초과·멱등키 충돌·위조 결과 필드·가맹점 인증)을 확인하려면 합성 fixture를 먼저 복원한 뒤 다음을 실행한다.

```bash
docker compose exec -T haeon-card-mysql sh -c \
  'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" \
   < /docker-entrypoint-initdb.d/003_haeon_payment_baseline.sql'
HAEON_CARD_URL=http://localhost:8084 bash tools/card-api-contract-check.sh
```

결과는 `evidence/runs/CARD-CONTRACT-.../`에 요청·응답·매핑 manifest 형태로 남는다.

전체 결제 왕복과 멱등 재시도, 세 서비스 로그의 correlation ID를 한 번에 확인하려면
다음 스크립트를 사용한다.

```bash
bash tools/payment-flow-contract-check.sh
```

Haeon 디버그 포트까지 직접 확인하려면 `HAEON_CARD_URL=http://localhost:8084`를
추가한다. 실행 증거는 `evidence/runs/PAYMENT-FLOW-.../`에 저장된다.

## Haeon 카드 localhost 디버깅

기본 실행에서 Haeon 카드의 `8084`는 Docker 내부에서만 열려 있다. 호스트에서
Actuator를 직접 확인할 때만 다음처럼 디버그 오버라이드를 함께 사용한다.

```bash
docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card
curl http://127.0.0.1:8084/actuator/health
```

디버깅 후에는 기본 내부 전용 구성으로 다시 올린다.

```bash
docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  rm -sf haeon-card
docker compose --env-file .env up -d haeon-card
```

## 화면과 운영 콘솔

| 주소 | 역할 |
|---|---|
| `http://127.0.0.1:8094/` | 해온카드 공격 시나리오 실행·탐지 로그 콘솔. `http://haeon-attack.localhost:8090/`에서도 연다. |
| `http://haeon.localhost:8090/merchant/` | 해온카드 가맹점 결제 연동 점검. 직접 포털 `8085`에서 가맹점을 선택해도 이 주소로 이동한다. |
| `http://localhost:8080/` | 북웨이브 온라인 서점. 도서를 고르고 해온카드로 **결제를 시작**한다. |
| `http://localhost:8085/` | 해온카드 홈. 카드·혜택·금융 안내와 로그인. 회원 조회 영역은 두지 않는다. |
| `http://localhost:8085/mypage` | 해온카드 **마이페이지(단독 화면)**. 로그인한 회원만 보유 카드 한도와 승인·거절 이용내역을 조회한다. |

상단 `MY` 메뉴와 빠른 메뉴는 모두 `/mypage`로 이동한다. 로그아웃 상태로 들어오면 그 화면에서
바로 로그인하고, 성공하면 같은 자리에서 조회 화면으로 바뀐다.

결제는 북웨이브에서만 시작한다. 결과는 해온카드 승인 DB에 기록되고, 회원은 해온카드
마이페이지 이용내역에서 같은 승인번호로 확인한다. 합성 로그인 계정과 포털 조회 API는
`services/haeon-card/README.md`에 정리한다.

`8080`의 서점 화면(`services/bookwave-app/.../static/`)은 북웨이브 담당자의 실제 화면이
들어오기 전까지 쓰는 임시 자리채움이다. 교체 절차와 지켜야 하는 연동 계약은
`docs/handoff/bookwave-merchant-integration-handoff-v0.1.md`에 정리한다.

화면이 정상인지 한 번에 확인하려면 실제 브라우저로 도는 점검 스크립트를 쓴다.

```bash
bash tools/portal-ui-check.sh
```

랜딩 → 마이페이지 → 로그인 → 조회 → 로그아웃 흐름과 JS 오류·4xx/5xx 유무를 확인하고,
화면 캡처와 판정을 `evidence/runs/PORTAL-UI-*/`에 남긴다.

실행 결과를 한 장으로 모아 보려면 증거 리포트를 만든다.

```bash
bash tools/evidence-report.sh     # -> evidence/report.html (브라우저로 열기)
```

`evidence/runs/`의 최신 실행에서 해온카드 Before/After 판정, 회원 보호 안내, 네트워크 격리,
정상 결제 회귀 결과를 한 화면에 모은다.

시연 순서는 `docs/scenarios/haeon-lab-demo-runbook-v1.0.md`를 따른다. 같은 내용의 인쇄용
PDF가 `docs/scenarios/haeon-lab-demo-runbook-v1.0.pdf`에 있다. 문서를 고친 뒤에는 다시 만든다.

```bash
bash tools/md-to-pdf.sh docs/scenarios/haeon-lab-demo-runbook-v1.0.md
```
