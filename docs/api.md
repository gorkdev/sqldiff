# API Reference

Tüm endpoint'ler `runtime = "nodejs"` ve `dynamic = "force-dynamic"` ile çalışır. Local-only kullanım — auth yok, rate limit yok.

---

## `POST /api/jobs`

Yeni bir karşılaştırma işi başlatır. İki dosyayı diske yazar, async worker'ı tetikler, `jobId` döner.

### Request

`multipart/form-data` body:

| Field | Tip | Açıklama |
|---|---|---|
| `oldDump` | `File` | Eski snapshot (.sql) |
| `newDump` | `File` | Yeni snapshot (.sql) |

### Response — 200

```json
{ "jobId": "094976ae-fdea-4fd0-9fa5-5df5053ac20e" }
```

### Response — 400

```json
{ "error": "Both `oldDump` and `newDump` files are required." }
```

### Davranış

- Dosyalar `os.tmpdir()/sqldiff/<jobId>/` altına stream edilir (orijinal dosya adı sanitize edilerek korunur).
- Worker fire-and-forget olarak başlatılır. Endpoint hemen döner; parse + diff arka planda devam eder.

---

## `GET /api/jobs/:id`

İşin mevcut durumunu döndürür. UI bu endpoint'i 1.5 sn aralıklarla `done` veya `error` olana kadar polling eder.

### Response — 200

```json
{
  "id": "094976ae-...",
  "status": "parsing-old | parsing-new | diffing | done | error | queued",
  "progress": {
    "currentTable": "posts",
    "bytesRead": 4231000,
    "totalBytes": 5445000,
    "rowsSeen": 12453
  },
  "error": "...",            // sadece status === "error"
  "oldFile": { "name": "old.sql", "size": 4721 },
  "newFile": { "name": "new.sql", "size": 5445 },
  "summary": {                // sadece status === "done"
    "oldFileName": "old.sql",
    "newFileName": "new.sql",
    "oldFileSize": 4721,
    "newFileSize": 5445,
    "generatedAt": "2026-05-10T08:15:40.661Z",
    "tables": [
      {
        "table": "posts",
        "columns": ["id", "title", "..."],
        "pkColumns": ["id"],
        "insertCount": 2,
        "updateCount": 3,
        "deleteCount": 1,
        "samples": {
          "inserts": [{ "kind": "insert", "pkValues": ["5"], "preview": "INSERT INTO `posts` ..." }, ...],
          "updates": [...],
          "deletes": [...]
        }
      }
    ]
  }
}
```

### Response — 404

```json
{ "error": "Not found" }
```

### Notlar

- `samples` her tipten en fazla **5 satır** içerir. UI'da preview için kullanılır; tüm satırların gönderilmesi gereksiz network yükü olur.
- Tüm `RowChange` listesi server'da `job-store`'da saklanır; download endpoint'i tam veriyi kullanır.

---

## `POST /api/jobs/:id/sql`

Seçilen tablolar için `sync.sql` üretip indirir.

### Request

`Content-Type: application/json` body:

```json
{ "tables": ["posts", "comments", "users"] }
```

### Response — 200

`Content-Type: application/sql`
`Content-Disposition: attachment; filename="sync-<jobId-prefix>.sql"`

Body: tam SQL metni (bkz. [`parser-and-diff.md`](./parser-and-diff.md#çıktı-şablonu)).

### Response — 400

```json
{ "error": "Select at least one table" }
```

### Response — 404

```json
{ "error": "Not found" }
```

### Response — 409

```json
{ "error": "Job not finished" }
```

`status !== "done"` ise döner.

---

## `DELETE /api/jobs/:id`

Job'ı temizler: temp dosyaları siler, in-memory state'i kaldırır.

### Response — 200

```json
{ "ok": true }
```

Job zaten yoksa da `{ "ok": true }` döner — idempotent.

---

## Job lifecycle (state diyagramı)

```
                       ┌─────────────────┐
                       │ DELETE /jobs/:id│ (idempotent, her aşamada çağrılabilir)
                       └────────┬────────┘
                                ▼
                          (state silinir)

POST /jobs ──▶ queued ──▶ parsing-old ──▶ parsing-new ──▶ diffing ──▶ done
                  │            │              │              │         │
                  └────────────┴──────────────┴──────────────┴─────────┴──▶ error
                                                                                │
                                                                       (error mesajı state'te)

GET /jobs/:id   her aşamada çağrılabilir, mevcut state'i döndürür
POST /jobs/:id/sql  yalnızca status === "done" iken
```
