# Desktop: Mode Multi-Device (Fase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mode Multi-Device (Ubiquiti saja) di aplikasi desktop: penemuan perangkat lewat DHCP lease, tabel perangkat berstatus hidup, inject paralel, dan pencatatan hasil ke draft Catat Serial Number tanpa kehilangan baris.

**Architecture:** Mesin Multi hidup di proses utama; logikanya murni di `countrylock/src/multi/` dan diuji dengan jam serta port palsu. Proses utama (`desktop/src/main/multi/`) memasang port nyata (SSH exec, ping, info, inject). Renderer (`useMulti`) hanya menampilkan snapshot, mengirim perintah, dan mencatat peristiwa `injected` ke draft lewat `useDraftRows.addInjected`.

**Tech Stack:** TypeScript, Bun (`bun:test` di `countrylock/`), Electron 45 + ssh2 + `node:sqlite` + zod (`desktop/`, vitest), React + TanStack (`web/`, vitest + Testing Library).

**Spec:** `docs/superpowers/specs/2026-11-19-desktop-multi-device-design.md` (perilaku lama: `docs/superpowers/specs/2026-11-06-countrylock-legacy-behavior.md` bagian 4, rujukan "L4.x"). Dasar kode: cabang `feat/desktop-catat-serial-bersama` (PR #124: draft SQLite, `useDraftRows`, `addInjected`).

## Global Constraints

- Jembatan v9: `MULTI_BRIDGE_VERSION = 9`, `BRIDGE_VERSION = 9`; `MIN_BRIDGE_VERSION` tetap 2 dan `UI_MIN_BRIDGE_VERSION` tetap 8 (UI menyembunyikan mode Multi bila jembatan < 9).
- Merk Multi selalu `ubiquiti`; paket skrip aktif (`package.load`) dipakai apa adanya; `connectVia` diabaikan; mode `multi` di `config.QC` (`brands.ubiquiti.multi`, `server.*`).
- Concurrent 1 sampai 32, bawaan 4. Masa tenggang perangkat hilang 60_000 ms. Pemindaian lease adaptif 1000/3000/5000 ms (tak ada perangkat / ada perangkat tanpa `injecting` / ada `injecting`). Jeda loop perangkat 500 ms (status sibuk, ping gagal, `waiting`) dan 800 ms (stabil).
- Perintah lease persis: `/ip dhcp-server lease print terse proplist=address,mac-address,status where status=bound`. MAC dinormalisasi `AA:BB:CC:DD:EE:FF` (huruf besar, titik dua).
- Sandi (perangkat, router) tidak pernah ada di snapshot, log, pesan galat, argumen/hasil jembatan; semua keluaran sandi lewat `maskSecrets`/`sanitizeProgress`. Tidak ada kanal jembatan yang menerima jalur berkas.
- Semua argumen jembatan divalidasi zod di `BRIDGE_ARGS` (tuple ketat); skema hanya berisi yang disebut spek.
- UI: field relasi (Tipe, Business Unit, Lokasi) memakai `LinkField`; pilihan enum memakai `Select`; tidak ada `<select>` bawaan. Teks UI santai dan bahasa Indonesia ("Serial Number" lengkap pada judul).
- Tes: `bun run --cwd countrylock test` (`bun:test`), `bun run --cwd desktop test` (vitest), `bun run --cwd web test` / `bunx vitest run <jalur>` dari `web/`. Sebelum tiap komit: typecheck (`bun run typecheck`) dan `bunx biome check --write <jalur>` bersih. Komit pesan awalan konvensional dan akhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Jangan mengubah mode tunggal selain ekstraksi runner inject (Task 8) dan penambahan penjaga saling-kecualikan; semua tes mode tunggal tetap hijau.

## Review Focus

1. **Dua MAC bertukar IP pada satu pemindaian** (swap): inject tidak boleh sampai ke perangkat yang salah; sebelum inject IP perangkat dicocokkan lagi dengan lease terbaru, selisih = kembali `waiting` tanpa inject (Task 4 dan 5).
2. **Kredensial habis**: tiap kredensial dicoba paling banyak sekali per sesi IP; setelah habis tidak ada panggilan `readInfo` lagi sampai ada pemicu (Task 3 dan 4).
3. **Draft menjadi penuh/rusak di tengah batch** (`setBlocked`): perangkat `queued` kembali `ready`, tidak ada slot baru, yang `injecting` selesai normal (Task 4 dan 10).
4. **Peristiwa `injected` belum di-ack saat aplikasi dimuat ulang atau ditutup**: dikirim lagi, tidak menggandakan baris draft, tidak hilang (Task 7 dan 10).
5. **Perangkat sukses dicabut lalu muncul lagi** (lewat masa tenggang) dan **IP perangkat `success` berubah**: tidak di-inject ulang otomatis (Task 2 dan 4).

---

### Task 1: Tipe bersama dan pembaca DHCP lease

**Files:**
- Create: `countrylock/src/multi/types.ts`, `countrylock/src/multi/lease.ts`
- Test: `countrylock/src/multi/lease.test.ts`

**Interfaces:**
- Produces (`types.ts`): `type DeviceStatus = 'waiting'|'pinging'|'fetching_info'|'ready'|'queued'|'injecting'|'success'|'failed'|'disconnected'`; `interface Credential { username: string; password: string }`; `interface Lease { ip: string; mac: string }`; `interface MultiTarget { itemId; itemLabel; buId; buLabel; locationId; locationLabel: string }`; `interface InjectedEvent { eventId: string; mac: string; serial: string; model: string; injectedAt: string; target: MultiTarget }`.
- Produces (`lease.ts`): `LEASE_COMMAND` (string persis dari Global Constraints); `normalizeMac(raw: string): string | null` (huruf besar, pemisah `:`/`-`/`.`/tanpa pemisah diterima, hanya 12 heksadesimal, selain itu `null`); `parseDhcpLeases(output: string): Lease[]`.

- [ ] **Step 1: Tulis tes `lease.test.ts`** dengan keluaran contoh L4.3 `0 D address=192.168.88.1 mac-address=58:D6:1F:0E:4E:FE status=bound`. Tes: `parseDhcpLeases` mengembalikan `[{ip:'192.168.88.1', mac:'58:D6:1F:0E:4E:FE'}]`; baris tanpa `address=` dibuang; baris tanpa MAC sah dibuang; status selain `bound` dibuang; MAC huruf kecil dinormalisasi; keluaran kosong/aneh = `[]` (tidak melempar); duplikat MAC memakai baris terakhir; `normalizeMac('58-d6-1f-0e-4e-fe')`, `'58d6.1f0e.4efe'`, `'58D61F0E4EFE'` semuanya `'58:D6:1F:0E:4E:FE'`; `normalizeMac('xyz')` = `null`.
- [ ] **Step 2: Jalankan** `bun run --cwd countrylock test src/multi/lease.test.ts`. Expected: FAIL (modul belum ada).
- [ ] **Step 3: Implementasikan** `types.ts` dan `lease.ts` sesuai Interfaces. Parsing baris per baris dengan regex tahan spasi; filter `status=bound` bila status ada (baris tanpa status diterima karena perintah sudah menyaring).
- [ ] **Step 4: Jalankan tes lagi.** Expected: PASS.
- [ ] **Step 5: Komit** `feat(countrylock): tipe Multi-Device dan pembaca DHCP lease`.

### Task 2: Registri perangkat (identitas MAC, masa tenggang, diambil alih)

**Files:**
- Create: `countrylock/src/multi/registry.ts`
- Test: `countrylock/src/multi/registry.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Lease`, `DeviceStatus`, `Credential`).
- Produces: `interface DeviceRecord { mac: string; ip: string; status: DeviceStatus; message: string; pingable: boolean; model: string; serial: string; country: string; credentialIndex: number; credentialsExhausted: boolean; alreadyRegistered: boolean; injectedThisSession: boolean; lastSeenAt: number; log: string[] }` (belum memuat sandi; kredensial aktif dihitung engine dari `credentialIndex`); `newDevice(mac: string, ip: string, now: number): DeviceRecord` (status `waiting`, indeks 0, pesan "Menunggu"); `reconcileLeases(devices: readonly DeviceRecord[], leases: readonly Lease[], now: number, opts: { excludeIp: string; graceMs: number }): { devices: DeviceRecord[]; added: string[]; ipChanged: string[]; removed: string[] }` (murni, tidak mengubah masukan).

