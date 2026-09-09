# Bookwave · Mock PG · Haeon Card 실습 환경

이 폴더는 WSL2에서 실행할 Docker Compose 기준선이다. 현재 애플리케이션 이미지를 연결하기 전 단계이므로 Java 런타임 컨테이너가 대기 상태로 실행된다. 각 서비스가 준비되면 해당 서비스의 `image`와 `command`를 Java/Spring 이미지로 교체한다.

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
- `ERROR_INJECTION_ENABLED=true`는 승인된 Before 실습에서만 사용한다.
- 실제 금융망, 실제 카드번호·CVC, 실제 기업 자격증명은 넣지 않는다.

## 다음 교체 지점

1. `bookwave-app`, `bookwave-chatbot`, `mock-pg`, `haeon-card`의 대기 명령을 각 Spring Boot 이미지로 교체한다.
2. `bookwave-cover-upload`는 우선 Java/Spring 실습 서비스로 시작한다. SCN-05B를 레거시 환경으로 재현하기로 확정할 때만 Apache/PHP 전용 이미지로 교체한다.
3. 해온카드 컨테이너에는 `HAEON_CARD_모의서비스_DDL_v1.0.sql` 기준 초기화와 API 계약 테스트를 붙인다.
4. 정상 결제 왕복이 통과한 뒤에만 OD-02-X 오류 주입과 북웨이브 SCN-05A/SCN-05B를 활성화한다.
