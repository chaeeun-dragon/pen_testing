-- 해온카드 H0 전용 신규 기준선 v1.0 / 문서 완전판 v1.1 대응
-- 원본: CARD_모의서비스_DDL_v1.2.sql. 기존 파일/DB를 덮는 마이그레이션이 아니다.
-- MySQL 8.0.16 이상 / InnoDB / UTF-8. 검증용 빈 스키마를 선택한 뒤 1회 실행.
-- DROP, TRUNCATE, 기존 데이터 변경, 샘플 개인정보/비밀은 포함하지 않는다.
-- Core 7개. 직원/앱토큰/상태이벤트/외부PG 테이블은 원본 CARD v1.2에 보존.
-- 모든 금액은 합성 KRW, API는 원 단위 정수 문자열 -> Java BigDecimal 변환.
-- 모든 연결은 UTC. 승인 트랜잭션은 Before/After 모두 READ COMMITTED.
-- 아래 SESSION 설정은 import 연결만 바꾼다. Spring/Hikari의 각 연결에도 적용할 것.
-- 대사기는 별도 READ ONLY REPEATABLE READ 트랜잭션의 한 스냅샷을 사용한다.
-- used_amount <= limit_amount CHECK는 의도적으로 두지 않는다.
-- Before 초과를 관측하고 After 서비스의 잠금/재판정으로 방어하는 실습 설계다.
-- H0에서 취소/매입/환불/카드 상태 변경과 한도 변경은 동결한다.
SET NAMES utf8mb4;
SET SESSION time_zone = '+00:00';
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;

