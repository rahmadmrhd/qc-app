# Panduan Interaktif Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengguna mempelajari aplikasi sendiri lewat tur yang menyorot UI asli, banner/kartu penawaran, dan tooltip ikon info dengan demo bergerak, dengan status "selesai" yang disimpan menurut jenis akun (individu = database, bersama = per perangkat).

**Architecture:** Katalog panduan di kode web; satu fungsi penawaran murni ("berhak AND belum selesai AND baru hanya setelah dasar") memakai `GuideStore` yang dipilih dari `me.sharedAccount` (server atau `localStorage`). Server menambah kolom `users.shared_account` dan tabel `guide_progress` dengan tiga rute REST. Mesin tur, tooltip demo, banner, kartu, dan titik sidebar dimuat malas dan dipasang di `AppShell`.

**Tech Stack:** Bun + Hono + MariaDB (server), React 19 + TanStack Query/Router/Form + zod + Radix (web), Vitest + Testing Library (web), `bun:test` (server).

**Spec:** `docs/superpowers/specs/2026-11-13-panduan-interaktif-design.md` (disetujui 2026-11-13). Baca bersama rencana ini.

## Global Constraints

- Teks UI santai, bukan baku penuh (serapan asing seperti scan/batch/default boleh). Bahasa Indonesia.
- Migrasi `0015`: expand-only, idempoten (`IF NOT EXISTS`), kompatibel mundur dengan image sebelumnya.
- Rute REST baru: `shared/contract.ts` + `shared/api.ts` + modul server + tes `rest.test.ts`; tanpa `permission` modul (cukup sesi, pola `notifications.*`); rute JSON baru wajib masuk tabel `server/src/http/body.test.ts`.
- Penerima/pemilik baris dikunci email ternormalisasi (`normalizeEmail` di `server/src/core/email.ts`).
- Penyimpanan perangkat: kunci `qc.guide.done:<email huruf kecil, tanpa spasi pinggir>`, objek JSON `{ "<id>": <versi> }`, dibungkus try/catch (pola `web/src/modules/push/lib/storage.ts`).
- Tidak ada status `skipped`: penanda ada = selesai pada versi itu. "Nanti" memakai `sessionStorage` dan tidak menulis penanda selesai. Progres sebagian tidak disimpan.
- Tur hanya menyorot: tidak mengisi/mengubah field, tidak memanggil rute tulis, berhenti sebelum tombol simpan/kirim.
- Ikon info (tooltip) permanen; hanya titik penandanya yang hilang setelah ikon pernah dibuka.
- Klip: `web/public/klip/<id-panduan>-<n>.webm`, maks. 1 MB, tidak dipra-cache (`globPatterns` PWA tetap tanpa webm/mp4). Adegan `klip` tanpa `berkas` memakai fallback daftar langkah bernomor dan tidak menggagalkan tes.
- Tiap potongan JS web ≤ 600 KB gzip (`scripts/verify-dist.ts`): mesin tur, demo, dan konten dimuat malas (`React.lazy`).
- Tanpa `<select>` bawaan; dialog mengikuti aturan `ui/dialog` (header/footer tetap, badan yang digulir).
- `bun run check` (butuh `bun run db:tunnel` hidup) hijau sebelum tiap commit; tes server per berkas: `bun run --cwd server test <jalur>`; tes web per berkas: `bun run --cwd web test <jalur>`.

## Review Focus

Masukan/kondisi yang tak disebut spek tetapi mungkin dialami pengguna; tiap baris punya tes di task pemiliknya.

1. Akun individu offline atau `guides.list` gagal: TIDAK ada penawaran apa pun (bukan "semua belum selesai"). → Task 5.
2. `localStorage` melempar galat (jendela privat): tidak merusak halaman; panduan dianggap belum selesai. → Task 5.
3. Panduan yang semua langkahnya gugur karena izin per langkah (N = 0) tidak ditawarkan. → Task 5.
4. `guides.mark`/`guides.reset` dengan id tak dikenal, versi 0/negatif/pecahan, atau versi melebihi versi terdaftar: `VALIDATION`, tanpa menulis. → Task 3.
5. Akun berpindah jenis (database berisi baris, lalu menjadi bersama): penyimpanan perangkat yang dipakai, baris database diabaikan, tidak dihapus. → Task 5.

## Gelombang Eksekusi (paralel)

Keputusan pemilik 2026-11-13: eksekusi paralel dalam gelombang (opsi C). Ketergantungan antar-task:

| Gelombang | Task | Serentak | Bergantung pada |
|---|---|---|---|
| S0 | Task 1, lalu Task 1A | 1 | — |
| S1 | Task 2 · Task 3 · Task 4 · Task 5 | 4 | S0 |
| S2 | Task 6 · Task 7 · Task 10 | 3 | Task 5 |
| S3 | Task 8 · Task 11 | 2 | Task 6 (untuk 8), Task 7 dan 10 (untuk 11) |
| S4 | Task 9 | 1 | Task 8 |
| S5 | Task 12 | 1 | semua |

Agen (satu per jalur beban, dilanjutkan lewat `SendMessage`; model disebut eksplisit saat dispatch): **A** server-akses (Sonnet): Task 1, 1A, 2. **B** server-panduan (Sonnet): Task 3. **C** web-akses (Haiku): Task 4. **D** web-inti (Sonnet): Task 5, 6, 8, 9. **E** web-demo (Sonnet): Task 7, 11. **F** web-konten (Sonnet): Task 10. **G** dokumentasi (Haiku): Task 12.

