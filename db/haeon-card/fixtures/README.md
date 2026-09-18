# 해온카드 합성 fixture

새 `haeon_card` 볼륨을 처음 만들 때 MySQL init이 다음 순서로 실행한다.

| 순서 | 파일 | 내용 |
|---|---|---|
| 001 | `../init/001_haeon_card_schema.sql` | Core 7개 테이블 |
| 002 | `002_card03_baseline.sql` | CARD-03 기준 회원·가맹점·카드·한도 |
| 003 | `003_card03_reset.sql` | 기준선 복원 |
| 004 | `../init/004_portal_schema.sql` | 회원 포털용 컬럼과 `member_sessions` |
| 006 | `006_portal_seed.sql` | 회원 2명·보유 카드 4장·가맹점 표시명 |
| 007 | `007_portal_history_seed.sql` | 마이페이지 이용내역용 과거 승인 13건·거절 3건(총 16건) |

004·006·007은 재실행해도 결과가 같다. 기존 볼륨에는 init이 다시 돌지 않으므로 직접 넣는다.

```bash
for f in db/haeon-card/init/004_portal_schema.sql \
         db/haeon-card/fixtures/006_portal_seed.sql \
         db/haeon-card/fixtures/007_portal_history_seed.sql; do
  docker exec -i bookwave-haeon-lab-haeon-card-mysql-1 \
    sh -c 'mysql -uroot -proot_lab_only haeon_card' < "$f"
done
```

## 고정 입력

- 가맹점: `BOOKWAVE-LAB`(표시명 `북웨이브`), 표시용 `HAEON-MART`·`HAEON-CAFE`·`HAEON-TRAVEL`
- CARD-03 대상 카드: `card-token-lab-001` / 한도 `100000` / 초기 사용액 `0`
- CARD-03 요청 A/B: 서로 다른 `merchantRequestId`, 각 `80000`
- 회원: `HC-MEMBER-001`(김해온, 카드 `001`·`002`·`003`), `HC-MEMBER-002`(이해온, 카드 `011`)
- 포털 로그인: `haeon01` / `haeon02`, 비밀번호는 둘 다 `Haeon!2026` (합성 값)

`007_portal_history_seed.sql`은 `card-token-lab-001`에 아무 행도 넣지 않는다. CARD-03 증거
집계를 건드리지 않기 위해서다.

## 기준선 복원

```bash
docker compose exec -T haeon-card-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < /docker-entrypoint-initdb.d/003_card03_reset.sql'
```

`003`(한도 100,000)과 `004_card03_demo_reset.sql`(한도 10,000,000)은 `card-token-lab-001`의
한도만 실습 값으로 되돌린다. 나머지 카드는 한도를 유지한 채 사용액만 0으로 맞춘다.

두 파일 모두 승인·거래·감사 데이터를 전부 지우므로 마이페이지 이용내역도 함께 비워진다.
화면 내역이 다시 필요하면 `007_portal_history_seed.sql`을 이어서 실행하거나, 북웨이브에서
결제를 한 건 진행한다.

기존 볼륨에서 다시 기준선을 만들 때는 먼저 Before/After 증거를 보존한다. 운영 데이터에 이
fixture를 적용하지 않는다.
