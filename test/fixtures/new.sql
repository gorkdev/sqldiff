-- MySQL dump 10.13  Distrib 8.0.36, for Linux (x86_64)
--
-- Host: localhost    Database: blog
-- ------------------------------------------------------
-- Server version	8.0.36

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) NOT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_email_unique` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `users` WRITE;
INSERT INTO `users` VALUES (1,'Görkem Üveyk','gorkem@example.com','$2y$10$aaaaaaaaaa','2026-04-01 10:00:00'),(2,'Ayşe Demir','ayse@example.com','$2y$10$bbbbbbbbbb','2026-04-15 14:30:00'),(3,'Mehmet Kaya','mehmet@new.com','$2y$10$cccccccccc','2026-04-20 09:15:00'),(4,'Zeynep Aydın','zeynep@example.com','$2y$10$dddddddddd','2026-05-08 16:20:00'),(5,'Can Şahin','can@example.com','$2y$10$eeeeeeeeee','2026-05-09 11:45:00');
UNLOCK TABLES;

--
-- Table structure for table `categories`
--

DROP TABLE IF EXISTS `categories`;
CREATE TABLE `categories` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `slug` varchar(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `categories_slug_unique` (`slug`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `categories` WRITE;
INSERT INTO `categories` VALUES (1,'Teknoloji','teknoloji'),(2,'Yazılım','yazilim'),(3,'Tasarım','tasarim');
UNLOCK TABLES;

--
-- Table structure for table `posts`
--

DROP TABLE IF EXISTS `posts`;
CREATE TABLE `posts` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `user_id` int unsigned NOT NULL,
  `category_id` int unsigned NOT NULL,
  `title` varchar(255) NOT NULL,
  `slug` varchar(255) NOT NULL,
  `body` text NOT NULL,
  `status` enum('draft','published') NOT NULL DEFAULT 'draft',
  `view_count` int unsigned NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `posts_slug_unique` (`slug`),
  KEY `posts_user_id_idx` (`user_id`),
  KEY `posts_category_id_idx` (`category_id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `posts` WRITE;
INSERT INTO `posts` VALUES (1,1,1,'İlk Yazımız','ilk-yazimiz','Hoş geldiniz. Bu blog''un ilk yazısıdır.','published',198,'2026-04-02 11:00:00','2026-04-02 11:00:00'),(2,1,2,'Laravel İpuçları','laravel-ipuclari','Şunlara dikkat edin: route caching, eager loading.','published',124,'2026-04-10 09:30:00','2026-04-10 09:30:00'),(3,2,1,'Yapay Zeka','yapay-zeka','LLM''ler hakkında düşünceler.','published',12,'2026-04-18 16:00:00','2026-05-09 08:00:00'),(5,1,2,'Next.js 16 Çıktı','nextjs-16-cikti','Yeni özellikler: cache components, view transitions.','published',54,'2026-05-08 13:00:00','2026-05-08 13:00:00'),(6,2,3,'Tasarım Trendleri 2026','tasarim-trendleri-2026','Bu yıl öne çıkanlar: brutalism, neo-skeuomorphism.','published',31,'2026-05-09 10:00:00','2026-05-09 10:00:00');
UNLOCK TABLES;

--
-- Table structure for table `comments`
--

DROP TABLE IF EXISTS `comments`;
CREATE TABLE `comments` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `post_id` int unsigned NOT NULL,
  `user_id` int unsigned NOT NULL,
  `body` text NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `comments_post_id_idx` (`post_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `comments` WRITE;
INSERT INTO `comments` VALUES (1,1,2,'Harika bir yazı!','2026-04-03 10:00:00'),(2,2,3,'Eager loading olayını çözemedim.','2026-04-11 14:00:00'),(3,5,4,'Cache components olayı süper.','2026-05-09 09:30:00'),(4,1,5,'Geç de olsa okudum, teşekkürler.','2026-05-09 12:00:00'),(5,6,1,'Brutalism geri dönüyor demek :)','2026-05-09 14:00:00');
UNLOCK TABLES;

--
-- Table structure for table `settings`
--

DROP TABLE IF EXISTS `settings`;
CREATE TABLE `settings` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `settings_setting_key_unique` (`setting_key`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `settings` WRITE;
INSERT INTO `settings` VALUES (1,'site_title','Benim Blog'),(2,'site_description','Teknoloji ve yazılım üzerine.'),(3,'posts_per_page','15');
UNLOCK TABLES;

--
-- Table structure for table `media`
--

DROP TABLE IF EXISTS `media`;
CREATE TABLE `media` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) NOT NULL,
  `mime` varchar(100) NOT NULL,
  `size` int unsigned NOT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `media` WRITE;
INSERT INTO `media` VALUES (1,'hero.jpg','image/jpeg',45821,'2026-04-02 10:50:00'),(2,'logo.png','image/png',8420,'2026-04-02 10:55:00'),(3,'next16-banner.png','image/png',32015,'2026-05-08 12:55:00'),(4,'design-trends-cover.jpg','image/jpeg',58200,'2026-05-09 09:55:00');
UNLOCK TABLES;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
-- Dump completed on 2026-05-10 14:00:00
