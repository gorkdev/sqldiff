# Parser, Diff ve SQL Writer

Bu döküman `lib/parser.ts`, `lib/differ.ts`, `lib/sql-writer.ts` çekirdek mantığını açıklar.

---

## Parser

`parseDump(filePath, hooks)` → `Promise<DumpSnapshot>`

**Girdi:** mysqldump çıktısı bir `.sql` dosyası
**Çıktı:** `Map<tableName, TableSnapshot>` — her tablo için kolon listesi, PK kolonları, ve `Map<rowKey, RowData>`.

### Stream stratejisi

```ts
const stream = createReadStream(filePath, { encoding: "utf8", highWaterMark: 1 << 16 });
const rl = createInterface({ input: stream, crlfDelay: Infinity });

for await (const line of rl) { … }
```

Dosya satır satır okunur, tüm dosya hiçbir zaman tek seferde RAM'de tutulmaz. `bytesRead` her satırda toplanıp her ~2 MB'da `onProgress` callback'iyle UI'ya iletilir.

### State machine

Her satır 3 durumdan birine girer:

1. **`CREATE TABLE` görüldü** → `inCreate` state'i aktive olur. Sonraki satırlar kolon adları (`` `name` type … ``), `PRIMARY KEY (...)` veya kapanış `) ENGINE=...` olabilir. Kapanışta tablo metadata'sı snapshot'a yazılır.
2. **`INSERT INTO` görüldü** → satırın geri kalanı `VALUES (...),(...);` formatında. `iterateTuples()` ile her tuple ayıklanır, `splitTupleValues()` ile alanlar bölünür, hash hesaplanır, `Map<rowKey, RowData>`'e eklenir.
3. **Diğer her şey** (yorumlar, `LOCK TABLES`, `DROP TABLE`, `CREATE VIEW`, `DELIMITER`, trigger gövdesi) → ignore.

### Tuple iteration (manuel scanner)

`INSERT INTO posts VALUES (1,'Title','Body'),(2,'Title 2',NULL);`

Buradaki `(...)` blokları regex ile bölünemez çünkü string içinde `)` veya `,` olabilir. Bunun yerine karakter-by-karakter scanner:

```ts
function findMatchingParen(s, start) {
  let depth = 1, i = start + 1;
  while (i < s.length) {
    if (s[i] === "'") i = skipSingleQuoted(s, i);   // string atla
    else if (s[i] === '"') i = skipDoubleQuoted(s, i);
    else if (s[i] === ")") { depth--; if (depth === 0) return i; i++; }
    else i++;
  }
}
```

`skipSingleQuoted` iki escape stilini de kabul eder:
- **Backslash escape:** `'O\'Brien'` → `\` görünce 2 karakter atla
- **Doubled quote:** `'O''Brien'` → `'` ardından `'` varsa 2 karakter atla

İkisi de mysqldump tarafından üretilebilir (`SQL_MODE` ayarına göre).

### Hash

Her satırın `values` (tuple içeriğinin raw text birleşimi) MD5 ile hash'lenir:

```ts
const hash = createHash("md5").update(valuesJoined).digest("hex");
```

MD5 cryptographically broken — burada problem değil. Tek tablo içinde collision olasılığı 2⁻⁶⁴ civarında, milyonlarca satır olsa bile pratik sıfır.

### Primary key çıkarımı

`CREATE TABLE` içinde `PRIMARY KEY (\`a\`,\`b\`)` satırı bulunca:
```ts
inCreate.pkColumns = pkMatch[1]
  .split(",")
  .map((s) => s.trim().replace(/^[`"]|[`"]$/g, ""));
