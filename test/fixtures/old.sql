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
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `users` WRITE;
INSERT INTO `users` VALUES (1,'Görkem Üveyk','gorkem@example.com','$2y$10$aaaaaaaaaa','2026-04-01 10:00:00'),(2,'Ayşe Demir','ayse@example.com','$2y$10$bbbbbbbbbb','2026-04-15 14:30:00'),(3,'Mehmet Kaya','mehmet@old.com','$2y$10$cccccccccc','2026-04-20 09:15:00');
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
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `posts` WRITE;
INSERT INTO `posts` VALUES (1,1,1,'İlk Yazımız','ilk-yazimiz','Hoş geldiniz. Bu blog''un ilk yazısıdır.','published',142,'2026-04-02 11:00:00','2026-04-02 11:00:00'),(2,1,2,'Laravel İpuçları','laravel-ipuclari','Şunlara dikkat edin: route caching, eager loading.','published',89,'2026-04-10 09:30:00','2026-04-10 09:30:00'),(3,2,1,'Yapay Zeka','yapay-zeka','LLM''ler hakkında düşünceler.','draft',0,'2026-04-18 16:00:00','2026-04-18 16:00:00'),(4,3,3,'Eski Yazı','eski-yazi','Silinecek bir post.','published',5,'2026-04-25 12:00:00','2026-04-25 12:00:00');
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
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `comments` WRITE;
INSERT INTO `comments` VALUES (1,1,2,'Harika bir yazı!','2026-04-03 10:00:00'),(2,2,3,'Eager loading olayını çözemedim.','2026-04-11 14:00:00');
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
INSERT INTO `settings` VALUES (1,'site_title','Benim Blog'),(2,'site_description','Teknoloji ve yazılım üzerine.'),(3,'posts_per_page','10');
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
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4;

LOCK TABLES `media` WRITE;
INSERT INTO `media` VALUES (1,'hero.jpg','image/jpeg',45821,'2026-04-02 10:50:00'),(2,'logo.png','image/png',8420,'2026-04-02 10:55:00');
UNLOCK TABLES;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
-- Dump completed on 2026-05-08 09:00:00
