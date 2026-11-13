# PWA Fase 3, Tahap A: Penanda Status dan Penghitung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengguna selalu tahu mana centang yang "Belum terkirim", mana yang "Mengirim…", berapa totalnya (chip di header), dan diperingatkan sebelum keluar bila masih ada yang belum terkirim.

**Architecture:** Satu penyimpan kecil dalam memori (`outbox-status.ts`) mencatat butir (task+indeks) yang permintaannya sedang berjalan, diisi oleh penguras antrean DAN oleh centang langsung di `useCheckQueue`. `useOutboxOverlay` menggabungkannya dengan antrean `localStorage` Fase 2 menjadi peta status per butir untuk `NoteView`; chip header membaca antrean yang sama. Antrean masih `localStorage` (pindah ke IndexedDB di Tahap C); tidak ada perubahan server.

**Tech Stack:** React 19, TanStack Query/Router, Vitest + Testing Library, lucide-react, shadcn `popover`/`alert-dialog`, Biome.

**Spec:** `docs/superpowers/specs/2026-11-13-pwa-offline-serah-terima-design.md` §5 (Tahap A). Rencana Fase 2 yang menjadi dasar: `docs/superpowers/plans/2026-11-13-pwa-fase-2.md`.

## Global Constraints

- Teks UI bahasa Indonesia santai. Teks penanda persis: `Belum terkirim`, `Mengirim…` (satu karakter elipsis `…`).
- Penanda `sending` hanya dalam memori per tab, tidak disimpan (spek §5: tahap A, "diterima untuk tahap ini").
- Peringatan keluar: judul `Keluar sekarang?`, tombol `Batal` dan `Tetap keluar` (pemilik produk menyetujui peringatan ini 2026-11-13).
- Layar "Tidak ada koneksi": tambahan hanya hitungan antrean, tanpa isi dan tanpa sesi.
- Antrean masih `localStorage` `qc.outbox:<email>`; jangan mengubah bentuk `OutboxEntry`, batas 200 entri, kedaluwarsa 24 jam, atau penahanan penulisan saat keluar.
- Jangan memakai `<select>` bawaan. Dialog memakai komponen `ui/alert-dialog` apa adanya (header/footer sudah menempel; jangan menambah `max-h`/`overflow` sendiri).
- `bun run lint` (Biome) dan `bun run --cwd web typecheck` hijau pada akhir tiap task.

## Review Focus

Input atau kondisi yang tidak tersentuh tes tugas biasa, tetapi paling mungkin merugikan pengguna (tiap butir punya tesnya di task pemiliknya):
1. **Penanda "Mengirim…" macet** bila pengiriman gagal, kena batas waktu (abort), atau ditolak server: status harus dibersihkan di semua jalur (Task 1).
2. **Dua klik beruntun pada butir yang sama** (dua tanda bertumpuk): butir tetap "Mengirim…" sampai KEDUANYA selesai, tidak turun-naik (Task 1).
3. **Entri antrean untuk task yang tidak ada di cache**: popover chip memakai "Task lain" dan tidak crash (Task 3).
4. **Header ponsel sempit**: chip hanya ikon + angka (teks panjang mulai lebar `sm`), label aksesibel lengkap, header tidak meluap (Task 3).
5. **Keluar saat ada entri milik pemilik lain atau berbeda**: dialog menghitung SEMUA entri yang akan dibuang; "Batal" tidak membuang apa pun; tanpa entri keluar langsung tanpa dialog (Task 4).

---

### Task 1: Penyimpan status "mengirim" dan pemasangannya di dua pengirim

**Files:**
- Create: `web/src/modules/handover/lib/outbox-status.ts`
- Create: `web/src/modules/handover/lib/outbox-status.test.ts`
- Modify: `web/src/modules/handover/lib/check-outbox-flush.ts` (fungsi `run`)
- Modify: `web/src/modules/handover/lib/use-check-queue.ts` (blok kirim langsung `handovers.setCheck`)
- Test: `web/src/modules/handover/lib/check-outbox-flush.test.ts`, `web/src/modules/handover/lib/use-check-queue.test.tsx` (tambahkan kasus; ikuti pola pengaturan yang sudah ada di berkas itu)

