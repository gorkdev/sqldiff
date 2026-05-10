# Edge Cases ve Sınırlar

`test/fixtures/edge_old.sql` ve `edge_new.sql` dosyaları aşağıdaki tüm senaryoları kapsayan bir test suite'idir. Her satırda gerçek dump çıktılarında karşılaşılabilecek bir özel duruma örnek vardır.

---

## Desteklenen edge case'ler

### 1. String escape — iki stil

mysqldump çıktısı `SQL_MODE`'a göre ya backslash ya doubled-quote escape üretir. Parser ikisini de tanır:

```sql
INSERT INTO `escapes` VALUES
  (1, 'O\'Brien backslash'),    -- backslash escape
  (2, 'O''Brien doubled');      -- doubled quote escape
```

Hash hesabı raw text üzerinden yapıldığı için, **iki dump aynı SQL_MODE ile alınmalı**. Eski dump `\'` yeni dump `''` kullanırsa aynı satır farklı hash üretir → yanlış pozitif UPDATE. Tek MySQL sunucusundan iki snapshot alınıyorsa SQL_MODE değişmez, sorun çıkmaz.

### 2. JSON kolonları

```sql
INSERT INTO `json_data` VALUES
  (1, '{"name":"Görkem","tags":[1,2,3]}'),
  (2, '{"with":"comma, inside","nested":{"a":1,"b":2}}');
```

mysqldump JSON alanını string olarak yazar, içindeki `"` karakterlerini `\"` ile escape eder. Parser scanner'ı `'` ile başlayan stringi bulur ve `'` ile kapatana kadar (escape'leri sayarak) okur — içindeki `,`, `{`, `}`, `\"` string sınırını bozmaz.

### 3. Hex literal BLOB

```sql
INSERT INTO `binary_blob` VALUES
  (1, 0xDEADBEEF),
  (2, _binary 0xCAFEBABE),
  (3, NULL);
```

`0x...` ve `_binary 0x...` formları quote'suz literal — splitTupleValues onları ham string olarak alır, hash'e doğru girer. Karşılaştırma çalışır.

### 4. Sayılar (negatif, decimal, scientific)

```sql
INSERT INTO `numbers` VALUES
  (1, 9223372036854775807, 1234567890.12345, 1.5e10),
  (2, -9223372036854775808, -0.00001, -3.14);
```