Aturan gelombang:
1. **Isolasi.** Tiap agen bekerja di worktree sendiri dan commit per task pada cabang sendiri (`panduan/t<N>`). Koordinator menggabungkan cabang gelombang ke cabang kerja (`git merge --no-ff`) di akhir gelombang dan menyelesaikan konflik kecil (mis. `shared/contract.ts`). Dokumen spek dan rencana WAJIB sudah ter-commit di cabang kerja sebelum agen disebar (agar ada di dasar worktree).
2. **Tes selama paralel.** Tiap agen hanya menjalankan tes terarah: server `QC_TEST_SHARDS=1 bun run --cwd server test <jalur>`, web `bun run --cwd web test <jalur>`, shared `bun run --cwd shared test <jalur>`. Setiap langkah "Jalankan ... `bun run check`" di task dibaca sebagai "tes terarah task itu"; `bun run check` penuh (dan `bun run build` bila disebut) dijalankan SEKALI oleh koordinator setelah gabungan gelombang. Alasan: `max_connections` MariaDB VPS 40 dan pool ≤ 8 koneksi per proses tes. Pada S0 (satu agen) `bun run check` penuh boleh dijalankan.
3. **Berkas bersama.** Task dalam satu gelombang tidak menyentuh berkas yang sama. `app-shell.tsx` hanya disentuh berurutan: Task 10 (S2, atribut `data-tour`), Task 8 (S3, `TourProvider` dan sapaan), Task 9 (S4, banner).
4. **Review.** Tidak ada review per task. Satu review independen (kesesuaian dengan spek, kebenaran/regresi, dan security review memakai skill `security-audit` pada perubahan) setelah S5; temuan dikerjakan agen yang sama.
5. Jangan menghentikan atau memulai ulang server dev milik pengguna (port 3000 dan 8788).

---

### Task 1: Migrasi 0015 (kolom akun bersama dan tabel progres)

**Files:**
- Create: `server/migrations/0016_panduan_interaktif.sql`
- Modify: `server/src/core/migrate.test.ts` (daftar tabel ~baris 53; tambah dua tes skema)
- Modify: `server/test-support/access-fixtures.ts` (`seedUser` menerima `sharedAccount?: boolean`)

**Interfaces:**
- Produces: kolom `users.shared_account TINYINT(1) NOT NULL DEFAULT 0`; tabel `guide_progress(recipient VARCHAR(255), guide_id VARCHAR(100), \`version\` INT, updated_at VARCHAR(30))` kunci utama `(recipient, guide_id)`, kolasi `utf8mb4_nopad_bin`, tanpa kunci asing (konvensi `0013_notifikasi.sql`).
- Produces: `seedUser(env, { ..., sharedAccount?: boolean })` menulis kolom itu.