- [ ] **Step 1: Tulis tes `registry.test.ts`**: (a) MAC baru → `added`, status `waiting`; (b) MAC sama IP berbeda → IP diperbarui dan `ipChanged`; bila status `disconnected` atau (status bukan `injecting`, bukan `success`) kembali `waiting` dengan `credentialIndex=0` dan `credentialsExhausted=false`; status `injecting` dan `success` tidak diubah (`success` hanya IP baru; **tidak diproses ulang**, Review Focus 5); (c) IP diambil alih MAC lain: perangkat lama (bukan `injecting`/`disconnected`) menjadi `disconnected` "Terputus (IP diambil alih perangkat lain)"; (d) MAC hilang dari lease: `disconnected` "Terputus" kecuali `injecting`; dibuang (`removed`) hanya bila `now - lastSeenAt >= graceMs` dan bukan `injecting`; (e) entri lease dengan IP sama `excludeIp` atau tanpa MAC diabaikan; (f) **swap**: MAC A dan B bertukar IP dalam satu pemindaian → keduanya `ipChanged`, tidak ada yang `disconnected`; (g) MAC yang muncul kembali setelah `disconnected` kembali `waiting` dan `lastSeenAt` diperbarui; (h) `injectedThisSession` dan `alreadyRegistered` dipertahankan lintas pembaruan IP.
- [ ] **Step 2: Jalankan** `bun run --cwd countrylock test src/multi/registry.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan** `registry.ts`; urutan: tandai pengambilalihan IP dulu (sebelum memperbarui IP MAC lain), lalu perbarui yang terlihat, lalu proses yang hilang. Fungsi murni dengan salinan objek.
- [ ] **Step 4: Jalankan tes.** Expected: PASS.
- [ ] **Step 5: Komit** `feat(countrylock): registri perangkat Multi (identitas MAC, masa tenggang)`.

### Task 3: Kredensial dan penjadwal slot

**Files:**
- Create: `countrylock/src/multi/credentials.ts`, `countrylock/src/multi/scheduler.ts`
- Test: `countrylock/src/multi/credentials.test.ts`, `countrylock/src/multi/scheduler.test.ts`

**Interfaces:**
- Produces (`credentials.ts`): `credentialAt(index: number, base: Credential, queue: readonly Credential[]): Credential | null` (0 = `base`, i = `queue[i-1]`, selain itu `null`); `credentialSource(index: number): string` (`'Default'` atau `` `Antrian #${index}` ``); `nextCredentialIndex(index: number, queueLength: number): number | null` (`null` = habis); `addCredential(queue: readonly Credential[], cred: Credential): Credential[]` (tanpa duplikat username+password; kosong ditolak mengembalikan antrean yang sama).
- Produces (`scheduler.ts`): `createScheduler(limit: number): { acquire(signal?: AbortSignal): Promise<() => void>; setLimit(n: number): void; readonly limit: number; readonly running: number; readonly waiting: number }`. `limit` dijepit 1 sampai 32. Slot dibagi FIFO dengan penghitung, TANPA mengganti objek penjadwal.

