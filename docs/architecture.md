# Mimari

## Yüksek seviye akış

```
[Browser]                         [Next.js API + Worker]                  [Disk]
   │                                       │                                 │
   │── multipart upload (2 dosya) ────────▶│                                 │
   │                                       │── temp dosyaya stream ─────────▶│
   │◀── { jobId } ─────────────────────────│                                 │
   │                                       │── async parse + diff worker ────┐
   │── GET /api/jobs/:id (1.5sn polling) ─▶│                                 │ │
   │◀── { status, progress } ──────────────│                                 │ │
   │     …                                                                     │ │
   │◀── { status: "done", summary } ───────│◀────────────────────────────────┘
   │── POST /api/jobs/:id/sql ────────────▶│                                 │
   │     body: { tables: [...] }           │── seçili tablolardan SQL üret ──│
   │◀── sync.sql download ─────────────────│                                 │
   │── DELETE /api/jobs/:id ──────────────▶│                                 │
   │                                       │── temp dosyaları sil ──────────▶│
```

3 sayfa state'i, 1 wizard yok: **upload → progress → diff results**. Aynı route, state-driven render.

## Klasör yapısı

```
sqldiff/
├── app/
│   ├── layout.tsx              Geist fontları, light theme root
│   ├── page.tsx                State machine (upload → job)
│   ├── globals.css             Tailwind 4 + @theme
│   └── api/
│       └── jobs/
│           ├── route.ts            POST  upload + worker başlat
│           └── [id]/
│               ├── route.ts        GET status, DELETE cleanup
│               └── sql/route.ts    POST → sync.sql download
├── lib/
│   ├── types.ts                Domain types (RowData, TableSnapshot, JobState…)
│   ├── parser.ts               Streaming mysqldump parser
│   ├── differ.ts               Snapshot karşılaştır → TableDiff[]
│   ├── sql-writer.ts           TableDiff[] → sync.sql
│   ├── job-store.ts            globalThis tabanlı Map<jobId, JobState>
│   └── worker.ts               Async parse + diff orchestrator
├── components/
│   ├── UploadZone.tsx          Drop + file picker
│   ├── ProgressView.tsx        İnce progress bar + meta
│   ├── DiffTableList.tsx       Tablo listesi, selection, footer download
│   └── DiffRow.tsx             Tek satır + expandable preview kartları
├── test/fixtures/              Demo + edge case dump'ları
└── docs/                       Bu klasör
```

## Bileşenler ve sorumlulukları

### `lib/parser.ts`
Tek tek dump dosyasını okuyup `DumpSnapshot` (`Map<tableName, TableSnapshot>`) üretir. Stream-based — tüm dosyayı belleğe almaz. Her ~2 MB'da `onProgress` callback çağırır.

Bkz. [`parser-and-diff.md`](./parser-and-diff.md#parser).

### `lib/differ.ts`
İki `DumpSnapshot`'ı tablo tablo karşılaştırır, her tablo için `TableDiff` üretir (`inserts`, `updates`, `deletes`).

### `lib/sql-writer.ts`
`TableDiff[]` ve seçilen tablo isimlerini alır, `sync.sql` metnini üretir. Wrapper: `SET FOREIGN_KEY_CHECKS=0; START TRANSACTION; … COMMIT;`.

### `lib/job-store.ts`
Tek-process Node sunucusunun `globalThis` üstünde tuttuğu `Map<jobId, JobState>`. Hot reload (Next dev mode) sırasında module re-import'a karşı `globalThis.__sqldiffJobs` üzerinden persist eder.

### `lib/worker.ts`
`startJob(id)` fire-and-forget olarak çağrılır. Sırasıyla:
1. Status `parsing-old` → `parser.parseDump(oldFile)`
2. Status `parsing-new` → `parser.parseDump(newFile)`
3. Status `diffing` → `differ.diffSnapshots()`
4. Status `done`, sonuç `summary` olarak job-store'a yazılır.

Hata olursa job state `error` durumuna geçer, mesaj `error` alanında.

### API route'ları
Bkz. [`api.md`](./api.md).

### UI bileşenleri
- `UploadZone` — drag-drop + click-to-pick, dosya state callback
- `ProgressView` — status etiketi + 1px progress bar + 3 sütun meta (current table, rows seen, bytes)
- `DiffTableList` — header (totals + select all/clear), liste, footer (download)
- `DiffRow` — checkbox + tablo adı + `+/~/−` sayıları + chevron, expanded'da insert/update/delete sample'ları kart kart

## State machine (UI)

`app/page.tsx` tek state ile yönetir:

```
[upload]  ──── handleCompare ────▶  [job: jobId set]
                                          │
                                          ├── status: parsing-old / parsing-new / diffing
                                          │     → ProgressView
                                          │
                                          ├── status: done
                                          │     → DiffTableList
                                          │
                                          └── status: error
                                                → error banner

[job]  ──── handleReset (DELETE /api/jobs/:id) ────▶  [upload]
```

Polling her 1500 ms'de `GET /api/jobs/:id`. `done` veya `error` olunca polling durur.

## Job lifecycle

```
queued → parsing-old → parsing-new → diffing → done
                                              ↘ error (her aşamada)
```

`done` job'lar **kullanıcı reset edene kadar bellekte kalır** (download için). Reset ile temp dosyalar + memory state temizlenir. Server restart'ında aktif job'lar kaybolur — local tool olduğu için kabul edilebilir trade-off.

## Stack

| Katman | Teknoloji |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack default) |
| UI | React 19, TypeScript, Tailwind CSS 4 |
| Font | Geist Sans + Geist Mono (`next/font`) |
| Runtime | Node.js (route handler `runtime = "nodejs"`) |
| Hash | `node:crypto` md5 |
| Stream | `node:fs` createReadStream + `node:readline` |
| Storage | `os.tmpdir()` (her job kendi alt klasörü) + in-memory job map |

Sıfır npm dep core engine'de. UI'da sadece Next/React/Tailwind.
