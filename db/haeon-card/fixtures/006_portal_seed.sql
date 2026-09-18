-- 해온카드 포털 합성 기준 데이터 v1.0
-- 회원 2명, 보유 카드 4장, 가맹점 표시명을 만든다. 재실행해도 결과가 같다.
-- 실제 개인정보·카드번호·비밀번호가 아니다. 전부 팀 프로젝트용 합성 값이다.
-- 로그인 계정(공개 합성값): haeon01 / Haeon!2026 , haeon02 / Haeon!2026
-- 비밀번호는 SHA-256(salt || password) hex로 보관한다. 애플리케이션도 같은 방식으로 검증한다.
SET NAMES utf8mb4;
SET SESSION time_zone = '+00:00';

-- 1) 회원
INSERT IGNORE INTO card_members (member_no, display_name) VALUES
  ('HC-MEMBER-001', '김해온'),
  ('HC-MEMBER-002', '이해온');

UPDATE card_members SET
  display_name = '김해온',
  login_id = 'haeon01',
  password_salt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  password_hash = SHA2(CONCAT('a1b2c3d4e5f60718293a4b5c6d7e8f90', 'Haeon!2026'), 256)
WHERE member_no = 'HC-MEMBER-001';

UPDATE card_members SET
  display_name = '이해온',
  login_id = 'haeon02',
  password_salt = '0f1e2d3c4b5a69788796a5b4c3d2e1f0',
  password_hash = SHA2(CONCAT('0f1e2d3c4b5a69788796a5b4c3d2e1f0', 'Haeon!2026'), 256)
WHERE member_no = 'HC-MEMBER-002';

-- 2) 가맹점 표시명 (승인 주체는 서버 인증 토큰에서만 결정된다. 여기 값은 표시용이다.)
INSERT IGNORE INTO merchants (merchant_no, name, status) VALUES
  ('BOOKWAVE-LAB', '북웨이브', 'ACTIVE'),
  ('HAEON-MART', '해온마트', 'ACTIVE'),
  ('HAEON-CAFE', '해온카페', 'ACTIVE'),
  ('HAEON-TRAVEL', '해온여행', 'ACTIVE');

UPDATE merchants SET name = '북웨이브' WHERE merchant_no = 'BOOKWAVE-LAB';

-- 3) 보유 카드
-- 주 이용 카드는 해온 데일리(card-token-lab-002)다. card-token-lab-001은 CARD-03 기준선
-- 카드라 한도가 100,000으로 고정되어 있어 회원 화면의 대표 카드로 쓰지 않는다.
INSERT IGNORE INTO cards (card_token, member_id, card_last4, status, status_version)
SELECT s.card_token, m.member_id, s.card_last4, 'NORMAL', 0
FROM (
            SELECT 'card-token-lab-001' AS card_token, 'HC-MEMBER-001' AS member_no, '0001' AS card_last4
  UNION ALL SELECT 'card-token-lab-002',                'HC-MEMBER-001',              '0002'
  UNION ALL SELECT 'card-token-lab-003',                'HC-MEMBER-001',              '0003'
  UNION ALL SELECT 'card-token-lab-011',                'HC-MEMBER-002',              '0011'
) s
JOIN card_members m ON m.member_no = s.member_no;

UPDATE cards c
JOIN (
            SELECT 'card-token-lab-001' AS card_token, '해온 플러스' AS card_name, 'Mastercard' AS brand, '신용' AS card_type, 25 AS payment_day, 0 AS is_primary, '주요 쇼핑몰 10% · 외식·배달 5% · 모든 가맹점 2%' AS benefit_summary
  UNION ALL SELECT 'card-token-lab-002',                '해온 데일리',                '국내전용',          '신용',              25,                 1,                 '온라인 쇼핑 10% · 편의점·커피 5% · 대중교통 3%'
  UNION ALL SELECT 'card-token-lab-003',                '해온 트래블',                'Visa',              '신용',              14,                 0,                 '해외 결제 2% · 해외 수수료 0원 · 공항 라운지 무료'
  UNION ALL SELECT 'card-token-lab-011',                '해온 데일리',                '국내전용',          '신용',              25,                 1,                 '온라인 쇼핑 10% · 편의점·커피 5% · 대중교통 3%'
) s ON s.card_token = c.card_token
SET c.card_name = s.card_name, c.brand = s.brand, c.card_type = s.card_type,
    c.payment_day = s.payment_day, c.is_primary = s.is_primary, c.benefit_summary = s.benefit_summary;

-- 4) 카드별 이용한도 (card-token-lab-001은 CARD-03 기준선 100,000을 유지한다)
INSERT IGNORE INTO card_limits (card_id, limit_amount, used_amount, version)
SELECT c.card_id, s.limit_amount, 0.00, 0
FROM (
            SELECT 'card-token-lab-001' AS card_token,  100000.00 AS limit_amount
  UNION ALL SELECT 'card-token-lab-002',               3000000.00
  UNION ALL SELECT 'card-token-lab-003',               2000000.00
  UNION ALL SELECT 'card-token-lab-011',               1500000.00
) s
JOIN cards c ON c.card_token = s.card_token;

UPDATE card_limits l
JOIN cards c ON c.card_id = l.card_id
JOIN (
            SELECT 'card-token-lab-002' AS card_token, 3000000.00 AS limit_amount
  UNION ALL SELECT 'card-token-lab-003',               2000000.00
  UNION ALL SELECT 'card-token-lab-011',               1500000.00
) s ON s.card_token = c.card_token
SET l.limit_amount = s.limit_amount;