- [ ] **Step 1: Tulis tes skema yang gagal** di `migrate.test.ts`: `users.shared_account` bertipe `tinyint`, `is_nullable = 'NO'`, bawaan `0`; tabel `guide_progress` ada dengan kunci utama `(recipient, guide_id)`. Ikuti bentuk tes `users.bu_assignments` (~baris 350).
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/core/migrate.test.ts`. Harapan: dua tes baru GAGAL.
- [ ] **Step 3: Tulis migrasi** `0016_panduan_interaktif.sql`: `ALTER TABLE users ADD COLUMN IF NOT EXISTS shared_account TINYINT(1) NOT NULL DEFAULT 0` dan `CREATE TABLE IF NOT EXISTS guide_progress` (komentar kepala: expand-only, idempoten, alasan tanpa kunci asing). Tambahkan `guide_progress` ke daftar tabel yang diperiksa tes (~baris 53) bila daftar itu menuntutnya.
- [ ] **Step 4: Perluas `seedUser`** agar menyertakan `shared_account` pada `INSERT` (bawaan 0).
- [ ] **Step 5: Jalankan** tes yang sama; harapan LULUS. Lalu `bun run check`.
- [ ] **Step 6: Commit** `feat(panduan): migrasi 0015 kolom akun bersama dan tabel progres panduan`.

---

### Task 1A: Kontrak bersama dan rute sementara

Membuka S1: sesudah task ini server dan web tidak saling menunggu (tes web memakai `api` tiruan). `RouteTable` dipetakan dari `ApiContract`, jadi id `guides.*` butuh rute sementara agar typecheck hijau.

**Files:**
- Create: `shared/guides.ts`, `shared/guides.test.ts`, `server/src/modules/guide/routes.ts` (SEMENTARA, diganti Task 3)
- Modify: `shared/contract.ts` (`UserDto`, `SaveUserInput`, `MeDto`, tiga id `guides.*`), `shared/api.ts`, `shared/api.test.ts` (contoh input tiga id), `server/src/routes.ts` (daftarkan `guideRoutes()` dekat `notificationRoutes()`), `server/src/http/body.test.ts` (tiga rute), `server/src/modules/access/service.ts` (`toUserDto` mengisi `sharedAccount: false` sementara), `server/src/modules/auth/api.ts` (`sharedAccount: false` sementara)
- Modify (fallout tipe): fixture `MeDto`/`UserDto` di web dan server yang ditandai `bun run typecheck` (±23 berkas web, beberapa server): tambahkan `sharedAccount: false`, mekanis.

**Interfaces:**
- Produces (`shared/guides.ts`): `GUIDE_IDS` (`['sapaan-awal','dasar-layout','handover-dasar','tip-handover-tempel-wa'] as const`), `type GuideId`, `GUIDE_VERSIONS: Record<GuideId, number>` (semua 1), `GUIDE_COVERS: Partial<Record<GuideId, readonly GuideId[]>>` (kosong pada tahap awal), `interface GuideProgressDto { id: GuideId; version: number }`.
- Produces (kontrak): `'guides.list'` `{ input: null; output: GuideProgressDto[] }`; `'guides.mark'` `{ input: MarkGuideInput; output: GuideProgressDto[] }` dengan `MarkGuideInput { id: string; version: number }`; `'guides.reset'` `{ input: ResetGuideInput; output: GuideProgressDto[] }` dengan `ResetGuideInput { id: string }`. Semua keluaran = daftar lengkap pemanggil sesudah operasi. `UserDto.sharedAccount: boolean`; `MeDto.sharedAccount: boolean`; `SaveUserInput.sharedAccount?: boolean`.
- Produces (`api.ts`): `GET /guides`; `PUT /guides/{id}` (badan `{ version }`); `POST /guides/{id}/reset` (pola `notifications.markRead`).
- Produces: `guideRoutes(): Pick<RouteTable, 'guides.list' | 'guides.mark' | 'guides.reset'>` SEMENTARA: ketiganya mengembalikan `[]` (komentar kepala: "SEMENTARA, diganti Task 3").

- [ ] **Step 1: Tulis tes yang gagal.** `shared/guides.test.ts`: setiap id di `GUIDE_IDS` punya `GUIDE_VERSIONS` bilangan bulat ≥ 1; kunci dan nilai `GUIDE_COVERS` semuanya ada di `GUIDE_IDS`. `shared/api.test.ts`: contoh input `'guides.list': null`, `'guides.mark': { id: 'dasar-layout', version: 1 }`, `'guides.reset': { id: 'dasar-layout' }` (tes yang menjaga `API_ROUTES` dan `ApiContract` sejalan sudah ada). `body.test.ts`: tiga rute masuk tabel.
- [ ] **Step 2: Jalankan** `bun run --cwd shared test`. Harapan: GAGAL.
- [ ] **Step 3: Implementasi** semua berkas "Produces" dan perubahan "Modify"; nilai `sharedAccount: false` sementara diberi komentar "SEMENTARA, diganti Task 2".
- [ ] **Step 4: Perbaiki fallout tipe** sampai `bun run typecheck` hijau.
- [ ] **Step 5: Jalankan** `bun run check` (S0 satu agen: penuh boleh); harapan hijau.
- [ ] **Step 6: Commit** `feat(panduan): kontrak bersama (akun bersama, guides.*) dan rute sementara`.

---

### Task 2: Akun bersama di server (validasi, repo, service, `auth.me`)

**Files:**
- Modify: `server/src/modules/access/{validate,repo,service,context}.ts`, `server/src/modules/auth/api.ts`
- Test: `server/src/modules/access/validate.test.ts`, `rest.test.ts`, `context.test.ts`, `server/src/modules/auth/*.test.ts` (yang sudah menguji `auth.me`)

**Interfaces:**
- Consumes: `UserDto.sharedAccount`, `MeDto.sharedAccount`, `SaveUserInput.sharedAccount?` dan nilai sementara `false` (Task 1A).
- Produces: `SaveUserInput.sharedAccount?: boolean` dihilangkan pada pembaruan = pertahankan nilai yang ada, pada pembuatan = `false`; `UserRecord.sharedAccount`; `UserContext.sharedAccount: boolean`; nilai sementara Task 1A diganti nilai nyata.
- Produces: snapshot audit `userSnapshot` memuat `sharedAccount` sehingga perubahan tercatat di `user.update`.

- [ ] **Step 1: Tulis tes yang gagal.** `validate.test.ts`: `validateSaveUser` menerima `sharedAccount: true|false`, menolak bukan-boolean (pesan field `sharedAccount`), dan hasilnya tidak memuat kunci itu bila tak dikirim. `rest.test.ts`: (a) `PUT access.users.save` dengan `sharedAccount: true` lalu `GET` daftar user mengembalikan `sharedAccount: true`; (b) pembaruan tanpa field itu mempertahankan nilai `true`; (c) entri audit `user.update` berisi `sharedAccount` pada `before`/`after`; (d) pengguna tanpa `access: manage` ditolak seperti biasa. `auth` tes: `auth.me` untuk akun bertanda bersama mengembalikan `sharedAccount: true`, akun lain `false`.
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/access src/modules/auth`. Harapan: tes baru GAGAL.
- [ ] **Step 3: Implementasi** — `validateSaveUser` membaca boolean opsional (pola `validatePushPreference`); `repo.ts`: `UserRow`/`toUser`/semua `SELECT`/`insertUserStmt`/`updateUserStmt` memuat `shared_account` (`Number(...) === 1`); `service.ts`: `toUserDto`, `userSnapshot`, `saveUser` (pertahankan nilai saat tak dikirim); `context.ts`: tambahkan kolom `shared_account` ke `ACCESS_SQL` (kolom generik berikutnya) dan ke `UserContext` (admin super: dari baris bila ada, selain itu `false`); `auth/api.ts`: kirim `sharedAccount: ctx.user.sharedAccount` dan `toUserDto` kirim `user.sharedAccount` (keduanya menggantikan nilai sementara Task 1A).
- [ ] **Step 4: Jalankan** tes di Step 2; harapan LULUS.
- [ ] **Step 5: Commit** `feat(panduan): akun bersama di data pengguna, auth.me, dan audit`.

---

### Task 3: Modul panduan server (tiga rute REST)

**Files:**
- Modify: `server/src/modules/guide/routes.ts` (ganti rute sementara Task 1A dengan handler nyata)
- Create: `server/src/modules/guide/{repo,service,validate}.ts`
- Test: `server/src/modules/guide/rest.test.ts`, `service.test.ts`

**Interfaces:**
- Consumes: `GUIDE_IDS`, `GUIDE_VERSIONS`, `GUIDE_COVERS`, `GuideProgressDto`, `MarkGuideInput`, `ResetGuideInput`, id `guides.*`, dan entri `API_ROUTES` (Task 1A); tabel `guide_progress` (Task 1).
- Produces (service): `listGuides(env, user): Promise<GuideProgressDto[]>`; `markGuide(env, user, input, covers = GUIDE_COVERS): Promise<GuideProgressDto[]>`; `resetGuide(env, user, input): Promise<GuideProgressDto[]>`.

- [ ] **Step 1: Tulis tes yang gagal** di `rest.test.ts`: (a) `GET /guides` pengguna baru → `[]`; (b) `PUT /guides/dasar-layout` `{version:1}` lalu `GET` → berisi `{id:'dasar-layout',version:1}`; (c) mark ulang dengan versi sama idempoten, versi tak pernah turun; (d) milik pemanggil saja (dua email berbeda tidak saling melihat); (e) `POST /guides/dasar-layout/reset` menghapus barisnya; (f) **Review Focus 4**: id tak dikenal, `version` 0, `-1`, `1.5`, `"1"`, dan versi lebih besar dari `GUIDE_VERSIONS[id]` → 400 `VALIDATION` dan tabel tidak berubah, juga untuk `reset` dengan id tak dikenal; (g) tanpa sesi → 401. Di `service.test.ts`: `markGuide` dengan `covers = { 'handover-dasar': ['tip-handover-tempel-wa'] }` menulis KEDUA baris dalam satu `batch()` (pembuktian atomik: bila salah satu id bermasalah tidak ada baris tertulis).
- [ ] **Step 2: Jalankan** `bun run --cwd server test src/modules/guide`. Harapan: GAGAL (rute sementara mengembalikan `[]`).
- [ ] **Step 3: Implementasi** `repo.ts` (satu `SELECT` per `recipient`; upsert `INSERT ... ON DUPLICATE KEY UPDATE` dengan `GREATEST(version, VALUES(version))`, kolom `version` berbacktick; `DELETE` per id); `validate.ts` (`readObject`, id wajib ada di `GUIDE_IDS`, versi bilangan bulat 1..versi terdaftar); `service.ts` (email via `normalizeEmail`, waktu via `nowIso(env)`; semua tulis dalam satu `batch()`); `routes.ts` tetap bertipe `Pick<RouteTable, ...>` tanpa `permission`, kini memanggil service (pendaftaran di `server/src/routes.ts` sudah ada dari Task 1A).
- [ ] **Step 4: Jalankan** tes di Step 2; harapan LULUS.
- [ ] **Step 5: Commit** `feat(panduan): rute guides.list/mark/reset dengan penyimpanan di database`.

---

### Task 4: Opsi "Akun bersama" di Pengaturan Akses (web)

**Files:**
- Modify: `web/src/modules/access/schemas.ts` (`userFormSchema`, `toUserFormDefaults`), `components/user-form.tsx`, `components/users-table.tsx`
- Test: `schemas.test.ts`, `components/user-form.test.tsx`, `components/users-table.test.tsx`

**Interfaces:**
- Consumes: `UserDto.sharedAccount`, `SaveUserInput.sharedAccount` (Task 1A).
- Produces: `UserFormInput.sharedAccount: boolean` (bawaan `false`; hasil `toUserFormDefaults` mengikuti `user.sharedAccount`); formulir mengirim `sharedAccount` ke `access.users.save`.

- [ ] **Step 1: Tulis tes yang gagal.** `schemas.test.ts`: `toUserFormDefaults()` → `sharedAccount: false`; `toUserFormDefaults(userBersama).sharedAccount` → `true`; `userFormSchema.parse` meneruskan boolean itu. `user-form.test.tsx`: checkbox berlabel "Akun bersama" tampil dengan keterangan singkat; mencentangnya lalu simpan memanggil `onSubmit` dengan `sharedAccount: true`. `users-table.test.tsx`: baris akun bersama menampilkan lencana "Akun bersama"; akun individu tidak.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/access`. Harapan: GAGAL.
- [ ] **Step 3: Implementasi**: skema dan defaults; `Checkbox` (`ui/checkbox`) + `Label` di `UserForm` setelah field Status, keterangan santai ("Dipakai beberapa orang. Panduan ditampilkan ulang di tiap perangkat."); `Badge variant="outline"` di sel Email/Nama pada `UsersTable`; pastikan `routes/_app/access/users.tsx` meneruskan nilai form apa adanya ke `useSaveUser`.
- [ ] **Step 4: Jalankan** tes di Step 2 dan `bun run check`; harapan hijau.
- [ ] **Step 5: Commit** `feat(panduan): opsi Akun bersama di form dan tabel pengguna`.

---

### Task 5: Katalog, fungsi penawaran, dan `GuideStore` (web, tanpa UI)

**Files:**
- Create: `web/src/modules/guide/lib/{types,offer,device-store,use-guide-store}.ts`, `web/src/modules/guide/queries.ts`, `web/src/modules/guide/catalog/index.ts` (daftar awal kosong yang diisi Task 10-11)
- Test: `lib/offer.test.ts`, `lib/device-store.test.ts`, `lib/use-guide-store.test.tsx`, `catalog/catalog.test.ts`

**Interfaces:**
- Consumes: `GuideProgressDto`, `GUIDE_VERSIONS`, `GUIDE_COVERS`, id `guides.*` (Task 1A); `MeDto.sharedAccount` (Task 1A); `canAnywhere` (`web/src/modules/auth/permissions.ts`).
- Produces (`types.ts`): `GuidePermission { module: ModuleKey; level: Level; scope?: 'location' }`; `GuideAccess = GuidePermission | readonly GuidePermission[]` (daftar = salah satu cukup, sama dengan `NavItem.permission`); `GuideStep { target: string; text: string; route?: string; advance: 'next' | 'click'; izin?: GuideAccess; tip?: string }`; `GuideEntry { id: string; kind: 'dasar'|'baru'|'tip'|'sapaan'; status: 'disimpan'|'diturunkan'; version: number; title: string; izin?: GuideAccess; halaman?: string; steps: readonly GuideStep[]; covers?: readonly string[] }`.
- Produces (`offer.ts`): `offeredGuides(input: { me: MeDto; catalog: readonly GuideEntry[]; done: ReadonlyMap<string, number>; derived: ReadonlyMap<string, boolean>; activeLocationIds?: readonly string[] }): GuideOffer[]` dengan `GuideOffer { entry: GuideEntry; stepCount: number }`; `stepsFor(entry, me, activeLocationIds): GuideStep[]` (langkah lolos `izin`). `hasAccess(me: MeDto, access: GuideAccess | undefined, activeLocationIds?: readonly string[]): boolean` (tanpa `access` = semua pengguna; daftar = salah satu cukup; dipakai juga untuk `izin` per langkah). Aturan = spek 4.2; `tip` dan `sapaan` tidak ikut daftar kartu/banner (sapaan ditangani terpisah: fungsi `greetingDue(done): boolean`).
- Produces (`device-store.ts`): `readDone(email): Map<string, number>`, `writeDone(email, entries: Record<string, number>): void`, `clearOne(email, id): void`.
- Produces (`use-guide-store.ts`): `useGuideStore(): { ready: boolean; done: ReadonlyMap<string, number>; mark(id: string, version: number, covers?: readonly string[]): Promise<void>; reset(id: string): Promise<void> }`; memilih server bila `!me.sharedAccount`, perangkat bila `me.sharedAccount`.
- Produces (`queries.ts`): `guideKeys`, `guidesQueryOptions()` memakai `api('guides.list', null)`; TIDAK masuk whitelist `app/query-persist.ts`.

- [ ] **Step 1: Tulis tes `offer.test.ts` (tabel kasus).** Pengguna tanpa izin modul tidak ditawari; izin cukup + belum selesai → ditawari; `done` versi lebih rendah dari katalog → ditawari lagi; `baru` tidak ditawari sebelum `dasar` modulnya selesai, ditawari sesudahnya; `stepCount` hanya menghitung langkah yang lolos `izin`; **Review Focus 3**: panduan yang semua langkahnya gugur (`stepCount` 0) tidak ditawari; panduan `diturunkan` ditawari menurut `derived.get(id) === true` dan tak pernah membaca `done`; `greetingDue` true bila `sapaan-awal` belum ada di `done`.
- [ ] **Step 2: Tulis tes `device-store.test.ts`.** Kunci per email (dua email tidak saling melihat; huruf besar/spasi pinggir disamakan); JSON rusak → peta kosong; **Review Focus 2**: `localStorage.getItem`/`setItem` melempar galat → `readDone` kosong dan `writeDone` tidak melempar.
- [ ] **Step 3: Tulis tes `use-guide-store.test.tsx`** (mock `useMe` dan `@/lib/api` seperti `push-onboarding.test.tsx`): akun individu memuat dari `guides.list`, `ready` false sebelum termuat; **Review Focus 1**: `guides.list` gagal → `ready` tetap false (tidak ada penawaran), bukan peta kosong siap; `mark` memanggil `guides.mark` dan memperbarui cache; akun bersama memakai `localStorage` dan TIDAK memanggil `api`; **Review Focus 5**: akun `sharedAccount: true` dengan baris di respons server tidak pernah memanggil `guides.list`; `mark` dengan `covers` menulis juga id yang tercakup (server: satu panggilan; perangkat: satu kali tulis).
- [ ] **Step 4: Tulis `catalog.test.ts`**: id unik; setiap entri `status: 'disimpan'` ada di `GUIDE_IDS` dengan `version` sama dengan `GUIDE_VERSIONS`; `entry.covers` sama dengan `GUIDE_COVERS[entry.id]` (satu sumber kebenaran di `shared/guides.ts` dipakai server; katalog tidak boleh menyimpang) dan merujuk id yang ada; setiap `step.route` adalah rute yang dikenal router (`LinkProps['to']` lewat `MODULE_LINKS`/`NAV_GROUPS` atau daftar eksplisit); setiap `step.target` muncul sebagai `data-tour="<target>"` di `web/src` (pindai sumber); setiap adegan `klip` yang memuat `berkas` ada di `web/public/klip/`; adegan tanpa `berkas` lolos.
- [ ] **Step 5: Jalankan** `bun run --cwd web test src/modules/guide`. Harapan: GAGAL (modul belum ada).
- [ ] **Step 6: Implementasi** semua berkas "Produces" di atas. `useGuideStore` memilih implementasi lewat `useMe().sharedAccount`; pemuatan server lewat `useQuery(guidesQueryOptions())` dan `ready` = `isSuccess`; mutasi memasang hasil server ke cache (`setQueryData`, pola `notification/queries.ts`).
- [ ] **Step 7: Jalankan** tes di Step 5 dan `bun run check`; harapan hijau.
- [ ] **Step 8: Commit** `feat(panduan): katalog, fungsi penawaran, dan penyimpanan status per jenis akun`.

---

### Task 6: Mesin tur

**Files:**
- Create: `web/src/modules/guide/components/tour/{tour-provider,tour-overlay,tour-step-card}.tsx`, `web/src/modules/guide/lib/resolve-steps.ts`
- Test: `components/tour/tour.test.tsx`, `lib/resolve-steps.test.ts` (tes membungkus `TourProvider` sendiri; pemasangan di `AppShell` dikerjakan Task 8)

**Interfaces:**
- Consumes: `GuideEntry`, `GuideStep`, `stepsFor` (Task 5); `useGuideStore().mark` (Task 5).
- Produces: `TourProvider` dan `useTour(): { start(entry: GuideEntry): void; active: boolean }`; `resolveSteps(entry, me, activeLocationIds, queryTarget: (target: string) => Element | null): GuideStep[]` (membuang langkah tanpa izin; langkah tanpa target di halaman dibuang saat tur berjalan, bukan di awal).

- [ ] **Step 1: Tulis tes yang gagal** (`tour.test.tsx`, jsdom; elemen uji diberi `data-tour`): (a) `start` menyorot elemen target (overlay punya `role="dialog"`/label "Panduan", kartu langkah menampilkan teks); (b) langkah `advance: 'next'` maju dengan tombol Lanjut; (c) langkah `advance: 'click'` maju otomatis saat target diklik; (d) langkah dengan `route` berbeda menavigasi lalu menunggu target muncul; (e) target tidak ada (`tidak muncul dalam batas waktu`) → langkah dilewati, tur TIDAK macet dan lanjut ke berikutnya; (f) langkah `izin` tidak terpenuhi dilewati seluruhnya; (g) langkah dengan `tip` menampilkan adegan demo (komponen dari Task 7, dimock pada tes ini); (h) tombol Esc/Tutup menutup tur tanpa menulis penanda; menyelesaikan langkah terakhir memanggil `mark(entry.id, entry.version, entry.covers)` tepat sekali; (i) tur tidak mengubah nilai field mana pun (assert input uji tetap kosong) dan tidak memanggil `api` untuk rute tulis.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/guide/components/tour`. Harapan: GAGAL.
- [ ] **Step 3: Implementasi.** Sorotan: elemen tetap berposisi dari `getBoundingClientRect` target (dihitung ulang saat `resize`/gulir), dengan `box-shadow` besar sebagai latar redup; kartu langkah memakai `ui/popover` atau kartu tetap; navigasi lewat `useNavigate` TanStack; tunggu target dengan `MutationObserver` + batas waktu (konstanta bernama `TARGET_WAIT_MS`); di layar sempit langkah yang menyorot menu sidebar membuka sidebar lebih dulu (`useSidebar`); hormati `prefers-reduced-motion`; Tab/Enter/Esc/ArrowRight dapat dipakai. Muat malas: `React.lazy` pada pembungkus agar tidak masuk potongan utama.
- [ ] **Step 4: Jalankan** tes Step 2 dan `bun run check` lalu `bun run build` (periksa `verify-dist` lolos anggaran 600 KB gzip per potongan); harapan hijau.
- [ ] **Step 5: Commit** `feat(panduan): mesin tur yang menyorot UI asli`.

---

### Task 7: Tooltip ikon info dan pemutar demo

**Files:**
- Create: `web/src/modules/guide/components/{tip-button,demo-player}.tsx`, `web/src/modules/guide/lib/demo-types.ts`
- Test: `components/tip-button.test.tsx`, `components/demo-player.test.tsx`

**Interfaces:**
- Consumes: `useGuideStore` (Task 5); `ui/popover`.
- Produces (`demo-types.ts`): `type DemoScene = { kind: 'kode'; caption: string; durationMs: number; render: () => ReactNode } | { kind: 'klip'; caption: string; berkas?: string; cues?: readonly { at: number; text: string }[] }`.
- Produces: `DemoPlayer({ scenes }: { scenes: readonly DemoScene[] })` (jeda, titik adegan yang dapat diketuk, keterangan per adegan, berulang); `TipButton({ tipId, label }: { tipId: string; label: string })` (ikon info; hover/fokus membuka di desktop, ketuk di layar sentuh; titik penanda sampai pernah dibuka).

- [ ] **Step 1: Tulis tes yang gagal.** `demo-player`: adegan berganti sesuai `durationMs` (timer palsu) dan keterangan mengikutinya; tombol Jeda menghentikan pergantian; titik adegan melompat; adegan `klip` tanpa `berkas` atau dengan galat muat → daftar langkah bernomor; `prefers-reduced-motion` → daftar langkah bernomor tanpa animasi. `tip-button`: ikon memiliki nama aksesibel dari `label`; titik penanda tampil bila penanda `tipId` belum ada, hilang setelah dibuka dan `mark` dipanggil SEKALI; ikon tetap ada setelah penanda ada (permanen); Enter/fokus membuka; klip `preload="none"` (tidak mengunduh sebelum dibuka).
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/guide/components/tip-button.test.tsx src/modules/guide/components/demo-player.test.tsx`. Harapan: GAGAL.
- [ ] **Step 3: Implementasi** dengan `useReducer` untuk indeks adegan dan status jeda; `Popover` terkendali (hover dengan `onPointerEnter/Leave` bila `pointer: fine`, ketuk bila tidak); `<video muted loop playsInline preload="none">` untuk klip dengan keterangan dari `cues` disinkronkan lewat `timeupdate`. Seluruh modul dimuat malas oleh pemakainya.
- [ ] **Step 4: Jalankan** tes Step 2 dan `bun run check`; harapan hijau.
- [ ] **Step 5: Commit** `feat(panduan): tooltip ikon info dengan pemutar demo bergerak`.

---

### Task 8: Kartu beranda, menu profil, dan sapaan

**Files:**
- Create: `web/src/modules/guide/components/{guide-cards,guide-greeting,guide-menu-dialog}.tsx`, `web/src/modules/guide/lib/use-offered-guides.ts`
- Modify: `web/src/routes/_app/index.tsx` (kartu di atas daftar modul), `web/src/app/shell/user-menu.tsx` (item "Panduan"), `web/src/app/shell/app-shell.tsx` (bungkus dengan `TourProvider` dari Task 6, dimuat malas; pasang `GuideGreeting`)
- Test: `components/guide-cards.test.tsx`, `guide-greeting.test.tsx`, `guide-menu-dialog.test.tsx`, `web/src/app/shell/user-menu.test.tsx` (tambahan)

**Interfaces:**
- Consumes: `offeredGuides`, `greetingDue`, `useGuideStore` (Task 5); `useTour` (Task 6); status perangkat dari `web/src/app/pwa/install` dan `web/src/modules/push/lib/*` untuk `derived` (hanya dibaca).
- Produces: `useOfferedGuides(): { ready: boolean; offers: GuideOffer[] }` (menyatukan `GuideStore` dan keadaan perangkat; kosong bila `!ready`); `GuideMenuDialog` memuat SEMUA panduan yang berhak (termasuk yang sudah selesai, dengan "Ulangi" yang memanggil `reset` lalu `start`).

- [ ] **Step 1: Tulis tes yang gagal.** `guide-cards`: menampilkan daftar penawaran dengan judul, jumlah langkah, dan tombol Mulai yang memanggil `start`; tidak merender apa pun saat tidak ada penawaran atau `!ready`. `guide-greeting`: dialog "Mau tur singkat?" tampil bila `greetingDue` dan `ready`, TIDAK tampil bila tur sedang berjalan atau dialog/banner `PushOnboarding` sedang tampil; "Mulai" menjalankan panduan dasar pertama yang ditawarkan; "Nanti" menulis penanda `sapaan-awal` (tidak ditanya lagi). `app-shell`: `useTour()` dipanggil dari anak `AppShell` tidak melempar (provider terpasang). `guide-menu-dialog` dan `user-menu`: item "Panduan" membuka dialog; panduan `disimpan` yang selesai menampilkan "Ulangi" (memanggil `reset` lalu `start`), panduan `diturunkan` selalu menampilkan "Lihat lagi" yang hanya `start` tanpa `reset`.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/guide/components src/app/shell/user-menu.test.tsx`. Harapan: GAGAL.
- [ ] **Step 3: Implementasi** (dialog mengikuti aturan `ui/dialog`; kartu memakai `Card`/`Button` yang ada; sapaan ditunda lewat penanda bersama dengan `PushOnboarding` — tambahkan ekspor `useBlockingOnboardingActive()` kecil di `push-onboarding.tsx` bila belum ada cara membaca statusnya).
- [ ] **Step 4: Jalankan** tes Step 2 dan `bun run check`; harapan hijau.
- [ ] **Step 5: Commit** `feat(panduan): kartu beranda, item menu profil, dan sapaan`.

---

### Task 9: Banner per halaman dan titik penanda sidebar

**Files:**
- Create: `web/src/modules/guide/components/guide-banner.tsx`, `web/src/modules/guide/lib/guide-for-route.ts`
- Modify: `web/src/app/shell/app-shell.tsx` (banner di atas `<main>`), `web/src/app/shell/app-sidebar.tsx` (titik pada item yang punya panduan belum selesai)
- Test: `components/guide-banner.test.tsx`, `lib/guide-for-route.test.ts`, `web/src/app/shell/app-sidebar.test.tsx` (baru bila belum ada)

**Interfaces:**
- Consumes: `useOfferedGuides` (Task 8), `useTour` (Task 6).
- Produces: `guideForRoute(offers: readonly GuideOffer[], pathname: string): GuideOffer | null` (awalan `entry.halaman` cocok dengan `pathname`; bila lebih dari satu, yang pertama menurut urutan katalog); `hasPendingGuide(offers, itemTo: string): boolean` untuk titik sidebar.

- [ ] **Step 1: Tulis tes yang gagal.** `guide-for-route`: `'/handover'` cocok dengan `/handover` dan `/handover/new` tetapi tidak `/handovers-lain`; satu panduan saja bila beberapa cocok (urutan katalog); `dasar-layout` (tanpa `halaman`) tidak pernah cocok. `guide-banner`: teks "Pertama kali di …? Ada panduan N langkah." dengan tombol **Mulai**, **Nanti**, **Sudah paham**; Mulai → `start`; Nanti → banner hilang dan `sessionStorage` tercatat, tidak ada `mark`; Sudah paham → `mark(id, version, covers)` lalu hilang; banner TIDAK tampil saat tur berjalan atau saat dialog `PushOnboarding` tampil. `app-sidebar`: titik muncul pada item yang punya panduan belum selesai dan hilang setelah selesai.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/guide src/app/shell/app-sidebar.test.tsx`. Harapan: GAGAL.
- [ ] **Step 3: Implementasi** (banner memakai pola `update-banner`/banner push yang ada; titik = elemen dekoratif kecil dengan `aria-label` "Ada panduan" pada tautan sidebar).
- [ ] **Step 4: Jalankan** tes Step 2 dan `bun run check`; harapan hijau.
- [ ] **Step 5: Commit** `feat(panduan): banner panduan per halaman dan titik penanda sidebar`.

---

### Task 10: Konten panduan layout dasar, PWA, dan push

**Files:**
- Create: `web/src/modules/guide/catalog/{layout,device}.ts`
- Modify: `web/src/modules/guide/catalog/index.ts`; pasang `data-tour` pada `app-shell.tsx` (`sidebar-trigger`), `location-picker.tsx` (`location-picker`), `notification-bell.tsx` (`notification-bell`), `theme-toggle.tsx` (`theme-toggle`), `user-menu.tsx` (`user-menu`), `app-sidebar.tsx` (`sidebar-menu`)
- Test: `catalog/catalog.test.ts` (sudah ada dari Task 5; harus tetap hijau), `catalog/layout.test.ts`

**Interfaces:**
- Consumes: tipe katalog (Task 5), `useInstall` (`web/src/app/pwa/install`), dan utilitas yang sudah ada di `web/src/modules/push/lib/` untuk membaca izin notifikasi dan langganan perangkat (tanpa menulis).
- Produces: entri `dasar-layout` (`status: 'disimpan'`, tanpa `halaman`, semua pengguna; langkah: sidebar → pemilih lokasi → lonceng → tema → menu profil), `perangkat-pwa` dan `perangkat-push` (`status: 'diturunkan'`; langkah menjelaskan menu "Pasang aplikasi" dan "Notifikasi push" dengan adegan `klip` tanpa `berkas` dulu), dan fungsi `deriveDeviceGuides(): Map<string, boolean>` (true bila PWA belum terpasang dan dapat dipasang; true bila izin push bukan `granted` atau belum berlangganan).

- [ ] **Step 1: Tulis tes yang gagal** (`layout.test.ts`): `deriveDeviceGuides` dengan `matchMedia('(display-mode: standalone)')` palsu → `perangkat-pwa` false saat terpasang; `Notification.permission` `granted` + langganan ada → `perangkat-push` false; selain itu true; untuk `dasar-layout` `offeredGuides` memberi `stepCount` sama dengan jumlah langkah bagi pengguna tanpa modul apa pun (semua langkahnya tanpa `izin`).
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/guide`. Harapan: GAGAL (+ tes katalog Task 5 menuntut `data-tour` yang belum ada).
- [ ] **Step 3: Implementasi** entri dan atribut `data-tour`. Teks langkah (draf, boleh diubah pemilik produk), santai dan singkat: sidebar = "Menu di sini mengikuti akses kamu."; lokasi = "Pilih lokasi aktif: daftar di halaman ikut berubah."; lonceng = "Kabar terbaru (komentar, centang) muncul di sini."; tema = "Terang, gelap, atau ikut sistem."; profil = "Pasang aplikasi, atur notifikasi push, dan buka Panduan lagi dari sini."
- [ ] **Step 4: Jalankan** tes Step 2 dan `bun run check`; harapan hijau.
- [ ] **Step 5: Commit** `feat(panduan): panduan layout dasar, pasang PWA, dan push`.

---

### Task 11: Konten panduan Serah Terima dan tooltip Tempel dari WhatsApp

**Files:**
- Create: `web/src/modules/guide/catalog/handover.ts`, `web/src/modules/handover/guide/whatsapp-demo.tsx`
- Modify: `catalog/index.ts`; `data-tour` pada `handover-board-page.tsx` (`handover-board`), tombol Tambah di halaman daftar (`handover-new`), `handover-batch-form.tsx` (`handover-batch-form`), `whatsapp-paste-panel.tsx` (`handover-paste-panel` dan penempatan `TipButton` di samping judul "Tempel dari WhatsApp"), kartu/centang di `handover-detail-view.tsx` (`handover-checklist`), `comment-composer.tsx` (`handover-comment`)
- Test: `web/src/modules/handover/guide/whatsapp-demo.test.tsx`, `catalog/handover.test.ts`, `whatsapp-paste-panel.test.tsx` (tambahan)

**Interfaces:**
- Consumes: `TipButton`/`DemoPlayer` (Task 7), `splitWhatsappBatch` (`shared/handover-paste.ts`), katalog (Task 5).
- Produces: entri `handover-dasar` (`halaman: '/handover'`, `izin`: daftar `[handover view, qc edit]` keduanya `scope: 'location'` agar sama dengan item sidebar Serah Terima; langkah sisi QC punya `izin: { module: 'qc', level: 'edit', scope: 'location' }`), `tip-handover-tempel-wa` (kind `tip`); `WhatsappDemoScenes: readonly DemoScene[]` (empat adegan: gelembung chat generik terpilih → kotak tempel terisi teks contoh → tombol Pecah → kartu hasil dari `splitWhatsappBatch(SAMPLE_TEXT)`), dan satu adegan `klip` untuk "cara memilih banyak pesan di WhatsApp" tanpa `berkas` (menunggu rekaman pemilik).

- [ ] **Step 1: Tulis tes yang gagal.** `whatsapp-demo.test.tsx`: jumlah kartu adegan hasil sama dengan `splitWhatsappBatch(SAMPLE_TEXT).length` (bukan angka tulis tangan) dan nama customer usulan sama dengan `customerSuggestion` fungsi itu; adegan memakai token tema (tanpa warna hex tetap). `handover.test.ts`: pengguna `handover: view` saja tidak menerima langkah sisi QC (`stepCount` lebih kecil dari pengguna `qc: edit`); `tip-handover-tempel-wa` ada di `GUIDE_IDS`. `whatsapp-paste-panel.test.tsx`: ikon info berlabel "Cara tempel banyak pesan sekaligus" ada di samping judul panel dan membuka demo.
- [ ] **Step 2: Jalankan** `bun run --cwd web test src/modules/handover src/modules/guide`. Harapan: GAGAL.
- [ ] **Step 3: Implementasi**: entri katalog; `whatsapp-demo.tsx` (teks contoh dua-tiga pesan yang valid untuk `splitWhatsappBatch`; keterangan santai, mis. "Salin semua pesan sekaligus, tempel sekali saja"); penempatan `TipButton` dan atribut `data-tour`. Langkah tur menyematkan demo lewat `tip: 'tip-handover-tempel-wa'` pada langkah panel tempel (tur TIDAK mengisi kotak tempel).
- [ ] **Step 4: Jalankan** tes Step 2 dan `bun run check`; harapan hijau.
- [ ] **Step 5: Commit** `feat(panduan): panduan Serah Terima dan demo Tempel dari WhatsApp`.

---

### Task 12: Dokumentasi, checklist rilis, dan verifikasi akhir

**Files:**
- Modify: `CLAUDE.md` (bagian Struktur: modul `web/src/modules/guide/` dan `server/src/modules/guide/`; Aturan: tabel keputusan perubahan spek 4.7 sebagai checklist rilis; langkah rilis "tandai akun bersama di Pengaturan Akses"), `docs/ci-cd.md` (catatan migrasi 0015 expand-only dan pengecualian rollback: image sebelum 0015 mengabaikan kolom/tabel baru), `docs/e2e-checklist.md` (butir uji manual panduan), `docs/superpowers/specs/2026-11-13-panduan-interaktif-design.md` (status "diimplementasikan" bila semua task selesai)

- [ ] **Step 1: Tulis dokumentasi** sesuai daftar di atas, ringkas (tabel 4.7 disalin; langkah rilis: tandai akun bersama segera setelah rilis).
- [ ] **Step 2: Jalankan** `bun run check` dan `bun run build`; harapan hijau dan `verify-dist` lolos.
- [ ] **Step 3: Uji manual di server dev** (`bun run dev` + tunnel; JANGAN menghentikan server yang sedang berjalan milik pengguna): akun individu menyelesaikan panduan lalu login dari peramban lain tidak ditawari lagi; akun bertanda bersama ditawari lagi di peramban lain; tur Serah Terima berjalan tanpa mengubah data; ikon info Tempel dari WhatsApp tetap ada setelah tur selesai. Catat hasil di komentar PR.
- [ ] **Step 4: Commit** `docs(panduan): checklist rilis dan catatan migrasi 0015`.
