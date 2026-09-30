-- Isolated CARD-03 filming experiment. Never touches cards/card_limits/authorizations.
USE haeon_card;
CREATE TABLE IF NOT EXISTS lab_card03_limits (
  run_id VARCHAR(80) PRIMARY KEY,
  limit_amount BIGINT NOT NULL,
  used_amount BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS lab_card03_approvals (
  run_id VARCHAR(80) NOT NULL,
  request_id VARCHAR(100) NOT NULL,
  amount BIGINT NOT NULL,
  observed_used BIGINT NOT NULL,
  result VARCHAR(20) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY(run_id,request_id)
) ENGINE=InnoDB;
GRANT SELECT,INSERT,UPDATE,DELETE ON haeon_card.lab_card03_limits TO 'haeon_lab_support'@'%';
GRANT SELECT,INSERT,UPDATE,DELETE ON haeon_card.lab_card03_approvals TO 'haeon_lab_support'@'%';
