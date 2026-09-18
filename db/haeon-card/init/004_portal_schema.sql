-- 해온카드 회원 포털(마이페이지) 스키마 확장 v1.0
-- 001_haeon_card_schema.sql의 Core 7개 테이블을 그대로 두고 조회 서비스에 필요한
-- 회원 로그인 정보·카드 표시 정보·세션 테이블만 더한다.
-- 새 볼륨에서는 MySQL init으로 자동 실행되고, 기존 볼륨에서는 수동으로 1회 실행한다.
-- 모든 문장은 재실행해도 안전하도록 information_schema로 존재 여부를 먼저 확인한다.
-- 실제 개인정보·카드번호·비밀번호는 저장하지 않는다. 전부 합성 값이다.
SET NAMES utf8mb4;
SET SESSION time_zone = '+00:00';

-- 컬럼이 없을 때만 ALTER를 실행하는 공통 패턴.
SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'card_members'
                 AND column_name = 'login_id') = 0,
  'ALTER TABLE card_members
     ADD COLUMN login_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT ''포털 로그인 아이디'',
     ADD COLUMN password_salt CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT ''합성 비밀번호 솔트'',
     ADD COLUMN password_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT ''SHA-256(salt||password) hex'',
     ADD UNIQUE KEY uk_hc_member_login (login_id)',
  'DO 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.columns
               WHERE table_schema = DATABASE() AND table_name = 'cards'
                 AND column_name = 'card_name') = 0,
  'ALTER TABLE cards
     ADD COLUMN card_name VARCHAR(60) NOT NULL DEFAULT ''해온카드'' COMMENT ''카드 상품명'',
     ADD COLUMN brand VARCHAR(20) NOT NULL DEFAULT ''국내전용'' COMMENT ''브랜드 표기'',
     ADD COLUMN card_type VARCHAR(20) NOT NULL DEFAULT ''신용'' COMMENT ''신용 또는 체크'',
     ADD COLUMN payment_day TINYINT UNSIGNED NOT NULL DEFAULT 25 COMMENT ''결제일(일)'',
     ADD COLUMN benefit_summary VARCHAR(200) NOT NULL DEFAULT '''' COMMENT ''대표 혜택 한 줄'',
     ADD COLUMN is_primary TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''회원의 주 이용 카드 여부''',
  'DO 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF((SELECT COUNT(*) FROM information_schema.table_constraints
               WHERE constraint_schema = DATABASE() AND table_name = 'cards'
                 AND constraint_name = 'ck_hc_card_payment_day') = 0,
  'ALTER TABLE cards ADD CONSTRAINT ck_hc_card_payment_day CHECK (payment_day BETWEEN 1 AND 28)',
  'DO 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 포털 로그인 세션. 토큰 원문은 저장하지 않고 SHA-256 해시만 보관한다.
CREATE TABLE IF NOT EXISTS member_sessions (
  session_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '세션 PK',
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SHA-256(발급 토큰) hex',
  member_id BIGINT NOT NULL COMMENT '로그인한 합성 회원 FK',
  issued_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC 발급 시각',
  expires_at DATETIME(6) NOT NULL COMMENT 'UTC 만료 시각',
  revoked_at DATETIME(6) NULL COMMENT '로그아웃 시각',
  PRIMARY KEY (session_id),
  UNIQUE KEY uk_hc_session_token (token_hash),
  KEY ix_hc_session_member (member_id, expires_at),
  CONSTRAINT fk_hc_session_member FOREIGN KEY (member_id) REFERENCES card_members(member_id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='해온카드 포털 로그인 세션';

-- 조회 서비스 책임 (DDL로 강제할 수 없는 조건)
-- 1. 포털 조회 API는 항상 세션의 member_id로 카드·거래를 제한한다. 요청 값으로 회원을 고르지 않는다.
-- 2. card_limits.version은 CARD-03 증거·운영 확인용으로만 보관하며 회원 화면에 노출하지 않는다.
-- 3. 세션 토큰 원문은 로그·증거 파일에 남기지 않는다.
