# CARD-03 시연 전 리허설 체크리스트

작성일: 2026-09-15
대상: 해온카드 동시 승인·한도 이중 사용 시나리오
목적: 영상 촬영 전에 시나리오가 정해진 순서대로 재현되고, 탐지 증거가 남는지 확인

## 1. 시연에서 보여줄 이야기

```text
정상 결제
  → 같은 요청 재조회는 중복 승인하지 않음
  → 두 결제 요청이 동시에 들어오는 공격 재현
  → Before에서는 같은 한도 값을 읽어 초과 승인
  → After에서는 행 잠금과 최신 값 재판정으로 한 건 거절
  → 로그·DB·화면으로 차이를 증명
```

이 실습은 합성 카드 토큰과 합성 금액만 사용하는 내부 테스트다. 실제 카드번호,
CVC, 금융망, 실제 회원 정보는 사용하지 않는다.

## 2. 촬영 전 체크리스트

### 2.1 환경과 버전

- [ ] WSL에서 프로젝트 루트로 이동했는가
- [ ] 촬영할 Git 커밋 또는 브랜치를 기록했는가
- [ ] `docker compose ps`에서 `bookwave-app`, `mock-pg`, `haeon-card`,
      `haeon-card-mysql`가 healthy인가
- [ ] 해온카드 외부 포트를 사용할 경우 `compose.debug.yaml`을 함께 사용했는가
- [ ] 프론트엔드 변경 후 `bookwave-app` 이미지를 재빌드했는가
- [ ] `AuthorizationRequest`의 고액 시연 상한과 DB CHECK 범위가 일치하는가

### 2.2 고액 시연 프로파일

- [ ] 기존 DB 볼륨에서 `005_card03_demo_amount_range.sql`을 한 번 실행했는가
- [ ] `004_card03_demo_reset.sql` 적용 후 다음 상태인가

```text
limit_amount = 10,000,000
used_amount  = 0
version      = 0
```

- [ ] 요청 금액이 두 건 모두 6,000,000원인가
- [ ] 다른 시연에서 금액을 바꿨다면 `CARD03_REQUEST_AMOUNT`와 DB 한도를 함께
      바꿨는가
- [ ] 화면·로그·DB의 금액 단위가 모두 원 단위로 표시되는가

### 2.3 정상 흐름

- [ ] 정상 승인 1건이 `APPROVED`로 표시되는가
- [ ] 승인 금액이 화면과 API 응답에서 같은가
- [ ] 같은 요청 재조회가 같은 `paymentId`, `pgTid`, `authorizationNo`를 반환하는가
- [ ] 재조회가 새 `authorization_requests`나 `card_transactions`를 만들지 않는가
- [ ] 한도 초과 요청이 `DECLINED`와 `LIMIT_EXCEEDED`로 표시되는가
- [ ] 거절 금액이 0원으로 표시되는가

### 2.4 Before 공격 재현

- [ ] DB 기준선을 다시 복원했는가
- [ ] 해온카드를 `LAB_PROFILE=before`,
      `BEFORE_BARRIER_ENABLED=true`로 재생성했는가
- [ ] 같은 카드 토큰으로 6,000,000원 요청 두 건을 동시에 보냈는가
- [ ] 두 요청의 `merchantRequestId`와 `correlationId`는 서로 다른가
- [ ] 두 응답이 모두 `APPROVED`가 되었는가
- [ ] 두 요청 로그 모두 같은 `readUsedAmount`와
      `readLimitVersion`을 보여주는가
- [ ] DB에서 승인 합계 또는 `used_amount`가 10,000,000원을 초과하는가
- [ ] `version`이 두 번 증가했는가

Before에서 초과 승인이 나오지 않으면 공격 재현이 실패한 것이다. 이 경우 영상
촬영을 진행하지 말고 프로파일, barrier 설정, 기준선 DB를 먼저 확인한다.

### 2.5 After 통제 검증

- [ ] DB를 `004_card03_demo_reset.sql`로 다시 복원했는가
- [ ] 해온카드를 `LAB_PROFILE=after`,
      `BEFORE_BARRIER_ENABLED=false`로 재생성했는가
- [ ] 같은 금액의 동시 요청 두 건을 다시 보냈는가
- [ ] 정확히 한 건만 `APPROVED`인가
- [ ] 나머지 한 건이 `DECLINED`, `LIMIT_EXCEEDED`인가
- [ ] 최종 `used_amount`가 6,000,000원인가
- [ ] 최종 `used_amount`가 `limit_amount`보다 작거나 같은가
- [ ] 승인 거래는 1건, 거절 요청의 거래는 0건인가
- [ ] 승인·거절 모두 `AUTH_COMMITTED` 감사 이벤트가 있는가

## 3. 탐지 자동 점검

탐지 점검기는 공격을 실행하지 않고, 현재 DB와 저장된 서비스 로그를 검사한다.

