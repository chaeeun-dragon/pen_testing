-- Restore the synthetic payment database to its normal baseline.
-- 승인 데이터를 모두 지우므로 포털 이용내역도 함께 비워진다.
-- 화면 내역이 다시 필요하면 007_portal_history_seed.sql을 이어서 실행한다.

DELETE FROM audit_events;
DELETE FROM card_transactions;
DELETE FROM authorization_requests;

-- Restore the baseline card limit and usage.
UPDATE card_limits l
JOIN cards c ON c.card_id = l.card_id
SET l.limit_amount = 100000.00,
    l.used_amount = 0.00,
    l.version = 0
WHERE c.card_token = 'card-token-lab-001';

-- 나머지 카드는 한도를 유지한 채 사용액만 승인 데이터와 맞춘다 (S = used_amount).
UPDATE card_limits l
JOIN cards c ON c.card_id = l.card_id
SET l.used_amount = 0.00,
    l.version = 0
WHERE c.card_token <> 'card-token-lab-001';