- [ ] **Step 1: Tulis tes**: kredensial (indeks 0 default, urutan antrean, habis = `null`, duplikat/kosong ditolak, sumber teks); penjadwal (limit 2: dua `acquire` langsung, ketiga menunggu sampai ada `release`; `release` dua kali aman; `setLimit(1)` saat 2 berjalan tidak memutus yang berjalan dan tidak memberi slot baru sampai `running < 1`; `setLimit(5)` melepas waiter sampai penuh; `setLimit(0)`/`99` dijepit 1/32; `acquire` dengan `signal` yang dibatalkan saat menunggu menolak dengan `AbortError` dan tidak menghabiskan slot; FIFO).
- [ ] **Step 2: Jalankan** kedua berkas tes. Expected: FAIL.
- [ ] **Step 3: Implementasikan** kedua modul sesuai Interfaces.
- [ ] **Step 4: Jalankan tes.** Expected: PASS.
- [ ] **Step 5: Komit** `feat(countrylock): kredensial dan penjadwal slot Multi`.

### Task 4: Engine, bagian pemindaian dan loop perangkat

**Files:**
- Create: `countrylock/src/multi/engine.ts`, `countrylock/src/multi/snapshot.ts`
- Test: `countrylock/src/multi/engine.test.ts`, `countrylock/src/multi/fakes.ts` (port palsu + jam terkendali, dipakai Task 5)

**Interfaces:**
- Consumes: Task 1 sampai 3.
- Produces (`snapshot.ts`): `interface MultiDeviceDto` = `DeviceRecord` tanpa `credentialIndex` plus `credentialSource: string` (tanpa sandi); `interface MultiSnapshot { running: boolean; blockedReason: string | null; queueStopped: boolean; autoInject: boolean; concurrency: number; devices: MultiDeviceDto[]; counts: { waiting: number; queued: number; injecting: number; success: number; failed: number; active: number }; credentialCount: number; message: string }`.
- Produces (`engine.ts`):
  ```ts
  interface MultiPorts {
    now(): number;
    sleep(ms: number, signal: AbortSignal): Promise<void>;       // menolak AbortError bila dibatalkan
    readLeases(): Promise<Lease[] | null>;                          // null = galat baca
    ping(ip: string): Promise<boolean>;
    readInfo(ip: string, cred: Credential): Promise<{ ok: true; model: string; serial: string; country: string } | { ok: false; error: 'PERMISSION_DENIED' | 'UNAVAILABLE' }>;
    inject(req: { id: string; ip: string; cred: Credential; firmwareCode: string }, signal: AbortSignal, onProgress: (m: string) => void): Promise<{ ok: boolean; stage: 'completed'|'failed'|'cancelled'; message: string }>;
    ensureBridgePorts(): Promise<{ ok: boolean; message: string }>;
    events: { add(e: InjectedEvent): void; list(): InjectedEvent[]; ack(ids: string[]): void };
    newId(): string;
  }
  interface MultiStartConfig { firmwareCode: string; concurrency: number; excludeIp: string; autoInject: boolean; target: MultiTarget; base: Credential }
  interface MultiEngine { start(cfg: MultiStartConfig): void; stop(): Promise<void>; scan(): Promise<void>; setConcurrency(n: number): void; setAutoInject(on: boolean): void; addCredential(c: Credential): void; setRegistered(serials: string[]): void; setBlocked(reason: string | null): void; snapshot(): MultiSnapshot; onChange(cb: (s: MultiSnapshot) => void): () => void }
  export function createMultiEngine(ports: MultiPorts): MultiEngine
  ```
  Aksi inject (`injectDevice`, `injectAll`, `stopQueue`, `cancelAll`, `cancelDevice`, `prepareBridge`, `pendingEvents`, `ackInjected`) ditambahkan di Task 5.

