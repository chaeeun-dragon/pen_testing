# 해온카드 합성 fixture

`002_card03_baseline.sql`은 새 `haeon_card` 볼륨을 처음 만들 때 MySQL init 스크립트로 실행된다.

## 고정 입력

- 가맹점: `BOOKWAVE-LAB`
- 카드 토큰: `card-token-lab-001`
- 한도: `100000`
- 초기 사용액: `0`
- CARD-03 요청 A/B: 서로 다른 `merchantRequestId`, 각 `80000`

기존 볼륨에서 다시 기준선을 만들 때는 먼저 Before/After 증거를 보존한 뒤 별도 초기화 절차를 사용한다. 운영 데이터에 이 fixture를 적용하지 않는다.

재실행 전 기준선 복원:

```bash
docker compose exec -T haeon-card-mysql sh -c 'mysql -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE" < /docker-entrypoint-initdb.d/003_card03_reset.sql'
```
