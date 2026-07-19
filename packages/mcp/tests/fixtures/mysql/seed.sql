USE taurus_mcp_test;

INSERT INTO users (email, phone, id_card, status, city, created_at, updated_at, remark) VALUES
('alice@example.com', '13800000001', 'ID-ALICE-001', 'active', 'shanghai', '2026-04-10 09:00:00', '2026-04-10 09:00:00', 'vip user with long remark for sample testing'),
('bob@example.com', '13800000002', 'ID-BOB-002', 'active', 'beijing', '2026-04-11 10:30:00', '2026-04-11 10:30:00', 'normal user'),
('carol@example.com', '13800000003', 'ID-CAROL-003', 'inactive', 'shenzhen', '2026-04-12 14:15:00', '2026-04-12 14:15:00', 'legacy account');

INSERT INTO orders (order_no, user_id, status, amount, remark, payload_json, created_at, updated_at) VALUES
('ORD-1001', 1, 'paid', 128.50, 'first paid order', '{"source":"web","campaign":"spring"}', '2026-04-12 09:10:00', '2026-04-12 09:10:00'),
('ORD-1002', 1, 'pending', 88.00, 'awaiting payment', '{"source":"app","campaign":"promo-a"}', '2026-04-13 11:20:00', '2026-04-13 11:20:00'),
('ORD-1003', 2, 'paid', 256.00, 'corporate purchase', '{"source":"api","campaign":"partner"}', '2026-04-14 15:40:00', '2026-04-14 15:40:00'),
('ORD-1004', 3, 'cancelled', 32.99, 'cancelled before shipment', '{"source":"web","campaign":"clearance"}', '2026-04-15 08:05:00', '2026-04-15 08:05:00');

INSERT INTO payments (order_id, channel, status, paid_amount, paid_at, created_at) VALUES
(1, 'wechat', 'paid', 128.50, '2026-04-12 09:12:00', '2026-04-12 09:12:00'),
(3, 'alipay', 'paid', 256.00, '2026-04-14 15:45:00', '2026-04-14 15:45:00');

INSERT INTO audit_events (event_type, actor, resource_type, resource_id, payload_json, created_at) VALUES
('order_created', 'system', 'order', 'ORD-1001', '{"status":"paid"}', '2026-04-12 09:10:01'),
('order_paid', 'system', 'order', 'ORD-1001', '{"channel":"wechat"}', '2026-04-12 09:12:05'),
('order_created', 'system', 'order', 'ORD-1003', '{"status":"paid"}', '2026-04-14 15:40:03');
