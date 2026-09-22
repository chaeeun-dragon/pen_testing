# 해온카드 진단 API 시나리오 실행 런북

갱신일: 2026-09-22
시나리오: HAEON-DIAG-01
진입점: 해온카드 가맹점 포털의 결제 연동 진단 API

이 런북은 정상 진단, Before, 대응, After, 회원 보호 안내까지 해온카드 흐름만 실행한다. 북웨이브와 PG 서비스는 시작 조건에 포함되지 않는다.

## 1. 시연 흐름

| 순서 | 화면·동작 | 확인 결과 |
|---|---|---|
| 1 | 가맹점 포털 로그인 | 가맹점 세션 발급 |
| 2 | 등록 진단 대상 연결 확인 | 정상 결과와 응답 시간 |
| 3 | Before 실행 | 제한 세션, 지정 자료 20건 조회, 내부 수신 결과 |
| 4 | 탐지 이벤트 확인 | 이벤트 기반 ALERT |
| 5 | 운영자 대응 | 해당 실행 CONTAINED/BLOCKED, 세션 폐기 |
| 6 | After 실행 | HTTP 403 DIAGNOSTIC_INPUT_BLOCKED |
| 7 | 회원 마이페이지 | 대상 회원 안내 및 확인 완료 |

최초 진입은 http://haeon.localhost:8090/merchant/의 결제 연동 진단 기능이다. 서버는 고정 입력 마커만 처리하며 임의 OS 명령, 실제 웹쉘 설치, 실제 카드·회원 정보 조회를 수행하지 않는다.

## 2. 화면 주소와 실행 환경

모든 명령은 프로젝트 루트의 WSL 셸에서 실행한다.

| 용도 | 주소 |
|---|---|
| 가맹점 포털 | http://haeon.localhost:8090/merchant/ |
| 회원 마이페이지 | http://127.0.0.1:8085/mypage |
| 로컬 제어 API | http://127.0.0.1:8092 |

가맹점 화면과 해온카드 포털은 기존 청록색 브랜드 스타일을 사용한다. 촬영 때는 사용자 화면에 비밀번호나 세션 토큰이 보이지 않도록 한다. attack-response.json에는 세션 값이 포함될 수 있으므로 화면에 열지 않는다.

## 3. 해온카드 구성만 기동

Compose는 게이트웨이에 필요한 해온카드 서비스만 시작한다. 북웨이브와 Mock PG는 실행하지 않아도 된다.

~~~bash
docker compose --env-file .env up -d --build haeon-lab-gateway
docker compose --env-file .env ps
~~~

haeon-lab-gateway의 의존 구성은 해온카드 포털, 진단 지원 서비스, 해온카드 DB, 내부 수신기다. 브라우저에서 가맹점 주소를 열어 로그인 화면이 표시되는지 확인한다.

## 4. 정상 기준선

브라우저에서 가맹점 계정으로 로그인하고 등록된 진단 대상을 선택해 연결 상태를 확인한다. 이어서 동일 API를 호출하는 검증 도구로 응답 증거를 남긴다.

~~~bash
bash tools/haeon-diagnostic-lab.sh normal
NORMAL_DIR="$(find evidence/runs -maxdepth 1 -type d -name 'NORMAL-*' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
cat "$NORMAL_DIR/summary.txt" "$NORMAL_DIR/response.json"
~~~

기대 결과는 result=SUCCESS다. 로그인하지 않았거나 다른 가맹점의 진단 대상을 지정하면 요청이 거부되어야 한다.

## 5. Before — 제한 웹쉘 흐름과 자료 전송

~~~bash
bash tools/haeon-diagnostic-lab.sh before
RUN_DIR="$(find evidence/runs -maxdepth 1 -type d -name 'HAEON-DIAG-*' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
RUN_ID="$(basename "$RUN_DIR")"
cat "$RUN_DIR/summary.txt" "$RUN_DIR/exfiltration.json"
~~~

다음 증거를 같은 실행 ID로 대조한다.