- [ ] **Step 1: Tulis `fakes.ts`** (jam maju manual, `sleep` yang selesai saat jam dimajukan, port yang dapat diskrip per IP) dan tes `engine.test.ts` untuk bagian ini: (a) `start` memindai lease dan membuat perangkat `waiting`→`pinging`→`fetching_info`→`ready` ("Siap inject" / "Siap inject (SN sudah terdaftar)" bila serial ada di `setRegistered`); (b) ping gagal pada perangkat stabil → `waiting` "Tidak merespon ping" dan `pingable=false`; (c) interval pemindaian adaptif 1000/3000/5000 menurut kondisi; (d) `readInfo` `PERMISSION_DENIED` → maju ke kredensial berikutnya sampai habis → `waiting` "Permission denied!!!", `credentialsExhausted=true` dan **jumlah panggilan `readInfo` tidak bertambah** pada putaran loop berikutnya (Review Focus 2); `addCredential` memicu satu percobaan lagi; (e) info tak lengkap (serial atau model kosong) → `waiting` "Info perangkat tidak lengkap"; (f) Auto Inject: `ready` dan tidak `alreadyRegistered` dan tidak `injectedThisSession` → ikut antre (dipastikan di Task 5); bila `setBlocked` aktif tidak mengantre; (g) `setConcurrency` dijepit dan masuk snapshot; (h) `onChange` dipanggil saat snapshot berubah dan berhenti setelah berhenti berlangganan; (i) `stop()` membatalkan semua loop (tak ada timer tersisa) dan `snapshot().running=false`; (j) snapshot tidak pernah memuat string sandi (uji dengan sandi sentinel pada `base` dan antrean).
- [ ] **Step 2: Jalankan** `bun run --cwd countrylock test src/multi/engine.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan** `snapshot.ts` dan `engine.ts` (bagian pemindaian: satu `isScanning`; satu loop per MAC dengan `AbortController` per perangkat; `ProcessDevice` iteratif, bukan rekursif; transisi memakai `reconcileLeases` dan fungsi kredensial). Loop perangkat `success` hanya me-refresh info tanpa mengubah status (L4.4).
- [ ] **Step 4: Jalankan tes.** Expected: PASS.
- [ ] **Step 5: Komit** `feat(countrylock): engine Multi (pemindaian dan loop perangkat)`.

### Task 5: Engine, bagian inject, antrean, peristiwa

**Files:**
- Modify: `countrylock/src/multi/engine.ts` (tambah aksi), `countrylock/src/multi/engine.test.ts`

**Interfaces:**
- Consumes: Task 4 (`MultiEngine`, `MultiPorts`).
- Produces (ditambahkan ke `MultiEngine`): `injectDevice(mac: string): void`, `cancelDevice(mac: string): void`, `injectAll(): void`, `stopQueue(): void`, `cancelAll(): void`, `prepareBridge(): Promise<{ ok: boolean; message: string }>`, `pendingEvents(): InjectedEvent[]`, `ackInjected(ids: string[]): void`.

- [ ] **Step 1: Tulis tes** (menambah `engine.test.ts`): (a) `injectDevice` pada `ready` → `queued` lalu `injecting` lalu `success` "Selesai", dan tepat satu `InjectedEvent` dengan `injectedAt` dari `ports.now()`, `target` batch, `serial` dari info; tidak ada event bila gagal/batal; (b) paralelisme: limit 2 dengan 5 perangkat → paling banyak 2 `injecting` bersamaan; `setConcurrency` di tengah inject tidak memutus yang berjalan; (c) `injectAll` hanya menyapu perangkat `ready` sekali dan mencabut `queueStopped`; `stopQueue` membatalkan `queued` (kembali `ready` "Dibatalkan (masih antri)") dan membiarkan `injecting` selesai; `cancelAll` juga membatalkan `injecting` → `failed` "Dibatalkan"; `queueStopped` baru dicabut `injectAll` atau menyalakan Auto Inject; (d) **blokir** (Review Focus 3): `setBlocked('Draft penuh')` → `queued` kembali `ready`, tidak ada slot baru, `injectDevice`/Auto Inject ditolak dengan pesan, `injecting` tetap selesai normal; `setBlocked(null)` melanjutkan; (e) **swap** (Review Focus 1): sebelum `inject`, lease terbaru dicocokkan; bila IP milik MAC itu sudah berubah, perangkat kembali `waiting` ("IP berubah, memeriksa ulang") dan `ports.inject` tidak dipanggil dengan IP lama; (f) perangkat `success` yang dicabut, dibuang setelah masa tenggang, lalu muncul lagi → `ready` dengan `injectedThisSession` (tidak ikut Auto Inject, `injectDevice` manual tetap boleh) (Review Focus 5); (g) `alreadyRegistered`: Auto Inject melewatinya, inject manual boleh; (h) `ackInjected` membuang event dari `pendingEvents()`; event yang sama tidak dibuat dua kali untuk satu inject; (i) `prepareBridge` memanggil `ports.ensureBridgePorts` dan hasilnya dilaporkan di `snapshot().message`, tidak pernah dipanggil otomatis oleh `start`; (j) log per perangkat berisi baris progres berstempel `ports.now()`; (k) kegagalan `ports.inject` melempar galat → `failed` (bukan crash engine).
- [ ] **Step 2: Jalankan** tes engine. Expected: FAIL pada kasus baru.
- [ ] **Step 3: Implementasikan** aksi inject: `InjectDevice` mengambil slot lewat `scheduler.acquire(signal)`, memeriksa blokir dan kecocokan lease tepat sebelum `ports.inject`, menulis event lewat `ports.events.add` SEBELUM status `success` terlihat, dan melepas slot di `finally`.
- [ ] **Step 4: Jalankan** seluruh `bun run --cwd countrylock test`. Expected: PASS (semua tes lama juga).
- [ ] **Step 5: Komit** `feat(countrylock): inject paralel, antrean, dan peristiwa injected pada engine Multi`.

### Task 6: Kontrak jembatan v9

**Files:**
- Modify: `countrylock/src/bridge-channels.ts`, `countrylock/src/bridge-contract.ts`, `countrylock/src/bridge-contract.test.ts`

**Interfaces:**
- Consumes: Task 4/5 (`MultiSnapshot`, `MultiStartConfig` minus `base`, `InjectedEvent`).
- Produces: `type MultiStartDto = Omit<MultiStartConfig, 'base'>` (kredensial dasar dibaca main dari paket, tidak dikirim renderer); `BRIDGE_VERSION = 9`; `MULTI_BRIDGE_VERSION = 9`; `MULTI_CHANGE_EVENT = 'qc:multi:changed'`; kanal `multi*` di `BRIDGE_CHANNELS` (`multiStart, multiStop, multiScan, multiSetConcurrency, multiSetAutoInject, multiInjectDevice, multiCancelDevice, multiInjectAll, multiStopQueue, multiCancelAll, multiAddCredential, multiSetBlocked, multiSetRegistered, multiPrepareBridge, multiSnapshot, multiPendingEvents, multiAckInjected, multiOpenWeb`); `QcBridge.multi` (`start(cfg: MultiStartDto): Promise<void>` dst. sesuai kanal; `onChange(cb: (s: MultiSnapshot) => void): () => void`); skema zod `BRIDGE_ARGS.multi*`: `cfg` memuat `firmwareCode` (string pendek), `concurrency` (int 1..32), `excludeIp` (kosong atau IPv4), `autoInject` (bool), `target` (enam string dibatasi panjang); `mac` divalidasi `normalizeMac`; `addCredential` username/password string dibatasi; `setRegistered` array string maks. `DRAFT_MAX_ROWS` entri; `setBlocked` string ≤ 200 atau `null`; `ackInjected` array id maks. 500.

- [ ] **Step 1: Tulis tes** di `bridge-contract.test.ts`: semua kanal `multi*` unik dan berawalan `qc:multi:`; setiap skema menerima contoh sah dan menolak: argumen berlebih, `concurrency` 0 dan 33, `excludeIp` bukan IPv4, `mac` bukan MAC, `target` tanpa satu field, string kepanjangan; tidak ada skema yang menerima field `password` selain `multiAddCredential`.
- [ ] **Step 2: Jalankan** `bun run --cwd countrylock test src/bridge-contract.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan** konstanta, tipe, dan skema; re-ekspor tipe `MultiSnapshot`/`InjectedEvent` dari `bridge-contract.ts` agar web dan desktop mengimpor dari satu tempat.
- [ ] **Step 4: Jalankan** tes countrylock dan `bun run typecheck`. Expected: PASS (typecheck desktop/web akan menuntut wiring Task 9 dan 10; bila gagal hanya karena `QcBridge.multi` belum diisi, lanjutkan Task 9 dan 10 sebelum komit, atau tambahkan stub sementara yang dihapus di task itu).
- [ ] **Step 5: Komit** `feat(countrylock): kontrak jembatan v9 untuk Multi-Device`.

