SET NAMES utf8mb4;
SET SESSION time_zone = '+00:00';

INSERT IGNORE INTO lab_merchant_accounts
  (merchant_no, login_id, password_salt, password_hash, status)
VALUES
  ('HAEON-MART', 'labmart', '11112222333344445555666677778888', SHA2(CONCAT('11112222333344445555666677778888','LabMart!2026'),256), 'ACTIVE'),
  ('HAEON-CAFE', 'labcafe', '9999aaaabbbbccccddddeeeeffff0000', SHA2(CONCAT('9999aaaabbbbccccddddeeeeffff0000','LabCafe!2026'),256), 'ACTIVE');

INSERT IGNORE INTO lab_diagnostic_targets (target_id, merchant_no, display_name, endpoint_key, status)
VALUES ('diag-target-mart', 'HAEON-MART', '해온마트 결제 연동 점검 대상', 'synthetic-merchant-health', 'ACTIVE'),
       ('diag-target-cafe', 'HAEON-CAFE', '해온카페 결제 연동 점검 대상', 'synthetic-merchant-health', 'ACTIVE');

INSERT IGNORE INTO lab_sensitive_records
  (member_no, support_ref, card_token, card_last4, transaction_ref, amount, occurred_at)
SELECT 'HC-MEMBER-001', CONCAT('SUP-202609-', LPAD(n, 2, '0')), CONCAT('synthetic-token-', LPAD(n, 2, '0')),
       LPAD(2000 + n, 4, '0'), CONCAT('LAB-TXN-', LPAD(n, 3, '0')), 12000 + (n * 1700),
       DATE_SUB('2026-09-20 12:00:00', INTERVAL n DAY)
FROM (SELECT 1 n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
      UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10
      UNION ALL SELECT 11 UNION ALL SELECT 12 UNION ALL SELECT 13 UNION ALL SELECT 14 UNION ALL SELECT 15
      UNION ALL SELECT 16 UNION ALL SELECT 17 UNION ALL SELECT 18 UNION ALL SELECT 19 UNION ALL SELECT 20) nums;
