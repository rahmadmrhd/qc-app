# Push Notifikasi Sisi Klien Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat push Serah Terima sampai ke perangkat: handler push di service worker, permintaan izin sekali setelah login pertama di PWA terpasang, banner pengingat bila izin ditolak, saklar push pengguna, dan halaman status push untuk admin.

**Architecture:** Backend push sudah ada (PR #59). Skrip service worker tambahan `web/public/push-sw.js` diimpor Workbox lewat `workbox.importScripts` (titik perluasan yang dicatat di `pwa-config.ts`), bukan `injectManifest`. Logika klien ada di modul baru `web/src/modules/push/` (lib murni + queries + komponen); satu komponen `PushOnboarding` di `AppShell` mengurus dialog pra-izin, sinkron izin, dan banner. Satu perubahan backend kecil: `push.config` membawa `userEnabled` agar klien dapat menampilkan saklar tanpa rute baru.

**Tech Stack:** React 19, TanStack Query/Router, vitest + Testing Library, Workbox `generateSW` (vite-plugin-pwa), Push API/Notification API, Bun + Hono + MariaDB.

**Spec:** `docs/superpowers/specs/2026-11-12-notifikasi-serah-terima-design.md` (§5.2, §9, §10); PRD PWA `docs/prd/2026-10-26-qc-pwa.md`.

## Global Constraints

- Izin peramban diminta **satu kali**, tepat setelah login pertama di PWA terpasang (`isStandalone`), atas gestur pengguna (klik tombol di dialog pra-izin); tidak pernah diminta ulang bila `Notification.permission === 'denied'` (spek §5.2).
- Logout TIDAK berhenti berlangganan dan tidak menyentuh langganan; satu langganan boleh dipakai beberapa akun di perangkat yang sama (spek §5.2). `use-logout.ts` tidak diubah.
- Lonceng tak dapat dimatikan; hanya push (`push.setPreference`) (spek §5.1).
- Halaman status admin: izin `access: view`, hanya status per pengguna (`aktif | tidak ada langganan | izin ditolak | pengiriman gagal | dimatikan`), tanpa pengenal perangkat atau rincian galat (spek §10).
- iOS: push hanya untuk PWA terpasang di layar utama; di Safari biasa UI menjelaskan, tidak meminta izin.
- Service worker tidak boleh men-cache `/api`, `/auth`, `/sync` (aturan PWA); `push-sw.js` tidak dipra-cache (`globIgnores`) dan dilayani `no-cache` oleh server statis (sudah berlaku untuk berkas di luar `/assets/`).
- Aturan frontend `CLAUDE.md`: tanpa `<select>` bawaan; dialog memakai `ui/dialog` (header/footer tetap); tanpa library state global; teks UI bahasa Indonesia santai (memori `feedback-bahasa-ui-santai`).
- Berkas storage (`localStorage`/`sessionStorage`) dibungkus try/catch dan halaman harus tetap bekerja tanpanya.
- Keputusan di luar spek = pilihan perancang: ditandai di spek dan `CLAUDE.md`; tidak ada yang menunggu pemilik (lihat "Keputusan perancang" di akhir).

## Review Focus

1. Push tanpa data atau JSON rusak: SW tetap menampilkan notifikasi generik (Chrome mewajibkan notifikasi tampil bagi `userVisibleOnly`); tidak melempar.
2. `url` di payload berbahaya (`//evil.test`, `https://evil.test`, `javascript:alert(1)`, tanpa awalan `/`): klik jatuh ke `/`, tidak pernah membuka origin lain.
3. Izin `denied`: tidak ada panggilan `requestPermission`/`subscribe`; banner paling sering sekali per 7 hari per pengguna; `granted` atau server `enabled=false` tidak memunculkan banner.
4. Peramban tanpa SW/PushManager (dev, Safari iOS non-standalone): tidak ada galat; UI menjelaskan kenapa tidak tersedia.
5. Dua akun di satu perangkat: penanda "sudah ditanya" per email; akun kedua dengan izin `granted` berlangganan diam-diam (langganan yang sama ditautkan ke akun itu) tanpa dialog.
6. Kunci VAPID server berubah: langganan peramban lama ditolak/diganti, bukan dipakai terus.
7. Preferensi dimatikan pengguna: tidak ada dialog izin baru dan tidak ada subscribe diam-diam.

---

## File Structure

- Modify `shared/contract.ts` (`PushConfigDto.userEnabled`), `server/src/modules/notification/push-service.ts` + `push-routes.ts` (`pushConfig(env, user)`), `push-rest.test.ts`.
- Create `web/public/push-sw.js`; modify `web/src/app/pwa/pwa-config.ts` + `pwa-config.test.ts`; create `web/src/modules/push/push-sw.test.ts` (sandbox).
- Create `web/src/modules/push/lib/{support,storage,subscribe}.ts` + tes; `web/src/modules/push/queries.ts`.
- Create `web/src/modules/push/components/{push-onboarding,denied-banner,push-settings-dialog,push-status-page}.tsx` + tes; modify `web/src/app/shell/{app-shell,user-menu}.tsx`.
- Create `web/src/routes/_app/access/push.tsx` (+ `routeTree.gen.ts` dibangkitkan), modify `web/src/app/navigation.ts` + `navigation.test.ts`.
- Docs: spek, `CLAUDE.md`, `docs/e2e-checklist.md` (N18), PRD PWA bila memuat "push di luar cakupan".

---

### Task 1: `push.config` membawa preferensi pengguna

**Files:** Modify `shared/contract.ts`, `server/src/modules/notification/push-service.ts`, `push-routes.ts`; Test `server/src/modules/notification/push-rest.test.ts`.

**Interfaces:**
- Produces: `PushConfigDto = { enabled: boolean; publicKey: string; userEnabled: boolean }`; `pushConfig(env: Env, user: Pick<UserContext,'email'>): Promise<PushConfigDto>`. `userEnabled` = nilai `notification_prefs.push_enabled` pengguna (email ternormalisasi); tanpa baris = `true` (aktif bawaan, spek §5.2).

- [ ] **Step 1:** Tes REST di `push-rest.test.ts`: (a) pengguna baru → `push.config` memberi `userEnabled: true`; (b) setelah `push.setPreference {enabled:false}` → `userEnabled: false`; (c) VAPID kosong → `enabled: false`, `publicKey: ''`, `userEnabled` tetap mengikuti preferensi; (d) pengguna lain tak terpengaruh.
- [ ] **Step 2:** Jalankan `bun run --cwd server test src/modules/notification/push-rest.test.ts` → gagal (properti belum ada).
- [ ] **Step 3:** Tambah field di `PushConfigDto`; ubah `pushConfig` menjadi async dan membaca `push_enabled` (satu `SELECT`, `Number()`/boolean-kan); handler rute `(_input, ctx) => pushConfig(ctx.env, ctx.user)`. Cari semua pemakai `pushConfig`/`PushConfigDto` (`rg`) dan perbaiki.
- [ ] **Step 4:** Tes hijau; `bun run typecheck`.
- [ ] **Step 5:** Commit `feat(notifikasi): push.config membawa preferensi push pengguna`.

### Task 2: Handler push di service worker

**Files:** Create `web/public/push-sw.js`, `web/src/modules/push/push-sw.test.ts`; Modify `web/src/app/pwa/pwa-config.ts`, `pwa-config.test.ts`.

**Interfaces:**
- Produces: payload yang dibaca SW = JSON `{ title: string; body: string; url: string; tag?: string }` (sama dengan `pushPayloadOf` di `server/src/modules/notification/push.ts`; baca berkasnya untuk bentuk persisnya).
- Produces: `pwaOptions.workbox.importScripts = ['push-sw.js']`, `globIgnores = ['push-sw.js']`.

- [ ] **Step 1:** Tes `push-sw.test.ts`: muat isi `web/public/push-sw.js` ke sandbox `new Function('self', code)` dengan `self` palsu yang merekam `addEventListener`, `registration.showNotification`, `clients.matchAll/openWindow`, `location.origin`. Kasus: (a) payload valid → `showNotification(title, {body, tag, icon:'/icons/icon-192.png', data:{url}})`; (b) tanpa data / JSON rusak / `title` bukan string → notifikasi generik `QC App` / `Ada pembaruan di QC App`; (c) `event.waitUntil` dipanggil dengan promise (notifikasi pasti tampil); (d) klik: `notification.close()`; ada window same-origin → `focus()` lalu `navigate(url)` bila tersedia; tak ada window → `openWindow(url)`; (e) `url` `//evil.test/x`, `https://evil.test`, `javascript:alert(1)`, `''`, bukan string → dinormalkan ke `/`; `/handover/abc?loc=l1` lolos apa adanya.
- [ ] **Step 2:** Jalankan `bun run --cwd web test src/modules/push/push-sw.test.ts` → gagal (berkas belum ada).
- [ ] **Step 3:** Tulis `push-sw.js` (skrip klasik, tanpa modul/impor): `safeUrl(value): string` (harus string, diawali `/`, bukan `//`, bukan mengandung `\\`; selain itu `/`), `parsePayload(event)` dengan try/catch, handler `push` dan `notificationclick` seperti dites. Tag bawaan dari server dipakai agar notifikasi sejenis menggantikan.
- [ ] **Step 4:** `pwa-config.ts`: tambah `importScripts: ['push-sw.js']` dan `globIgnores: ['push-sw.js']`, perbarui komentar titik perluasan; `pwa-config.test.ts`: tegaskan keduanya dan bahwa `push-sw.js` ada di `web/public`.
- [ ] **Step 5:** Tes hijau; `bun run build` lalu cek `server/dist/push-sw.js` ada, `server/dist/sw.js` memuat `importScripts("push-sw.js")`, dan `verify-dist` OK.
- [ ] **Step 6:** Commit `feat(push): handler push dan klik notifikasi di service worker`.

### Task 3: Inti klien push (dukungan, penyimpanan, langganan, queries)

**Files:** Create `web/src/modules/push/lib/{support,storage,subscribe}.ts` + `*.test.ts`, `web/src/modules/push/queries.ts`.

**Interfaces:**
- `support.ts`: `pushSupported(win?: Window): boolean` (butuh `serviceWorker` di `navigator`, `PushManager`, `Notification`); `devicePermission(win?): 'granted'|'denied'|'default'|'unsupported'`; `platformOf(nav?): 'ios'|'android'|'desktop'`.
- `storage.ts` (kunci per email ternormalisasi lowercase; semua try/catch): `wasAsked(email): boolean`, `markAsked(email): void`, `BANNER_INTERVAL_MS = 7 * 24 * 3600 * 1000`, `bannerDue(email, now: number): boolean`, `markBannerShown(email, now): void`, `wasSynced(email): boolean`/`markSynced(email)` (sessionStorage; sekali per sesi tab).
- `subscribe.ts`: `urlBase64ToBytes(key: string): Uint8Array<ArrayBuffer>`; `subscribeThisDevice(deps): Promise<'subscribed'|'unavailable'>` dengan `deps = { registration, config: PushConfigDto, send: (sub: PushSubscribeInput) => Promise<unknown>, unsubscribeServer: (endpoint) => Promise<unknown> }`: bila ada langganan lama dengan `applicationServerKey` ≠ `config.publicKey` → `unsubscribe()` lokal + `push.unsubscribe`, lalu `subscribe({userVisibleOnly:true, applicationServerKey})`; kirim `endpoint`, `keys.p256dh`, `keys.auth` dari `toJSON()`.
- `queries.ts`: `pushConfigQueryOptions()` (`['push','config']`), `pushStatusQueryOptions()` (`['push','status']`), `usePushPreference()` mutation (`push.setPreference`, memasang hasil ke cache `push.config`), `reportPermission(state)`.

- [ ] **Step 1:** Tes: `pushSupported` true/false per kombinasi; `platformOf` untuk UA iPhone/Android/Windows; `bannerDue` (belum pernah → true, 6 hari → false, 7 hari → true), `markAsked` per email terpisah, storage melempar (stub `localStorage` yang melempar) → `wasAsked` false, tidak melempar; `urlBase64ToBytes` (kunci uji 65 byte, `-`/`_`, tanpa padding); `subscribeThisDevice`: langganan baru dikirim dengan kunci benar, langganan lama kunci sama dipakai ulang (tetap dikirim, idempoten), kunci beda → unsubscribe lalu subscribe ulang, `config.enabled=false` → `'unavailable'` tanpa subscribe.
- [ ] **Step 2:** Jalankan tesnya → gagal.
- [ ] **Step 3:** Implementasi sesuai antarmuka; `urlBase64ToBytes` memakai `atob` (kode web, bukan `shared/server`).
- [ ] **Step 4:** Tes hijau.
- [ ] **Step 5:** Commit `feat(push): inti klien push (dukungan, penyimpanan, langganan, queries)`.

### Task 4: Dialog pra-izin, sinkron izin, banner izin ditolak

**Files:** Create `web/src/modules/push/components/{push-onboarding,denied-banner}.tsx` + tes; Modify `web/src/app/shell/app-shell.tsx`.

**Interfaces:**
- Consumes: Task 3 (`pushSupported`, `devicePermission`, `wasAsked`/`markAsked`, `bannerDue`/`markBannerShown`, `subscribeThisDevice`, `pushConfigQueryOptions`), `isStandalone`, `useMe`.
- Produces: `<PushOnboarding />` (tanpa prop; dirender di `AppShell` di luar `<main>`), memutuskan:
  1. `config.enabled` salah atau `!pushSupported()` → tidak merender apa pun.
  2. `permission === 'granted'` dan `config.userEnabled`: `subscribeThisDevice` diam-diam sekali per sesi (`wasSynced`); lalu `push.reportPermission('granted')`.
  3. `permission === 'default'` dan `isStandalone(window)` dan `config.userEnabled` dan `!wasAsked(email)` → dialog pra-izin "Aktifkan notifikasi" dengan tombol **Aktifkan** (klik → `Notification.requestPermission()`; `granted` → subscribe + report; `denied` → report `denied`) dan **Nanti** (→ `markAsked`; tak ditanya lagi di perangkat ini; tetap bisa dari menu pengguna). Selesai apa pun hasilnya = `markAsked`.
  4. `permission === 'denied'` → `reportPermission('denied')` (sekali per perubahan) dan `<DeniedBanner />` bila `bannerDue`: spanduk (`role="status"`) dengan langkah menurut `platformOf` (ikon gembok → Notifikasi → Izinkan; iOS: Pengaturan → Notifikasi → QC App), tombol **Tutup** (`markBannerShown`); tampil paling sering sekali per 7 hari.
  - Cek ulang izin saat jendela fokus (pengguna dapat mengubah di pengaturan peramban) dan laporkan perubahan.

- [ ] **Step 1:** Tes komponen (mock `api`, `Notification`, `navigator.serviceWorker`, `matchMedia` untuk standalone): (a) standalone + default + belum ditanya → dialog tampil, klik Aktifkan → `requestPermission` dipanggil sekali, `granted` → `push.subscribe` dan `push.reportPermission('granted')`; (b) klik Nanti → `markAsked`, tidak ada `requestPermission`; render ulang → tak ada dialog; (c) bukan standalone → tak ada dialog dan tak ada `requestPermission`; (d) `denied` → banner tampil, `requestPermission` TIDAK pernah dipanggil, `reportPermission('denied')`; Tutup → tak tampil lagi pada render berikut dalam 7 hari; (e) `granted` + akun lain di perangkat sama (email berbeda) → subscribe diam-diam tanpa dialog; (f) `userEnabled:false` → tidak ada dialog, tidak ada subscribe; (g) `config.enabled:false` → tidak ada apa-apa.
- [ ] **Step 2:** Jalankan → gagal.
- [ ] **Step 3:** Implementasi; mount `<PushOnboarding />` di `app-shell.tsx`. Dialog memakai `ui/dialog` (tanpa gaya `max-h` sendiri); banner mengikuti pola `update-banner.tsx`. Teks Indonesia santai.
- [ ] **Step 4:** Tes hijau; tes AppShell yang ada tetap hijau.
- [ ] **Step 5:** Commit `feat(push): dialog izin sekali, sinkron izin, dan banner izin ditolak`.

### Task 5: Pengaturan push pengguna

**Files:** Create `web/src/modules/push/components/push-settings-dialog.tsx` + tes; Modify `web/src/app/shell/user-menu.tsx` (+ tesnya bila ada).

**Interfaces:**
- Consumes: `pushConfigQueryOptions`, `usePushPreference`, `subscribeThisDevice`, `devicePermission`, `platformOf`, `isStandalone`, `isIosBrowser`.
- Produces: `<PushSettingsDialog open onOpenChange />`: kotak centang "Terima notifikasi push" (`push.setPreference`, optimistik lewat cache `push.config`), baris status perangkat (`Aktif di perangkat ini` | `Izin ditolak: <langkah per platform>` | `Belum diaktifkan` + tombol **Aktifkan di perangkat ini** (gestur → `requestPermission` → subscribe → report) | `Tidak didukung` / iOS non-standalone: "Pasang aplikasi ke layar utama dulu" | `Push belum dikonfigurasi server`), dan catatan bahwa lonceng tetap menerima semuanya. Item menu "Notifikasi push" (ikon `BellRing`) membuka dialog; dialog dirender di luar `DropdownMenu` (pola "Pasang aplikasi").

- [ ] **Step 1:** Tes: saklar mengikuti `userEnabled`; klik memanggil `push.setPreference {enabled:false}` dan cache ter-update; status `denied` menampilkan langkah platform dan TIDAK menampilkan tombol aktifkan; `default` + standalone → tombol aktifkan memanggil `requestPermission` lalu subscribe; iOS non-standalone → pesan pasang aplikasi; `enabled:false` server → pesan belum dikonfigurasi dan saklar nonaktif.
- [ ] **Step 2:** Jalankan → gagal.
- [ ] **Step 3:** Implementasi dan item menu.
- [ ] **Step 4:** Tes hijau.
- [ ] **Step 5:** Commit `feat(push): pengaturan notifikasi push di menu pengguna`.

### Task 6: Halaman status push admin

**Files:** Create `web/src/modules/push/components/push-status-page.tsx` + tes, `web/src/routes/_app/access/push.tsx`; Modify `web/src/app/navigation.ts`, `navigation.test.ts`; `routeTree.gen.ts` dibangkitkan plugin router.

**Interfaces:**
- Consumes: `pushStatusQueryOptions` (`PushUserStatusDto { email; name; state }`, `PushUserState = 'active'|'none'|'failing'|'disabled'|'denied'`).
- Produces: rute `/access/push` (`beforeLoad: requirePermission(context.queryClient, 'access', 'view')`, meniru `access/audit.tsx`), item sidebar "Status Push" (ikon `BellRing`, izin `access: view`, di grup "Pengaturan Akses" setelah "Log Audit"). Tabel: Nama, Email, Status (badge berlabel Indonesia: Aktif, Belum berlangganan, Pengiriman gagal, Dimatikan pengguna, Izin ditolak); pencarian nama/email di klien; urut masalah dulu (`denied`, `failing`, `none`, `disabled`, `active`) lalu nama; ringkasan jumlah per status. Tanpa pengenal perangkat.

- [ ] **Step 1:** Tes halaman: urutan masalah-dulu, pencarian, label status, keadaan kosong, tidak ada teks endpoint/perangkat; tes navigasi: item "Status Push" ada untuk pengguna dengan `access: view` dan tidak untuk `none`.
- [ ] **Step 2:** Jalankan → gagal.
- [ ] **Step 3:** Implementasi halaman, rute, dan item navigasi; jalankan `bun run build` (atau generator rute) agar `routeTree.gen.ts` terbarui dan ter-commit.
- [ ] **Step 4:** Tes hijau; `bun run typecheck`.
- [ ] **Step 5:** Commit `feat(push): halaman Status Push untuk admin`.

### Task 7: Dokumen, verifikasi penuh, review

**Files:** Modify spek, `CLAUDE.md`, `docs/e2e-checklist.md`, PRD PWA bila perlu.

- [ ] **Step 1:** Spek §5.2/§9: catat "Keputusan klien" (pilihan perancang: dialog pra-izin dengan tombol Nanti; banner 7 hari; `userEnabled` di `push.config`; status admin lima keadaan; `push-sw.js` via `importScripts`); perbarui §9 (tahap klien sudah dikerjakan). `CLAUDE.md`: tambah `web/src/modules/push/` dan `web/public/push-sw.js` pada bullet Notifikasi dan hapus "Belum ada: handler push ... halaman status admin". `docs/e2e-checklist.md`: pecah N18 menjadi langkah uji perangkat (Android Chrome terpasang, desktop Chrome/Firefox, iOS 16.4+ PWA terpasang; izin sekali, tolak → banner, nyalakan lagi, matikan saklar, admin melihat status, klik notifikasi membuka task dengan `?loc=`), status "belum teruji di perangkat nyata; butuh VAPID terisi di staging".
- [ ] **Step 2:** `bun run check` penuh (`QC_TEST_SHARDS=2`, tunnel hidup) dan `bun run build` (`verify-dist` OK). Kegagalan dipisah per pola; 3 tes `jobs.test.ts` dan galat koneksi tunnel diketahui, bukan regresi.
- [ ] **Step 3:** Review independen (agent baru, tanpa kesimpulan implementer) atas diff + security-audit terfokus: validasi `url` di SW, penanda izin per email, endpoint tak bocor di halaman admin. Kerjakan temuan sesuai spek.
- [ ] **Step 4:** Commit `docs(push): catat keputusan klien push dan perbarui panduan uji N18`.

---

## Keputusan perancang (ditandai di spek)

Dialog pra-izin sebelum dialog bawaan peramban (agar gestur pengguna ada dan penolakan tidak "membakar" izin); tombol "Nanti" hanya menunda ke menu pengguna; frekuensi banner 7 hari; saklar push dibaca dari `push.config.userEnabled`; `Notification.permission` dilaporkan ke server tiap berubah; bahasa teks Indonesia santai.