**Interfaces:**
- Produces (semua di `outbox-status.ts`):
  - `export type ItemSendState = 'waiting' | 'sending'`
  - `export function beginSending(taskId: string, index: number): () => void`: menambah hitungan butir itu dan mengembalikan fungsi akhir yang idempoten (panggilan kedua tidak mengurangi lagi).
  - `export function isItemSending(taskId: string, index: number): boolean`
  - `export function subscribeSending(listener: () => void): () => void`
  - `export function sendingVersion(): number` (naik tiap perubahan; untuk `useSyncExternalStore`)
  - `export function resetSendingForTests(): void`
- Consumes: tidak ada.

- [ ] **Step 1: Tulis tes `outbox-status.test.ts`.** Nama dan assertion:
  - `beginSending menandai butir dan end() membersihkannya`: `isItemSending('t',0)` false → `const end = beginSending('t',0)` → true → `end()` → false.
  - `dua tanda pada butir yang sama dihitung`: dua `beginSending('t',0)`; setelah `end` pertama masih true; setelah kedua false. Butir `('t',1)` dan task `('u',0)` tetap false sepanjang jalan.
  - `end() dipanggil dua kali hanya mengurangi satu`: dua tanda, `end1()` dua kali → masih true; `end2()` → false.
  - `subscribeSending dipanggil saat tanda berubah dan sendingVersion naik`: listener terpanggil pada `beginSending` dan pada `end()`; `sendingVersion()` bertambah; setelah unsubscribe listener tidak terpanggil.
- [ ] **Step 2: Jalankan tes, pastikan gagal.** `bun run --cwd web test src/modules/handover/lib/outbox-status.test.ts` → FAIL (modul belum ada).
- [ ] **Step 3: Implementasikan `outbox-status.ts`.** Peta `Map<string, number>` berkunci `` `${taskId}#${index}` ``; setiap perubahan menaikkan `version` dan memanggil pendengar (salinan himpunan, seperti pola `check-outbox.ts`).
- [ ] **Step 4: Jalankan tes, pastikan lulus.** Perintah sama → PASS.
- [ ] **Step 5: Tulis tes pemasangan di penguras.** Di `check-outbox-flush.test.ts`, kasus baru (pakai `send` palsu berupa promise yang dikendalikan tes):
  - `butir ditandai mengirim selama send berjalan dan dibersihkan sesudah entri terhapus`: selama `send` tertunda `isItemSending(taskId,index)` true; setelah promise sukses dan `flushOutbox` selesai false dan antrean kosong.
  - `status dibersihkan pada penolakan, UNAVAILABLE, dan galat tak dikenal`: tiga `send` yang menolak dengan `ApiError('CONFLICT',…)`, `ApiError('UNAVAILABLE',…)`, dan `new Error('x')`; setelah masing-masing `flushOutbox` selesai `isItemSending` false (Review Focus 1).
  - `pemilik berganti di tengah kirim tetap membersihkan status`: `isOwnerActive` mengembalikan false setelah `send` selesai; `isItemSending` false.
- [ ] **Step 6: Tulis tes pemasangan di `useCheckQueue`.** Di `use-check-queue.test.tsx`:
  - `klik online: butir mengirim selama api berjalan lalu bersih`: `api` ditunda; setelah `toggle(...)` dipanggil, `isItemSending(task.id, item.index)` true; setelah `api` selesai false.
  - `UNAVAILABLE: butir masuk antrean dan tidak lagi mengirim`: `api` menolak `UNAVAILABLE`; sesudahnya `readOutbox(by)` berisi satu entri dan `isItemSending` false.
  - `dua klik beruntun pada butir yang sama: tetap mengirim sampai keduanya selesai`: dua `toggle` untuk butir sama dengan `api` tertunda terkendali; setelah permintaan pertama selesai `isItemSending` masih true; setelah kedua false (Review Focus 2).
