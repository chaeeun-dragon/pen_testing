-- CARD-03 H0 합성 기준 fixture
-- 신규 haeon_card 스키마에만 자동 적용된다. 실제 카드번호·개인정보는 사용하지 않는다.
-- 한도 100,000원, 초기 사용액 0원, 동시 요청 A/B 각 80,000원.

INSERT IGNORE INTO card_members (member_no, display_name)
VALUES ('HC-MEMBER-001', '회원01');

INSERT IGNORE INTO merchants (merchant_no, name, status)
VALUES ('BOOKWAVE-LAB', '북웨이브 실습 가맹점', 'ACTIVE');

INSERT IGNORE INTO cards (card_token, member_id, card_last4, status, status_version)
SELECT 'card-token-lab-001', member_id, '0001', 'NORMAL', 0
FROM card_members
WHERE member_no = 'HC-MEMBER-001';

INSERT IGNORE INTO card_limits (card_id, limit_amount, used_amount, version)
SELECT card_id, 100000.00, 0.00, 0
FROM cards
WHERE card_token = 'card-token-lab-001';
