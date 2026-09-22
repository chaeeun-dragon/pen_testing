# 북웨이브 · Mock PG · 해온카드 통합 작업 가이드 v0.1

갱신일: 2026-09-22
대상: 팀장이 만든 북웨이브 화면·결제 흐름과 Mock PG 연동을 현재 해온카드 기준선에 합칠 때
관련 문서: [결제 API 계약](../contracts/api-contract-v0.1.md), [북웨이브 연동 인계](bookwave-merchant-integration-handoff-v0.1.md), [통합 아키텍처](../architecture/북웨이브_해온카드_통합아키텍처_v0.1.md)

## 1. 통합 원칙

해온카드의 진단 API 시나리오와 북웨이브 결제 흐름은 함께 Docker Compose에서 실행할 수 있지만, 서로 다른 실행 경로다.

~~~text
북웨이브 결제: bookwave-app → mock-pg → haeon-card 승인 API
해온카드 진단: 공격 콘솔 → haeon-merchant-support → haeon-lab-receiver
~~~

북웨이브는 해온카드 DB나 승인 API를 직접 호출하지 않고, Mock PG만 <code>haeon-card:8084</code>을 호출한다. 해온카드 진단 시나리오는 Mock PG와 승인 API를 호출하지 않는다. 통합 뒤에도 이 두 경계를 유지한다.

## 2. 통합 기준선

통합 브랜치는 아래 해온카드 기준선에서 시작한다.

| 항목 | 값 |
|---|---|
| 기준 브랜치 | <code>feat/haeon-lab-baseline</code> |
| 진단·가맹점·회원 보호 기준 | <code>8818bc7</code> — <code>feat: harden haeon diagnostic workflow</code> |
| 공격 콘솔 기준 | <code>c0e7b93</code> — <code>feat: add haeon attack scenario console</code> |

팀장이 원격에서 작업하려면 먼저 이 기준 브랜치를 origin에 반영한다.

~~~bash
git push origin feat/haeon-lab-baseline
~~~

## 3. Git과 작업 폴더

기존 해온카드 작업 폴더를 그대로 두고, 통합 전용 worktree에서만 북웨이브·PG 변경을 합친다. 서비스 폴더를 수동으로 복사해서 합치지 않는다.

~~~text
상위 작업 폴더/
├── bookwave-haeon-lab/             # 해온카드 기준선 작업 폴더
└── bookwave-pg-integration/        # 통합 전용 worktree
~~~

### 같은 원격 저장소의 브랜치를 합칠 때

~~~bash
cd /mnt/c/study/docker/bookwave-haeon-lab
git status --short
git fetch origin
git worktree add ../bookwave-pg-integration \
  -b feat/bookwave-pg-integration feat/haeon-lab-baseline

cd ../bookwave-pg-integration
git merge --no-ff origin/<team-lead-branch>
~~~

<code>git status --short</code> 결과가 비어 있을 때만 worktree를 만든다. <code>&lt;team-lead-branch&gt;</code>에는 팀장이 만든 북웨이브·PG 브랜치 이름을 넣는다.

### 별도 저장소의 코드를 합칠 때

통합 worktree에서 팀장 저장소를 한 번만 remote로 등록한 뒤 필요한 브랜치를 가져온다.

~~~bash
cd /mnt/c/study/docker/bookwave-pg-integration
git remote add team-lead <team-lead-repository-url>
git fetch team-lead <team-lead-branch>
git merge --no-ff team-lead/<team-lead-branch>
~~~

remote 이름과 브랜치 이름은 팀장과 먼저 맞춘다. 통합 작업이 끝난 뒤에는 worktree를 제거하기 전에 변경 사항을 커밋하거나 별도 백업 브랜치에 남긴다.

~~~bash
cd /mnt/c/study/docker/bookwave-haeon-lab
git worktree list
git worktree remove ../bookwave-pg-integration
~~~

## 4. 폴더 소유와 공동 검토 대상

| 구분 | 기본 소유 폴더 | 통합 시 원칙 |
|---|---|---|
| 북웨이브 | <code>services/bookwave-app/</code>, <code>services/bookwave-chatbot/</code>, <code>services/bookwave-cover-upload/</code>, <code>db/bookwave/</code> | 팀장 구현으로 교체 가능. 해온카드 폴더를 함께 바꾸지 않는다. |
| Mock PG | <code>services/mock-pg/</code> | 북웨이브와 해온카드 사이의 어댑터만 책임진다. |
| 해온카드 | <code>services/haeon-card/</code>, <code>services/haeon-merchant-support/</code>, <code>services/haeon-lab-receiver/</code>, <code>services/haeon-attack-console/</code>, <code>services/haeon-lab-gateway/</code>, <code>db/haeon-card/</code> | 해온카드 담당 승인 뒤에만 변경한다. |
| 공동 검토 | <code>compose.yaml</code>, <code>.env.example</code>, <code>README.md</code>, <code>docs/contracts/</code>, 결제·포트 검증 도구 | 서비스 간 계약·포트·네트워크가 바뀔 때 함께 검토한다. |
| 생성물 | <code>.env</code>, <code>evidence/runs/</code>, <code>evidence/receiver/</code> | Git에 올리지 않는다. 실행 증거와 개인별 환경 값은 worktree마다 분리한다. |

통합 브랜치에서는 <code>git add .</code> 대신 변경한 담당 폴더와 공동 파일을 명시적으로 stage한다.