- [ ] **Step 7: Jalankan tes baru, pastikan gagal.** `bun run --cwd web test src/modules/handover/lib/check-outbox-flush.test.ts src/modules/handover/lib/use-check-queue.test.tsx` → kasus baru FAIL.
- [ ] **Step 8: Pasang di `check-outbox-flush.ts` dan `use-check-queue.ts`.**
  - Penguras: di `run`, tepat setelah `tried.add(next.id)` panggil `const end = beginSending(next.taskId, next.index)` dan bungkus SELURUH badan `try { … } catch { … }` per entri dengan `try { … } finally { end(); }` supaya `end()` terjadi SESUDAH `removeEntries` pada semua jalur (tanpa kedipan "Belum terkirim" di antara).
  - `use-check-queue.ts`: bungkus HANYA `await api('handovers.setCheck', …)` dalam `const end = beginSending(task.id, item.index); try { … } finally { end(); }` sehingga pada jalur `UNAVAILABLE` entri sudah ditulis `queueIt()` (di `catch` bagian dalam) sebelum `end()` berjalan. Cabang "task masih punya entri antrean" TIDAK menandai mengirim (hanya mengantre).
- [ ] **Step 9: Jalankan seluruh tes dua berkas itu, lalu typecheck.** `bun run --cwd web test src/modules/handover/lib` → PASS; `bun run --cwd web typecheck` → bersih.
- [ ] **Step 10: Commit.** `git add web/src/modules/handover/lib && git commit -m "feat(pwa): status mengirim per butir untuk penguras antrean dan centang langsung"`

---

### Task 2: Peta status per butir di overlay, `NoteView`, kartu, dan detail

**Files:**
- Modify: `web/src/modules/handover/lib/use-pending-checks.ts`, `web/src/modules/handover/components/note-view.tsx`, `web/src/modules/handover/components/handover-card.tsx`, `web/src/modules/handover/components/handover-detail-view.tsx`
- Test: `web/src/modules/handover/lib/use-pending-checks.test.tsx`, `web/src/modules/handover/components/note-view.test.tsx`, `web/src/modules/handover/components/handover-card.test.tsx`, `web/src/modules/handover/components/handover-detail-view.test.tsx`

**Interfaces:**
- Consumes: `ItemSendState`, `isItemSending`, `subscribeSending`, `sendingVersion`, `beginSending` dari Task 1; `readOutbox`, `overlayPendingChecks`, `subscribeOutbox`, `outboxVersion` dari `check-outbox.ts` (sudah ada).
- Produces:
  - `useOutboxOverlay(dto: HandoverDto, owner: string): { dto: HandoverDto; itemStates: ReadonlyMap<number, ItemSendState> }` (menggantikan `pendingIndexes`). Aturan: butir yang punya entri antrean (teks cocok) = `waiting`, atau `sending` bila `isItemSending`; butir tanpa entri tetapi `isItemSending` = `sending`. Tanpa apa pun: `dto` dikembalikan apa adanya dan peta kosong yang IDENTIK antar render (konstanta modul).
  - Prop `NoteView`: `itemStates?: ReadonlyMap<number, ItemSendState>` (menggantikan `pendingIndexes`).