```bash
SERVICES_LOG=evidence/runs/<실행ID>/services.log \
CORRELATION_IDS=<승인ID>,<거절ID> \
BASELINE_USED_AMOUNT=0 \
EXPECTED_SERVICES=haeon-card \
bash tools/card03-detection-check.sh
```

card03-concurrency.sh는 해온카드 내부 승인 API를 직접 호출하므로
EXPECTED_SERVICES=haeon-card를 사용한다. 북웨이브 → Mock PG → 해온카드 전체
결제 흐름을 점검할 때는 이 값을 생략해 세 서비스를 모두 필수로 검사한다.
`CORRELATION_IDS`(또는 `MERCHANT_REQUEST_IDS`)와 `BASELINE_USED_AMOUNT`는 필수다.
이 값이 없으면 전체 DB를 검사하지 않고 실행을 중단한다.

스크립트가 확인하는 항목:

- 한도보다 큰 승인 합계
- 같은 카드와 `read_limit_version`을 사용한 중복 승인
- 승인 요청과 거래의 연결 여부
- 거래 금액과 승인 금액의 일치 여부
- 승인 요청과 `AUTH_COMMITTED` 감사 이벤트 연결 여부
- `used_amount`와 승인 거래 합계의 일치 여부
- 세 서비스의 `correlationId` 연결 여부

### 기대 결과

| 실행 상태 | 기대 결과 | 의미 |
|---|---|---|
| Before | `ALERT`, `failures=0` | 취약 상태와 탐지 대상이 재현됨 |
| After | `PASS`, `alerts=0`, `failures=0` | 초과 승인과 데이터 불일치가 차단됨 |
| 어느 상태든 | `FAIL` | 로그·DB·감사 연결 중 하나가 깨짐. 촬영 중단 |

생성되는 파일:

- `result.json`: 자동 점검 결과
- `summary.txt`: 사람이 읽는 요약
- `findings.txt`: 규칙별 PASS·ALERT·FAIL
- `db-summary.tsv`: DB 조회 결과
- `correlation-report.tsv`: 서비스별 `correlationId` 확인표

## 4. 영상 촬영 순서

1. 화면에 합성 카드와 1,000만 원 한도를 보여준다.
2. 정상 결제 1건을 실행하고 승인 결과를 보여준다.
3. 같은 요청 재조회를 실행하고 거래번호가 바뀌지 않는 것을 보여준다.
4. DB 기준선을 복원하고 Before 모드로 전환한다.
5. 동시에 두 요청을 보내 승인 2건과 한도 초과 사용액을 보여준다.
6. 로그에서 같은 `readLimitVersion`을 읽은 두 줄을 보여준다.
7. DB 결과와 탐지 스크립트의 `ALERT`를 보여준다.
8. DB 기준선을 다시 복원하고 After 모드로 전환한다.
9. 같은 요청을 다시 보내 1건 승인·1건 거절을 보여준다.
10. 최종 `used_amount`, `version`, 승인·거절 건수를 보여준다.
11. 탐지 스크립트의 `PASS`와 세 서비스 `correlationId` 연결 결과를 보여준다.

## 5. 촬영 중단 기준

다음 중 하나라도 발생하면 결과를 편집으로 숨기지 말고 촬영을 중단한다.

- [ ] 실제 개인정보·카드정보·비밀값이 화면에 노출됨
- [ ] Before가 두 건 승인되지 않거나 After가 두 건 승인됨
- [ ] 화면 결과와 API 응답 또는 DB 결과가 다름
- [ ] `correlationId`가 한 서비스에서 끊김
- [ ] `used_amount`와 승인 거래 합계가 다름
- [ ] 승인 요청·거래·감사 이벤트의 수가 서로 맞지 않음
- [ ] 탐지 스크립트가 `FAIL`을 반환함
- [ ] 테스트 외부의 네트워크나 실제 PG에 요청이 나감

## 6. 촬영 후 정리

- [ ] `003_card03_reset.sql`로 기본 10만 원 기준선을 복원했는가
- [ ] 해온카드를 `LAB_PROFILE=normal`,
      `BEFORE_BARRIER_ENABLED=false`로 복원했는가
- [ ] 서비스가 다시 healthy인지 확인했는가
- [ ] 증거 폴더에 기준선·Before·After·탐지 결과가 모두 있는가
- [ ] 영상에 사용한 실행 ID와 Git 커밋을 기록했는가
- [ ] 실제 정보나 테스트용 비밀값이 증거·영상에 남지 않았는가

## 7. 최종 합격 기준

다음 네 가지가 모두 충족되어야 “시연 가능”으로 판정한다.

1. Before에서 한도 이중 사용이 재현된다.
2. After에서 한도 초과 승인이 차단된다.
3. 로그와 DB로 두 결과의 차이를 설명할 수 있다.
4. 탐지 자동 점검 결과가 Before에서는 `ALERT`, After에서는 `PASS`가 된다.
