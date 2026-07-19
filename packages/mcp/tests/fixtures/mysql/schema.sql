DROP DATABASE IF EXISTS taurus_mcp_test;
CREATE DATABASE taurus_mcp_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE taurus_mcp_test;

CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(191) NOT NULL,
  phone VARCHAR(64) NOT NULL,
  id_card VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  city VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  remark TEXT NULL,
  UNIQUE KEY uk_users_email (email),
  KEY idx_users_status_created_at (status, created_at)
) COMMENT='application users';

CREATE TABLE orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_no VARCHAR(64) NOT NULL,
  user_id BIGINT NOT NULL,
  status VARCHAR(32) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  remark VARCHAR(255) NULL,
  payload_json TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  KEY idx_orders_user_id (user_id),
  KEY idx_orders_status_created_at (status, created_at),
  UNIQUE KEY uk_orders_order_no (order_no),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
) COMMENT='orders for MCP integration tests';

CREATE TABLE payments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  order_id BIGINT NOT NULL,
  channel VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  paid_amount DECIMAL(12,2) NOT NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_payments_order_id (order_id),
  KEY idx_payments_status_paid_at (status, paid_at),
  CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id)
) COMMENT='payments for MCP integration tests';

CREATE TABLE audit_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  event_type VARCHAR(64) NOT NULL,
  actor VARCHAR(64) NOT NULL,
  resource_type VARCHAR(64) NOT NULL,
  resource_id VARCHAR(64) NOT NULL,
  payload_json TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_events_type_created_at (event_type, created_at)
) COMMENT='audit trail';