- [ ] **Step 1: Perbarui dan tambah tes.**
  - `use-pending-checks.test.tsx`: ganti `pendingIndexes` dengan `itemStates` pada tes yang ada (`.size` 0; `new Map([[0,'waiting']])` via `[...itemStates]`); tambah `butir tanpa entri tetapi sedang dikirim langsung berstatus sending` (`beginSending(dto.id, 0)` dalam `act`) dan `entri antrean yang sedang dikirim berstatus sending lalu waiting` setelah `end()`.
  - `note-view.test.tsx`: ganti dua tes `pendingIndexes` dengan: `"Belum terkirim" hanya untuk butir berstatus waiting` (`itemStates: new Map([[1,'waiting']])`: satu teks `Belum terkirim`, ada di butir indeks 1 saja), `"Mengirim…" untuk butir berstatus sending`, dan `tanpa itemStates tidak ada penanda` (tidak ada `Belum terkirim` maupun `Mengirim…`).
  - `handover-card.test.tsx` dan `handover-detail-view.test.tsx`: ubah teks yang dicari dari `Menunggu terkirim` menjadi `Belum terkirim`.
- [ ] **Step 2: Jalankan tes, pastikan gagal.** `bun run --cwd web test src/modules/handover` → kasus yang diubah FAIL.
- [ ] **Step 3: Implementasikan.**
  - `use-pending-checks.ts`: dua `useSyncExternalStore` (antrean dan `sendingVersion`), keduanya menjadi dependensi `useMemo`.
  - `note-view.tsx`: ganti prop, dan penanda per butir (tetap `data-note-meta=""` dan kelas `ml-6 block text-xs italic text-muted-foreground`): `waiting` → ikon `Clock` (aria-hidden) + `Belum terkirim`; `sending` → ikon `Loader2` berputar (`animate-spin`, aria-hidden) + `Mengirim…`. Tanpa status: perilaku lama (nama + waktu bila tercentang).
  - `handover-card.tsx` dan `handover-detail-view.tsx`: teruskan `itemStates` ke `NoteView`.
- [ ] **Step 4: Jalankan tes modul handover, typecheck, lint.** `bun run --cwd web test src/modules/handover` → PASS; `bun run --cwd web typecheck`; `bun run lint` → bersih.
- [ ] **Step 5: Commit.** `git add web/src/modules/handover && git commit -m "feat(pwa): penanda Belum terkirim dan Mengirim per butir (kartu dan detail)"`

---

### Task 3: Chip penghitung di header dengan daftar singkat

**Files:**
- Create: `web/src/modules/handover/lib/use-outbox-summary.ts` (+ `use-outbox-summary.test.tsx`)
- Create: `web/src/app/shell/outbox-chip.tsx` (+ `outbox-chip.test.tsx`)
- Modify: `web/src/modules/handover/lib/board-cache.ts` (tambah `findCachedHandover`), `web/src/modules/handover/lib/use-check-queue.ts` (pakai `findCachedHandover`, hapus fungsi lokal `cachedHandover`), `web/src/app/shell/app-shell.tsx` (pasang `<OutboxChip />` sebelum `<NotificationBell />`)

**Interfaces:**
- Consumes: `readOutbox`, `subscribeOutbox`, `outboxVersion`, `OutboxEntry` (check-outbox.ts); `isItemSending`, `subscribeSending`, `sendingVersion` (Task 1); `formatClock(ms: number): string` dari `@/app/server-status`; `handoverKeys.one(id, locationIds)` dari `modules/handover/queries`; `useMe().email` dari `@/modules/auth/use-me`.
- Produces:
  - `findCachedHandover(queryClient: QueryClient, id: string): HandoverDto | undefined`: papan lebih dulu (`findHandoverInBoards`), lalu cache detail `['handovers','one',id]`; persis perilaku `cachedHandover` lama di `use-check-queue.ts`.
  - `useOutboxSummary(owner: string): { entries: readonly OutboxEntry[]; sending: number }`: `entries` = `readOutbox(owner)` (kosong bila `owner === ''`), `sending` = jumlah entri yang `isItemSending(entry.taskId, entry.index)`.
  - `OutboxChip(): JSX.Element | null` tanpa prop; pemilik dari `useMe().email`.

