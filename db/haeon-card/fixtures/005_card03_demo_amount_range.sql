-- CARD-03 시연용 금액 범위 확장
-- 기존 볼륨에서 한 번 실행한다. 실제 카드·금융망과 무관한 합성 범위다.
-- 새로 생성되는 DB는 001_haeon_card_schema.sql에 반영된 범위를 사용한다.

SET @drop_auth_check = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'authorization_requests'
      AND constraint_name = 'ck_hc_auth_amount'
  ),
  'ALTER TABLE authorization_requests DROP CHECK ck_hc_auth_amount',
  'SELECT 1'
);
PREPARE stmt FROM @drop_auth_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE authorization_requests
  ADD CONSTRAINT ck_hc_auth_amount
  CHECK (amount > 0 AND amount <= 10000000 AND amount = FLOOR(amount));

SET @drop_txn_check = IF(
  EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'card_transactions'
      AND constraint_name = 'ck_hc_txn_amount'
  ),
  'ALTER TABLE card_transactions DROP CHECK ck_hc_txn_amount',
  'SELECT 1'
);
PREPARE stmt FROM @drop_txn_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE card_transactions
  ADD CONSTRAINT ck_hc_txn_amount
  CHECK (amount > 0 AND amount <= 10000000 AND amount = FLOOR(amount));
