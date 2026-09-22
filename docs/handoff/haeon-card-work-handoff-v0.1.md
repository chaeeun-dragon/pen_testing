# 해온카드 작업 인수인계

갱신일: 2026-09-22
현재 해온카드 공격 흐름은 가맹점 결제 연동 진단 API에서 시작하는 독립 웹쉘 시나리오 `HAEON-DIAG-01`이다. 기존 북웨이브 공격 및 북웨이브→Mock PG→해온카드 정상 결제 흐름과 별도로 실행한다.

## 서비스 경계

| 구성 | 주소·포트 | 역할 |
|---|---|---|
| 해온카드 로컬 게이트웨이 | `haeon.localhost:8090` | 가맹점·회원 화면의 웹 진입점 |
| 가맹점 진단 지원 | 관리 API `127.0.0.1:8092` | 로그인, 등록 진단, 실행 제어, 탐지·대응 |
| 내부 수신기 | 컨테이너 내부 `8093` | 지정 실행에서 수신한 합성자료 기록 |
| 해온카드 승인·회원 포털 | `8084` 내부, `127.0.0.1:8085` 포털 | 정상 승인·회원 조회·보호 안내 |

진단 지원 서비스는 `lab_` 접두사 테이블과 합성 자료를 사용한다. 카드 승인 API나 실제 회원의 비밀번호·카드 데이터를 진입 경로로 사용하지 않는다. 웹쉘 세션은 지정 조회와 지정 내부 수신 동작만 허용한다.

## 실행과 촬영 자료

프로젝트 루트에서 필요한 해온카드 구성만 시작한다.

```bash
docker compose --env-file .env up -d --build haeon-lab-gateway
bash tools/haeon-diagnostic-lab.sh normal
bash tools/haeon-diagnostic-lab.sh before
RUN_ID=<Before 실행 ID> bash tools/haeon-diagnostic-lab.sh verify
RUN_ID=<Before 실행 ID> bash tools/haeon-diagnostic-lab.sh respond
bash tools/haeon-diagnostic-lab.sh after
```

시연 순서와 화면 포인트는 [촬영 큐시트](../scenarios/haeon-lab-demo-shooting-guide-v1.0.html),
공격자·방어자 동시 진행은 [레드·블루 큐시트](../scenarios/haeon-lab-incident-red-blue-shooting-guide-v1.0.html),
서비스 동작과 판정 기준은 [HAEON-DIAG-01 시나리오](../scenarios/haeon-diagnostic-api-attack-scenario-v0.2.md)를 따른다.

실행 증거는 `evidence/runs/<RUN_ID>/`에 저장한다. `reset` 명령은 진단 실행 자료와 보호 안내만 초기화하며, 기존 결제 승인·거래 내역과 저장된 증거는 보존한다.

## 정상 결제 회귀

해온카드의 정상 승인·거절·멱등성 계약은 공격 시나리오와 독립적으로 유지한다.

```bash
bash tools/haeon-card-smoke.sh
bash tools/card-api-contract-check.sh
bash tools/payment-flow-contract-check.sh
```

진단 실행 전후에도 승인 포트는 기본 구성에서 외부에 노출하지 않는다. 로컬 운영 범위 밖의 도메인, 외부 수신지, 실제 자격증명은 검증 대상으로 사용하지 않는다.
