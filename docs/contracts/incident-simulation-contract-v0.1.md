# 결제 서버 침입 징후 합성 시뮬레이션 실행 계약 v0.1

작성일: 2026-09-16
상태: 6단계 회귀·보안 검증 완료 - 실행 도구·증거 패키지·범위 제한 탐지·DB 격리·포트 점검 구성됨

## 1. 목적과 소유 경계

이 계약은 북웨이브의 미래 **결제 서버 침입 징후 합성 시뮬레이션**만 다룬다. 정상
결제 흐름인 `bookwave-app → mock-pg → haeon-card`와 해온카드 자체 진단 시나리오 `HAEON-DIAG-01`은 독립된 실행 흐름이다.

- 시뮬레이션은 Mock PG와 해온카드 API를 호출하지 않는다.
- 시뮬레이션은 해온카드 DB와 `audit_events`를 읽거나 쓰지 않는다.
- 일반 `POST /api/v1/payments`의 결제·멱등성·승인 결과를 바꾸지 않는다.
- 실제 웹쉘, 명령 실행, 외부 네트워크, 실제 개인정보·카드·PG 자격증명은 사용하지 않는다.

## 2. 현재 구현된 실행 차단 장치

Bookwave 설정 `bookwave.incident-simulation.enabled`는 환경 변수
`INCIDENT_SIMULATION_ENABLED`에서 읽으며 기본값은 `false`다.

전용 진입점은 `IncidentSimulationGuard.requireAuthorized(runId, accessToken)`을 먼저
호출한다. `runId` 검증과 별개로 제어 토큰을 비교하므로, 실행 ID는 권한을 부여하지
않는다.

| 조건 | 결과 |
|---|---|
| `INCIDENT_SIMULATION_ENABLED=false` | `403 INCIDENT_SIMULATION_DISABLED` |
| 활성화 + 실행 ID 형식 불일치 | `400 INVALID_SIMULATION_RUN_ID` |
| 활성화 + 제어 토큰 미설정 | `503 INCIDENT_SIMULATION_NOT_CONFIGURED` |
| 활성화 + 제어 토큰 불일치 | `403 INCIDENT_SIMULATION_NOT_AUTHORIZED` |
| 활성화 + 유효 실행 ID·제어 토큰 | 고정 합성 시뮬레이션만 허용 |

구현된 전용 경로는 `POST /internal/v1/lab/incident-simulations/payment-server`다.
필수 헤더는 `X-Correlation-Id`, `X-Lab-Run-Id`, `X-Lab-Simulation-Token`이며 요청
본문을 받지 않는다. 결제수단·가맹점·카드·명령·임의 이벤트 본문을 받지 않으므로
일반 `POST /api/v1/payments`와 교차하지 않는다.

성공 시 서버는 다음의 **고정된 일곱 개** 이벤트만 로그와 응답에 기록한다. 각 이벤트는
같은 MDC `corr=<correlationId>`와 `runId=<runId>`를 가지며, 외부 입력으로 내용이나
순서를 바꿀 수 없다.

1. `incident_simulation_started` (`RECORDED`)
2. `simulated_payment_server_access_detected` (`OBSERVED`)
3. `simulated_synthetic_data_access_attempted` (`OBSERVED`, 실제 데이터 접근은 수행하지 않음)
4. `incident_simulation_alert_raised` (`ALERT`)
5. `simulated_synthetic_data_access_blocked` (`BLOCKED`)
6. `incident_simulation_additional_verification_passed` (`PASS`)
7. `incident_simulation_completed` (`PASS`)

구현은 `PaymentService`, `MockPgClient`, 해온카드 DB 또는 해온카드 API를 의존하지
않으며, 응답의 `mockPgCalled=false`, `haeonCardCalled=false`가 이 격리 결과를 명시한다.

## 3. 실행 식별자 규칙

| 값 | 규칙 | 사용 위치 |
|---|---|---|
| `runId` | `INCIDENT-SIM-[A-Za-z0-9_-]{8,80}` | 도구가 생성하는 실행 묶음·증거 경로 |
| `correlationId` | 기존 결제 계약의 8~80자 ASCII ID | 미래 이벤트 로그의 상관 추적용 |
| `accessToken` | `INCIDENT_SIMULATION_ACCESS_TOKEN`의 랩 전용 값 | 전용 제어 경로의 opt-in 권한 |
| `simulation` | 서버가 기록하는 `true` 고정 표식 | 로그·`scenario.json`의 합성 범위 증명 |

`runId`는 승인·한도·가맹점 인증의 입력이 아니며, 카드 승인 판단에 절대 사용하지 않는다.

## 4. 실행과 최소 출력 계약

`INCIDENT_SIMULATION_ENABLED=true`와 랩 전용 제어 토큰을 지정해 Bookwave를 재시작한
뒤 다음처럼 실행한다.