```

Composite (çoklu) PK doğal olarak desteklenir. PK olmayan tablolar için fallback: tüm tuple `rowKey` olarak kullanılır (collision riski + duplikat satır sıkıntısı için bkz. [`edge-cases.md`](./edge-cases.md#pk-yok)).

### Trigger / View skip

`CREATE TRIGGER` ve `CREATE VIEW` satırları regex'lerle eşleşmez (sadece `CREATE TABLE` arıyorum). Trigger gövdesindeki `INSERT INTO` satırları **indent edilmiş** (`  INSERT INTO ...`) olduğundan `^INSERT INTO` regex'i match etmez — yanlış pickup olmaz.

---

## Differ

`diffSnapshots(oldSnap, newSnap)` → `TableDiff[]`

İki `DumpSnapshot` map'inin union'ı üzerinde tablo tablo:

```
newKeys − oldKeys   = inserts (yalnızca yenide var)
oldKeys − newKeys   = deletes (yalnızca eskide var)
key in both, hash farklı = updates
key in both, hash aynı   = değişmedi (output yok)
```

```ts
for (const [key, newRow] of newTable.rows) {
  const oldRow = oldTable.rows.get(key);
  if (!oldRow) inserts.push({ kind: "insert", newRow });
  else if (oldRow.hash !== newRow.hash) updates.push({ kind: "update", oldRow, newRow });
}
for (const [key, oldRow] of oldTable.rows) {
  if (!newTable.rows.has(key)) deletes.push({ kind: "delete", oldRow });
}
```

Tablo eski'de var ama yeni'de yok → tüm satırlar `delete`. Yeni'de var ama eski'de yok → tüm satırlar `insert`. UI bu durumlarda da çalışır; kullanıcı tablo bazında deselect edebilir.

---

## SQL Writer

`writeSyncSql(summary, { tables: Set<string> })` → `string`

### Çıktı şablonu

```sql
-- sqldiff sync · <ISO timestamp>
-- old: <oldName> (<size>)
-- new: <newName> (<size>)
-- tables included: <comma list>

SET FOREIGN_KEY_CHECKS = 0;
START TRANSACTION;

-- <table>: +N ~M −K
-- WARNING: no primary key detected for `table`...   (sadece PK yoksa)
DELETE FROM `table` WHERE …;        (delete'ler)
DELETE FROM `table` WHERE …;        (update için: önce delete)
INSERT INTO `table` (…) VALUES (…); (update için: yeni hali)
INSERT INTO `table` (…) VALUES (…); (gerçek insert'ler)

… (her tablo için aynı blok) …

COMMIT;
SET FOREIGN_KEY_CHECKS = 1;
```

### Tasarım kararları

#### `FOREIGN_KEY_CHECKS = 0` neden?

Yeni post'un yorumu da yeni gelmiş olabilir. SQL ifadeleri tablo bazında batch halinde geliyor (ör. önce `posts`, sonra `comments`). Eğer `comments` önce gelirse FK hatası alır. Topolojik sıralama overengineering — `FOREIGN_KEY_CHECKS = 0` MySQL'de standart bir pattern, `mysqldump` çıktısı zaten bu yaklaşımı kullanır.

#### Update neden `DELETE` + `INSERT`?

3 alternatif vardı:
1. **`UPDATE table SET col1=v1, col2=v2 WHERE pk=...`** — kolon kolon değişeni hesapla, sadece değişenleri yaz. Zarif ama implementation karmaşık (her UPDATE için old vs new row alan alan compare).
2. **`REPLACE INTO`** — varsa sil, yoksa ekle. Kolay ama: AUTO_INCREMENT'ı tüketir, foreign key cascade davranışı `DELETE` gibi (child satırlar düşebilir).
3. **`DELETE` + `INSERT`** — ✅ seçilen. Atomik (transaction içinde), implementation tek satır. `REPLACE`'den farkı: AUTO_INCREMENT counter'a dokunmaz (manual id veriyoruz zaten).

Trade-off: cascading delete'ler zincir reaksiyon yapabilir (parent silinince child'lar düşer). Bu sebeple wrapper'da `FOREIGN_KEY_CHECKS = 0` zaten kapalı — tetikleyiciler de bypass edilir.

#### `INSERT` neden kolon adlı?

`INSERT INTO posts (id, title, …) VALUES (…)` — kolon adları açıkça yazılır. Alternatif `INSERT INTO posts VALUES (…)` daha kısa ama:
- Hedef DB'de kolon sırası değişmişse veya kolon eklenmişse patlar.
- Açık kolon listesi DB schema değişikliklerine karşı güçlü.

Maliyeti minik (her INSERT'e ~50 char), faydası büyük.

#### `DELETE` formu

```sql
DELETE FROM `table` WHERE `pk1`=val1 AND `pk2`=val2;
```

Composite PK için doğal. Tek PK için `pk1=val1`. PK yoksa `column1=val1 AND column2=val2 AND ...` (tüm kolonlar) — ama `WARNING` comment ekleniyor çünkü güvensiz.

#### `NULL` handling

`WHERE col=NULL` MySQL'de hiçbir satırla eşleşmez (NULL özel). Doğru form: `WHERE col IS NULL`. SQL writer bunu kontrol eder:

```ts
if (v === "NULL" || v === "null") return `${quoteIdent(col)} IS NULL`;
return `${quoteIdent(col)}=${v}`;
```