CREATE TABLE card_members (
  member_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '합성 회원 PK',
  member_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '합성 회원번호',
  display_name VARCHAR(80) NOT NULL COMMENT '회원01 같은 합성 표시명',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC 생성 시각',
  PRIMARY KEY (member_id),
  UNIQUE KEY uk_hc_member_no (member_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='해온카드 합성 회원 기준 데이터';

CREATE TABLE merchants (
  merchant_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '가맹점 PK',
  merchant_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '서버 인증 주체 매핑용 번호',
  name VARCHAR(100) NOT NULL COMMENT '합성 가맹점명',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' COMMENT 'ACTIVE 또는 SUSPENDED',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC 생성 시각',
  PRIMARY KEY (merchant_id),
  UNIQUE KEY uk_hc_merchant_no (merchant_no),
  CONSTRAINT ck_hc_merchant_status CHECK (status IN ('ACTIVE','SUSPENDED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='해온카드 합성 가맹점 - 인증 비밀은 DB 외부';

CREATE TABLE cards (
  card_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '카드 PK',
  card_token VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '실제 PAN이 아닌 합성 card_ref',
  member_id BIGINT NOT NULL COMMENT '소유 합성 회원 FK',
  card_last4 CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '합성 끝 네 자리',
  status VARCHAR(20) NOT NULL DEFAULT 'NORMAL' COMMENT 'NORMAL SUSPENDED LOST EXPIRED',
  status_version BIGINT NOT NULL DEFAULT 0 COMMENT 'H0 고정 상태 버전',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC 생성 시각',
  PRIMARY KEY (card_id),
  UNIQUE KEY uk_hc_card_token (card_token),
  KEY ix_hc_card_member (member_id),
  CONSTRAINT fk_hc_card_member FOREIGN KEY (member_id) REFERENCES card_members(member_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_hc_card_status CHECK (status IN ('NORMAL','SUSPENDED','LOST','EXPIRED')),
  CONSTRAINT ck_hc_card_version CHECK (status_version >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='해온카드 합성 카드 - 등록 때 한도 행 함께 생성';

CREATE TABLE card_limits (
  card_id BIGINT NOT NULL COMMENT '카드 PK 겸 FK - 카드당 최대 한 행',
  limit_amount DECIMAL(15,2) NOT NULL COMMENT '합성 이용한도 L',
  used_amount DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '확정 승인 사용액 U',
  version BIGINT NOT NULL DEFAULT 0 COMMENT '성공한 한도 갱신마다 증가',
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6) COMMENT 'UTC 변경 시각',
  PRIMARY KEY (card_id),
  CONSTRAINT fk_hc_limit_card FOREIGN KEY (card_id) REFERENCES cards(card_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_hc_limit_nonnegative CHECK (limit_amount >= 0),
  CONSTRAINT ck_hc_used_nonnegative CHECK (used_amount >= 0),
  CONSTRAINT ck_hc_limit_version CHECK (version >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='H0 경쟁 자원 - After PK 행 잠금 대상';

CREATE TABLE authorization_requests (
  auth_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '승인 요청 PK',
  auth_no VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '외부 합성 승인번호',
  merchant_id BIGINT NOT NULL COMMENT '서버 인증 주체에서 얻는 가맹점 FK',
  merchant_request_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '가맹점 범위 멱등키 - 공백 금지',
  request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '정규화 요청 SHA-256 hex',
  card_id BIGINT NOT NULL COMMENT '승인 대상 카드 FK',
  channel VARCHAR(16) NOT NULL DEFAULT 'CARD' COMMENT 'H0는 CARD만',
  currency CHAR(3) NOT NULL DEFAULT 'KRW' COMMENT 'H0는 KRW만',
  amount DECIMAL(15,2) NOT NULL COMMENT '합성 승인 요청 금액',
  read_limit_version BIGINT NULL COMMENT '실제 판단에 사용한 한도 버전',
  read_used_amount DECIMAL(15,2) NULL COMMENT '실제 판단에 사용한 사용액',
  read_card_status_version BIGINT NULL COMMENT '확인한 카드 상태 버전',
  isolation_level VARCHAR(24) NOT NULL DEFAULT 'READ-COMMITTED' COMMENT '실측 연결 설정 값',
  instance_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '처리 인스턴스',
  tx_attempt_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '이번 확정 시도의 UUID',
  lock_query_elapsed_ms BIGINT NULL COMMENT '잠금 SELECT 왕복 경과 - 순수 대기시간 아님',
  lock_acquired_at DATETIME(6) NULL COMMENT '잠금 SELECT 반환 시각 - Before는 NULL',
  status VARCHAR(20) NOT NULL DEFAULT 'REQUESTED' COMMENT 'REQUESTED는 트랜잭션 내부에서만 사용',
  decision_code VARCHAR(40) NULL COMMENT 'APPROVED LIMIT_EXCEEDED CARD_BLOCKED',
  correlation_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '요청 추적용 - 탐지 정답 아님',
  requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT 'UTC 요청 시각',
  decided_at DATETIME(6) NULL COMMENT 'UTC 업무 판정 시각 - 커밋 시각과 다름',
  PRIMARY KEY (auth_id),
  UNIQUE KEY uk_hc_auth_no (auth_no),
  UNIQUE KEY uk_hc_merchant_request (merchant_id,merchant_request_id),
  UNIQUE KEY uk_hc_tx_attempt (tx_attempt_id),
  KEY ix_hc_auth_card_time (card_id,requested_at),
  KEY ix_hc_auth_correlation (correlation_id),
  CONSTRAINT fk_hc_auth_card FOREIGN KEY (card_id) REFERENCES cards(card_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_hc_auth_merchant FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_hc_request_key CHECK (CHAR_LENGTH(TRIM(merchant_request_id)) > 0),
  CONSTRAINT ck_hc_auth_amount CHECK (amount > 0 AND amount <= 100000 AND amount = FLOOR(amount)),
  CONSTRAINT ck_hc_auth_channel CHECK (channel = 'CARD' AND currency = 'KRW'),
  CONSTRAINT ck_hc_auth_read_version CHECK (read_limit_version IS NULL OR read_limit_version >= 0),
  CONSTRAINT ck_hc_auth_read_used CHECK (read_used_amount IS NULL OR read_used_amount >= 0),
  CONSTRAINT ck_hc_auth_status_version CHECK (read_card_status_version IS NULL OR read_card_status_version >= 0),
  CONSTRAINT ck_hc_auth_lock_ms CHECK (lock_query_elapsed_ms IS NULL OR lock_query_elapsed_ms >= 0),
  CONSTRAINT ck_hc_auth_isolation CHECK (isolation_level = 'READ-COMMITTED'),
  CONSTRAINT ck_hc_auth_state CHECK (
    (status = 'REQUESTED' AND decision_code IS NULL AND decided_at IS NULL)
    OR (status = 'APPROVED' AND decision_code IS NOT NULL AND decision_code = 'APPROVED' AND decided_at IS NOT NULL)
    OR (status = 'DECLINED' AND decision_code IS NOT NULL AND decision_code IN ('LIMIT_EXCEEDED','CARD_BLOCKED') AND decided_at IS NOT NULL)
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='H0 승인·멱등·판정 관측값 - REQUESTED 상태 커밋 금지';

CREATE TABLE card_transactions (
  txn_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '확정 승인 거래 PK',
  txn_no VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '합성 거래번호',
  auth_id BIGINT NOT NULL COMMENT '원 승인 FK 겸 단일 거래 UNIQUE',
  amount DECIMAL(15,2) NOT NULL COMMENT '확정 합성 금액 - 승인 금액과 일치해야 함',
  status VARCHAR(20) NOT NULL DEFAULT 'APPROVED' COMMENT 'H0는 승인만 - 취소·환불 제외',
  approved_at DATETIME(6) NOT NULL COMMENT '업무 승인 시각 - 커밋 확인은 별도 증거',
  PRIMARY KEY (txn_id),
  UNIQUE KEY uk_hc_txn_no (txn_no),
  UNIQUE KEY uk_hc_txn_auth (auth_id),
  CONSTRAINT fk_hc_txn_auth FOREIGN KEY (auth_id) REFERENCES authorization_requests(auth_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_hc_txn_amount CHECK (amount > 0 AND amount <= 100000 AND amount = FLOOR(amount)),
  CONSTRAINT ck_hc_txn_status CHECK (status = 'APPROVED')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='H0 승인 장부 - INV-01~03 대사 대상';

CREATE TABLE audit_events (
  event_id BIGINT NOT NULL AUTO_INCREMENT COMMENT '확정 업무 감사 PK',
  event_uuid CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '수집 중복 제거용 UUID',
  auth_id BIGINT NOT NULL COMMENT '같이 커밋되는 승인 FK',
  event_type VARCHAR(40) NOT NULL COMMENT 'AUTH_COMMITTED - 거절도 결과 필드로 구분',
  actor_type VARCHAR(20) NOT NULL DEFAULT 'MERCHANT' COMMENT 'H0 인증 가맹점',
  actor_id BIGINT NOT NULL COMMENT '가맹점 논리 ID - auth_id를 통해 물리 관계 확인',
  action VARCHAR(24) NOT NULL DEFAULT 'AUTHORIZE' COMMENT '승인 업무',
  result VARCHAR(20) NOT NULL COMMENT 'APPROVED 또는 DECLINED',
  row_count INT NOT NULL COMMENT '생성 거래 수 - 승인1 거절0',
  business_ref VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'merchant_request_id',
  correlation_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT '서비스 요청 상관 ID',
  payload_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'request_fingerprint - 원문 없음',
  details_json JSON NULL COMMENT '버전·인스턴스 등 비민감 진단 - 비밀 저장 금지',
  occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) COMMENT '감사행 생성 시각 - 실제 커밋 시각 아님',
  PRIMARY KEY (event_id),
  UNIQUE KEY uk_hc_audit_uuid (event_uuid),
  UNIQUE KEY uk_hc_audit_auth_event (auth_id,event_type),
  KEY ix_hc_audit_time (occurred_at),
  CONSTRAINT fk_hc_audit_auth FOREIGN KEY (auth_id) REFERENCES authorization_requests(auth_id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT ck_hc_audit_type CHECK (event_type = 'AUTH_COMMITTED' AND actor_type = 'MERCHANT' AND action = 'AUTHORIZE'),
  CONSTRAINT ck_hc_audit_result CHECK ((result = 'APPROVED' AND row_count = 1) OR (result = 'DECLINED' AND row_count = 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='승인과 원자 커밋 - 시도·잠금대기·초기화 로그는 JSONL';

-- 서비스/대사 책임 (DDL 단독으로 강제할 수 없는 교차 테이블 조건)
-- 1. 카드 등록과 card_limits 생성은 같은 트랜잭션. 한도 행 누락 시 승인 거부/오류.
-- 2. APPROVED 승인당 금액 일치 거래 1개, DECLINED 승인당 거래 0개.
-- 3. 동일 승인당 result/row_count가 일치하는 감사 1개. REQUESTED 커밋 0건.
-- 4. S <= limit_amount, S = used_amount. 한도 변경/취소/환불 없는 H0 기준.
-- 5. merchant_request_id는 [A-Za-z0-9_-] 1~80자. SQL CHECK는 빈값만 검사.
-- 6. fingerprint/UUID의 형식은 애플리케이션 검증. 재시도는 같은 키 유지.
-- 7. lock_query_elapsed_ms는 네트워크·실행을 포함. 순수 lock_wait_ms로 부르지 않는다.
-- 8. 과거 CARD v1.2 데이터를 가져오려면 별도 검토된 migration 필요. 이 파일은 빈 스키마 전용.