- 진단 API 요청이 만든 제한 웹쉘 세션
- HC-MEMBER-001 관련 결제 지원 자료 20건의 조회
- 내부 수신기의 전송 결과, 건수, SHA-256
- 자료 접근·전송 이벤트에서 도출된 ALERT

세션 토큰이 포함될 수 있는 attack-response.json은 촬영하지 않는다.

## 6. 대응 — 실행 차단과 세션 폐기

Before 실행에 사용한 RUN_ID를 유지한다.

~~~bash
RUN_ID="$RUN_ID" bash tools/haeon-diagnostic-lab.sh respond
RUN_ID="$RUN_ID" bash tools/haeon-diagnostic-lab.sh verify
cat "$RUN_DIR/verification.txt" "$RUN_DIR/events.json"
~~~

기대 상태는 실행 CONTAINED, 경보 BLOCKED다. 대응 완료 후 기존 세션으로 자료를 다시 조회하거나 전송할 수 없어야 한다. 같은 대응 요청을 반복해도 보호 기록이 중복 생성되지 않는다.

## 7. After — 개선 통제 확인

After는 새 실행 ID로 수행한다. 같은 의미의 비정상 진단 입력은 403으로 차단되고 정상 진단은 계속 성공해야 한다.

~~~bash
bash tools/haeon-diagnostic-lab.sh after
AFTER_DIR="$(find evidence/runs -maxdepth 1 -type d -name 'HAEON-DIAG-*' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
cat "$AFTER_DIR/summary.txt" "$AFTER_DIR/attack-response.json"
bash tools/haeon-diagnostic-lab.sh normal
~~~

기대 결과는 attackHttp=403, result=DIAGNOSTIC_INPUT_BLOCKED다. After 실행에 웹쉘 세션이나 수신 자료가 생기지 않아야 한다. 차단 뒤 단계는 성공이 아니라 ‘선행 단계 차단으로 미실행’으로 판단한다.

## 8. 회원 보호 안내

회원 마이페이지에서 영향 회원과 비교 회원을 각각 확인한다.

1. haeon01로 로그인해 추가 확인 안내, 발생 시각, 확인 버튼을 보여 준다.
2. 확인 버튼을 누른 뒤 확인 완료 상태가 유지되는지 확인한다.
3. haeon02로 로그인해 같은 안내가 나타나지 않는지 확인한다.

안내 확인은 회원이 내용을 읽었다는 기록이다. 로그인이나 카드 결제를 정지하거나 사고가 해결됐다는 의미가 아니다.

## 9. 증거 위치와 초기화

각 실행의 요청·응답·이벤트·수신 기록은 evidence/runs/<RUN_ID>/ 아래에 저장된다. 실행 ID, 전송 ID, 건수, SHA-256을 기준으로 송신과 수신을 대조한다.

촬영 종료 후 현재 상태와 보호 안내를 초기화한다. 명령은 기존 증거 파일과 정상 결제 자료를 지우지 않는다.

~~~bash
bash tools/haeon-diagnostic-lab.sh reset
bash tools/network-port-security-check.sh
~~~

## 10. 빠른 문제 확인

- 로그인 실패: 가맹점 계정과 세션 발급 응답을 확인한다.
- 진단 대상이 비어 있음: 로그인 주체에 등록 대상이 연결되어 있는지 확인한다.
- 수신 결과가 없거나 실패: 수신 서비스 상태와 exfiltration.json의 HTTP 결과를 확인한다. 실패를 성공으로 표시하지 않는다.
- After에서 403이 아님: 실행 모드와 DIAGNOSTIC_INPUT_BLOCKED 응답을 확인한다.
- 보호 안내가 잘못 표시됨: 조회된 회원 번호와 실행 결과의 영향 회원을 대조한다.
- 주소 접속 실패: 게이트웨이와 의존 서비스의 Compose 상태를 확인한다.

## 관련 문서

- [공격 시나리오](haeon-diagnostic-api-attack-scenario-v0.2.md)
- [공격자/방어자 촬영 큐시트](haeon-lab-incident-red-blue-shooting-guide-v1.0.html)
- [시연 촬영 큐시트](haeon-lab-demo-shooting-guide-v1.0.html)