- [ ] **Step 1: Tulis tes.**
  - `use-outbox-summary.test.tsx`: `tanpa entri: entries kosong dan sending 0`; `dengan dua entri dan satu sedang dikirim: sending 1`; `owner kosong: entries kosong`; `berubah saat antrean berubah` (pola `act` seperti `use-pending-checks.test.tsx`).
  - `outbox-chip.test.tsx` (render dengan `QueryClientProvider`; mock `useMe` seperti tes komponen lain): `tidak tampil tanpa entri`; `dua entri: teks "2 belum terkirim" dalam elemen role=status`; `satu dari dua sedang dikirim: "Mengirim 1 dari 2…"`; `membuka popover menampilkan nomor task dari cache` (seed `queryClient.setQueryData(handoverKeys.one('h1',['loc-a']), makeHandover({ id: 'h1', number: 'ST-20261113-001' }))`, lalu klik chip: teks `ST-20261113-001` dan `Centang`); `entri untuk task yang tidak ada di cache memakai "Task lain" tanpa galat` (Review Focus 3); `label aksesibel lengkap`: tombol punya `aria-label` berisi teks penuh walau teks visual disembunyikan di layar sempit (Review Focus 4: elemen teks panjang berkelas `hidden sm:inline`).
- [ ] **Step 2: Jalankan tes, pastikan gagal.** `bun run --cwd web test src/modules/handover/lib/use-outbox-summary.test.tsx src/app/shell/outbox-chip.test.tsx` → FAIL.
- [ ] **Step 3: Implementasikan hook dan `findCachedHandover`** (pindahkan isi `cachedHandover` dari `use-check-queue.ts`; perbarui pemakainya di berkas itu).
- [ ] **Step 4: Implementasikan `OutboxChip`.** `<div role="status" aria-live="polite">` membungkus tombol `Popover` (komponen `ui/popover`); isi tombol: ikon (`Clock` bila tidak mengirim, `Loader2 animate-spin` bila mengirim) + angka total + teks panjang `hidden sm:inline`; label: `sending > 0` → `Mengirim ${sending} dari ${total}…`, selain itu `${total} belum terkirim`. Isi popover: daftar entri; tiap baris `Centang · {nomor atau 'Task lain'} · {formatClock(at)}` dan di bawahnya teks butir satu baris terpotong (`line-clamp-1`). Pasang di `app-shell.tsx`.
- [ ] **Step 5: Jalankan tes, typecheck, lint.** Perintah Step 2 → PASS; `bun run --cwd web test src/modules/handover/lib/use-check-queue.test.tsx` → tetap PASS (refaktor `findCachedHandover`); `bun run --cwd web typecheck`; `bun run lint`.
- [ ] **Step 6: Commit.** `git add web/src && git commit -m "feat(pwa): chip penghitung perubahan belum terkirim di header"`

**Revisi pasca-review:** hitungan chip di header memakai `useAllOutboxCount` (semua pemilik, tanpa prop `count`) dan melewatkan entri kedaluwarsa lewat `isExpiredEntry`, sejalan dengan spek §5.

---

### Task 4: Peringatan saat keluar bila masih ada yang belum terkirim

**Files:**
- Modify: `web/src/modules/handover/lib/check-outbox.ts` (tambah `countAllOutboxEntries`; ekstrak pembacaan satu kunci agar `readOutbox` dan fungsi baru memakai validasi `isEntry` yang sama)
- Test: `web/src/modules/handover/lib/check-outbox.test.ts` (tambahkan kasus)
- Create: `web/src/modules/auth/logout-confirm-dialog.tsx` (+ `logout-confirm-dialog.test.tsx`)
- Modify: `web/src/app/shell/user-menu.tsx`
- Test: `web/src/app/shell/user-menu-logout.test.tsx` (berkas baru)

**Interfaces:**
- Produces:
  - `countAllOutboxEntries(): number` (di `check-outbox.ts`): jumlah entri VALID dari SEMUA kunci `qc.outbox:*` (semua pemilik); 0 bila penyimpanan tak tersedia atau amplop rusak. Dipakai juga oleh Task 5.
  - `LogoutConfirmDialog({ count, onConfirm, onCancel }: { count: number; onConfirm: () => void; onCancel: () => void }): JSX.Element` (selalu terbuka bila dirender; induk menentukan kapan dirender).

