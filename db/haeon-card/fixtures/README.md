# 해온카드 합성 결제·회원 fixture

새 `haeon_card` 볼륨은 MySQL init에서 아래 파일을 이름순으로 적용한다.

| 순서 | 파일 | 내용 |
|---|---|---|
| 001 | `../init/001_haeon_card_schema.sql` | 카드 승인 코어 테이블 |
| 002 | `002_haeon_payment_seed.sql` | 합성 회원·가맹점·카드·한도 초기값 |
| 003 | `003_haeon_payment_baseline.sql` | 카드 API 계약 검증용 기준선 복원 |
| 004 | `../init/004_portal_schema.sql` | 회원 포털 스키마와 세션 |
| 006 | `006_portal_seed.sql` | 회원·보유 카드·가맹점 표시명 |
| 007 | `007_portal_history_seed.sql` | 마이페이지용 과거 승인 13건·거절 3건 |

포털 스키마와 회원 seed는 기존 볼륨에도 재실행할 수 있다. 기존 볼륨에는 init 파일이 자동으로 다시 적용되지 않으므로 필요한 변경분만 직접 넣는다.

```bash
for f in db/haeon-card/init/004_portal_schema.sql \
         db/haeon-card/fixtures/006_portal_seed.sql \
         db/haeon-card/fixtures/007_portal_history_seed.sql; do
  docker exec -i bookwave-haeon-lab-haeon-card-mysql-1 \
    sh -c 'mysql -uroot -proot_lab_only haeon_card' < "$f"
done
```

## 고정 계정과 자료

- 결제 가맹점: `BOOKWAVE-LAB` (표시명 `북웨이브`)
- 회원: `HC-MEMBER-001`(김해온, 카드 `001`·`002`·`003`), `HC-MEMBER-002`(이해온, 카드 `011`)
- 포털 로그인: `haeon01`, `haeon02`; 두 계정의 합성 비밀번호는 `Haeon!2026`
- 가맹점 포털 계정과 진단 대상은 `haeon-merchant-support` 전용 seed에서 관리한다.

`007_portal_history_seed.sql`은 표시용 마이페이지 이용내역이다. 승인 API 계약 검증과 진단 시나리오의 상태를 초기화할 때 이 이용내역을 함께 지우지 않도록 주의한다.

## 결제 API 기준선 복원

`003_haeon_payment_baseline.sql`은 승인 요청·거래·감사 데이터를 삭제하고 합성 카드 사용액을 초기화한다. 기존 승인 데이터를 보존해야 하는 상태에서는 실행하지 않는다. 이 파일은 카드 API/결제 왕복 회귀 검증 전에만 사용한다.

```bash
docker compose exec -T haeon-card-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < /docker-entrypoint-initdb.d/003_haeon_payment_baseline.sql'
```

웹쉘 진단 시나리오의 `reset`은 `lab_` 테이블과 보호 안내만 정리하며 이 결제 기준선 파일을 실행하지 않는다. 진단 시나리오 문서는 [HAEON-DIAG-01](../../../docs/scenarios/haeon-diagnostic-api-attack-scenario-v0.2.md)을 참고한다.