### Task 7: Penyimpanan peristiwa `injected`

**Files:**
- Create: `desktop/src/main/store/multi-event-store.ts`
- Test: `desktop/src/main/store/multi-event-store.test.ts`

**Interfaces:**
- Consumes: `InjectedEvent` (Task 1).
- Produces: `openMultiEventStore(file: string): { add(e: InjectedEvent): void; list(): InjectedEvent[]; ack(ids: readonly string[]): void; close(): void }` (tabel `multi_injected(event_id TEXT PRIMARY KEY, json TEXT NOT NULL, created_at TEXT NOT NULL)`, `node:sqlite`, WAL, `busy_timeout`, berkas yang sama dengan draft: `draft.db`; `add` idempoten pada `event_id`; `list` terurut waktu masuk; baris rusak dilewati dan dibuang, bukan melempar).

- [ ] **Step 1: Tulis tes** (folder sementara): `add` lalu `list` mengembalikan event yang sama setelah `close` dan buka ulang (Review Focus 4); `add` dua kali `eventId` sama = satu baris; `ack` membuang hanya id yang disebut; `ack` id tak dikenal aman; baris JSON rusak disisipkan langsung ke tabel tidak menggagalkan `list`; dapat berdampingan dengan `openDraftStore` pada berkas yang sama tanpa saling mengunci.
- [ ] **Step 2: Jalankan** `bun run --cwd desktop test src/main/store/multi-event-store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implementasikan** modul (pola `draft-store.ts`).
- [ ] **Step 4: Jalankan tes.** Expected: PASS.
- [ ] **Step 5: Komit** `feat(desktop): penyimpanan peristiwa inject Multi di draft.db`.

### Task 8: Runner inject bersama dan adaptor port nyata

**Files:**
- Create: `desktop/src/main/inject-runner.ts`, `desktop/src/main/multi/ports.ts`
- Modify: `desktop/src/main/ipc.ts` (hanya mengganti isi `runInjectRequest` dengan pemanggilan runner)
- Test: `desktop/src/main/inject-runner.test.ts`, `desktop/src/main/multi/ports.test.ts`

**Interfaces:**
- Produces (`inject-runner.ts`): `createInjectRunner(deps: { ensurePackage(): Promise<LoadedPackage | null>; fetchHostKey; runInject; emitProgress? }): { run(input: { id: string; mode: 'single' | 'multi'; brand: Brand; firmwareCode: string; target: { ip; username; password } }, signal: AbortSignal, onProgress?: (m: string) => void): Promise<InjectResult> }` (isi sama dengan `runInjectRequest` lama: `{sshKey}` hanya bila skrip memakainya, `planInject` dengan `mode`, penyamaran sandi, pesan `REASON_MESSAGES`; `mode: 'multi'` memakai `planInject` mode `multi` sehingga `connectVia` diabaikan).
- Produces (`ports.ts`): `createMultiPorts(deps): MultiPorts` memasang port nyata: `readLeases` = `execCommands` ke `config.server` (host `brands.ubiquiti.multi.ipServer` bila kosong `server.ip`) menjalankan `LEASE_COMMAND` lalu `parseDhcpLeases` (galat apa pun = `null`, tanpa pesan sandi); `ping` = `pingOnce(ip, 1000)`; `readInfo` = `readDeviceInfo('ubiquiti', ...)` dipetakan ke bentuk port; `inject` = `runner.run({mode:'multi',...})`; `ensureBridgePorts` = SSH ke router menjalankan dua langkah L4.2 (hapus bridge port selain `interfaceComp`, tambah tiap `interfaceList` ke `interfaceBridge`; galat per perintah dilaporkan ringkas, tanpa menelan); `events` = `multi-event-store`; `now/sleep/newId` nyata.

- [ ] **Step 1: Tulis tes**: runner (karakterisasi): hasil sama dengan perilaku `runInjectRequest` yang ada untuk satu contoh sukses, firmware tak dikenal, skrip hilang, paket belum dipilih, dan sandi tak bocor di pesan; `mode:'multi'` + `connectVia:'Server'` tetap menyambung ke IP perangkat. Ports: `readLeases` memakai `fake-ssh-server.ts` (`desktop/test-support/`) dengan keluaran contoh L4.3 dan mengembalikan `[{ip, mac}]`; server mati = `null`; `ensureBridgePorts` mengirim tepat perintah L4.2 dan melaporkan galat; sandi sentinel tidak muncul di pesan/log keluaran port.
- [ ] **Step 2: Jalankan** kedua tes. Expected: FAIL.
- [ ] **Step 3: Ekstrak** logika `runInjectRequest` ke `inject-runner.ts` (tanpa mengubah perilaku), ubah `ipc.ts` memakainya, lalu implementasikan `ports.ts`.
- [ ] **Step 4: Jalankan** `bun run --cwd desktop test` penuh. Expected: PASS (termasuk `ipc.test.ts` lama tanpa perubahan asersi).
- [ ] **Step 5: Komit** `refactor(desktop): runner inject bersama; feat(desktop): port nyata Multi-Device`.

### Task 9: Host Multi, IPC, preload, wiring, saling-kecualikan

**Files:**
- Create: `desktop/src/main/multi/host.ts`
- Modify: `desktop/src/main/ipc.ts`, `desktop/src/preload/index.ts`, `desktop/src/main/index.ts`
- Test: `desktop/src/main/multi/host.test.ts`, `desktop/src/main/ipc.test.ts` (tambah)

**Interfaces:**
- Consumes: Task 5, 6, 7, 8.
- Produces: `createMultiHost(deps: { ports: MultiPorts; ensurePackage(): Promise<LoadedPackage | null>; emitChange(s: MultiSnapshot): void; isSingleInjecting(): boolean; openExternal(url: string): Promise<void> }): { handle(channel: MultiChannel, args: unknown[]): Promise<unknown>; isRunning(): boolean; isInjecting(): boolean; dispose(): void }`; `IpcDeps.multi` dan `registerIpc` mengembalikan `{ isInjecting(): boolean; isMultiBusy(): boolean }` (`isInjecting` ikut menghitung Multi untuk `blockReload`/pengelola UI).
- Perilaku: `multiStart` menolak bila `isSingleInjecting()` ("Hentikan inject tunggal dulu"), bila paket belum dipilih, atau merk Ubiquiti tidak ada; kredensial dasar dibaca dari `config.brands.ubiquiti` di main; tunggal menolak `injectRun` bila `host.isInjecting()` ("Hentikan Multi dulu"); `multiOpenWeb(mac)` hanya membuka `https://<ip>` untuk MAC yang ada di snapshot (IP divalidasi `isValidHost`); peristiwa `qc:multi:changed` dikirim ke renderer tiap snapshot berubah; saat renderer baru memuat, `multiPendingEvents` mengembalikan event yang belum di-ack; `dispose` dipanggil di `will-quit` (hentikan engine, tutup store).

