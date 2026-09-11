# Bookwave · Mock PG · Haeon Card 실습 환경

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
- `haeon-card`는 기본 구성에서 내부 전용이며, localhost 직접 확인은 `compose.debug.yaml`을 사용할 때만 허용한다.
- `ERROR_INJECTION_ENABLED=true`는 승인된 Before 실습에서만 사용한다.
- 실제 금융망, 실제 카드번호·CVC, 실제 기업 자격증명은 넣지 않는다.

## 다음 교체 지점

1. `bookwave-chatbot`과 `bookwave-cover-upload`의 대기 명령을 각 실습 이미지로 교체한다. `bookwave-app`, `mock-pg`, `haeon-card`는 Spring Boot 뼈대가 연결되어 있다.
2. `bookwave-cover-upload`는 우선 Java/Spring 실습 서비스로 시작한다. SCN-05B를 레거시 동작으로 재현하기로 확정할 때만 Apache/PHP 전용 이미지로 교체한다.
3. 해온카드 컨테이너에 H0 DDL 기준 합성 fixture와 API 계약 smoke test를 붙인다. 정상 프로파일은 DB 기준 승인·거절과 승인 거래·감사 기록을 처리한다.
4. 정상 결제 왕복이 통과한 뒤에만 CARD-03 Before/After 비교, OD-02-X 오류 주입과 북웨이브 SCN-05A/SCN-05B를 활성화한다.

## Mock PG만 먼저 확인하기

```bash
docker compose --env-file .env build mock-pg
docker compose --env-file .env up -d mock-pg
curl http://localhost:8083/actuator/health
```

정상 프로파일에서는 `/internal/v1/authorizations`가 DB 기준 승인·거절을 반환한다. CARD-03 동시성은 `services/haeon-card/README.md`와 `tools/card03-concurrency.sh`의 별도 실습 절차로 확인한다.

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

## 북웨이브 결제 화면

`bookwave-app`을 실행한 뒤 브라우저에서 `http://localhost:8080/`을 열면 해온카드
스타일의 모의 결제 화면을 사용할 수 있다. 실제 카드정보 없이 테스트 토큰으로 결제
요청을 보내고, 승인 결과·PG 거래번호·카드 승인번호·요청 추적 ID를 한 화면에서
확인한다. 같은 요청 재시도 버튼으로 멱등 처리도 눈으로 확인할 수 있다.