Hepsi raw text — parser quote görmüyor, virgülde böler, sorun yok. BIGINT 64-bit sınırlarına kadar string olarak korunur (JS Number precision'a düşmez).

### 5. Composite primary key

```sql
CREATE TABLE `user_roles` (
  `user_id` int NOT NULL,
  `role_id` int NOT NULL,
  ...
  PRIMARY KEY (`user_id`,`role_id`)
);
```

`PRIMARY KEY (\`a\`,\`b\`)` regex'i çoklu kolonu virgülle böler. `rowKey` = `"1 1"`, `"1 2"` şeklinde. UPDATE/DELETE üretirken `WHERE user_id=1 AND role_id=1`.

### 6. Multi-byte UTF-8

```sql
INSERT INTO `i18n` VALUES
  (1, 'Türkçe çağrışımı: şıkırtı'),
  (2, '日本語テスト'),
  (3, 'العربية اختبار'),
  (4, 'emoji: 🚀✓😀');
```

Stream `utf8` encoding ile açılır, `Buffer.byteLength(line, "utf8")` ile doğru byte sayar. Aynı string aynı hash üretir, identical kalan satırlar diff'te görünmez.

### 7. VIEW / TRIGGER / DELIMITER blokları

```sql
CREATE VIEW `posts_view` AS SELECT 1 AS id, 'placeholder' AS title;

DELIMITER ;;
CREATE TRIGGER `tr_log` AFTER INSERT ON `triggered` FOR EACH ROW BEGIN
  INSERT INTO `audit_log` VALUES ('triggered_insert', NEW.note, NOW());
END ;;
DELIMITER ;
```

- `CREATE VIEW` regex'i match etmiyor (`CREATE TABLE` arıyoruz) → atlanır.
- Trigger gövdesindeki `INSERT INTO audit_log` **iki space ile indent edilmiş** — `^INSERT INTO` regex'i line başında string istediği için match etmez, yanlış pickup yok.
- `DELIMITER ;;` ve `END ;;` parser tarafından bilinen bir komut değil, ignore edilir.

### 8. NULL değerler

`NULL` keyword (quote'suz) bir string `"NULL"` olarak tutulur. SQL writer `NULL` ya da `null` görürse `IS NULL`'a çevirir (MySQL'de `=NULL` hiçbir satırla eşleşmediği için bu kritik):

```ts
if (v === "NULL" || v === "null") return `${quoteIdent(col)} IS NULL`;
```

---

## Bilinen sınırlar

### PK yok — duplicate satırlar görünmez

PK olmayan tabloda `rowKey = pkValues.join(" ") = tüm tuple`. Aynı içerikli iki satır varsa Map override eder, **diff "1 satır" gibi davranır**. Audit log gibi tablolarda nadir ama mümkün. UI `no pk` etiketi gösteriyor.

**Tek satır farkı (2 → 3 identical row) yakalanmaz.** Eğer böyle bir tablo varsa ya manuel kontrol gerekir ya da PK ekle.

### Schema değişikliği — tüm satırlar UPDATE çıkar

Eski dump 5 kolonlu, yeni dump 6 kolonlu (yeni kolon eklenmiş) → her satırın hash değeri farklı → tüm satırlar UPDATE olarak listelenir. Doğru ama aşırı büyük bir diff.

`sqldiff` **veri farkı** odaklı, **schema farkı** odaklı değil. Schema değişikliği varsa migration ayrı yürütülmeli, sonra data sync edilmeli.

### `_binary 'ham bayt'` (hex değil)

`mysqldump --hex-blob` flag'i kullanılmadıysa BLOB içeriği `_binary 'ham byte stream'` formatında gelir. Node `readline` UTF-8 stream içinde non-UTF-8 byte sequence'larını replacement char (`U+FFFD`) ile değiştirir → BLOB içeriği bozulur, hash yanlış.

**Çözüm:** dump'ı `mysqldump --hex-blob ...` ile al. Yaygın bir best practice; çoğu Laravel/CMS senaryosunda BLOB nadir (image'lar storage'da, DB'de path).

### Çok büyük tek satır INSERT (>~100 MB)

`mysqldump --max_allowed_packet` ayarına göre tek `INSERT INTO ... VALUES (...)` satırı 1 GB'a kadar olabilir. `readline` o satırı tek bir string olarak buffer'lar. 100 MB+ tek satır sıkıntı yaratır.

200 MB toplam dump'ta tek satır pratikte 16-32 MB civarında kalır (mysqldump default `--net_buffer_length=1MB`'a denk düşürür). Pratik problem değil ama bilmek lazım.

### Backtick içinde backtick

`` `my\`name` `` gibi escape edilmiş backtick'li tablo/kolon isimleri parser tarafından desteklenmiyor — regex `[^`"]+` kabul ediyor. mysqldump bu pattern'i nadir üretir; isim convention'ı normal kullanımda backtick içermez.

### `routines` (PROCEDURE/FUNCTION)

Trigger gibi indented `INSERT` içerebilir; aynı sebeple yakalanmaz. Routine gövdesinde line-başlangıçlı `INSERT INTO` varsa (nadir) yanlış pickup riski var. mysqldump `--routines` flag'i ile dump alındıysa dikkat — gerçek dump'ında routine kullanımın varsa parse sonrası gözle kontrol et.

---

## Manuel doğrulama (audit yöntemi)

`test/fixtures/edge_*.sql` üzerinde end-to-end:

```bash
# Dev sunucu açıkken:
cd test/fixtures
JOBID=$(curl -s -F "oldDump=@edge_old.sql" -F "newDump=@edge_new.sql" \
  http://localhost:3000/api/jobs | grep -oE '[a-f0-9-]{36}')

# Beklenen vs gerçek:
curl -s "http://localhost:3000/api/jobs/$JOBID" | python -c "
import json,sys
d = json.load(sys.stdin)
for t in d['summary']['tables']:
    print(f\"{t['table']:20} +{t['insertCount']} ~{t['updateCount']} -{t['deleteCount']}\")
"
```

Beklenen:

| Tablo | + | ~ | − |
|---|---|---|---|
| audit_log | 1 | 0 | 0 |
| binary_blob | 1 | 1 | 0 |
| escapes | 1 | 1 | 0 |
| i18n | 0 | 0 | 0 |
| json_data | 1 | 1 | 0 |
| numbers | 0 | 0 | 0 |
| triggered | 1 | 0 | 0 |
| user_roles | 1 | 1 | 1 |

Gerçek bir prod dump'ında tuhaflık yaşarsan: küçük bir slice (ilk 5-10 MB) alıp aynı yöntemle parse et, beklenmeyen bir tablo görürsen `lib/parser.ts` üstünde `console.log` ekle, hangi satırın yanlış yorumlandığını bul.