- [ ] **Step 1: Tulis tes**: host dengan engine dan port palsu: `start` menolak saat tunggal berjalan dan sebaliknya; argumen divalidasi (IPC menolak `concurrency` 99 dan `mac` ngawur); snapshot yang dikirim ke renderer tidak memuat sandi (sentinel); `openWeb` hanya untuk MAC dikenal dan hanya `https://<ip>`; `isInjecting()` benar selama ada perangkat `injecting`; `dispose` menghentikan engine; `ipc.test.ts`: `injectRun` ditolak saat Multi `injecting` dengan pesan jelas dan semua tes lama tetap hijau.
- [ ] **Step 2: Jalankan** tes desktop terkait. Expected: FAIL.
- [ ] **Step 3: Implementasikan** host, handler IPC `multi*` (memakai pola `handle`/`parseArgs`/`IpcError` yang ada), preload `multi` (termasuk `onChange` yang membuang pendengar), wiring di `index.ts` (`openMultiEventStore(join(userData,'draft.db'))`, `createMultiPorts`, `emitChange` → `webContents.send(MULTI_CHANGE_EVENT, snapshot)`), `blockReload` dan pemeriksaan keluar-aplikasi: keluar sungguhan dari menu tray menanyakan konfirmasi bila `multi.isInjecting()` (dialog OS bawaan Electron, tanpa kanal baru).
- [ ] **Step 4: Jalankan** `bun run --cwd desktop test` dan `bun run --cwd desktop typecheck`. Expected: PASS.
- [ ] **Step 5: Komit** `feat(desktop): host Multi-Device, IPC, preload, dan saling-kecualikan dengan mode tunggal`.