- [ ] **Step 1: Tulis tes.**
  - `check-outbox.test.ts`: `countAllOutboxEntries menjumlah entri semua pemilik` (dua pemilik, 2 + 1 = 3); `mengabaikan entri tak valid dan amplop rusak`; `nol tanpa kunci apa pun`.
  - `logout-confirm-dialog.test.tsx`: judul `Keluar sekarang?`; deskripsi memuat `3 perubahan belum terkirim` untuk `count=3`; tombol `Batal` memanggil `onCancel`, `Tetap keluar` memanggil `onConfirm` tepat sekali.
  - `user-menu-logout.test.tsx` (mock `@/modules/auth/use-logout` mengembalikan spy `logout`; seed antrean lewat `enqueueCheck`): `tanpa entri: klik Keluar langsung memanggil logout tanpa dialog`; `dengan entri: klik Keluar menampilkan dialog dan belum memanggil logout`; `Batal menutup dialog, logout tidak dipanggil, antrean utuh` (`readOutbox` tidak berubah); `Tetap keluar memanggil logout satu kali`; `entri milik pemilik lain ikut terhitung` (seed dua pemilik; deskripsi menyebut jumlah total, Review Focus 5).
- [ ] **Step 2: Jalankan tes, pastikan gagal.** `bun run --cwd web test src/modules/handover/lib/check-outbox.test.ts src/modules/auth/logout-confirm-dialog.test.tsx src/app/shell/user-menu-logout.test.tsx` → FAIL.
- [ ] **Step 3: Implementasikan `countAllOutboxEntries` dan `LogoutConfirmDialog`.** Dialog memakai `AlertDialog` + `AlertDialogContent/Header/Title/Description/Footer/Cancel/Action`; deskripsi: `{count} perubahan belum terkirim akan hilang kalau Anda keluar. Tunggu sampai terkirim dulu, atau tetap keluar.`
- [ ] **Step 4: Sambungkan di `user-menu.tsx`.** Item `Keluar` menjadi `onSelect={() => { const count = countAllOutboxEntries(); if (count > 0) setLogoutCount(count); else logout(); }}`; render `LogoutConfirmDialog` bila `logoutCount !== null`, DI LUAR `DropdownMenu` (di samping dialog iOS/push yang sudah ada); `onConfirm` menutup dialog lalu memanggil `logout()`; `onCancel` menutupnya.
- [ ] **Step 5: Jalankan tes, typecheck, lint.** Perintah Step 2 → PASS; `bun run --cwd web typecheck`; `bun run lint`.
- [ ] **Step 6: Commit.** `git add web/src && git commit -m "feat(pwa): peringatan sebelum keluar bila masih ada perubahan belum terkirim"`

**Revisi pasca-review:** dialog keluar memakai `useAllOutboxCount` (tanpa prop `count`), sehingga angkanya dibaca langsung dari antrean selama dialog terbuka; hitungan mengabaikan entri kedaluwarsa lewat `isExpiredEntry`; bila nol, teks dialog berubah menjadi "Semua perubahan sudah terkirim. Aman untuk keluar." Prop `count` di atas tidak dipakai lagi.

---

### Task 5: Jumlah antrean di layar "Tidak ada koneksi"

**Files:**
- Modify: `web/src/app/shell/offline-screen.tsx`
- Test: `web/src/app/shell/offline-screen.test.tsx` (tambahkan kasus)

**Interfaces:**
- Consumes: `countAllOutboxEntries()` dari Task 4.
- Produces: `OfflineScreen({ onRetry })` tidak berubah tanda tangannya; menghitung sendiri saat dirender.

