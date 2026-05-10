-- MySQL dump 10.13  Distrib 8.0.36 — edge case suite
/*!40101 SET NAMES utf8mb4 */;

-- ============================================================
-- 1. ESCAPE STYLES: backslash vs doubled quote
-- ============================================================
DROP TABLE IF EXISTS `escapes`;
CREATE TABLE `escapes` (
  `id` int NOT NULL,
  `text` varchar(500),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

INSERT INTO `escapes` VALUES (1,'O\'Brien backslash'),(2,'O''Brien doubled'),(3,'has, comma'),(4,'has (paren) and; semi'),(5,NULL),(6,'with \\ backslash'),(7,'tab\there newline\nhere'),(8,'multi line\nstring with \"quotes\" too');

-- ============================================================
-- 2. JSON COLUMN: nested structures, escaped quotes
-- ============================================================
DROP TABLE IF EXISTS `json_data`;
CREATE TABLE `json_data` (
  `id` int NOT NULL,
  `payload` json,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

INSERT INTO `json_data` VALUES (1,'{\"name\":\"Görkem\",\"tags\":[1,2,3]}'),(2,'{\"with\":\"comma, inside\",\"nested\":{\"a\":1,\"b\":2}}'),(3,NULL),(4,'[\"array\",\"of\",\"strings, with commas\"]');

-- ============================================================
-- 3. BINARY BLOB: hex literal forms
-- ============================================================
DROP TABLE IF EXISTS `binary_blob`;
CREATE TABLE `binary_blob` (
  `id` int NOT NULL,
  `data` blob,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

INSERT INTO `binary_blob` VALUES (1,0xDEADBEEF),(2,_binary 0xCAFEBABE),(3,NULL),(4,0x);

-- ============================================================
-- 4. NUMBER VARIANTS
-- ============================================================
DROP TABLE IF EXISTS `numbers`;
CREATE TABLE `numbers` (
  `id` int NOT NULL,
  `intval` bigint,
  `decval` decimal(20,5),
  `floatval` double,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

INSERT INTO `numbers` VALUES (1,9223372036854775807,1234567890.12345,1.5e10),(2,-9223372036854775808,-0.00001,-3.14),(3,0,0,0),(4,NULL,NULL,NULL);

-- ============================================================
-- 5. COMPOSITE PRIMARY KEY (2 columns)
-- ============================================================
DROP TABLE IF EXISTS `user_roles`;
CREATE TABLE `user_roles` (
  `user_id` int NOT NULL,
  `role_id` int NOT NULL,
  `granted_at` datetime NOT NULL,
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `role_idx` (`role_id`)
) ENGINE=InnoDB;

INSERT INTO `user_roles` VALUES (1,1,'2026-01-01 00:00:00'),(1,2,'2026-02-01 00:00:00'),(2,1,'2026-03-01 00:00:00'),(3,3,'2026-04-01 00:00:00');

-- ============================================================
-- 6. NO PRIMARY KEY (audit log style)
-- ============================================================
DROP TABLE IF EXISTS `audit_log`;
CREATE TABLE `audit_log` (
  `event_type` varchar(50) NOT NULL,
  `payload` text,
  `at` datetime NOT NULL,
  KEY `event_type_idx` (`event_type`)
) ENGINE=InnoDB;

INSERT INTO `audit_log` VALUES ('login','user=1','2026-04-01 10:00:00'),('login','user=2','2026-04-01 11:00:00'),('logout','user=1','2026-04-01 12:00:00');

-- ============================================================
-- 7. MULTI-BYTE UTF-8
-- ============================================================
DROP TABLE IF EXISTS `i18n`;
CREATE TABLE `i18n` (
  `id` int NOT NULL,
  `txt` varchar(500),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `i18n` VALUES (1,'Türkçe çağrışımı: şıkırtı'),(2,'日本語テスト'),(3,'العربية اختبار'),(4,'emoji: 🚀✓😀'),(5,'mixed: hello 世界 مرحبا 🌍');

-- ============================================================
-- 8. VIEW DEFINITION (parser must skip without breaking)
-- ============================================================
DROP VIEW IF EXISTS `posts_view`;
CREATE VIEW `posts_view` AS SELECT 1 AS id, 'placeholder' AS title;

-- ============================================================
-- 9. TRIGGER (parser must not pick up INSERTs inside)
-- ============================================================
DROP TABLE IF EXISTS `triggered`;
CREATE TABLE `triggered` (
  `id` int NOT NULL AUTO_INCREMENT,
  `note` varchar(100),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

INSERT INTO `triggered` VALUES (1,'before trigger'),(2,'still real');

DELIMITER ;;
CREATE TRIGGER `tr_log` AFTER INSERT ON `triggered` FOR EACH ROW BEGIN
  INSERT INTO `audit_log` VALUES ('triggered_insert', NEW.note, NOW());
END ;;
DELIMITER ;
