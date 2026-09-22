-- 해온카드 포털 이용내역 합성 기준 데이터 v1.0
-- 마이페이지 "이용내역"이 처음부터 비어 있지 않도록 haeon01의 승인 13건·거절 3건(총 16건)을 채운다.
-- card-token-lab-001 baseline card has no seeded transactions so normal account history is consistent.
-- 003/004 기준선 복원 SQL은 승인 데이터를 모두 지우므로, 화면 내역이 필요하면 이 파일을 다시 실행한다.
-- 재실행해도 결과가 같다(auth_no 고유키로 중복 방지). 실제 거래·개인정보가 아니다.
SET NAMES utf8mb4;
SET SESSION time_zone = '+00:00';

INSERT IGNORE INTO authorization_requests
  (auth_no, merchant_id, merchant_request_id, request_fingerprint, card_id, channel, currency, amount,
   read_limit_version, read_used_amount, read_card_status_version, isolation_level, instance_id,
   tx_attempt_id, status, decision_code, correlation_id, requested_at, decided_at)
SELECT s.auth_no, m.merchant_id, s.request_id, SHA2(CONCAT(s.auth_no, ':', s.amount), 256), c.card_id,
       'CARD', 'KRW', s.amount, s.read_version, s.read_used, 0, 'READ-COMMITTED', 'haeon-card-seed',
       UUID(), s.status, s.decision_code, CONCAT(s.request_id, '-CORR'), s.occurred_at, s.occurred_at
FROM (
            SELECT 'AUTH-HC-SEED-0001' AS auth_no, 'HC-SEED-0001' AS request_id, 'HAEON-MART'   AS merchant_no, 'card-token-lab-002' AS card_token,    3200 AS amount, 0 AS read_version,      0.00 AS read_used, 'APPROVED' AS status, 'APPROVED'       AS decision_code, '2026-09-04 01:30:00' AS occurred_at
  UNION ALL SELECT 'AUTH-HC-SEED-0002',              'HC-SEED-0002',              'HAEON-CAFE',                'card-token-lab-002',                  5600,              1,                3200.00,            'APPROVED',           'APPROVED',                      '2026-09-05 05:50:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0003',              'HC-SEED-0003',              'HAEON-TRAVEL',              'card-token-lab-002',               4000000,              2,                8800.00,            'DECLINED',           'LIMIT_EXCEEDED',                '2026-09-06 11:15:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0004',              'HC-SEED-0004',              'BOOKWAVE-LAB',              'card-token-lab-002',                 32400,              2,                8800.00,            'APPROVED',           'APPROVED',                      '2026-09-07 09:44:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0005',              'HC-SEED-0005',              'HAEON-MART',                'card-token-lab-002',                 87600,              3,               41200.00,            'APPROVED',           'APPROVED',                      '2026-09-08 02:02:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0006',              'HC-SEED-0006',              'HAEON-MART',                'card-token-lab-002',                 41200,              4,              128800.00,            'APPROVED',           'APPROVED',                      '2026-09-10 06:10:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0007',              'HC-SEED-0007',              'HAEON-MART',                'card-token-lab-002',                  4800,              5,              170000.00,            'APPROVED',           'APPROVED',                      '2026-09-12 03:33:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0008',              'HC-SEED-0008',              'BOOKWAVE-LAB',              'card-token-lab-002',                 38900,              6,              174800.00,            'APPROVED',           'APPROVED',                      '2026-09-13 04:22:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0009',              'HC-SEED-0009',              'HAEON-CAFE',                'card-token-lab-002',                  6300,              7,              213700.00,            'APPROVED',           'APPROVED',                      '2026-09-14 08:12:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0010',              'HC-SEED-0010',              'HAEON-TRAVEL',              'card-token-lab-003',               2000000,              0,                   0.00,            'DECLINED',           'LIMIT_EXCEEDED',                '2026-09-09 12:05:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0011',              'HC-SEED-0011',              'HAEON-TRAVEL',              'card-token-lab-003',               1280000,              0,                   0.00,            'APPROVED',           'APPROVED',                      '2026-09-11 07:20:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0012',              'HC-SEED-0012',              'HAEON-CAFE',                'card-token-lab-011',                  5000,              0,                   0.00,            'APPROVED',           'APPROVED',                      '2026-09-06 10:00:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0013',              'HC-SEED-0013',              'HAEON-MART',                'card-token-lab-011',                 65000,              1,                5000.00,            'APPROVED',           'APPROVED',                      '2026-09-11 08:30:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0014',              'HC-SEED-0014',              'BOOKWAVE-LAB',              'card-token-lab-011',                120000,              2,               70000.00,            'APPROVED',           'APPROVED',                      '2026-09-13 06:00:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0015',              'HC-SEED-0015',              'BOOKWAVE-LAB',              'card-token-lab-002',                 16800,              8,              220000.00,            'APPROVED',           'APPROVED',                      '2026-09-15 03:15:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0016',              'HC-SEED-0016',              'HAEON-CAFE',                'card-token-lab-002',                 12500,              9,              236800.00,            'APPROVED',           'APPROVED',                      '2026-09-16 04:40:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0017',              'HC-SEED-0017',              'HAEON-MART',                'card-token-lab-002',                 27300,             10,              249300.00,            'APPROVED',           'APPROVED',                      '2026-09-17 06:10:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0018',              'HC-SEED-0018',              'HAEON-TRAVEL',              'card-token-lab-002',               3000000,             11,              276600.00,            'DECLINED',           'LIMIT_EXCEEDED',                '2026-09-17 08:35:00'
  UNION ALL SELECT 'AUTH-HC-SEED-0019',              'HC-SEED-0019',              'BOOKWAVE-LAB',              'card-token-lab-002',                 14100,             11,              276600.00,            'APPROVED',           'APPROVED',                      '2026-09-18 01:20:00'
) s
JOIN merchants m ON m.merchant_no = s.merchant_no
JOIN cards c ON c.card_token = s.card_token;

INSERT IGNORE INTO card_transactions (txn_no, auth_id, amount, status, approved_at)
SELECT CONCAT('TXN-HC-', SUBSTRING(a.auth_no, 14)), a.auth_id, a.amount, 'APPROVED', a.decided_at
FROM authorization_requests a
WHERE a.auth_no LIKE 'AUTH-HC-SEED-%' AND a.status = 'APPROVED';

INSERT IGNORE INTO audit_events
  (event_uuid, auth_id, event_type, actor_type, actor_id, action, result, row_count,
   business_ref, correlation_id, payload_hash, details_json, occurred_at)
SELECT UUID(), a.auth_id, 'AUTH_COMMITTED', 'MERCHANT', a.merchant_id, 'AUTHORIZE', a.status,
       IF(a.status = 'APPROVED', 1, 0), a.merchant_request_id, a.correlation_id, a.request_fingerprint,
       JSON_OBJECT('source', 'portal-history-seed', 'readLimitVersion', a.read_limit_version), a.decided_at
FROM authorization_requests a
WHERE a.auth_no LIKE 'AUTH-HC-SEED-%';

-- 승인 합계와 카드 한도 사용액을 일치시킨다 (S = used_amount).
UPDATE card_limits l
JOIN cards c ON c.card_id = l.card_id
JOIN (
            SELECT 'card-token-lab-002' AS card_token,  290700.00 AS used_amount, 12 AS version
  UNION ALL SELECT 'card-token-lab-003',               1280000.00,                1
  UNION ALL SELECT 'card-token-lab-011',                190000.00,                3
) s ON s.card_token = c.card_token
SET l.used_amount = s.used_amount, l.version = s.version;
