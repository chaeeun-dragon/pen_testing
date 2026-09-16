# 결제 서버 침입 징후 합성 시뮬레이션 실행 계약 v0.1

작성일: 2026-09-16
상태: 1·2단계 완료 - opt-in 가드만 구현됨, 침입 징후 이벤트·API·탐지기는 아직 미구현

## 1. 목적과 소유 경계

이 계약은 북웨이브의 미래 **결제 서버 침입 징후 합성 시뮬레이션**만 다룬다. 정상
결제 흐름인 `bookwave-app → mock-pg → haeon-card`와 CARD-03 한도 검증은 별도다.

- 시뮬레이션은 Mock PG와 해온카드 API를 호출하지 않는다.
- 시뮬레이션은 해온카드 DB와 `audit_events`를 읽거나 쓰지 않는다.
- 일반 `POST /api/v1/payments`의 결제·멱등성·승인 결과를 바꾸지 않는다.
- 실제 웹쉘, 명령 실행, 외부 네트워크, 실제 개인정보·카드·PG 자격증명은 사용하지 않는다.

## 2. 현재 구현된 실행 차단 장치

Bookwave 설정 `bookwave.incident-simulation.enabled`는 환경 변수
`INCIDENT_SIMULATION_ENABLED`에서 읽으며 기본값은 `false`다.

향후 시뮬레이션 진입점은 `IncidentSimulationGuard.requireEnabled(runId)`를 먼저 호출해야
한다.

| 조건 | 결과 |
|---|---|
| `INCIDENT_SIMULATION_ENABLED=false` | `403 INCIDENT_SIMULATION_DISABLED` |
| 활성화 + 실행 ID 형식 불일치 | `400 INVALID_SIMULATION_RUN_ID` |
| 활성화 + `INCIDENT-SIM-` 실행 ID | 이후 단계의 합성 시뮬레이션만 허용 |

이 버전에는 시뮬레이션 HTTP API가 없다. 따라서 활성화 환경 변수를 설정해도 이벤트
생성, 결제 호출, DB 변경은 발생하지 않는다.

## 3. 실행 식별자 규칙

| 값 | 규칙 | 사용 위치 |
|---|---|---|
| `runId` | `INCIDENT-SIM-[A-Za-z0-9_-]{8,80}` | 도구가 생성하는 실행 묶음·증거 경로 |
| `correlationId` | 기존 결제 계약의 8~80자 ASCII ID | 미래 이벤트 로그의 상관 추적용 |
| `simulation` | 서버가 기록하는 `true` 고정 표식 | 로그·`scenario.json`의 합성 범위 증명 |

`runId`는 승인·한도·가맹점 인증의 입력이 아니며, 카드 승인 판단에 절대 사용하지 않는다.

## 4. 이후 단계의 최소 출력 계약

S1~S4 구현 후에만 아래 산출물을 만든다. 이 문서는 현재 파일이 이미 생성됐다고
주장하지 않는다.

- `scenario.json`: `scenarioId`, `runId`, `simulation=true`, 기준선
- `services.log`: `event=incident_simulation_*`, `corr=<correlationId>` 형식
- `result.json`, `summary.txt`: Before `ALERT`, 차단 또는 재검증 `PASS`
- `correlation-report.tsv`: 해당 실행의 서비스별 로그 존재 여부

## 5. 회귀 보호 조건

새 시뮬레이션 구현 전후에 다음을 반드시 확인한다.

1. `tools/card-api-contract-check.sh`가 승인·재조회·거절·가맹점 인증 경계를 통과한다.
2. `tools/payment-flow-contract-check.sh`가 Bookwave → Mock PG → 해온카드의 동시 멱등성과
   세 서비스 `correlationId` 연결을 통과한다.
3. `tools/card03-detection-check.sh`가 지정된 실행 범위에서 `PASS`를 반환한다.
4. 실행 뒤 합성 카드 DB를 한도 100,000원, 사용액 0원, 버전 0으로 복원한다.