- [ ] **Step 1: Tulis tes.** `tanpa antrean: tidak ada teks perubahan menunggu`; `dengan dua entri: menampilkan "2 perubahan menunggu dikirim. Hubungkan ke jaringan, lalu coba lagi agar terkirim."` (seed lewat `enqueueCheck`; tanpa sesi/me).
- [ ] **Step 2: Jalankan tes, pastikan gagal.** `bun run --cwd web test src/app/shell/offline-screen.test.tsx` → kasus baru FAIL.
- [ ] **Step 3: Implementasikan.** Paragraf kedua `text-sm text-muted-foreground` hanya bila hitungan > 0; kalimat persis seperti di Step 1 dengan angka sebenarnya. Hanya hitungan, tanpa isi.
- [ ] **Step 4: Jalankan tes, typecheck, lint.** PASS dan bersih.
- [ ] **Step 5: Commit.** `git add web/src/app/shell && git commit -m "feat(pwa): jumlah perubahan belum terkirim di layar Tidak ada koneksi"`

**Revisi pasca-review:** hitungan layar "Tidak ada koneksi" mengabaikan entri kedaluwarsa (`isExpiredEntry`), sejalan dengan spek §5 (entri lewat 24 jam tidak dihitung).

---

### Task 6: Dokumen dan verifikasi akhir

**Files:**
- Modify: `docs/prd/2026-10-26-qc-pwa.md` (FR-P17: teks penanda; tambah catatan Fase 3 Tahap A), `docs/e2e-checklist.md` (butir #186 dan bagian baru), `CLAUDE.md` (bullet PWA)

- [ ] **Step 1: PRD.** Di FR-P17 ganti `ditandai "Menunggu terkirim"` dengan `ditandai "Belum terkirim" (dan "Mengirim…" selama permintaannya berjalan)`; di §4.4 tambahkan baris `FR-P20` "Penanda status, chip penghitung di header, dan peringatan sebelum keluar (Fase 3 Tahap A; spek `docs/superpowers/specs/2026-11-13-pwa-offline-serah-terima-design.md` §5)". Berkas berakhir baris CRLF: edit lewat skrip yang menjaga CRLF (pola `docs_fase2.py` di sesi ini) atau `Edit` per baris lalu pastikan `git diff` tidak menunjukkan perubahan akhir baris massal.
- [ ] **Step 2: E2E.** Ubah #186 ("Menunggu terkirim" → "Belum terkirim"); tambah bagian "PWA Fase 3, Tahap A" (nomor lanjut dari yang terakhir, #193 dst., ditandai BELUM TERUJI): chip "N belum terkirim" lalu "Mengirim X dari N…" saat sinyal kembali dan hilang setelah semua terkirim; penanda "Mengirim…" pada centang online dengan jaringan lambat; dialog "Keluar sekarang?" saat ada antrean (Batal tidak membuang, Tetap keluar membuang); layar "Tidak ada koneksi" memuat jumlah antrean; chip tidak meluapkan header di ponsel sempit.
- [ ] **Step 3: CLAUDE.md.** Pada bullet PWA tambahkan satu kalimat: penanda status (`modules/handover/lib/outbox-status.ts`, per tab, tidak disimpan), `useOutboxOverlay` mengembalikan `itemStates`, chip header (`app/shell/outbox-chip.tsx`), dan peringatan keluar (`countAllOutboxEntries`, `modules/auth/logout-confirm-dialog.tsx`).
- [ ] **Step 4: Verifikasi penuh (di mesin yang tidak sibuk).** `bun run typecheck`; `bun run lint`; `bun run --cwd web test` (semua berkas lulus, exit 0); `bun run build` (`verify-dist OK`). Suite server tidak dijalankan (tak ada perubahan di `server/`); sebutkan itu di badan PR.
- [ ] **Step 5: Commit.** `git add docs CLAUDE.md && git commit -m "docs(pwa): Fase 3 Tahap A di PRD, E2E, dan CLAUDE.md"`
