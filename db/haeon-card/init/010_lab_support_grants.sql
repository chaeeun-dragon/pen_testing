-- 가상 진단 지원 서비스 전용 DB 계정. 승인·한도·회원 비밀번호 테이블에는 권한이 없다.
CREATE USER IF NOT EXISTS 'haeon_lab_support'@'%' IDENTIFIED BY 'haeon_lab_support_only';
GRANT SELECT, INSERT, UPDATE, DELETE ON haeon_card.lab_merchant_accounts TO 'haeon_lab_support'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON haeon_card.lab_merchant_sessions TO 'haeon_lab_support'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON haeon_card.lab_diagnostic_targets TO 'haeon_lab_support'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON haeon_card.lab_runs TO 'haeon_lab_support'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON haeon_card.lab_shell_sessions TO 'haeon_lab_support'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON haeon_card.lab_sensitive_records TO 'haeon_lab_support'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON haeon_card.lab_events TO 'haeon_lab_support'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON haeon_card.lab_exfil_records TO 'haeon_lab_support'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON haeon_card.lab_protection_notices TO 'haeon_lab_support'@'%';
FLUSH PRIVILEGES;
