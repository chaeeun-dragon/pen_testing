-- CARD-03 시연용 기준선 복원 SQL
-- 실제 카드 정보·금융망 없이 합성 데이터로만 실행한다.
-- 시연 목표: 1천만원 한도에서 6백만원 요청 두 건을 비교한다.
-- 승인 데이터를 모두 지우므로 포털 이용내역도 함께 비워진다.
-- 화면 내역이 다시 필요하면 007_portal_history_seed.sql을 이어서 실행한다.

DELETE FROM audit_events;
DELETE FROM card_transactions;
DELETE FROM authorization_requests;

UPDATE card_limits l
JOIN cards c ON c.card_id = l.card_id
SET l.limit_amount = 10000000.00,
    l.used_amount = 0.00,
    l.version = 0
WHERE c.card_token = 'card-token-lab-001';

UPDATE card_limits l
JOIN cards c ON c.card_id = l.card_id
SET l.used_amount = 0.00,
    l.version = 0
WHERE c.card_token <> 'card-token-lab-001';
