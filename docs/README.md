# sqldiff dokümantasyonu

`sqldiff`, iki MySQL dump dosyasını alıp aralarındaki **veri farklarını** çıkaran ve uygulanabilir bir `sync.sql` üreten lokal bir web aracıdır. Tipik senaryo: yayındaki siteni localine indirip kod güncellerken prod'a yeni veri girilmiş; yeni veriyi localdeki güncellenmiş haline taşımak istiyorsun.

## Bu klasördeki dosyalar

| Dosya | İçerik |
|---|---|
| [`architecture.md`](./architecture.md) | Genel mimari, klasör yapısı, bileşenler, akış |
| [`parser-and-diff.md`](./parser-and-diff.md) | Streaming mysqldump parser, snapshot diff, sync.sql üretimi |
| [`api.md`](./api.md) | 4 HTTP endpoint'inin reference'ı (request/response şemaları) |
| [`edge-cases.md`](./edge-cases.md) | Desteklenen edge case'ler ve bilinen sınırlar |

## Hızlı başlangıç

```bash
npm install
npm run dev
```

Tarayıcıdan <http://localhost:3000> aç. İki SQL dump'ı drop et, **Compare** bas, değişen tabloları seç, `sync.sql`'i indir. Local DB'ye uygula:

```bash
mysql -u root -p mydb < sync.sql
```

## Tasarım prensipleri

- **Streaming**, in-memory değil: dosya satır satır okunur, tek seferde RAM'e alınmaz. Büyük dump'larda da çalışır.
- **Sıfır dış bağımlılık** (parser/diff/hash katmanında): `node:crypto`, `node:fs`, `node:readline`. Tüm SQL parse mantığı kendi yazımı.
- **PK + content hash** ile satır eşleştirme: aynı PK ama farklı içerik → UPDATE; farklı PK → INSERT/DELETE.
- **DELETE+INSERT pattern** UPDATE için: kolon kolon karşılaştırma yerine satırın tamamını yeniden yaz. Sade ve atomik (transaction içinde).
- **Server-side parse + JSON polling**: browser ham dump'ı parse etmez. UI sadece `TableDiff` özetini ve preview snippet'larını alır.
