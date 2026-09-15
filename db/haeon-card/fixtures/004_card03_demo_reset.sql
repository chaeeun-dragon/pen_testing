-- CARD-03 시연용 기준선 복원 SQL
-- 실제 카드 정보·금융망 없이 합성 데이터로만 실행한다.
-- 시연 목표: 1천만원 한도에서 6백만원 요청 두 건을 비교한다.

DELETE FROM audit_events;
DELETE FROM card_transactions;
DELETE FROM authorization_requests;

UPDATE card_limits
SET limit_amount = 10000000.00,
    used_amount = 0.00,
    version = 0;
