-- CARD-03 실험 재실행용 기준선 복원 SQL
-- Before/After 증거와 manifest를 먼저 보존한 뒤, 합성 DB에서만 실행한다.
-- 승인 데이터를 모두 지우므로 포털 이용내역도 함께 비워진다.
-- 화면 내역이 다시 필요하면 007_portal_history_seed.sql을 이어서 실행한다.

DELETE FROM audit_events;
DELETE FROM card_transactions;
DELETE FROM authorization_requests;

-- CARD-03 대상 카드만 실험 기준선으로 되돌린다.
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
