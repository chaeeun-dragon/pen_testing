# CARD-03 동시 승인·한도 이중 사용 Before/After 검증 기록

검증일: 2026-09-15
대상: 해온카드 합성 승인 API
요청: 동일 카드에 80,000원 승인 요청 2건을 동시에 전송
초기 한도: 100,000원 / 사용액 0원

## 1. 검증 목적

두 요청이 카드 한도 행을 동시에 읽을 때 같은 금액을 두 번 승인하는지 확인하고,
행 잠금 적용 후에는 한도 초과 요청이 거절되는지 비교한다.

실제 카드번호·CVC·금융망은 사용하지 않았으며, `card-token-lab-001` 합성 토큰만
사용했다.

## 2. 결과 요약

| 구분 | 요청 결과 | 최종 사용액 | 판단 |
|---|---|---:|---|
| Before | 80,000원 승인 2건 | 160,000원 | 취약 상태 재현. 한도 이중 사용 |
| After | 80,000원 승인 1건 + 1건 거절 | 80,000원 | 행 잠금으로 초과 승인 차단 |

## 3. Before 결과

실행 프로파일: `LAB_PROFILE=before`, `BEFORE_BARRIER_ENABLED=true`
증거 폴더: `evidence/runs/CARD03-BEFORE-20260915T005643Z/`

응답 A와 B 모두 다음과 같이 승인됐다.

```json
{
  "decision": "APPROVED",
  "approvedAmount": 80000,
  "reasonCode": "APPROVED"
}
```

DB 결과:

```text
card_id  limit_amount  used_amount  version
1        100000.00     160000.00    2

status    decision_code  count
APPROVED  APPROVED       2

approved_total
160000.00
```

핵심 로그에서는 두 요청이 모두 `readUsedAmount=0.00`과
`readLimitVersion=0`을 읽은 것이 확인된다. 이것이 같은 오래된 한도 스냅샷을
사용한 원인이다.

## 4. After 결과

실행 프로파일: `LAB_PROFILE=after`, `BEFORE_BARRIER_ENABLED=false`
증거 폴더: `evidence/runs/CARD03-AFTER-20260915T005920Z/`

응답 A:

```json
{
  "decision": "APPROVED",
  "approvedAmount": 80000,
  "reasonCode": "APPROVED"
}
```

응답 B:

```json
{
  "decision": "DECLINED",
  "approvedAmount": 0,
  "reasonCode": "LIMIT_EXCEEDED"
}
```

DB 결과:

```text
card_id  limit_amount  used_amount  version
1        100000.00     80000.00     1

status    decision_code  count
APPROVED  APPROVED       1
DECLINED  LIMIT_EXCEEDED 1

approved_total
80000.00
```

핵심 로그에서는 첫 요청이 `readUsedAmount=0.00`을 읽어 승인한 뒤,
두 번째 요청이 `readUsedAmount=80000.00`과 `readLimitVersion=1`을 읽고
거절된 것이 확인된다.

## 5. 시나리오에서 보여줄 내용

1. 공격 전: 한도 100,000원, 사용액 0원
2. 동시에 80,000원 요청 2건 전송
3. Before: 화면에는 승인 2건, DB에는 사용액 160,000원
4. 통제 적용: 카드 한도 행을 잠그고 최신 사용액으로 재판정
5. After: 1건 승인·1건 거절, DB 사용액 80,000원
6. 로그의 `limit_read`, `auth_committed`, `decision_code`로 결과 증명

## 6. 재실행 명령

프로젝트 루트에서 합성 DB를 기준선으로 복원한 후 실행한다.

```bash
docker compose exec -T haeon-card-mysql mysql \
  -uroot -p"$HAEON_DB_ROOT_PASSWORD" haeon_card \
  < db/haeon-card/fixtures/003_card03_reset.sql

LAB_PROFILE=before BEFORE_BARRIER_ENABLED=true \
  docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card
LAB_PROFILE=before bash tools/card03-concurrency.sh

docker compose exec -T haeon-card-mysql mysql \
  -uroot -p"$HAEON_DB_ROOT_PASSWORD" haeon_card \
  -e 'SELECT card_id,limit_amount,used_amount,version FROM card_limits;'
```

After도 같은 순서로 `LAB_PROFILE=after BEFORE_BARRIER_ENABLED=false`를 적용해
실행한다. 실습이 끝난 뒤에는 `normal` 프로파일과 기준선 DB로 복원한다.