```bash
INCIDENT_SIMULATION_ENABLED=true \
INCIDENT_SIMULATION_ACCESS_TOKEN=lab-simulation-20260916 \
  docker compose --env-file .env up -d --force-recreate bookwave-app

INCIDENT_SIMULATION_ACCESS_TOKEN=lab-simulation-20260916 \
  bash tools/payment-server-incident-simulation.sh
```

실행 후에는 `docker compose --env-file .env up -d --force-recreate bookwave-app`으로
기본 비활성 상태를 복원한다.

도구는 아래 산출물을 만든다. `INCIDENT_SIMULATION_ACCESS_TOKEN`은 실제 운영 비밀정보가
아닌 이 격리 실습의 제어 값만 사용한다.

- `scenario.json`: `scenarioId`, `runId`, `simulation=true`, PG·카드 호출 여부
- `request.json`: 경로·실행 ID·상관 ID, 제어 토큰은 `redacted`로만 보관
- `response.json`, `bookwave-health.json`, `services.log`: 고정 이벤트와 `corr=<correlationId>` 형식
- `result.json`, `summary.txt`: S3 `ALERT`, S4 차단·추가 검증 `PASS`
- `correlation-report.tsv`: Bookwave만 `yes`, Mock PG·해온카드는 `no (expected)`인지 확인
- `detection/result.json`, `detection/summary.txt`, `detection/event-sequence.tsv`:
  범위 제한 탐지의 판정·이벤트 순서·서비스별 상관 로그 대사
- `evidence-check.json`, `evidence-manifest.json`: 필수 증거 파일의 내용 검증 결과와
  파일별 SHA-256 해시. manifest는 자기 자신을 해시 대상에 포함하지 않는다.
- `haeon-db-before.tsv`, `haeon-db-after.tsv`, `haeon-db-isolation.json`: 선택적으로
  `tools/payment-server-incident-db-isolation-check.sh`가 해온카드 DB의 네 테이블
  (`card_limits`, `authorization_requests`, `card_transactions`, `audit_events`)을 시뮬레이션
  전후 비교해 변경 없음(`haeonCardDbChanged=false`)을 증명한다.

`tools/payment-server-incident-evidence-check.sh`는 저장된 증거만 읽는다. 일반 결제,
시뮬레이션 경로, Mock PG, 해온카드, DB를 호출하지 않으며, 동일 실행의 증거를 다시
검사할 때 사용한다.

최종 증거 패키지 검증 실행은 `INCIDENT-SIM-20260916T030000Z`이며, 이후 정상 결제
회귀 실행은 `POST-EVIDENCE-FLOW-20260916T034500Z`이다.

```bash
RUN_ID=INCIDENT-SIM-<실행ID> \
CORRELATION_ID=<해당-correlationId> \
  bash tools/payment-server-incident-evidence-check.sh
```

## 5. 회귀 보호 조건

새 시뮬레이션 구현 전후에 다음을 반드시 확인한다.

1. `tools/card-api-contract-check.sh`가 승인·재조회·거절·가맹점 인증 경계를 통과한다.
2. `tools/payment-flow-contract-check.sh`가 Bookwave → Mock PG → 해온카드의 동시 멱등성과
   세 서비스 `correlationId` 연결을 통과한다.
3. `tools/card-api-contract-check.sh`가 승인·멱등성·가맹점 인증 경계를 통과한다.
4. 실행 뒤 합성 카드 DB를 한도 100,000원, 사용액 0원, 버전 0으로 복원한다.
5. `tools/payment-server-incident-detection-check.sh`가 지정된 `runId`·`correlationId`
   범위에서 S1 관측 → S2 접근 시도 → S3 `ALERT` → S4 차단·추가 검증 `PASS` 순서를
   확인한다. Mock PG·해온카드의 해당 상관 로그가 있거나 이벤트가 누락·중복되면 `FAIL`이다.
6. `tools/payment-server-incident-evidence-check.sh`가 다섯 필수 파일(`scenario.json`,
   `services.log`, `result.json`, `summary.txt`, `correlation-report.tsv`)과 보조 증거의
   내용·범위를 검사하고 `evidence-manifest.json`을 생성한다.
7. `tools/payment-server-incident-db-isolation-check.sh`는 시뮬레이션 전후 해온카드
   승인 DB 스냅샷이 동일한지 검사한다. 이 도구를 쓸 때 증거 검사기는 스냅샷·격리
   결과 파일까지 manifest에 포함해 검증한다.
8. `tools/network-port-security-check.sh`는 읽기 전용으로 `127.0.0.1` 허용 포트
   (Bookwave 8080, Mock PG 8083, 선택적 해온카드 디버그 8084)와 내부 DB·카드·감사
   네트워크 경계를 검사한다.
