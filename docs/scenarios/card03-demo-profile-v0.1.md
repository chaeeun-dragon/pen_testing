# CARD-03 시연용 금액 프로파일

작성일: 2026-09-15
대상: 해온카드 CARD-03 동시 승인·한도 이중 사용 시나리오

## 1. 왜 별도 프로파일을 사용하는가

기존 `lab` 값은 빠르고 안전한 자동 테스트를 위한 작은 금액이다. 발표나 시연에서
화면의 피해 차이를 분명하게 보여주려면 더 큰 금액이 좋다. 두 목적의 데이터를
섞으면 기준선 복원과 재현 결과가 달라질 수 있으므로, DB 초기화 SQL과 실행 스크립트
모두에서 `lab`와 `demo`를 분리한다.

## 2. 프로파일 값

| 프로파일 | 초기 한도 | 동시 요청 금액 | Before 기대 결과 | After 기대 결과 |
|---|---:|---:|---|---|
| `lab` (기본) | 100,000원 | 80,000원 × 2 | 160,000원 승인 가능 상태 재현 | 1건 승인 + 1건 `LIMIT_EXCEEDED` |
| `demo` | 10,000,000원 | 6,000,000원 × 2 | 12,000,000원 승인 가능 상태 재현 | 1건 승인 + 1건 `LIMIT_EXCEEDED` |

두 프로파일 모두 합성 토큰 `card-token-lab-001`만 사용한다. 금액이 커져도 실제
결제나 실제 카드 한도가 아니다.

## 3. 시연 실행 순서

프로젝트 루트(`/mnt/c/study/docker/bookwave-haeon-lab`)에서 실행한다.

기존 DB 볼륨은 시연 전에 금액 범위 migration을 한 번만 실행한다. 새로 만든 DB는
수정된 schema를 사용하므로 이 단계가 필요 없다.

```bash
docker compose --env-file .env exec -T haeon-card-mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  < db/haeon-card/fixtures/005_card03_demo_amount_range.sql
```

### 3.1 시연 기준선 복원

```bash
docker compose --env-file .env exec -T haeon-card-mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  < db/haeon-card/fixtures/004_card03_demo_reset.sql
```

### 3.2 Before 재현

```bash
LAB_PROFILE=before BEFORE_BARRIER_ENABLED=true \
  docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card

LAB_PROFILE=before BEFORE_BARRIER_ENABLED=true \
CARD03_SCENARIO_PROFILE=demo \
bash tools/card03-concurrency.sh
```

기대 결과는 두 요청 모두 승인되고, `card_limits.used_amount`가 12,000,000원이
되는 것이다. 테스트가 끝나면 DB를 다시 기준선으로 복원한다.

### 3.3 After 검증

```bash
docker compose --env-file .env exec -T haeon-card-mysql \
  sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' \
  < db/haeon-card/fixtures/004_card03_demo_reset.sql

LAB_PROFILE=after BEFORE_BARRIER_ENABLED=false \
  docker compose -f compose.yaml -f compose.debug.yaml --env-file .env \
  up -d --force-recreate haeon-card

LAB_PROFILE=after BEFORE_BARRIER_ENABLED=false \
CARD03_SCENARIO_PROFILE=demo \
bash tools/card03-concurrency.sh
```

기대 결과는 6,000,000원 1건 승인과 1건 `LIMIT_EXCEEDED` 거절이며, 최종
`used_amount`는 6,000,000원이다.

## 4. 나중에 금액을 바꾸는 방법

`demo`의 기본 요청 금액은 6,000,000원이다. 별도 프로파일을 새로 만들지 않고
시험적으로 금액만 바꾸려면 다음처럼 덮어쓸 수 있다.

```bash
CARD03_SCENARIO_PROFILE=demo CARD03_REQUEST_AMOUNT=3000000 \
  LAB_PROFILE=after BEFORE_BARRIER_ENABLED=false \
  bash tools/card03-concurrency.sh
```

이 경우 초기 DB 한도도 요청 두 건의 합계보다 크거나 작도록 의도적으로 맞춘 뒤
실행한다. 영구적인 시연 금액을 정할 때는 별도 SQL fixture를 추가해 실행 기록과
함께 보관한다.

## 5. 주의사항

- `LAB_PROFILE`은 서버의 Before/After 동작을 선택하는 값이고,
  `CARD03_SCENARIO_PROFILE`은 금액·DB 기준선을 선택하는 값이다.
- 시연이 끝나면 `003_card03_reset.sql`로 실습 기본값(10만원 한도)으로 복원한다.
- 합성 토큰과 합성 금액만 사용하며 실제 카드번호·CVC·결제망을 연결하지 않는다.