### Task 10: Hook renderer `useMulti` dan jembatan palsu

**Files:**
- Create: `web/src/modules/countrylock/use-multi.ts`
- Modify: `web/src/modules/countrylock/fake-bridge.ts`
- Test: `web/src/modules/countrylock/use-multi.test.tsx`

**Interfaces:**
- Consumes: `QcBridge.multi` (Task 6), `DraftRows` (`useDraftRows`), `buildInjectedRow`/`newClientId`.
- Produces:
  ```ts
  export interface MultiState { supported: boolean; snapshot: MultiSnapshot | null; error: string | null }
  export interface UseMulti extends MultiState { start(cfg: MultiStartDto): Promise<void>; stop(): Promise<void>; actions: { scan(): void; setConcurrency(n: number): void; setAutoInject(on: boolean): void; injectDevice(mac: string): void; cancelDevice(mac: string): void; injectAll(): void; stopQueue(): void; cancelAll(): void; addCredential(c: { username: string; password: string }): void; prepareBridge(): Promise<void>; openWeb(mac: string): void } }
  export function useMulti(bridge: QcBridge, draft: DraftRows): UseMulti
  ```
  `supported = bridge.version >= MULTI_BRIDGE_VERSION && bridge.multi !== undefined`.

- [ ] **Step 1: Tulis tes** dengan `createFakeBridge` (tambah `multi` palsu yang dapat memancarkan snapshot dan menyimpan event): hook membaca `snapshot()` awal lalu berlangganan `onChange`; `setBlocked` dikirim dari `draft` (`injectBlocker` penuh/rusak/belum termuat → alasan, lainnya `null`) dan `setRegistered` dikirim tiap `draft.rows` berubah (serial dinormalisasi gaya web); event `injected` dari `pendingEvents` memanggil `draft.addInjected` dengan data event (Tipe/BU/Lokasi dari `event.target`, `clientId` diturunkan dari `eventId`), lalu `ackInjected`; **event yang sama dikirim dua kali** (muat ulang) tidak menggandakan baris (hasil `'duplicate'` tetap di-ack); `addInjected` hasil `'full'` tidak di-ack; hook tidak aktif bila `supported` false; galat jembatan jadi `error` tanpa melempar.
- [ ] **Step 2: Jalankan** `bunx vitest run src/modules/countrylock/use-multi.test.tsx` dari `web/`. Expected: FAIL.
- [ ] **Step 3: Implementasikan** hook dan perluas `fake-bridge.ts` (field `multi`, `multiEvents`, pemancar snapshot).
- [ ] **Step 4: Jalankan** tes countrylock web. Expected: PASS.
- [ ] **Step 5: Komit** `feat(web): useMulti dan jembatan palsu Multi-Device`.

### Task 11: UI mode Multi di halaman Country Lock

