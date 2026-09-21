-- 해온카드 가상 모의해킹 실습 전용 스키마
-- 실제 고객·카드·자격증명은 저장하지 않는다.
SET NAMES utf8mb4;
SET SESSION time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS lab_merchant_accounts (
  account_id BIGINT NOT NULL AUTO_INCREMENT,
  merchant_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  login_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  password_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  password_salt CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (account_id), UNIQUE KEY uk_lab_merchant_login (login_id),
  KEY ix_lab_merchant_no (merchant_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_merchant_sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  merchant_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(6) NOT NULL,
  PRIMARY KEY (token_hash), KEY ix_lab_merchant_session_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_diagnostic_targets (
  target_id VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  merchant_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  endpoint_key VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (target_id), KEY ix_lab_target_merchant (merchant_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_runs (
  run_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  mode VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  merchant_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  member_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'CREATED',
  alert_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'NONE',
  created_at DATETIME(6) NOT NULL,
  responded_at DATETIME(6) NULL,
  PRIMARY KEY (run_id),
  CONSTRAINT ck_lab_run_mode CHECK (mode IN ('before','after')),
  CONSTRAINT ck_lab_run_status CHECK (status IN ('CREATED','ACTIVE','CONTAINED','CLOSED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_shell_sessions (
  session_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  merchant_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME(6) NOT NULL,
  revoked_at DATETIME(6) NULL,
  PRIMARY KEY (session_id), KEY ix_lab_shell_run (run_id),
  CONSTRAINT fk_lab_shell_run FOREIGN KEY (run_id) REFERENCES lab_runs(run_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_sensitive_records (
  record_id BIGINT NOT NULL AUTO_INCREMENT,
  member_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  support_ref VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  card_token VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  card_last4 CHAR(4) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  transaction_ref VARCHAR(50) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  amount BIGINT NOT NULL,
  occurred_at DATETIME(6) NOT NULL,
  PRIMARY KEY (record_id), UNIQUE KEY uk_lab_support_ref (support_ref),
  KEY ix_lab_sensitive_member (member_no)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_events (
  event_id BIGINT NOT NULL AUTO_INCREMENT,
  run_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  correlation_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_type VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  result VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  detail_json JSON NULL,
  occurred_at DATETIME(6) NOT NULL,
  PRIMARY KEY (event_id), KEY ix_lab_event_run (run_id, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_exfil_records (
  transfer_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  record_count INT NOT NULL DEFAULT 0,
  payload_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  receiver_status VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  received_at DATETIME(6) NULL,
  PRIMARY KEY (transfer_id), KEY ix_lab_exfil_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lab_protection_notices (
  notice_id BIGINT NOT NULL AUTO_INCREMENT,
  member_no VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  run_id VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  notice_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  message VARCHAR(300) NOT NULL,
  acknowledged_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL,
  PRIMARY KEY (notice_id), UNIQUE KEY uk_lab_notice_run_member (member_no, run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