~~~bash
git add services/bookwave-app services/mock-pg db/bookwave
git add compose.yaml .env.example docs/contracts README.md
git status --short
~~~

## 5. Compose와 환경 변수 경계

| 구성 | 허용 네트워크 | 통합 시 확인 |
|---|---|---|
| <code>bookwave-app</code> | <code>front_net</code>, <code>dmz_net</code>, <code>bookwave_db_net</code> | <code>card_net</code>에 연결하지 않는다. |
| <code>mock-pg</code> | <code>dmz_net</code>, <code>card_net</code>, <code>audit_net</code> | 해온카드 승인 API의 유일한 호출자다. |
| <code>haeon-card</code> | <code>card_net</code>, <code>audit_net</code>, <code>card_portal_net</code> | 승인 API 8084는 내부 전용으로 유지한다. |
| 진단·공격 콘솔 구성 | <code>haeon_lab_net</code>과 포털 게이트웨이 | Mock PG·승인 API를 호출하지 않는다. |

다음 값은 한 변경 단위로 맞춘다.

| 값 | 연결 대상 |
|---|---|
| <code>MOCK_PG_BASE_URL=http://mock-pg:8083</code> | 북웨이브 → Mock PG 내부 호출 |
| <code>HAEON_CARD_BASE_URL=http://haeon-card:8084</code> | Mock PG → 해온카드 승인 내부 호출 |
| <code>MOCK_PG_MERCHANT_NO</code>, <code>HAEON_MERCHANT_NO</code> | 해온카드 <code>merchants.merchant_no</code> 행과 같은 값 |
| <code>HAEON_MERCHANT_TOKEN</code> | Mock PG와 해온카드의 같은 합성 가맹점 인증 값 |
| 호스트 포트 | <code>.env.example</code>, <code>compose.yaml</code>, 포트 검증 도구를 함께 갱신 |

컨테이너 간 호출에는 <code>localhost</code> 대신 Compose 서비스명(<code>mock-pg</code>, <code>haeon-card</code>)을 사용한다. 새 환경 변수는 <code>.env.example</code>에 기본값을 먼저 추가하고, 개인 <code>.env</code>에는 필요할 때만 반영한다.

## 6. 통합 순서

1. 팀장이 만든 북웨이브·PG 브랜치와 해온카드 기준선의 커밋 범위를 확인한다.
2. 통합 worktree에서 팀장 브랜치를 merge한다.
3. <code>services/bookwave-app/</code>, <code>services/mock-pg/</code>, <code>db/bookwave/</code> 충돌을 먼저 해결한다.
4. 공동 파일인 <code>compose.yaml</code>, <code>.env.example</code>, 계약 문서의 충돌을 함께 검토한다.
5. 정상 결제 왕복을 통과시킨 뒤 해온카드 독립 진단 시나리오를 다시 실행한다.
6. 변경 범위별로 커밋하고, 통합 브랜치에서만 원격 반영 또는 병합 요청을 만든다.

해온카드 공격 콘솔의 북웨이브·PG 메뉴는 현재 화면 자리만 준비되어 있다. 메뉴가 보인다는 사실만으로 북웨이브·PG 시나리오가 연결된 것은 아니다. 각 시나리오의 API·단계 로그·증거 규칙이 구현된 뒤에만 콘솔 메뉴를 연결한다.

## 7. 통합 검증 순서

모든 명령은 통합 worktree에서 실행한다.

~~~bash
docker compose --env-file .env config
docker compose --env-file .env up -d --build bookwave-app mock-pg haeon-card

bash tools/payment-flow-contract-check.sh
bash tools/network-port-security-check.sh
bash tools/portal-ui-check.sh
~~~

승인 API의 필드·멱등성까지 확인해야 하면 디버그 Compose를 사용한다.

~~~bash
docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card
HAEON_CARD_URL=http://127.0.0.1:8084 bash tools/card-api-contract-check.sh
~~~

마지막으로 결제 연동이 진단 시나리오에 영향을 주지 않는지 확인한다.

~~~bash
docker compose --env-file .env up -d --build haeon-lab-gateway
bash tools/haeon-diagnostic-lab.sh reset
python3 tools/haeon-ux-scenario-check.py --faults
bash tools/merchant-console-ui-check.sh
~~~

결제 회귀와 해온카드 진단 검증은 각각 다른 실행 ID와 증거 폴더로 보관한다. 한 흐름의 실패를 다른 흐름의 성공으로 판단하지 않는다.

## 8. 통합 전 최종 확인

- [ ] <code>docker compose --env-file .env config</code>가 통과한다.
- [ ] 북웨이브는 <code>card_net</code>에 연결되지 않았고, Mock PG만 해온카드 승인 API를 호출한다.
- [ ] 정상 결제의 <code>correlationId</code>, <code>paymentId</code>, <code>pgTid</code>, <code>authorizationNo</code>가 계약대로 연결된다.
- [ ] 같은 <code>merchantRequestId</code> 재시도에서 승인 거래가 중복되지 않는다.
- [ ] 해온카드 공격 콘솔의 Before → 대응 → After와 회원 보호 안내가 정상 결제 회귀와 독립적으로 동작한다.
- [ ] <code>.env</code>와 실행 증거가 Git stage 대상에 포함되지 않는다.
- [ ] 계약·포트·환경 변수 변경 사항을 관련 문서에 함께 반영했다.