**Files:**
- Create: `web/src/modules/countrylock/components/multi-panel.tsx`, `multi-device-table.tsx`, `multi-credential-panel.tsx`, `multi-form.tsx`
- Modify: `web/src/modules/countrylock/components/country-lock-page.tsx`
- Test: `web/src/modules/countrylock/components/multi-panel.test.tsx`; tambah di `country-lock-page.test.tsx`

**Interfaces:**
- Consumes: `UseMulti` (Task 10), `useCatalog`, `useInjectTarget`, `tipeOptionsFor`, komponen `LinkField`/`Select`.
- Produces: `MultiPanel({ bridge, draft, catalog })` dan di `CountryLockPage` tombol mode **Tunggal | Multi-Device** (Multi hanya bila `multi.supported` dan paket memuat merk Ubiquiti; dinonaktifkan dengan keterangan "Hentikan Multi dulu" selama `snapshot.running`).
- Form Multi: Merk (Ubiquiti, tetap), Tipe, Firmware, Business Unit, Lokasi (semua wajib; tombol Mulai nonaktif dengan "Wajib diisi sebelum Multi dimulai: ..."), Concurrent (1..32), Exclude IP, Auto Inject (konfirmasi sama dengan mode tunggal); field terkunci selama berjalan; nilai Concurrent dan Exclude IP diingat di `localStorage` `qc.countrylock.multi`. Tombol: Mulai/Hentikan, Scan, Siapkan bridge router (dialog konfirmasi yang menyebut perintahnya), Inject All, Stop Antrean, Cancel All. Lencana ringkasan klik-untuk-filter dan "N perangkat (M aktif)". Tabel (kartu bila lebar < 768 px, `useIsDesktop`): titik ping, MAC, IP, Model, Serial, Negara, sumber kredensial, status berwarna, aksi Inject/Retry atau Cancel, tombol "Buka web", log yang dapat dilipat. Panel kredensial dengan tombol `+`.

- [ ] **Step 1: Tulis tes**: tombol mode tampil hanya bila didukung dan merk Ubiquiti ada; memilih Multi menampilkan form dan menyembunyikan kartu Perangkat; Mulai nonaktif sampai Tipe, Firmware, BU, Lokasi terisi; setelah Mulai field terkunci dan tombol mode dinonaktifkan; snapshot dengan beberapa status merender baris/kartu dan lencana menyaring; aksi memanggil `bridge.multi.*` yang sesuai; "Siapkan bridge router" meminta konfirmasi dulu dan tidak memanggil sebelum dikonfirmasi; `+` menambah kredensial tanpa duplikat; teks sandi tidak pernah dirender; Concurrent/Exclude IP tersimpan dan dipulihkan; ringkasan draft dan dialog Catat tetap tampil di bawah.
- [ ] **Step 2: Jalankan** tes komponen. Expected: FAIL.
- [ ] **Step 3: Implementasikan** komponen dan integrasi halaman; gunakan `Select`/`LinkField` (tes memilih lewat `pickSelect`/`pickLink`).
- [ ] **Step 4: Jalankan** `bunx vitest run src/modules/countrylock` dan `bunx biome check --write src/modules/countrylock`. Expected: PASS.
- [ ] **Step 5: Komit** `feat(web): mode Multi-Device di halaman Country Lock`.

### Task 12: Dokumen, uji manual, verifikasi akhir

**Files:**
- Modify: `docs/superpowers/specs/2026-11-06-qc-desktop-country-lock-design.md` (§6.4 dan §9 fase 3), `CLAUDE.md` (bagian desktop), `docs/e2e-checklist-desktop.md`

- [ ] **Step 1: Perbarui dokumen**: spek induk §6.4 merujuk rancangan baru dan menandai fase 3 dikerjakan; `CLAUDE.md` mendapat ringkasan Multi-Device (arsitektur B, jembatan v9, `multi_injected`, saling-kecualikan, `qc.countrylock.multi`, `countrylock/src/multi/`, `desktop/src/main/multi/`); checklist E2E mendapat bagian Multi (satu perangkat, banyak perangkat paralel, IP berpindah, perangkat dicabut, Cancel All, muat ulang di tengah batch, Siapkan bridge router, draft penuh di tengah batch).
- [ ] **Step 2: Verifikasi penuh**: `bun run --cwd countrylock test`, `bun run --cwd desktop test`, `bun run --cwd web test`, `bun run typecheck`, `bunx biome check .` — semuanya bersih.
- [ ] **Step 3: Bangun dan jalankan** (`bun run build:web`, `bun run --cwd desktop build` dengan `CATALOG_TOKEN`) lalu uji asap lewat CDP: `window.qcBridge.version === 9`, `multi.snapshot()` mengembalikan `running:false`, argumen salah ditolak, tombol mode Multi tampil. Tanpa router sungguhan, pemindaian tidak diuji (catat sebagai belum terverifikasi).
- [ ] **Step 4: Komit** `docs(desktop): dokumentasikan mode Multi-Device` dan siapkan PR (bukan ke `main`; basis mengikuti keputusan pemilik: bertumpuk di atas PR #124 atau setelah #124 ter-merge).
