-- CARD-03 실험 재실행용 기준선 복원 SQL
-- Before/After 증거와 manifest를 먼저 보존한 뒤, 합성 실습 DB에서만 실행한다.

DELETE FROM audit_events;
DELETE FROM card_transactions;
DELETE FROM authorization_requests;

UPDATE card_limits
SET used_amount = 0.00,
    version = 0;
