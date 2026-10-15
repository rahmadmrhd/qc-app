# Fase B2 — Sinkronisasi QC Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** QC Desktop dapat menarik dan mendorong **merk** dan **item** (dua arah) lewat endpoint `doPost` bertoken, termasuk gambar (`sync.file.get`) dan Markdown `detail`, dengan kerangka yang bisa menampung sumber daya stok nanti; `setup` tidak lagi menimpa `DRIVE_FOLDER_ID` yang tak terakses.

**Architecture:** Jalur sinkron **terpisah** dari RPC sesi: `doPost` → `handleSync_` (token bersama + pembatas percobaan salah, tabel rute sinkron sendiri, handler tanpa `UserContext`, pelaku `sync:desktop`). Kursor tarik memakai `sync_rev` per baris dari penghitung per sumber daya (`sync_state`) yang dinaikkan di dalam lock setiap kali field sinkron berubah (termasuk dari form web dan dari ganti nama merk). Push berjalan per entri (satu lock per entri) sehingga satu kegagalan tidak membatalkan yang lain; penulisan item memakai fungsi yang sama dengan form web (`writeItem_`) agar keunikan, penautan berkas, dan audit identik.

**Tech Stack:** Bun 1.4 (workspaces `shared`, `gas`, `web`), TypeScript strict, GAS V8 (transpile per file), `bun:test`, Biome. Tidak ada perubahan UI selain label audit.

**Spec:** `docs/prd/2026-10-09-qc-item-serah-terima.md` bagian 4.8 (FS1–FS13), 6.2; kontrak `docs/api/desktop-sync.md` (bagian 1–3b, 5). Dibangun di atas Fase B (PR `rahmadmrhd/qc-gas#11`: sheet `items`/`brands`, kolom `external_id` dan `sync_rev`, `attachFiles_`, `resolveBrandByName_`).

## Global Constraints

- Semua balasan, pesan galat, dan komentar berbahasa Indonesia; identifier tetap Inggris/aslinya.
- Aturan GAS (`CLAUDE.md`, ditegakkan `scripts/build-gas.ts`): fungsi top-level di `gas/src` WAJIB berakhiran `_` kecuali `doGet`, `api`, `setup` — **dan `doPost` yang ditambahkan Task 4**; nama top-level unik di seluruh `gas/src` + `shared/`; dilarang `export default`, re-export, import alias/namespace/dynamic, `class`, `enum`; tanpa `Object.hasOwn`; API GAS hanya lewat `platform_()`; tulis sheet di dalam `platform_().withLock(...)`; **tanpa `withLock` bersarang** (fungsi yang dipanggil di dalam lock tidak boleh mengunci); I/O Drive di luar lock; backslash "termakan" alat penyunting → pakai pemindaian string atau `String.fromCharCode`, hindari regex berbackslash.
- Fungsi murni di `shared/` boleh tanpa akhiran `_`.
- Kontrak kabel (`docs/api/desktop-sync.md`) mengikat: nama field (`merk`, `tipe`, `isCountryLock`, `images`, `detail`, `stickers[].image`, `accessories`, `active`, `rev`, `uid`, `id`), status hasil (`created`, `updated`, `unchanged`, `conflict`, `invalid`), batas (push ≤ 200 entri, ≤ 100 bila memuat `detail`; pull `limit` 1–500, ≤ 200 bila `include` memuat `detail`; body ≤ 5 MB; `sync.file.get` ≤ 8 MB).
- Token: Script Property `SYNC_API_TOKEN` ≥ 32 karakter, dibandingkan waktu-konstan; 10 kegagalan dalam 10 menit → semua permintaan ditolak 10 menit. **Semua kegagalan sebelum autentikasi lolos (JSON rusak, body terlalu besar, token salah/hilang/dibatasi, token belum dikonfigurasi) menghasilkan galat yang sama: `UNAUTHENTICATED` "Token tidak valid".** Galat `VALIDATION`/`NOT_FOUND` baru muncul setelah autentikasi.
- Pelaku audit sinkron: `sync:desktop`. Aksi audit baru: `item.sync.conflict`, `brand.sync.conflict` (item/brand yang dibuat/diubah memakai aksi yang sudah ada).
- Semua id Drive pada kabel harus berada di folder aplikasi (`DRIVE_FOLDER_ID`); gambar Markdown pada push hanya `![alt](drive:<id>)`.
- `bun run check` hijau sebelum push. Format tanpa lint: `bunx biome check --write --linter-enabled=false <path>`.
- Commit diakhiri `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Jangan mengedit `gas/dist/` manual.
- Bun: `export PATH="$PATH:$HOME/.bun/bin"` di Git Bash. Pada tes bun, `beforeEach(() => { ... })` berkurung kurawal.
- Tes yang membaca hasil JSON dengan tipe longgar boleh memakai `// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes` bila Biome mengeluh; jangan melonggarkan kode produksi.
- Pada saat dokumen ini ditulis memory platform **tidak** mengedarkan TTL cache (nilai cache tak pernah kedaluwarsa); tes pembatas tidak menguji kedaluwarsa (diverifikasi manual di E2E).

## Review Focus

1. **Token dan pembatas:** token benar tetap ditolak saat diblokir; galat sebelum autentikasi tidak membedakan alasan (tidak membocorkan apakah metode ada, apakah token terkonfigurasi, apakah JSON sah); token sinkron tidak dapat memanggil `api`, token sesi tidak dapat memanggil `doPost`. → Task 4.
2. **Pull tepat sekali:** menarik dari `sinceRev: 0` sampai `hasMore: false` mengembalikan setiap item satu kali, urut naik, kursor = `rev` terakhir halaman; item hasil perubahan alias tidak muncul; item/brand lama (`sync_rev = 0`) dapat ditarik setelah `setup`. → Task 3, 6, 7.
3. **Idempoten dan konflik:** push yang sama dua kali → `unchanged`; `baseRev` basi + nilai berbeda → `conflict` tanpa perubahan; tanpa `baseRev` + nilai berbeda → `conflict`; `overwrite: true` menimpa; nilai sama + `baseRev` basi → `unchanged`. → Task 6, 8.
4. **Isolasi per entri:** entri tidak sah/konflik/galat tak terduga tidak membatalkan entri lain; urutan hasil = urutan permintaan; entri yang membuat nama bentrok → `invalid` dengan pesan per field. → Task 6, 8.
5. **Gambar:** id Drive di luar folder → `invalid` (tidak ada item dibuat/diubah); berkas Drive di folder yang belum tercatat didaftarkan otomatis; menghapus id dari `images` tidak menyentuh Drive; Markdown pada push menolak `https:`, `data:`, `qcfile:`; pada pull `qcfile:<id>` diterjemahkan ke `drive:<driveId>`. → Task 5, 8.
6. **Semantik field:** field tidak dikirim = tidak diubah; `[]`/`""` menggantikan; `merk`/`tipe`/`isCountryLock` wajib pada item baru; `"true"`/`"false"` diterima untuk `isCountryLock`; id MySQL angka diterima sebagai teks; alias tidak pernah berubah oleh push. → Task 8.
7. **`setup` aman:** `DRIVE_FOLDER_ID` terisi tetapi folder tak terakses → properti tidak diubah, tidak ada folder baru, laporan menyebut penyebab; `SYNC_API_TOKEN` pendek/kosong dilaporkan. → Task 2.
8. **Kenaikan revisi:** ubah detail/gambar/stiker/kelengkapan/country lock/status/merk/tipe dari web menaikkan `sync_rev` item; ubah alias tidak; ganti nama merk menaikkan `sync_rev` merk dan semua item merk itu. → Task 3.

---

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `shared/items.ts` | + `extractRefs`, `mapMarkdownRefs`, `extractImageTargets`, `isRefIdChar` (murni) |
| `shared/sync.ts` (baru) | Konstanta, tipe kabel (`SyncWireItem`, `SyncWireBrand`, hasil per entri), `constantTimeEqual` |
| `gas/src/core/platform.ts`, `gas-platform.ts`, `test-support/memory-platform.ts` | + `driveFileInfo`; `renderJsonOutput_` |
| `gas/src/core/config.ts`, `setup.ts`, `modules/files/service.ts` | `SYNC_API_TOKEN`, FS13, laporan, `assignInitialRevs_` |
| `gas/src/core/actor.ts` (baru) | `ActorRef` — pelaku apa pun yang punya `email` (user web atau `sync:desktop`) |
| `gas/src/modules/sync/state.ts` (baru) | Sheet `sync_state`, `nextRev_`, `assignInitialRevs_` |
| `gas/src/modules/sync/{auth,handler,routes,files,pull,conflict}.ts` (baru) | Kerangka dan metode umum |
| `gas/src/modules/sync/{brands,items}.ts` (baru) | Sumber daya `brands` dan `items` (validasi kabel, pull, push) |
| `gas/src/modules/item/service.ts`, `brand/service.ts` | `writeItem_`, `applyBrandSave_`, kenaikan `sync_rev`, tipe pelaku |
| `gas/src/main.ts`, `scripts/build-gas-lib.ts` | `doPost` publik |
| `docs/api/desktop-sync.md`, `docs/e2e-checklist.md`, `docs/setup-google.md`, `CLAUDE.md`, PRD | Dokumentasi |

---

### Task 1: Fungsi Markdown murni dan konstanta/tipe kabel (`shared/`)

**Files:**
- Modify: `shared/items.ts`, `shared/items.test.ts`
- Create: `shared/sync.ts`, `shared/sync.test.ts`

**Interfaces:**
- Consumes: `FILE_SCHEME` dari `./files`.
- Produces:
  - `shared/items.ts`: `isRefIdChar(ch): boolean`, `extractRefs(markdown, scheme): string[]` (`extractFileRefs` menjadi `extractRefs(markdown, FILE_SCHEME)`), `mapMarkdownRefs(markdown, fromScheme, toScheme, lookup: (id: string) => string | null): string`, `extractImageTargets(markdown): string[]`, `DRIVE_REF_SCHEME = 'drive:'`.
  - `shared/sync.ts`: `SYNC_API_VERSION`, `SYNC_ACTOR`, `SYNC_TOKEN_MIN_LENGTH`, `SYNC_RESOURCES`, `SYNC_LIMITS`, `constantTimeEqual(a, b)`, tipe `SyncResultStatus`, `SyncWireItem`, `SyncWireSticker`, `SyncWireBrand`, `SyncEntryResult<T>`, `SyncPullPage<T>`.

- [ ] **Step 1: Tulis tes yang gagal** — tambahkan ke `shared/items.test.ts` (dan tambahkan `extractRefs, extractImageTargets, mapMarkdownRefs` ke impor dari `./items`):

```ts
describe('extractRefs', () => {
  test('skema bebas; sama dengan extractFileRefs untuk qcfile', () => {
    const md = '![a](drive:AAA_1) dan [b](drive:BBB-2) ![c](qcfile:zzz)';
    expect(extractRefs(md, 'drive:')).toEqual(['AAA_1', 'BBB-2']);
    expect(extractRefs(md, 'qcfile:')).toEqual(['zzz']);
    expect(extractFileRefs(md)).toEqual(['zzz']);
  });
});

describe('mapMarkdownRefs', () => {
  test('mengganti skema dan id yang dikenal; id tak dikenal dan kemunculan di tengah kata dibiarkan', () => {
    const lookup = (id: string) => (id === 'f1' ? 'DRV1' : null);
    expect(mapMarkdownRefs('![x](qcfile:f1) ![y](qcfile:f2) xqcfile:f1', 'qcfile:', 'drive:', lookup)).toBe(
      '![x](drive:DRV1) ![y](qcfile:f2) xqcfile:f1',
    );
  });

  test('id kosong dan teks tanpa rujukan tidak berubah; bolak-balik stabil', () => {
    const none = () => null;
    expect(mapMarkdownRefs('![x](qcfile:) teks', 'qcfile:', 'drive:', none)).toBe('![x](qcfile:) teks');
    expect(mapMarkdownRefs('', 'qcfile:', 'drive:', none)).toBe('');
    const there = mapMarkdownRefs('A ![x](qcfile:f1) B', 'qcfile:', 'drive:', () => 'D1');
    expect(mapMarkdownRefs(there, 'drive:', 'qcfile:', () => 'f1')).toBe('A ![x](qcfile:f1) B');
  });
});

describe('extractImageTargets', () => {
  test('mengambil tujuan semua gambar ![..](..), termasuk yang berjudul; tautan biasa diabaikan', () => {
    const md = [
      '![a](drive:AAA)',
      '[tautan](https://x.test)',
      '![b](https://x.test/b.png "judul")',
      '![c](data:image/png;base64,AAAA)',
    ].join(String.fromCharCode(10));
    expect(extractImageTargets(md)).toEqual([
      'drive:AAA',
      'https://x.test/b.png "judul"',
      'data:image/png;base64,AAAA',
    ]);
  });

  test('tanpa gambar atau kurung tak lengkap menghasilkan daftar kosong', () => {
    expect(extractImageTargets('teks biasa')).toEqual([]);
    expect(extractImageTargets('![a] tanpa tujuan')).toEqual([]);
  });
});
```

dan `shared/sync.test.ts`:

```ts
import { expect, test } from 'bun:test';
import { constantTimeEqual, SYNC_ACTOR, SYNC_LIMITS, SYNC_RESOURCES } from './sync';

test('constantTimeEqual: sama, beda satu karakter, beda panjang, kosong', () => {
  expect(constantTimeEqual('abc123', 'abc123')).toBe(true);
  expect(constantTimeEqual('abc123', 'abc124')).toBe(false);
  expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  expect(constantTimeEqual('abcd', 'abc')).toBe(false);
  expect(constantTimeEqual('', '')).toBe(true);
  expect(constantTimeEqual('', 'a')).toBe(false);
});

test('konstanta kontrak', () => {
  expect(SYNC_ACTOR).toBe('sync:desktop');
  expect([...SYNC_RESOURCES]).toEqual(['brands', 'items']);
  expect(SYNC_LIMITS).toMatchObject({
    pullDefault: 100,
    pullMax: 500,
    pullMaxWithDetail: 200,
    pushMax: 200,
    pushMaxWithDetail: 100,
    failedAttempts: 10,
    blockSeconds: 600,
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd shared test items sync`
Expected: FAIL — `extractRefs`, `mapMarkdownRefs`, `extractImageTargets`, `./sync` belum ada.

- [ ] **Step 3: Implementasi** — `shared/items.ts`

Ubah `function isFileIdChar` menjadi `export function isRefIdChar` (ganti semua pemakaian), lalu ganti fungsi `extractFileRefs` dengan:

```ts
export const DRIVE_REF_SCHEME = 'drive:';

/**
 * Id dari setiap kemunculan "<skema><id>" (mis. "qcfile:" atau "drive:") di Markdown: bentuk apa pun yang
 * dirender (judul, kurung sudut, gaya referensi); unik, urutan kemunculan. Sengaja longgar: klaim berlebih
 * berarti simpan ditolak (aman), klaim kurang berarti berkas milik entitas lain bisa lolos.
 */
export function extractRefs(markdown: string, scheme: string): string[] {
  const found: string[] = [];
  let from = 0;
  while (from < markdown.length) {
    const at = markdown.indexOf(scheme, from);
    if (at < 0) break;
    let end = at + scheme.length;
    while (end < markdown.length && isRefIdChar(markdown.charAt(end))) end++;
    const id = markdown.slice(at + scheme.length, end);
    const before = at > 0 ? markdown.charAt(at - 1) : '';
    const boundary = before === '' || !isRefIdChar(before);
    if (boundary && id !== '' && !found.includes(id)) found.push(id);
    from = Math.max(end, at + 1);
  }
  return found;
}

export function extractFileRefs(markdown: string): string[] {
  return extractRefs(markdown, FILE_SCHEME);
}

/**
 * Mengganti "<fromScheme><id>" menjadi "<toScheme><lookup(id)>". Id yang tidak dikenal (lookup `null`),
 * id kosong, dan kemunculan di tengah kata dibiarkan apa adanya.
 */
export function mapMarkdownRefs(
  markdown: string,
  fromScheme: string,
  toScheme: string,
  lookup: (id: string) => string | null,
): string {
  let out = '';
  let from = 0;
  while (from < markdown.length) {
    const at = markdown.indexOf(fromScheme, from);
    if (at < 0) break;
    let end = at + fromScheme.length;
    while (end < markdown.length && isRefIdChar(markdown.charAt(end))) end++;
    const id = markdown.slice(at + fromScheme.length, end);
    const before = at > 0 ? markdown.charAt(at - 1) : '';
    const mapped = (before === '' || !isRefIdChar(before)) && id !== '' ? lookup(id) : null;
    out += markdown.slice(from, at) + (mapped === null ? markdown.slice(at, end) : toScheme + mapped);
    from = end;
  }
  return out + markdown.slice(from);
}

/** Tujuan (URL beserta judul bila ada) semua gambar `![alt](tujuan)`; tautan biasa diabaikan. */
export function extractImageTargets(markdown: string): string[] {
  const found: string[] = [];
  let from = 0;
  while (from < markdown.length) {
    const open = markdown.indexOf('![', from);
    if (open < 0) break;
    const mid = markdown.indexOf('](', open + 2);
    if (mid < 0) break;
    let end = mid + 2;
    while (end < markdown.length && markdown.charAt(end) !== ')' && markdown.charAt(end) !== LF) {
      end++;
    }
    found.push(markdown.slice(mid + 2, end).trim());
    from = end;
  }
  return found;
}
```

`shared/sync.ts`:

```ts
/** Kontrak sinkronisasi QC Desktop (docs/api/desktop-sync.md). Murni: tanpa API GAS/DOM. */
export const SYNC_API_VERSION = 1;
/** Pelaku yang tercatat di audit untuk semua perubahan lewat jalur sinkron. */
export const SYNC_ACTOR = 'sync:desktop';
export const SYNC_TOKEN_MIN_LENGTH = 32;
export const SYNC_RESOURCES = ['brands', 'items'] as const;

export const SYNC_LIMITS = {
  /** Panjang maksimum body permintaan (karakter). */
  bodyChars: 5_000_000,
  pullDefault: 100,
  pullMax: 500,
  pullMaxWithDetail: 200,
  pushMax: 200,
  pushMaxWithDetail: 100,
  /** Ukuran maksimum berkas untuk `sync.file.get` dan pendaftaran otomatis (byte). */
  fileBytes: 8_000_000,
  failedAttempts: 10,
  blockSeconds: 600,
} as const;

/** Perbandingan teks waktu-konstan terhadap isi (panjang berbeda tetap menelusuri panjang maksimum). */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export type SyncResultStatus = 'created' | 'updated' | 'unchanged' | 'conflict' | 'invalid';

export interface SyncWireSticker {
  name: string;
  note: string;
  /** Id berkas Drive, atau `null`. */
  image: string | null;
}

export interface SyncWireItem {
  uid: string;
  /** Id MySQL; `null` bila belum terpetakan. */
  id: string | null;
  merk: string;
  tipe: string;
  isCountryLock: boolean;
  /** Id Drive, urut galeri. */
  images: string[];
  detail?: string;
  stickers?: SyncWireSticker[];
  accessories?: Array<{ name: string; qty: number }>;
  active: boolean;
  rev: number;
}

export interface SyncWireBrand {
  uid: string;
  id: string | null;
  name: string;
  active: boolean;
  rev: number;
}

export interface SyncEntryResult<T> {
  index: number;
  status: SyncResultStatus;
  uid?: string;
  rev?: number;
  /** Hanya pada `conflict`: nilai terkini di QC App. */
  current?: T;
  /** Hanya pada `invalid`: pesan per field. */
  fields?: Record<string, string>;
}

export interface SyncPullPage<T> {
  nextRev: number;
  hasMore: boolean;
  items?: T[];
  brands?: T[];
}
```

Catatan: `extractFileRefs` lama (`shared/items.ts`) dan tes lamanya tetap lulus karena perilakunya identik.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `bun run --cwd shared test`
Expected: semua lulus.

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false shared
git add shared
git commit -m "feat(shared): fungsi rujukan Markdown generik dan kontrak kabel sinkronisasi" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `driveFileInfo`, pengamanan folder (FS13), `SYNC_API_TOKEN`, dan laporan `setup`

**Files:**
- Modify: `gas/src/core/platform.ts`, `gas/src/core/gas-platform.ts`, `gas/test-support/memory-platform.ts`, `gas/src/core/config.ts`, `gas/src/modules/files/service.ts`, `gas/src/modules/files/files.test.ts`, `gas/src/setup.ts`, `gas/src/setup.test.ts`

**Interfaces:**
- Consumes: `platform_()`, `appError_`.
- Produces:
  - `Platform.driveFileInfo(fileId, folderId): { mime: string; size: number } | null` — `null` bila tidak ditemukan, tidak terbaca, di tempat sampah, atau bukan anak `folderId`.
  - `ensureDriveFolder_(): string` — mengembalikan id folder yang ada, atau membuat **hanya bila properti kosong**; bila properti terisi tetapi folder tak terakses → melempar `AppError` `INTERNAL` ber-pesan jelas dan **tidak mengubah properti**.
  - `ConfigKey` + `'SYNC_API_TOKEN'`; `syncToken_(): string` (kosong bila belum diset).

- [ ] **Step 1: Tulis tes yang gagal**

`gas/src/modules/files/files.test.ts` — **ganti** tes `'ensureDriveFolder_ membuat folder baru bila folder lama dihapus atau ada di tempat sampah'` dengan:

```ts
test('ensureDriveFolder_ TIDAK menimpa DRIVE_FOLDER_ID yang tidak dapat diakses (FS13)', () => {
  const first = ensureDriveFolder_();
  platform.trashedFolders.add(first);
  const error = captureAppError(() => ensureDriveFolder_());
  expect(error.code).toBe('INTERNAL');
  expect(error.message).toContain('tidak dapat diakses');
  expect(platform.getProperty('DRIVE_FOLDER_ID')).toBe(first);
  expect(platform.folders.size).toBe(1);
  platform.trashedFolders.delete(first);
  expect(ensureDriveFolder_()).toBe(first);
});

test('driveFileInfo: berkas anak folder terbaca; folder lain, tak ada, dan id sembarang null', () => {
  const folder = ensureDriveFolder_();
  const other = platform.driveCreateFolder('Lain');
  const inside = platform.driveCreateFile(folder, 'a.png', 'image/png', PNG);
  const outside = platform.driveCreateFile(other, 'b.png', 'image/png', PNG);
  expect(platform.driveFileInfo(inside, folder)).toEqual({ mime: 'image/png', size: 16 });
  expect(platform.driveFileInfo(outside, folder)).toBeNull();
  expect(platform.driveFileInfo('tidak-ada', folder)).toBeNull();
});
```

(`PNG` di berkas tes itu adalah `'iVBORw0KGgoAAAANSUhEUg=='` = 16 byte.)

`gas/src/setup.test.ts` — tambahkan:

```ts
const ALL_PROPERTIES = {
  SPREADSHEET_ID: 'x',
  OAUTH_CLIENT_ID: 'a',
  OAUTH_CLIENT_SECRET: 'b',
  OAUTH_REDIRECT_URI: 'c',
  SESSION_SECRET: 'd',
  ADMIN_EMAIL: 'e@gmail.com',
};

test('setup tidak menimpa DRIVE_FOLDER_ID yang tidak dapat diakses dan menyebut penyebabnya (FS13)', () => {
  const platform = createMemoryPlatform({
    properties: { ...ALL_PROPERTIES, DRIVE_FOLDER_ID: 'folder-hilang' },
  });
  setPlatform_(platform);
  const report = runSetup_();
  expect(platform.properties.get('DRIVE_FOLDER_ID')).toBe('folder-hilang');
  expect(platform.folders.size).toBe(0);
  expect(report).toContain('TIDAK dapat diakses');
  expect(report).toContain('folder-hilang');
});

test('setup melaporkan status SYNC_API_TOKEN: kosong, pendek, dan cukup', () => {
  const run = (token?: string) => {
    const platform = createMemoryPlatform({
      properties: token === undefined ? ALL_PROPERTIES : { ...ALL_PROPERTIES, SYNC_API_TOKEN: token },
    });
    setPlatform_(platform);
    return runSetup_();
  };
  expect(run()).toContain('SYNC_API_TOKEN belum diset');
  expect(run('pendek')).toContain('kurang dari 32 karakter');
  const ok = run('x'.repeat(40));
  expect(ok).toContain('SYNC_API_TOKEN terisi');
  expect(ok).not.toContain('x'.repeat(40));
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test files setup`
Expected: FAIL — `driveFileInfo` belum ada; `ensureDriveFolder_` masih membuat folder baru; laporan belum memuat token.

- [ ] **Step 3: Implementasi**

`gas/src/core/platform.ts` — tambahkan ke `interface Platform`, setelah `driveReadFile`:

```ts
  /** Info berkas Drive tanpa membaca isinya; `null` bila tak ada, tak terbaca, di tempat sampah, atau bukan anak `folderId`. */
  driveFileInfo(fileId: string, folderId: string): { mime: string; size: number } | null;
```

`gas/src/core/gas-platform.ts` — setelah `driveReadFile: (...) => {...},` tambahkan:

```ts
    driveFileInfo: (fileId, folderId) => {
      try {
        const file = DriveApp.getFileById(fileId);
        if (file.isTrashed()) return null;
        const parents = file.getParents();
        let inFolder = false;
        while (parents.hasNext()) {
          if (parents.next().getId() === folderId) inFolder = true;
        }
        if (!inFolder) return null;
        return { mime: file.getMimeType(), size: file.getSize() };
      } catch {
        return null;
      }
    },
```

Tambahkan juga di akhir berkas (di samping `renderHtmlPage_`) — dipakai `doPost` di Task 4:

```ts
export function renderJsonOutput_(json: string): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
```

`gas/test-support/memory-platform.ts` — di objek yang dikembalikan `createMemoryPlatform`, setelah `driveReadFile`:

```ts
    driveFileInfo: (fileId, folderId) => {
      const file = drive.get(fileId);
      if (!file || file.folderId !== folderId || trashedFolders.has(file.folderId)) return null;
      return { mime: file.mime, size: base64ByteLength(file.base64) };
    },
```

dan tambahkan impor `import { base64ByteLength } from '@shared/files';` di berkas itu bila belum ada (cek pola impor `@shared/*` yang sudah dipakai berkas itu).

`gas/src/core/config.ts` — tambahkan `| 'SYNC_API_TOKEN'` ke `ConfigKey` (bukan ke `REQUIRED_CONFIG_KEYS`: sinkronisasi opsional) dan di akhir berkas:

```ts
/** Token sinkron QC Desktop; kosong bila belum diset (sinkronisasi nonaktif). */
export function syncToken_(): string {
  return platform_().getProperty('SYNC_API_TOKEN')?.trim() ?? '';
}
```

`gas/src/modules/files/service.ts` — ganti `ensureDriveFolder_`:

```ts
/**
 * Dipakai `setup`; idempoten. Membuat folder **hanya bila `DRIVE_FOLDER_ID` kosong**. Bila terisi tetapi
 * foldernya tak dapat diakses (dihapus, tempat sampah, atau akun pemilik tak punya akses), melempar galat dan
 * TIDAK menimpa properti: menimpa akan memutus semua gambar yang sudah tercatat (FS13).
 */
export function ensureDriveFolder_(): string {
  return platform_().withLock(() => {
    const platform = platform_();
    const existing = platform.getProperty(DRIVE_FOLDER_PROPERTY)?.trim();
    if (existing) {
      if (platform.driveFolderExists(existing)) return existing;
      throw appError_(
        'INTERNAL',
        `Folder Drive ${existing} tidak dapat diakses (dihapus, ada di tempat sampah, atau akun pemilik script belum punya akses Editor).`,
      );
    }
    const id = platform.driveCreateFolder(DRIVE_FOLDER_NAME);
    platform.setProperty(DRIVE_FOLDER_PROPERTY, id);
    return id;
  });
}
```

`gas/src/setup.ts` — tambahkan impor `import { syncToken_ } from '@gas/core/config';` (gabungkan dengan impor `missingConfigKeys_` yang ada: `import { missingConfigKeys_, syncToken_ } from '@gas/core/config';`) dan `import { SYNC_TOKEN_MIN_LENGTH } from '@shared/sync';`, lalu ganti blok folder di akhir `runSetup_`:

```ts
  try {
    const folderId = ensureDriveFolder_();
    lines.push(`Folder Drive "${DRIVE_FOLDER_NAME}" siap (${folderId}).`);
  } catch (error) {
    const property = platform_().getProperty('DRIVE_FOLDER_ID')?.trim() ?? '';
    lines.push(
      `Folder Drive TIDAK dapat diakses (${property}). Properti DRIVE_FOLDER_ID tidak diubah. ` +
        'Periksa: akun pemilik script punya akses Editor ke folder itu dan folder tidak di tempat sampah; ' +
        'atau kosongkan DRIVE_FOLDER_ID agar folder baru dibuat (gambar lama tidak akan tampil).',
    );
    platform_().logError(`setup: ${error instanceof Error ? error.message : String(error)}`);
  }
  const token = syncToken_();
  if (token === '') {
    lines.push('SYNC_API_TOKEN belum diset: sinkronisasi QC Desktop nonaktif.');
  } else if (token.length < SYNC_TOKEN_MIN_LENGTH) {
    lines.push(
      `SYNC_API_TOKEN kurang dari ${SYNC_TOKEN_MIN_LENGTH} karakter: sinkronisasi dinonaktifkan sampai token diperpanjang.`,
    );
  } else {
    lines.push(`SYNC_API_TOKEN terisi (${token.length} karakter).`);
  }
```

(hapus dua baris lama `const folderId = ensureDriveFolder_();` dan `lines.push(...)` setelah migrasi `users`).

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `bun run --cwd gas test files setup && bun run --cwd gas typecheck`
Expected: lulus; typecheck bersih. (Tes lama `'folder Drive dibuat sekali...'` dan `'setup membuat folder Drive sekali...'` tetap lulus: properti kosong → membuat sekali.)

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas shared
git add gas shared
git commit -m "feat(setup): folder Drive tidak lagi ditimpa bila tak terakses (FS13), driveFileInfo, dan laporan SYNC_API_TOKEN" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Penghitung revisi `sync_state`, kenaikan `sync_rev`, dan pelaku generik

**Files:**
- Create: `gas/src/core/actor.ts`, `gas/src/modules/sync/state.ts`, `gas/src/modules/sync/state.test.ts`
- Modify: `shared/sync.ts` (tipe `SyncResource`), `gas/src/modules/item/service.ts`, `gas/src/modules/item/item.test.ts`, `gas/src/modules/brand/service.ts`, `gas/src/modules/brand/brand.test.ts`, `gas/src/setup.ts`, `gas/src/setup.test.ts`

**Interfaces:**
- Consumes: `readTable_`/`insertRow_`/`updateRow_` (`core/db`), `listItems_`/`updateItem_`, `listBrands_`/`updateBrand_`, `SYNC_RESOURCES`.
- Produces:
  - `shared/sync.ts`: `type SyncResource = (typeof SYNC_RESOURCES)[number]`.
  - `core/actor.ts`: `interface ActorRef { email: string }`.
  - `sync/state.ts`: `SYNC_STATE_TABLE`, `nextRev_(resource): number` (**pemanggil memegang lock**), `currentRev_(resource): number`, `assignInitialRevs_(): number` (pemanggil memegang lock; mengembalikan jumlah baris yang diberi revisi).
  - `item/service.ts` dan `brand/service.ts`: perubahan field sinkron menaikkan `syncRev` (FS11); fungsi brand menerima `ActorRef`.

- [ ] **Step 1: Tulis tes yang gagal**

`shared/sync.ts` — tambahkan setelah `SYNC_RESOURCES`: `export type SyncResource = (typeof SYNC_RESOURCES)[number];`

`gas/src/modules/sync/state.test.ts`:

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { insertBrand_, listBrands_ } from '@gas/modules/brand/repo';
import { insertItem_, listItems_ } from '@gas/modules/item/repo';
import { brand, item } from '@gas-test/item-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { assignInitialRevs_, currentRev_, nextRev_ } from './state';

let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({ now: () => Date.parse('2026-10-15T00:00:00.000Z') });
  setPlatform_(platform);
});

test('nextRev_ menaikkan per sumber daya secara terpisah dan tersimpan di sheet sync_state', () => {
  expect(currentRev_('items')).toBe(0);
  expect([nextRev_('items'), nextRev_('items'), nextRev_('brands')]).toEqual([1, 2, 1]);
  expect(currentRev_('items')).toBe(2);
  expect(currentRev_('brands')).toBe(1);
  expect(platform.db.sheet('sync_state').rows).toEqual([
    ['resource', 'seq', 'updated_at'],
    ['items', '2', '2026-10-15T00:00:00.000Z'],
    ['brands', '1', '2026-10-15T00:00:00.000Z'],
  ]);
});

test('assignInitialRevs_ memberi revisi hanya pada baris ber-sync_rev 0, urut createdAt, dan idempoten', () => {
  insertBrand_(brand('B', { createdAt: '2026-01-02T00:00:00.000Z' }));
  insertBrand_(brand('A', { createdAt: '2026-01-01T00:00:00.000Z' }));
  insertBrand_(brand('Sudah', { syncRev: 9 }));
  insertItem_(item({ id: 'i2', brand: 'A', model: 'Y', createdAt: '2026-02-02T00:00:00.000Z' }));
  insertItem_(item({ id: 'i1', brand: 'A', model: 'X', createdAt: '2026-02-01T00:00:00.000Z' }));
  expect(assignInitialRevs_()).toBe(4);
  const brands = listBrands_();
  expect(brands.find((b) => b.name === 'A')?.syncRev).toBe(1);
  expect(brands.find((b) => b.name === 'B')?.syncRev).toBe(2);
  expect(brands.find((b) => b.name === 'Sudah')?.syncRev).toBe(9);
  const items = listItems_();
  expect(items.find((i) => i.id === 'i1')?.syncRev).toBe(1);
  expect(items.find((i) => i.id === 'i2')?.syncRev).toBe(2);
  expect(assignInitialRevs_()).toBe(0);
});
```

`gas/src/modules/item/item.test.ts` — tambahkan (impor `setItemStatus_` sudah ada):

```ts
test('sync_rev: baru dan setiap perubahan field sinkron naik; ubah alias saja tidak (FS11)', () => {
  const created = saveItem_({ ...baseInput }, admin);
  const rev = () => listItems_().find((i) => i.id === created.id)?.syncRev ?? -1;
  expect(rev()).toBe(1);

  saveItem_({ ...baseInput, id: created.id, aliases: ['ES24'] }, admin);
  expect(rev()).toBe(1); // alias tidak disinkronkan

  saveItem_({ ...baseInput, id: created.id, aliases: ['ES24'], detail: 'baru' }, admin);
  expect(rev()).toBe(2);

  saveItem_({ ...baseInput, id: created.id, aliases: ['ES24'], detail: 'baru' }, admin);
  expect(rev()).toBe(2); // tidak ada perubahan

  saveItem_({ ...baseInput, id: created.id, aliases: ['ES24'], detail: 'baru', isCountryLock: true }, admin);
  expect(rev()).toBe(3);

  setItemStatus_({ id: created.id, status: 'inactive' }, admin);
  expect(rev()).toBe(4);
});
```

`gas/src/modules/brand/brand.test.ts` — tambahkan impor `import { nextRev_ } from '@gas/modules/sync/state';` dan:

```ts
test('sync_rev merk: baru, ganti nama, dan status menaikkan; ganti nama juga menaikkan semua item merk itu saja', () => {
  const created = saveBrand_({ name: 'Ubiquity' }, admin);
  const brandRev = () => listBrands_().find((b) => b.id === created.id)?.syncRev ?? -1;
  expect(brandRev()).toBe(1);
  // Fixture memberi syncRev langsung; naikkan penghitung item agar revisi baru pasti lebih besar.
  for (let i = 0; i < 6; i++) nextRev_('items');
  insertItem_(item({ id: 'i1', brand: 'Ubiquity', model: 'X', syncRev: 5, brandId: created.id }));
  insertItem_(item({ id: 'i2', brand: 'Mikrotik', model: 'Y', syncRev: 6 }));
  saveBrand_({ id: created.id, name: 'Ubiquiti' }, admin);
  expect(brandRev()).toBe(2);
  const items = listItems_();
  expect((items.find((i) => i.id === 'i1')?.syncRev ?? 0) > 5).toBe(true);
  expect(items.find((i) => i.id === 'i2')?.syncRev).toBe(6);
  setBrandStatus_({ id: created.id, status: 'inactive' }, admin);
  expect(brandRev()).toBe(3);
});
```

`gas/src/setup.test.ts` — ubah ekspektasi urutan sheet menjadi `['users','roles','audit_log','locations','files','brands','items','sync_state']` dan tambahkan:

```ts
test('setup memberi sync_rev pada item/merk lama dan melaporkannya; diulang tidak melapor lagi', () => {
  const platform = createMemoryPlatform({ properties: ALL_PROPERTIES });
  setPlatform_(platform);
  runSetup_();
  insertBrand_(brand('A'));
  insertItem_(item({ id: 'i1', brand: 'A', model: 'X' }));
  expect(runSetup_()).toContain('2 baris diberi revisi sinkron');
  expect(listItems_()[0]?.syncRev).toBe(1);
  expect(runSetup_()).not.toContain('diberi revisi sinkron');
});
```

(impor di `setup.test.ts`: `insertBrand_` dari `@gas/modules/brand/repo`, `insertItem_`/`listItems_` dari `@gas/modules/item/repo`, `brand`/`item` dari `@gas-test/item-fixtures`.)

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test sync/state item brand setup`
Expected: FAIL — `./state` belum ada; `syncRev` tidak naik.

- [ ] **Step 3: Implementasi**

`gas/src/core/actor.ts`:

```ts
/** Pelaku perubahan data: user web (`UserContext` memenuhinya) atau pelaku sinkron `sync:desktop`. */
export interface ActorRef {
  email: string;
}
```

`gas/src/modules/sync/state.ts`:

```ts
import type { RowData, TableSchema } from '@gas/core/db';
import { insertRow_, readTable_, updateRow_ } from '@gas/core/db';
import { platform_ } from '@gas/core/platform';
import { listBrands_, updateBrand_ } from '@gas/modules/brand/repo';
import { listItems_, updateItem_ } from '@gas/modules/item/repo';
import type { SyncResource } from '@shared/sync';

export const SYNC_STATE_TABLE: TableSchema = {
  sheetName: 'sync_state',
  columns: ['resource', 'seq', 'updated_at'],
};

function readSyncSeq_(resource: SyncResource): { rowNumber: number | null; seq: number } {
  const found = readTable_(SYNC_STATE_TABLE).rows.find(
    (row) => (row.data.resource ?? '').trim() === resource,
  );
  return { rowNumber: found ? found.rowNumber : null, seq: found ? Number(found.data.seq) || 0 : 0 };
}

export function currentRev_(resource: SyncResource): number {
  return readSyncSeq_(resource).seq;
}

/** Revisi berikutnya untuk sumber daya. PEMANGGIL WAJIB memegang lock (tidak mengunci sendiri). */
export function nextRev_(resource: SyncResource): number {
  const { rowNumber, seq } = readSyncSeq_(resource);
  const next = seq + 1;
  const data: RowData = {
    resource,
    seq: String(next),
    updated_at: new Date(platform_().now()).toISOString(),
  };
  if (rowNumber === null) insertRow_(SYNC_STATE_TABLE, data);
  else updateRow_(SYNC_STATE_TABLE, rowNumber, data);
  return next;
}

/**
 * Memberi revisi pada merk dan item yang belum punya (sync_rev 0), urut createdAt, agar dapat ditarik oleh
 * `sync.*.pull`. Idempoten. PEMANGGIL WAJIB memegang lock.
 */
export function assignInitialRevs_(): number {
  let assigned = 0;
  const byCreated = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  for (const brand of listBrands_().filter((row) => row.syncRev === 0).sort(byCreated)) {
    updateBrand_({ ...brand, syncRev: nextRev_('brands') });
    assigned++;
  }
  for (const item of listItems_().filter((row) => row.syncRev === 0).sort(byCreated)) {
    updateItem_({ ...item, syncRev: nextRev_('items') });
    assigned++;
  }
  return assigned;
}
```

`gas/src/setup.ts` — impor `SYNC_STATE_TABLE, assignInitialRevs_` dari `@gas/modules/sync/state`; tambahkan `SYNC_STATE_TABLE` ke daftar tabel (setelah `ITEMS_TABLE`); setelah migrasi `users` dan **sebelum** blok folder:

```ts
  const revisions = platform_().withLock(() => assignInitialRevs_());
  if (revisions > 0) lines.push(`sync: ${revisions} baris diberi revisi sinkron.`);
```

`gas/src/modules/brand/service.ts`:
1. Ganti impor `UserContext` dengan `import type { ActorRef } from '@gas/core/actor';` dan ganti tipe parameter `actor: UserContext` menjadi `actor: ActorRef` pada `newBrandRecord_`, `insertBrandWithAudit_`, `resolveBrandByName_`, `saveBrand_`, `setBrandStatus_`.
2. Tambahkan `import { nextRev_ } from '@gas/modules/sync/state';`.
3. `newBrandRecord_`: ubah `syncRev: 0,` menjadi `syncRev: nextRev_('brands'),`.
4. Pada rename: `const updated: BrandRecord = { ...existing, name: input.name, key, syncRev: nextRev_('brands'), updatedAt: now, updatedBy: actor.email };` dan loop kunci item menjadi:

```ts
    for (const { item, next } of recomputed) {
      // Nama merk ikut tersinkron di setiap item (`merk`), jadi revisi item naik walau kunci sama.
      updateItem_({ ...item, key: next, syncRev: nextRev_('items') });
    }
```

5. `setBrandStatus_`: `const updated: BrandRecord = { ...existing, status: input.status, syncRev: nextRev_('brands'), updatedAt: now, updatedBy: actor.email };`

`gas/src/modules/item/service.ts`:
1. Tambahkan `import { nextRev_ } from '@gas/modules/sync/state';` dan di atas `saveItem_`:

```ts
/** Field yang disinkronkan ke Desktop (FS7). Alias TIDAK termasuk: mengubahnya tidak menaikkan revisi. */
function itemSyncSignature_(item: {
  brandId: string;
  model: string;
  isCountryLock: boolean;
  attachments: readonly string[];
  detail: string;
  stickers: readonly ItemStickerDto[];
  accessories: readonly ItemAccessoryDto[];
  status: ItemStatus;
}): string {
  return JSON.stringify([
    item.brandId,
    item.model,
    item.isCountryLock,
    item.attachments,
    item.detail,
    item.stickers,
    item.accessories,
    item.status,
  ]);
}
```

(tambahkan `ItemAccessoryDto, ItemStatus, ItemStickerDto` ke impor tipe `@shared/rpc`).
2. Pada cabang `existing` di `saveItem_`: ganti `const updated: ItemRecord = { ...existing, ...fields };` dengan

```ts
      const merged: ItemRecord = { ...existing, ...fields };
      const changed = itemSyncSignature_(existing) !== itemSyncSignature_(merged);
      const updated: ItemRecord = {
        ...merged,
        syncRev: changed ? nextRev_('items') : existing.syncRev,
      };
```

3. Pada pembuatan: `syncRev: 0,` → `syncRev: nextRev_('items'),`.
4. Pada `setItemStatus_`: di objek `updated` tambahkan `syncRev: nextRev_('items'),`.

- [ ] **Step 4: Jalankan semua tes gas dan typecheck**

Run: `bun run --cwd shared test && bun run --cwd gas test && bun run --cwd gas typecheck && bun scripts/build-gas.ts`
Expected: lulus. Bila tes lama menegaskan `syncRev: 0` setelah menyimpan lewat `saveItem_` (mis. "mengubah item mempertahankan ... revisi sinkron" memakai `syncRev: 7` dari fixture dan **tidak** mengubah field sinkron), nilainya tetap 7 karena tidak ada perubahan field sinkron; tes "membuat item" yang menegaskan `externalId: ''` tidak terpengaruh. Bila ada asersi yang gagal karena `syncRev` baru = 1, perbarui asersi itu (bukan perilakunya).

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas shared
git add gas shared
git commit -m "feat(sync): penghitung revisi sync_state, kenaikan sync_rev item/merk (FS11), dan backfill di setup" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Kerangka sinkron — `doPost`, token, pembatas, amplop, tabel rute, `sync.ping`

**Files:**
- Create: `gas/src/modules/sync/auth.ts`, `handler.ts`, `routes.ts`, `handler.test.ts`
- Modify: `gas/src/core/router.ts` (ekspor `toErrorBody_`), `gas/src/main.ts`, `scripts/build-gas-lib.ts`, `scripts/build-gas.test.ts`

**Interfaces:**
- Consumes: `syncToken_`, `constantTimeEqual`, `SYNC_*`, `toErrorBody_`, `renderJsonOutput_`.
- Produces:
  - `auth.ts`: `authenticateSync_(token: unknown): boolean`.
  - `handler.ts`: `SyncContext { requestId; actor }`, `SyncRouteDef<I>`, `SyncRouteTable`, `syncRoute_<I>(def)`, `handleSync_(rawBody, routes): RpcResult<unknown>`.
  - `routes.ts`: `getSyncRoutes_(): SyncRouteTable` (sekarang hanya `sync.ping`; Task 5–8 menambah).
  - `main.ts`: `doPost(e)` publik.

- [ ] **Step 1: Tulis tes yang gagal** — `gas/src/modules/sync/handler.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { handleRpc_ } from '@gas/core/router';
import { signSessionToken_ } from '@gas/core/session';
import { getRoutes_ } from '@gas/routes';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { handleSync_, syncRoute_ } from './handler';
import { getSyncRoutes_ } from './routes';

const TOKEN = 't0k3n'.repeat(8);
let platform: MemoryPlatform;

function boot(properties: Record<string, string> = { SYNC_API_TOKEN: TOKEN }) {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's', ...properties },
    now: () => Date.parse('2026-10-15T03:00:00.000Z'),
  });
  setPlatform_(platform);
}

beforeEach(() => {
  boot();
});

const send = (body: unknown) =>
  handleSync_(typeof body === 'string' ? body : JSON.stringify(body), getSyncRoutes_());
const ping = (token: unknown) => send({ v: 1, method: 'sync.ping', token, payload: null });

test('sync.ping dengan token benar mengembalikan versi, waktu server, dan sumber daya', () => {
  expect(ping(TOKEN)).toEqual({
    ok: true,
    data: { apiVersion: 1, serverTime: '2026-10-15T03:00:00.000Z', resources: ['brands', 'items'] },
  });
});

test('semua kegagalan sebelum autentikasi menghasilkan UNAUTHENTICATED yang sama', () => {
  const failures = [
    ping('salah'),
    ping(undefined),
    ping(123),
    send('{bukan json'),
    send(''),
    send('[]'),
    send('null'),
    send({ v: 1, method: 'tidak.ada', token: 'salah', payload: null }),
    send({ v: 99, method: 'sync.ping', token: 'salah' }),
    handleSync_(undefined, getSyncRoutes_()),
    handleSync_('x'.repeat(5_000_001), getSyncRoutes_()),
  ];
  for (const result of failures) {
    expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED', message: 'Token tidak valid' } });
  }
});

test('galat VALIDATION dan NOT_FOUND hanya muncul setelah token benar', () => {
  expect(send({ v: 2, method: 'sync.ping', token: TOKEN })).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION', fields: { v: 'Gunakan v 1' } },
  });
  expect(send({ v: 1, method: 'sync.tidak.ada', token: TOKEN })).toMatchObject({
    ok: false,
    error: { code: 'NOT_FOUND' },
  });
  expect(send({ v: 1, method: 'sync.ping', token: TOKEN, payload: { x: 1 } })).toMatchObject({
    ok: false,
    error: { code: 'VALIDATION' },
  });
});

test('token belum dikonfigurasi atau terlalu pendek: semua permintaan ditolak', () => {
  boot({});
  expect(ping('apa saja')).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  boot({ SYNC_API_TOKEN: 'pendek' });
  expect(ping('pendek')).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
});

test('10 kegagalan memblokir semua permintaan, termasuk yang bertoken benar', () => {
  for (let i = 0; i < 9; i++) ping(`salah-${i}`);
  expect(ping(TOKEN)).toMatchObject({ ok: true });
  ping('salah-9');
  expect(ping(TOKEN)).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  expect(platform.cache.get('sync:blocked')).toBe('1');
});

test('token sinkron tidak berlaku untuk RPC web, dan token sesi tidak berlaku untuk jalur sinkron', () => {
  const rpc = handleRpc_('auth.me', '', TOKEN, getRoutes_());
  expect(rpc).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  expect(ping(signSessionToken_('admin@gmail.com'))).toMatchObject({
    ok: false,
    error: { code: 'UNAUTHENTICATED' },
  });
});

test('galat tak terduga di handler menjadi INTERNAL tanpa membocorkan detail, dan dicatat', () => {
  const routes = {
    'sync.boom': syncRoute_({
      validate: () => null,
      handler: () => {
        throw new Error('rahasia internal');
      },
    }),
  };
  const result = handleSync_(JSON.stringify({ v: 1, method: 'sync.boom', token: TOKEN }), routes);
  expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL', message: 'Terjadi kesalahan pada server' } });
  expect(JSON.stringify(result)).not.toContain('rahasia');
  expect(platform.errors.join('')).toContain('rahasia internal');
});

test('handler menerima konteks dengan pelaku sync:desktop dan tanpa user', () => {
  let seen: unknown;
  const routes = {
    'sync.ctx': syncRoute_({
      validate: () => null,
      handler: (_input, ctx) => {
        seen = ctx;
        return 1;
      },
    }),
  };
  handleSync_(JSON.stringify({ v: 1, method: 'sync.ctx', token: TOKEN }), routes);
  expect(seen).toMatchObject({ actor: 'sync:desktop' });
  expect(Object.keys(seen as object).sort()).toEqual(['actor', 'requestId']);
});

test('nama method bawaan Object (constructor, __proto__) tidak dianggap rute', () => {
  for (const method of ['constructor', '__proto__', 'toString']) {
    expect(send({ v: 1, method, token: TOKEN })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  }
});
```

`scripts/build-gas.test.ts` — ubah tes `'doGet, api, dan setup boleh publik'`: tambahkan `export function doPost() { return 4; }` ke `source` dan `'doPost'` ke daftar `globals` yang diharapkan (urutan mengikuti urutan deklarasi di `source`).

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test sync/handler && bun test scripts/build-gas.test.ts`
Expected: FAIL — `./handler`, `./routes` belum ada; `doPost` belum publik.

- [ ] **Step 3: Implementasi**

`gas/src/core/router.ts` — ubah `function toErrorBody_(` menjadi `export function toErrorBody_(`.

`gas/src/modules/sync/auth.ts`:

```ts
import { syncToken_ } from '@gas/core/config';
import { platform_ } from '@gas/core/platform';
import { constantTimeEqual, SYNC_LIMITS, SYNC_TOKEN_MIN_LENGTH } from '@shared/sync';

const SYNC_BLOCK_KEY = 'sync:blocked';
const SYNC_FAIL_KEY = 'sync:fails';

/**
 * Mencatat satu kegagalan. Pembatas bersifat best-effort (cache GAS bisa dibuang sewaktu-waktu); kegagalan
 * mencatat tidak boleh mengubah balasan agar penyerang tidak mendapat sinyal tambahan.
 */
function recordSyncFailure_(): void {
  const platform = platform_();
  try {
    platform.withLock(() => {
      const count = (Number(platform.cacheGet(SYNC_FAIL_KEY)) || 0) + 1;
      if (count >= SYNC_LIMITS.failedAttempts) {
        platform.cachePut(SYNC_BLOCK_KEY, '1', SYNC_LIMITS.blockSeconds);
        platform.cacheRemove(SYNC_FAIL_KEY);
      } else {
        platform.cachePut(SYNC_FAIL_KEY, String(count), SYNC_LIMITS.blockSeconds);
      }
    });
  } catch {
    // diabaikan: lihat komentar fungsi
  }
}

/** True bila token sah dan tidak sedang diblokir. Setiap kegagalan dihitung (token belum diset ikut dihitung). */
export function authenticateSync_(token: unknown): boolean {
  const platform = platform_();
  if (platform.cacheGet(SYNC_BLOCK_KEY) !== null) return false;
  const expected = syncToken_();
  const valid =
    expected.length >= SYNC_TOKEN_MIN_LENGTH &&
    typeof token === 'string' &&
    constantTimeEqual(token, expected);
  if (valid) return true;
  recordSyncFailure_();
  return false;
}
```

`gas/src/modules/sync/handler.ts`:

```ts
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { toErrorBody_ } from '@gas/core/router';
import type { RpcResult } from '@shared/rpc';
import { SYNC_ACTOR, SYNC_API_VERSION, SYNC_LIMITS } from '@shared/sync';
import { authenticateSync_ } from './auth';

/** Konteks handler sinkron: TIDAK pernah memuat `UserContext` (FS3). */
export interface SyncContext {
  requestId: string;
  actor: typeof SYNC_ACTOR;
}

export interface SyncRouteDef<I = unknown> {
  validate: (raw: unknown) => I;
  handler: (input: I, ctx: SyncContext) => unknown;
}
export type SyncRouteTable = Record<string, SyncRouteDef<unknown>>;

/** Menghapus tipe input agar rute bertipe berbeda dapat berbagi satu tabel. */
export function syncRoute_<I>(def: SyncRouteDef<I>): SyncRouteDef<unknown> {
  return { validate: def.validate, handler: (input, ctx) => def.handler(input as I, ctx) };
}

function parseSyncEnvelope_(rawBody: unknown): Record<string, unknown> | null {
  if (typeof rawBody !== 'string' || rawBody === '' || rawBody.length > SYNC_LIMITS.bodyChars) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(rawBody);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function handleSync_(rawBody: unknown, routes: SyncRouteTable): RpcResult<unknown> {
  const requestId = platform_().uuid().replace(/-/g, '').slice(0, 8);
  try {
    const envelope = parseSyncEnvelope_(rawBody);
    // Autentikasi lebih dulu dan seragam: tidak ada yang terungkap (metode, versi, bentuk JSON) tanpa token sah.
    if (!authenticateSync_(envelope === null ? undefined : envelope.token) || envelope === null) {
      throw appError_('UNAUTHENTICATED', 'Token tidak valid');
    }
    if (envelope.v !== SYNC_API_VERSION) {
      throw appError_('VALIDATION', 'Versi API tidak didukung', { v: `Gunakan v ${SYNC_API_VERSION}` });
    }
    const method = envelope.method;
    if (typeof method !== 'string' || !Object.prototype.hasOwnProperty.call(routes, method)) {
      throw appError_('NOT_FOUND', 'Method tidak dikenal');
    }
    const route = routes[method] as SyncRouteDef<unknown>;
    const input = route.validate(envelope.payload === undefined ? null : envelope.payload);
    return { ok: true, data: route.handler(input, { requestId, actor: SYNC_ACTOR }) };
  } catch (error) {
    return { ok: false, error: toErrorBody_(error, requestId) };
  }
}
```

`gas/src/modules/sync/routes.ts`:

```ts
import { platform_ } from '@gas/core/platform';
import { expectNull_ } from '@gas/core/validate';
import { SYNC_API_VERSION, SYNC_RESOURCES } from '@shared/sync';
import type { SyncRouteTable } from './handler';
import { syncRoute_ } from './handler';

/** Tabel rute sinkron (terpisah dari `getRoutes_` RPC web). Dibangun lazy karena urutan load file GAS tidak dijamin. */
export function getSyncRoutes_(): SyncRouteTable {
  return {
    'sync.ping': syncRoute_({
      validate: expectNull_,
      handler: () => ({
        apiVersion: SYNC_API_VERSION,
        serverTime: new Date(platform_().now()).toISOString(),
        resources: [...SYNC_RESOURCES],
      }),
    }),
  };
}
```

`gas/src/main.ts` — tambahkan impor `renderJsonOutput_` (ke daftar impor `@gas/core/gas-platform`), `import { handleSync_ } from '@gas/modules/sync/handler';`, `import { getSyncRoutes_ } from '@gas/modules/sync/routes';` dan setelah `api`:

```ts
/** Endpoint sinkronisasi QC Desktop (docs/api/desktop-sync.md). Jalur terpisah dari `api` (RPC sesi web). */
export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  installGasPlatform_();
  return renderJsonOutput_(JSON.stringify(handleSync_(e?.postData?.contents, getSyncRoutes_())));
}
```

`scripts/build-gas-lib.ts` — tambahkan `'doPost'` ke `PUBLIC_GAS_FUNCTIONS`.

- [ ] **Step 4: Jalankan semua tes dan build**

Run: `bun run --cwd gas test && bun run --cwd gas typecheck && bun test scripts && bun scripts/build-gas.ts`
Expected: lulus; build GAS lolos (nama `authenticateSync_`, `handleSync_`, `syncRoute_`, `getSyncRoutes_` unik).

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas scripts
git add gas scripts
git commit -m "feat(sync): kerangka doPost — token waktu-konstan, pembatas, amplop berversi, tabel rute sinkron, sync.ping" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `sync.file.get` dan pendaftaran berkas Drive

**Files:**
- Create: `gas/src/modules/sync/files.ts`, `gas/src/modules/sync/files.test.ts`
- Modify: `gas/src/modules/sync/routes.ts`

**Interfaces:**
- Consumes: `driveFileInfo`, `driveReadFile`, `listFiles_`/`insertFile_`, `isImageMime`, `base64ByteLength`, `SYNC_LIMITS`, `SYNC_ACTOR`, `nowIso_`.
- Produces:
  - `files.ts`: `validateSyncFileGet_`, `getSyncFile_(input): { driveId; mime; base64 }`, `type DriveProbe = { mime; size }`, `probeDriveIds_(driveIds): Map<string, DriveProbe | null>` (**tanpa lock**, boleh memanggil Drive), `registerDriveFiles_(driveIds, probes): { map: Map<string, string>; missing: string[] }` (**pemanggil memegang lock**; `map` = idDrive → id baris `files`).
  - Rute `sync.file.get`.

- [ ] **Step 1: Tulis tes yang gagal** — `gas/src/modules/sync/files.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listFiles_ } from '@gas/modules/files/repo';
import { ensureDriveFolder_ } from '@gas/modules/files/service';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { handleSync_ } from './handler';
import { getSyncRoutes_ } from './routes';
import { probeDriveIds_, registerDriveFiles_ } from './files';

const TOKEN = 't0k3n'.repeat(8);
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
let platform: MemoryPlatform;
let folder: string;

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's', SYNC_API_TOKEN: TOKEN },
  });
  setPlatform_(platform);
  folder = ensureDriveFolder_();
});

const call = (payload: unknown) =>
  handleSync_(JSON.stringify({ v: 1, method: 'sync.file.get', token: TOKEN, payload }), getSyncRoutes_());

test('sync.file.get mengembalikan isi berkas di folder aplikasi', () => {
  const driveId = platform.driveCreateFile(folder, 'a.png', 'image/png', PNG);
  expect(call({ driveId })).toEqual({ ok: true, data: { driveId, mime: 'image/png', base64: PNG } });
});

test('sync.file.get: id di luar folder, tak dikenal, atau tanpa DRIVE_FOLDER_ID → NOT_FOUND', () => {
  const other = platform.driveCreateFolder('Lain');
  const outside = platform.driveCreateFile(other, 'b.png', 'image/png', PNG);
  expect(call({ driveId: outside })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  expect(call({ driveId: 'tidak-ada' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  platform.properties.delete('DRIVE_FOLDER_ID');
  const inside = platform.driveCreateFile(folder, 'c.png', 'image/png', PNG);
  expect(call({ driveId: inside })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
});

test('sync.file.get: payload tidak sah → VALIDATION; berkas > 8 MB → VALIDATION', () => {
  expect(call({})).toMatchObject({ ok: false, error: { code: 'VALIDATION', fields: { driveId: 'Wajib diisi' } } });
  expect(call(null)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  const big = platform.driveCreateFile(folder, 'big.png', 'image/png', 'A'.repeat(11_000_000));
  expect(call({ driveId: big })).toMatchObject({ ok: false, error: { code: 'VALIDATION', fields: { driveId: 'Berkas melebihi 8 MB' } } });
});

test('registerDriveFiles_: berkas di folder didaftarkan sekali; id tak sah dilaporkan missing; idempoten', () => {
  const good = platform.driveCreateFile(folder, 'a.png', 'image/png', PNG);
  const other = platform.driveCreateFolder('Lain');
  const outside = platform.driveCreateFile(other, 'b.png', 'image/png', PNG);
  const text = platform.driveCreateFile(folder, 't.txt', 'text/plain', PNG);
  const ids = [good, outside, text, 'tidak-ada', good];
  const first = registerDriveFiles_(ids, probeDriveIds_(ids));
  expect(first.missing.sort()).toEqual([outside, text, 'tidak-ada'].sort());
  expect(first.map.size).toBe(1);
  const rows = listFiles_();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ driveId: good, mime: 'image/png', size: 16, ownerType: '', createdBy: 'sync:desktop' });
  const second = registerDriveFiles_([good], probeDriveIds_([good]));
  expect(second.map.get(good)).toBe(first.map.get(good));
  expect(listFiles_()).toHaveLength(1);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test sync/files`
Expected: FAIL — `./files` belum ada.

- [ ] **Step 3: Implementasi** — `gas/src/modules/sync/files.ts`

```ts
import { appError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import { readObject_ } from '@gas/core/validate';
import { nowIso_ } from '@gas/modules/access/service';
import { insertFile_, listFiles_ } from '@gas/modules/files/repo';
import { base64ByteLength, isImageMime } from '@shared/files';
import { SYNC_ACTOR, SYNC_LIMITS } from '@shared/sync';

export interface SyncFileGetInput {
  driveId: string;
}

export interface DriveProbe {
  mime: string;
  size: number;
}

function syncFolderId_(): string {
  return platform_().getProperty('DRIVE_FOLDER_ID')?.trim() ?? '';
}

export function validateSyncFileGet_(raw: unknown): SyncFileGetInput {
  const reader = readObject_(raw);
  const driveId = reader.str('driveId', { required: true, max: 100 });
  reader.done();
  return { driveId };
}

export function getSyncFile_(input: SyncFileGetInput): { driveId: string; mime: string; base64: string } {
  const folderId = syncFolderId_();
  const info = folderId ? platform_().driveFileInfo(input.driveId, folderId) : null;
  if (!info) throw appError_('NOT_FOUND', 'Berkas tidak ditemukan');
  if (info.size > SYNC_LIMITS.fileBytes) {
    throw appError_('VALIDATION', 'Berkas melebihi 8 MB', { driveId: 'Berkas melebihi 8 MB' });
  }
  const content = platform_().driveReadFile(input.driveId, folderId);
  if (!content) throw appError_('NOT_FOUND', 'Berkas tidak ditemukan');
  if (base64ByteLength(content.base64) > SYNC_LIMITS.fileBytes) {
    throw appError_('VALIDATION', 'Berkas melebihi 8 MB', { driveId: 'Berkas melebihi 8 MB' });
  }
  return { driveId: input.driveId, mime: content.mime, base64: content.base64 };
}

/** TANPA lock (boleh I/O Drive): info Drive untuk id yang belum tercatat di sheet `files`; `null` = tak sah. */
export function probeDriveIds_(driveIds: readonly string[]): Map<string, DriveProbe | null> {
  const folderId = syncFolderId_();
  const known = new Set(listFiles_().map((file) => file.driveId));
  const probes = new Map<string, DriveProbe | null>();
  for (const driveId of new Set(driveIds)) {
    if (known.has(driveId)) continue;
    probes.set(driveId, folderId ? platform_().driveFileInfo(driveId, folderId) : null);
  }
  return probes;
}

/**
 * Memastikan tiap id Drive punya baris `files` (didaftarkan bila belum, tanpa pemilik). Id yang tak ada di folder
 * aplikasi, bukan gambar JPEG/PNG/WebP, atau > 8 MB dilaporkan di `missing`. PEMANGGIL WAJIB memegang lock.
 */
export function registerDriveFiles_(
  driveIds: readonly string[],
  probes: ReadonlyMap<string, DriveProbe | null>,
): { map: Map<string, string>; missing: string[] } {
  const byDrive = new Map(listFiles_().map((file) => [file.driveId, file.id]));
  const map = new Map<string, string>();
  const missing: string[] = [];
  for (const driveId of new Set(driveIds)) {
    const existing = byDrive.get(driveId);
    if (existing !== undefined) {
      map.set(driveId, existing);
      continue;
    }
    const probe = probes.get(driveId);
    if (!probe || !isImageMime(probe.mime) || probe.size > SYNC_LIMITS.fileBytes) {
      missing.push(driveId);
      continue;
    }
    const id = platform_().uuid();
    insertFile_({
      id,
      driveId,
      mime: probe.mime,
      size: probe.size,
      width: 0,
      height: 0,
      ownerType: '',
      ownerId: '',
      createdAt: nowIso_(),
      createdBy: SYNC_ACTOR,
    });
    map.set(driveId, id);
  }
  return { map, missing };
}
```

`gas/src/modules/sync/routes.ts` — impor `getSyncFile_, validateSyncFileGet_` dari `./files` dan tambahkan ke objek yang dikembalikan:

```ts
    'sync.file.get': syncRoute_({ validate: validateSyncFileGet_, handler: (input) => getSyncFile_(input) }),
```

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `bun run --cwd gas test sync && bun run --cwd gas typecheck`
Expected: lulus.

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas
git add gas
git commit -m "feat(sync): sync.file.get dan pendaftaran otomatis berkas Drive di folder aplikasi" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sumber daya `brands` — pull dan push

**Files:**
- Create: `gas/src/modules/sync/wire.ts`, `pull.ts`, `conflict.ts`, `brands.ts`, `brands.test.ts`
- Modify: `gas/src/modules/brand/service.ts` (ekstrak `applyBrandSave_`, `applyBrandStatus_`; ekspor `brandSnapshot_`), `gas/src/modules/sync/routes.ts`, `web/src/modules/access/lib/audit-actions.ts`

**Interfaces:**
- Consumes: `listBrands_`/`updateBrand_`, `brand/service.ts`, `SyncWireBrand`, `SyncEntryResult`, `isStaleWrite_`.
- Produces:
  - `brand/service.ts`: `applyBrandSave_(input, actor): BrandDto` dan `applyBrandStatus_(input, actor): BrandDto` — **tanpa lock** (pemanggil memegang lock); `saveBrand_`/`setBrandStatus_` membungkusnya dengan `withLock`; `brandSnapshot_` diekspor.
  - `wire.ts`: `type WireCheck<T>`, `asSyncObject_`, `readSyncId_`, `readSyncBool_`, `readSyncBaseRev_`, `validateSyncPush_(raw, key, detailLimited)`.
  - `pull.ts`: `SyncPullInput`, `validateSyncPull_(raw, includable)`, `paginateByRev_`.
  - `conflict.ts`: `isStaleWrite_(baseRev, currentRev, overwrite)`, `syncFailureResult_(error, index)`.
  - `brands.ts`: `checkSyncBrand_`, `toWireBrand_`, `pullBrands_`, `pushBrands_`; rute `sync.brands.pull`/`sync.brands.push`.

- [ ] **Step 1: Tulis tes yang gagal** — `gas/src/modules/sync/brands.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { insertBrand_, listBrands_ } from '@gas/modules/brand/repo';
import { insertItem_, listItems_ } from '@gas/modules/item/repo';
import { brand, item } from '@gas-test/item-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { handleSync_ } from './handler';
import { getSyncRoutes_ } from './routes';
import { nextRev_ } from './state';

const TOKEN = 't0k3n'.repeat(8);
let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's', SYNC_API_TOKEN: TOKEN },
    now: () => Date.parse('2026-10-15T00:00:00.000Z'),
  });
  setPlatform_(platform);
});

/** Fixture memberi `syncRev` langsung; naikkan penghitung sync_state agar revisi baru selalu lebih besar. */
function prime(resource: 'brands' | 'items', count: number): void {
  for (let i = 0; i < count; i++) nextRev_(resource);
}

function call(method: string, payload: unknown) {
  const result = handleSync_(JSON.stringify({ v: 1, method, token: TOKEN, payload }), getSyncRoutes_());
  return result as { ok: boolean; data?: any; error?: any };
}
const push = (brands: unknown[], extra: Record<string, unknown> = {}) =>
  call('sync.brands.push', { brands, ...extra });
const results = (brands: unknown[], extra: Record<string, unknown> = {}) => {
  const out = push(brands, extra);
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return out.data.results as Array<Record<string, any>>;
};
const lastAudit = () => {
  const record = listAuditRecords_().at(-1);
  if (!record) throw new Error('audit kosong');
  return record;
};

test('pull: halaman berurutan menurut rev, tepat sekali, kursor = rev terakhir; sinceRev menyaring', () => {
  for (let i = 1; i <= 5; i++) insertBrand_(brand(`Merk ${i}`, { syncRev: i * 10, externalId: i === 2 ? '77' : '' }));
  insertBrand_(brand('Lama', { syncRev: 0 })); // belum punya revisi: tidak ikut
  const seen: string[] = [];
  let since = 0;
  for (let guard = 0; guard < 10; guard++) {
    const page = call('sync.brands.pull', { sinceRev: since, limit: 2 });
    expect(page.ok).toBe(true);
    seen.push(...page.data.brands.map((b: { name: string }) => b.name));
    since = page.data.nextRev;
    if (!page.data.hasMore) break;
  }
  expect(seen).toEqual(['Merk 1', 'Merk 2', 'Merk 3', 'Merk 4', 'Merk 5']);
  expect(since).toBe(50);
  const one = call('sync.brands.pull', { sinceRev: 10, limit: 1 });
  expect(one.data.brands[0]).toEqual({ uid: 'brand-merk-2', id: '77', name: 'Merk 2', active: true, rev: 20 });
  expect(call('sync.brands.pull', { sinceRev: 50 }).data).toEqual({ brands: [], nextRev: 50, hasMore: false });
  expect(call('sync.brands.pull', null).data.brands).toHaveLength(5);
});

test('pull: payload tidak sah → VALIDATION', () => {
  for (const payload of [{ sinceRev: -1 }, { sinceRev: 1.5 }, { limit: 0 }, { limit: 501 }, { include: ['detail'] }, 'x']) {
    expect(call('sync.brands.pull', payload)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  }
});

test('push merk baru: created, dipetakan ke id MySQL, audit atas nama sync:desktop; diulang → unchanged', () => {
  const [first] = results([{ id: '3', name: 'Ubiquiti' }]);
  expect(first).toMatchObject({ index: 0, status: 'created', rev: 1 });
  expect(typeof first?.uid).toBe('string');
  expect(listBrands_()[0]).toMatchObject({ name: 'Ubiquiti', externalId: '3', status: 'active', syncRev: 1 });
  expect(lastAudit()).toMatchObject({ actor: 'sync:desktop', action: 'brand.create', target: 'Ubiquiti' });
  const auditCount = listAuditRecords_().length;
  const [again] = results([{ id: '3', name: 'Ubiquiti' }]);
  expect(again).toMatchObject({ status: 'unchanged', uid: first?.uid, rev: 1 });
  expect(listAuditRecords_()).toHaveLength(auditCount);
});

test('push mencocokkan menurut uid, lalu id MySQL, lalu nama ternormalisasi; pemetaan saja → updated tanpa kenaikan rev', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 5 }));
  const [mapped] = results([{ id: '3', name: 'ubiquiti' }]); // huruf berbeda = nilai sama
  expect(mapped).toMatchObject({ status: 'updated', uid: 'brand-ubiquiti', rev: 5 });
  expect(listBrands_()[0]).toMatchObject({ name: 'Ubiquiti', externalId: '3', syncRev: 5 });
  const [byId] = results([{ id: '3', name: 'Ubiquiti' }]);
  expect(byId).toMatchObject({ status: 'unchanged', uid: 'brand-ubiquiti' });
  const [byUid] = results([{ uid: 'brand-ubiquiti', active: true }]);
  expect(byUid?.status).toBe('unchanged');
});

test('ganti nama lewat push: updated, rev naik, kunci dan rev semua item merk itu ikut berubah, audit brand.update', () => {
  prime('brands', 5);
  prime('items', 8);
  insertBrand_(brand('Ubiquity', { syncRev: 5 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquity', model: 'ES 24', syncRev: 8 }));
  const [renamed] = results([{ uid: 'brand-ubiquity', name: 'Ubiquiti', baseRev: 5 }]);
  expect(renamed).toMatchObject({ status: 'updated' });
  expect((renamed?.rev ?? 0) > 5).toBe(true);
  expect(listItems_()[0]?.key).toBe('ubiquiti es 24');
  expect((listItems_()[0]?.syncRev ?? 0) > 8).toBe(true);
  expect(lastAudit()).toMatchObject({ actor: 'sync:desktop', action: 'brand.update' });
});

test('konflik: baseRev basi + nilai berbeda → conflict tanpa perubahan; baseRev terkini, overwrite, atau nilai sama berhasil', () => {
  prime('brands', 5);
  insertBrand_(brand('A', { syncRev: 5 }));
  const [stale] = results([{ uid: 'brand-a', name: 'B', baseRev: 3 }]);
  expect(stale).toMatchObject({ status: 'conflict', uid: 'brand-a', rev: 5, current: { uid: 'brand-a', name: 'A', active: true, rev: 5 } });
  expect(listBrands_()[0]?.name).toBe('A');
  expect(lastAudit()).toMatchObject({ actor: 'sync:desktop', action: 'brand.sync.conflict' });
  expect(results([{ uid: 'brand-a', name: 'B' }])[0]?.status).toBe('conflict'); // tanpa baseRev
  expect(results([{ uid: 'brand-a', name: 'B', baseRev: 3 }], { overwrite: true })[0]?.status).toBe('updated');
  expect(listBrands_()[0]?.name).toBe('B');
  expect(results([{ uid: 'brand-a', name: 'C', baseRev: listBrands_()[0]?.syncRev }])[0]?.status).toBe('updated');
  expect(results([{ uid: 'brand-a', name: 'C', baseRev: 1 }])[0]?.status).toBe('unchanged'); // nilai sama, baseRev basi
});

test('nonaktifkan lewat active:false; pull menampilkan active:false', () => {
  prime('brands', 1);
  insertBrand_(brand('A', { syncRev: 1 }));
  const [off] = results([{ uid: 'brand-a', active: false, baseRev: 1 }]);
  expect(off?.status).toBe('updated');
  expect(listBrands_()[0]?.status).toBe('inactive');
  expect(call('sync.brands.pull', {}).data.brands[0]).toMatchObject({ active: false });
});

test('entri tidak sah menghasilkan invalid per field tanpa membatalkan entri lain; urutan hasil = urutan permintaan', () => {
  const out = results([
    { name: 'Valid 1' },
    { name: '' },
    { id: { x: 1 }, name: 'Y' },
    { uid: 'tidak-ada', name: 'Z' },
    { name: '!!!' },
    { active: true },
    'bukan objek',
    { name: 'Valid 2', id: 12 },
  ]);
  expect(out.map((r) => r.status)).toEqual(['created', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'created']);
  expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  expect(out[1]?.fields).toEqual({ name: 'Wajib diisi' });
  expect(out[3]?.fields).toEqual({ uid: 'Merk tidak ditemukan' });
  expect(out[5]?.fields).toEqual({ name: 'Wajib diisi untuk merk baru' });
  expect(listBrands_().map((b) => b.name).sort()).toEqual(['Valid 1', 'Valid 2']);
  expect(listBrands_().find((b) => b.name === 'Valid 2')?.externalId).toBe('12');
});

test('uid dan id yang mengarah ke merk berbeda, atau merk sudah terpetakan ke id lain → conflict', () => {
  insertBrand_(brand('A', { externalId: '1', syncRev: 1 }));
  insertBrand_(brand('B', { externalId: '2', syncRev: 2 }));
  expect(results([{ uid: 'brand-a', id: '2' }])[0]?.status).toBe('conflict');
  expect(results([{ uid: 'brand-a', id: '9' }])[0]?.status).toBe('conflict');
  expect(listBrands_().map((b) => b.externalId)).toEqual(['1', '2']);
});

test('ganti nama ke nama merk lain → invalid (CONFLICT server dipetakan ke field name)', () => {
  insertBrand_(brand('A', { syncRev: 1 }));
  insertBrand_(brand('B', { syncRev: 2 }));
  const [out] = results([{ uid: 'brand-a', name: 'B', baseRev: 1 }]);
  expect(out).toMatchObject({ status: 'invalid', fields: { name: 'Nama merk sudah dipakai' } });
});

test('batas jumlah entri dan bentuk payload', () => {
  const many = Array.from({ length: 201 }, (_, i) => ({ name: `M${i}` }));
  expect(push(many)).toMatchObject({ ok: false, error: { code: 'VALIDATION', fields: { brands: 'Maksimal 200 merk' } } });
  expect(push([])).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(call('sync.brands.push', { brands: 'x' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(call('sync.brands.push', { brands: [{ name: 'A' }], overwrite: 'ya' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(call('sync.brands.push', null)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test sync/brands`
Expected: FAIL — `sync.brands.*` belum terdaftar, modul belum ada.

- [ ] **Step 3: Implementasi**

`gas/src/modules/brand/service.ts` — ekstrak isi `withLock` menjadi fungsi tanpa lock:

1. Ubah `function brandSnapshot_(` menjadi `export function brandSnapshot_(`.
2. Ganti `export function saveBrand_(input, actor) { return platform_().withLock(() => { ... }); }` menjadi dua fungsi: `export function applyBrandSave_(input: SaveBrandInput, actor: ActorRef): BrandDto { ...isi lama tanpa withLock... }` dan

```ts
export function saveBrand_(input: SaveBrandInput, actor: ActorRef): BrandDto {
  return platform_().withLock(() => applyBrandSave_(input, actor));
}
```

Lakukan hal yang sama untuk `setBrandStatus_` → `applyBrandStatus_(input: SetBrandStatusInput, actor: ActorRef): BrandDto` + pembungkus `setBrandStatus_`. Tidak ada perubahan perilaku (tes `brand.test.ts` tetap lulus).

`gas/src/modules/sync/wire.ts`:

```ts
import { appError_ } from '@gas/core/errors';
import { SYNC_LIMITS } from '@shared/sync';

export type WireCheck<T> = { ok: true; value: T } | { ok: false; fields: Record<string, string> };

export function asSyncObject_(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null;
}

/** id MySQL: teks ≤ 100 atau bilangan bulat ≥ 0 (dijadikan teks); kosong/null = tidak ada. */
export function readSyncId_(
  source: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
): string | undefined {
  const value = source[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'string' && value.trim() !== '' && value.trim().length <= 100) return value.trim();
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return String(value);
  fields[key] = 'ID tidak valid';
  return undefined;
}

/** boolean; teks "true"/"false" diterima (Desktop dapat mengirim teks). */
export function readSyncBool_(
  source: Record<string, unknown>,
  key: string,
  fields: Record<string, string>,
): boolean | undefined {
  const value = source[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  fields[key] = 'Harus true atau false';
  return undefined;
}

export function readSyncBaseRev_(
  source: Record<string, unknown>,
  fields: Record<string, string>,
): number | undefined {
  const value = source.baseRev;
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  fields.baseRev = 'Harus bilangan bulat ≥ 0';
  return undefined;
}

export interface SyncPushEnvelope {
  overwrite: boolean;
  entries: unknown[];
}

/** Validasi tingkat permintaan push; kesalahan per entri ditangani per entri (hasil `invalid`). */
export function validateSyncPush_(raw: unknown, key: 'items' | 'brands', detailLimited: boolean): SyncPushEnvelope {
  const source = asSyncObject_(raw);
  if (!source) throw appError_('VALIDATION', 'Input harus berupa objek', { _: 'Input harus berupa objek' });
  const label = key === 'items' ? 'item' : 'merk';
  if (source.overwrite !== undefined && typeof source.overwrite !== 'boolean') {
    throw appError_('VALIDATION', 'Input tidak valid', { overwrite: 'Harus true atau false' });
  }
  const entries = source[key];
  if (!Array.isArray(entries)) {
    throw appError_('VALIDATION', 'Input tidak valid', { [key]: 'Harus berupa daftar' });
  }
  if (entries.length === 0) {
    throw appError_('VALIDATION', 'Input tidak valid', { [key]: `Minimal 1 ${label}` });
  }
  const withDetail =
    detailLimited &&
    entries.some((entry) => typeof asSyncObject_(entry)?.detail === 'string');
  const max = withDetail ? SYNC_LIMITS.pushMaxWithDetail : SYNC_LIMITS.pushMax;
  if (entries.length > max) {
    throw appError_('VALIDATION', 'Input tidak valid', { [key]: `Maksimal ${max} ${label}` });
  }
  return { overwrite: source.overwrite === true, entries };
}
```

`gas/src/modules/sync/pull.ts`:

```ts
import { appError_ } from '@gas/core/errors';
import { SYNC_LIMITS } from '@shared/sync';
import { asSyncObject_ } from './wire';

export interface SyncPullInput {
  sinceRev: number;
  limit: number;
  include: string[];
}

/** `includable`: field berat yang boleh diminta lewat `include` (mis. ['detail', 'stickers', 'accessories']). */
export function validateSyncPull_(raw: unknown, includable: readonly string[]): SyncPullInput {
  const source = raw === null || raw === undefined ? {} : asSyncObject_(raw);
  if (!source) throw appError_('VALIDATION', 'Input harus berupa objek', { _: 'Input harus berupa objek' });
  const fields: Record<string, string> = {};
  const sinceRaw = source.sinceRev === undefined ? 0 : source.sinceRev;
  if (typeof sinceRaw !== 'number' || !Number.isInteger(sinceRaw) || sinceRaw < 0) {
    fields.sinceRev = 'Harus bilangan bulat ≥ 0';
  }
  const limitRaw = source.limit === undefined ? SYNC_LIMITS.pullDefault : source.limit;
  if (typeof limitRaw !== 'number' || !Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > SYNC_LIMITS.pullMax) {
    fields.limit = `Harus bilangan bulat 1–${SYNC_LIMITS.pullMax}`;
  }
  const includeRaw = source.include === undefined ? [] : source.include;
  if (!Array.isArray(includeRaw) || !includeRaw.every((entry) => typeof entry === 'string' && includable.includes(entry))) {
    fields.include = includable.length === 0 ? 'Tidak ada field yang dapat diminta' : `Subset dari: ${includable.join(', ')}`;
  }
  if (Object.keys(fields).length > 0) throw appError_('VALIDATION', 'Input tidak valid', fields);
  const include = [...new Set(includeRaw as string[])];
  const limit = Math.min(limitRaw as number, include.includes('detail') ? SYNC_LIMITS.pullMaxWithDetail : SYNC_LIMITS.pullMax);
  return { sinceRev: sinceRaw as number, limit, include };
}

/** Halaman baris dengan `syncRev` > sinceRev, urut naik; kursor = rev terakhir halaman (atau sinceRev bila kosong). */
export function paginateByRev_<T extends { syncRev: number }>(
  records: readonly T[],
  sinceRev: number,
  limit: number,
): { page: T[]; nextRev: number; hasMore: boolean } {
  const newer = records.filter((record) => record.syncRev > sinceRev).sort((a, b) => a.syncRev - b.syncRev);
  const page = newer.slice(0, limit);
  return { page, nextRev: page.at(-1)?.syncRev ?? sinceRev, hasMore: newer.length > limit };
}
```

`gas/src/modules/sync/conflict.ts`:

```ts
import { isAppError_ } from '@gas/core/errors';
import { platform_ } from '@gas/core/platform';
import type { SyncEntryResult } from '@shared/sync';

/**
 * Perubahan nilai dianggap konflik bila tidak ada `overwrite` dan `baseRev` kosong atau lebih lama dari revisi
 * sekarang. (Nilai yang sama persis tidak pernah sampai ke pemeriksaan ini: hasilnya `unchanged`.)
 */
export function isStaleWrite_(baseRev: number | undefined, currentRev: number, overwrite: boolean): boolean {
  return !overwrite && (baseRev === undefined || baseRev < currentRev);
}

/** Galat saat memproses satu entri → hasil `invalid` (tidak membatalkan entri lain). Galat tak terduga dicatat. */
export function syncFailureResult_<T>(error: unknown, index: number): SyncEntryResult<T> {
  if (isAppError_(error)) {
    return { index, status: 'invalid', fields: error.fields ?? { _: error.message } };
  }
  platform_().logError(`sync entri ${index} gagal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  return { index, status: 'invalid', fields: { _: 'Galat server; coba lagi' } };
}
```

`gas/src/modules/sync/brands.ts`:

```ts
import { platform_ } from '@gas/core/platform';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import type { BrandRecord } from '@gas/modules/brand/repo';
import { listBrands_, updateBrand_ } from '@gas/modules/brand/repo';
import { applyBrandSave_, applyBrandStatus_, brandSnapshot_ } from '@gas/modules/brand/service';
import { ITEM_LIMITS, normalizeKey } from '@shared/items';
import type { SyncEntryResult, SyncWireBrand } from '@shared/sync';
import { SYNC_ACTOR } from '@shared/sync';
import { isStaleWrite_, syncFailureResult_ } from './conflict';
import { paginateByRev_, validateSyncPull_ } from './pull';
import type { SyncPushEnvelope, WireCheck } from './wire';
import { asSyncObject_, readSyncBaseRev_, readSyncBool_, readSyncId_ } from './wire';

export interface SyncBrandInput {
  uid?: string;
  id?: string;
  name?: string;
  active?: boolean;
  baseRev?: number;
}

const SYNC_ACTOR_REF = { email: SYNC_ACTOR };

export function toWireBrand_(brand: BrandRecord): SyncWireBrand {
  return {
    uid: brand.id,
    id: brand.externalId === '' ? null : brand.externalId,
    name: brand.name,
    active: brand.status === 'active',
    rev: brand.syncRev,
  };
}

export function checkSyncBrand_(raw: unknown): WireCheck<SyncBrandInput> {
  const source = asSyncObject_(raw);
  if (!source) return { ok: false, fields: { _: 'Entri harus berupa objek' } };
  const fields: Record<string, string> = {};
  const value: SyncBrandInput = {};
  const uid = readSyncId_(source, 'uid', fields);
  if (uid !== undefined) value.uid = uid;
  const id = readSyncId_(source, 'id', fields);
  if (id !== undefined) value.id = id;
  if (source.name !== undefined) {
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (name === '') fields.name = 'Wajib diisi';
    else if (name.length > ITEM_LIMITS.brand) fields.name = `Maksimal ${ITEM_LIMITS.brand} karakter`;
    else if (normalizeKey(name) === '') fields.name = 'Nama merk harus memuat huruf atau angka';
    else value.name = name;
  }
  const active = readSyncBool_(source, 'active', fields);
  if (active !== undefined) value.active = active;
  const baseRev = readSyncBaseRev_(source, fields);
  if (baseRev !== undefined) value.baseRev = baseRev;
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

export function pullBrands_(raw: unknown): { brands: SyncWireBrand[]; nextRev: number; hasMore: boolean } {
  const input = validateSyncPull_(raw, []);
  const { page, nextRev, hasMore } = paginateByRev_(listBrands_(), input.sinceRev, input.limit);
  return { brands: page.map(toWireBrand_), nextRev, hasMore };
}

function brandConflict_(
  index: number,
  existing: BrandRecord,
  proposed: { name: string; status: string },
  extraFields?: Record<string, string>,
): SyncEntryResult<SyncWireBrand> {
  appendAudit_({
    ts: nowIso_(),
    actor: SYNC_ACTOR,
    action: 'brand.sync.conflict',
    target: existing.name,
    before: brandSnapshot_(existing),
    after: proposed,
  });
  return {
    index,
    status: 'conflict',
    uid: existing.id,
    rev: existing.syncRev,
    current: toWireBrand_(existing),
    ...(extraFields ? { fields: extraFields } : {}),
  };
}

/** Di dalam lock. */
function upsertBrandInLock_(entry: SyncBrandInput, index: number, overwrite: boolean): SyncEntryResult<SyncWireBrand> {
  const brands = listBrands_();
  const byUid = entry.uid === undefined ? undefined : brands.find((brand) => brand.id === entry.uid);
  if (entry.uid !== undefined && !byUid) {
    return { index, status: 'invalid', fields: { uid: 'Merk tidak ditemukan' } };
  }
  const byId = entry.id === undefined ? undefined : brands.find((brand) => brand.externalId === entry.id);
  if (byUid && byId && byUid.id !== byId.id) {
    return brandConflict_(index, byUid, { name: byUid.name, status: byUid.status }, { id: 'uid dan id mengarah ke merk berbeda' });
  }
  let existing = byUid ?? byId;
  if (!existing && entry.name !== undefined) {
    const key = normalizeKey(entry.name);
    existing = brands.find((brand) => brand.key === key);
  }
  if (existing && entry.id !== undefined && existing.externalId !== '' && existing.externalId !== entry.id) {
    return brandConflict_(index, existing, { name: entry.name ?? existing.name, status: existing.status }, { id: 'Merk sudah terpetakan ke id MySQL lain' });
  }

  if (!existing) {
    if (entry.name === undefined) {
      return { index, status: 'invalid', fields: { name: 'Wajib diisi untuk merk baru' } };
    }
    const created = applyBrandSave_({ name: entry.name }, SYNC_ACTOR_REF);
    const fresh = listBrands_().find((brand) => brand.id === created.id) as BrandRecord;
    updateBrand_({ ...fresh, externalId: entry.id ?? '' });
    if (entry.active === false) applyBrandStatus_({ id: created.id, status: 'inactive' }, SYNC_ACTOR_REF);
    const final = listBrands_().find((brand) => brand.id === created.id) as BrandRecord;
    return { index, status: 'created', uid: final.id, rev: final.syncRev };
  }

  // Nama dianggap sama bila kunci ternormalisasinya sama (migrasi dari Desktop tidak boleh jadi konflik karena huruf besar/kecil).
  const nameChanged = entry.name !== undefined && normalizeKey(entry.name) !== existing.key;
  const wantStatus = entry.active === undefined ? existing.status : entry.active ? 'active' : 'inactive';
  const statusChanged = wantStatus !== existing.status;
  const mapChanged = entry.id !== undefined && existing.externalId === '';
  if (!nameChanged && !statusChanged) {
    if (mapChanged) {
      // Pemetaan id MySQL adalah pembukuan, bukan perubahan data: tanpa kenaikan rev dan tanpa audit.
      updateBrand_({ ...existing, externalId: entry.id as string });
      return { index, status: 'updated', uid: existing.id, rev: existing.syncRev };
    }
    return { index, status: 'unchanged', uid: existing.id, rev: existing.syncRev };
  }
  if (isStaleWrite_(entry.baseRev, existing.syncRev, overwrite)) {
    return brandConflict_(index, existing, { name: nameChanged ? (entry.name as string) : existing.name, status: wantStatus });
  }
  if (nameChanged) applyBrandSave_({ id: existing.id, name: entry.name as string }, SYNC_ACTOR_REF);
  if (statusChanged) applyBrandStatus_({ id: existing.id, status: wantStatus }, SYNC_ACTOR_REF);
  const fresh = listBrands_().find((brand) => brand.id === existing.id) as BrandRecord;
  if (mapChanged) updateBrand_({ ...fresh, externalId: entry.id as string });
  return { index, status: 'updated', uid: fresh.id, rev: fresh.syncRev };
}

export function pushBrands_(envelope: SyncPushEnvelope): { results: Array<SyncEntryResult<SyncWireBrand>> } {
  const results = envelope.entries.map((raw, index): SyncEntryResult<SyncWireBrand> => {
    const check = checkSyncBrand_(raw);
    if (!check.ok) return { index, status: 'invalid', fields: check.fields };
    try {
      return platform_().withLock(() => upsertBrandInLock_(check.value, index, envelope.overwrite));
    } catch (error) {
      return syncFailureResult_(error, index);
    }
  });
  return { results };
}
```

`gas/src/modules/sync/routes.ts` — impor `pullBrands_, pushBrands_` dari `./brands` dan `validateSyncPush_` dari `./wire`, lalu tambahkan:

```ts
    'sync.brands.pull': syncRoute_({ validate: (raw) => raw, handler: (raw) => pullBrands_(raw) }),
    'sync.brands.push': syncRoute_({
      validate: (raw) => validateSyncPush_(raw, 'brands', false),
      handler: (envelope) => pushBrands_(envelope),
    }),
```

`web/src/modules/access/lib/audit-actions.ts` — tambahkan `'brand.sync.conflict': 'Konflik sinkronisasi merk',` dan `'item.sync.conflict': 'Konflik sinkronisasi item',` ke `AUDIT_ACTION_LABELS`.

- [ ] **Step 4: Jalankan tes**

Run: `bun run --cwd gas test && bun run --cwd gas typecheck && bun scripts/build-gas.ts`
Expected: lulus. Perhatikan bahwa pada tes "ganti nama lewat push", `applyBrandSave_` menaikkan rev merk lewat `nextRev_('brands')` (Task 3) dan rev item; tes brand lama tetap lulus (pembungkus `saveBrand_` tidak berubah perilaku).

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas web
git add gas web
git commit -m "feat(sync): sumber daya brands — pull berkursor, push per entri dengan konflik, pemetaan id MySQL, dan audit sync:desktop" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `sync.items.pull`

**Files:**
- Create: `gas/src/modules/sync/items.ts`, `gas/src/modules/sync/items-pull.test.ts`
- Modify: `gas/src/modules/item/service.ts` (ekspor `brandNameMap_`), `gas/src/modules/sync/routes.ts`

**Interfaces:**
- Consumes: `paginateByRev_`, `validateSyncPull_` (Task 6), `listItems_`, `listFiles_`, `mapMarkdownRefs`, `SyncWireItem`.
- Produces: `items.ts`: `SYNC_ITEM_INCLUDABLE = ['detail', 'stickers', 'accessories']`, `toWireItem_(item, names, driveByFile, include): SyncWireItem`, `pullItems_(raw): { items; nextRev; hasMore }`; rute `sync.items.pull`.

- [ ] **Step 1: Tulis tes yang gagal** — `gas/src/modules/sync/items-pull.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { loadUserContext_ } from '@gas/modules/access/context';
import { insertBrand_ } from '@gas/modules/brand/repo';
import { insertFile_ } from '@gas/modules/files/repo';
import { insertItem_ } from '@gas/modules/item/repo';
import { saveItem_ } from '@gas/modules/item/service';
import { brand, item } from '@gas-test/item-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { handleSync_ } from './handler';
import { validateSyncPull_ } from './pull';
import { getSyncRoutes_ } from './routes';

const TOKEN = 't0k3n'.repeat(8);
let platform: MemoryPlatform;

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's', SYNC_API_TOKEN: TOKEN },
  });
  setPlatform_(platform);
});

function pull(payload: unknown) {
  const result = handleSync_(
    JSON.stringify({ v: 1, method: 'sync.items.pull', token: TOKEN, payload }),
    getSyncRoutes_(),
  );
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.data as { items: Array<Record<string, unknown>>; nextRev: number; hasMore: boolean };
}

const file = (id: string, driveId: string) =>
  insertFile_({
    id,
    driveId,
    mime: 'image/png',
    size: 10,
    width: 1,
    height: 1,
    ownerType: 'item',
    ownerId: 'i1',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'seed',
  });

function seedRich() {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  file('f1', 'DRV1');
  file('f2', 'DRV2');
  file('f3', 'DRV3');
  insertItem_(
    item({
      id: 'i1',
      brand: 'Ubiquiti',
      model: 'ES 24',
      externalId: '12',
      syncRev: 1,
      attachments: ['f1'],
      stickers: [
        { name: 'Label', note: 'n', fileId: 'f2' },
        { name: 'G', note: '', fileId: null },
      ],
      accessories: [{ name: 'Kabel', qty: 2 }],
      detail: '![x](qcfile:f3) teks',
    }),
  );
}

test('bentuk kabel: merk dari tabel merk, id Drive, uid/id, active; field berat hanya bila diminta', () => {
  seedRich();
  expect(pull({}).items).toEqual([
    { uid: 'i1', id: '12', merk: 'Ubiquiti', tipe: 'ES 24', isCountryLock: false, images: ['DRV1'], active: true, rev: 1 },
  ]);
  const heavy = pull({ include: ['detail', 'stickers', 'accessories'] }).items[0];
  expect(heavy).toMatchObject({
    detail: '![x](drive:DRV3) teks',
    stickers: [
      { name: 'Label', note: 'n', image: 'DRV2' },
      { name: 'G', note: '', image: null },
    ],
    accessories: [{ name: 'Kabel', qty: 2 }],
  });
  const onlyDetail = pull({ include: ['detail'] }).items[0] ?? {};
  expect('stickers' in onlyDetail).toBe(false);
  expect('detail' in onlyDetail).toBe(true);
});

test('id MySQL kosong → null; nonaktif → active:false; rujukan berkas yang tak tercatat dibuang dari images', () => {
  insertBrand_(brand('A', { syncRev: 1 }));
  insertItem_(item({ id: 'i1', brand: 'A', model: 'X', syncRev: 1, status: 'inactive', attachments: ['hilang'] }));
  expect(pull({}).items[0]).toMatchObject({ id: null, active: false, images: [] });
});

test('halaman tepat sekali, urut rev, kursor benar, hasMore benar; sinceRev menyaring', () => {
  insertBrand_(brand('A', { syncRev: 1 }));
  for (let i = 1; i <= 5; i++) insertItem_(item({ id: `i${i}`, brand: 'A', model: `M${i}`, syncRev: i * 10 }));
  insertItem_(item({ id: 'lama', brand: 'A', model: 'Lama', syncRev: 0 })); // belum punya revisi: tidak ikut
  const seen: string[] = [];
  let since = 0;
  for (let guard = 0; guard < 10; guard++) {
    const page = pull({ sinceRev: since, limit: 2 });
    seen.push(...page.items.map((entry) => String(entry.uid)));
    since = page.nextRev;
    if (!page.hasMore) break;
  }
  expect(seen).toEqual(['i1', 'i2', 'i3', 'i4', 'i5']);
  expect(since).toBe(50);
  expect(pull({ sinceRev: 50 })).toEqual({ items: [], nextRev: 50, hasMore: false });
  expect(pull({ sinceRev: 20 }).items.map((entry) => entry.uid)).toEqual(['i3', 'i4', 'i5']);
});

test('FS11: ubah alias tidak muncul di pull berikutnya; ubah detail muncul', () => {
  const admin = loadUserContext_('admin@gmail.com');
  if (!admin) throw new Error('admin hilang');
  const base = { brand: 'Ubiquiti', model: 'X', isCountryLock: false, aliases: [], stickers: [], accessories: [], attachments: [], detail: '' };
  const saved = saveItem_(base, admin);
  const first = pull({});
  expect(first.items.map((entry) => entry.uid)).toEqual([saved.id]);
  saveItem_({ ...base, id: saved.id, aliases: ['Alias Baru'] }, admin);
  expect(pull({ sinceRev: first.nextRev }).items).toEqual([]);
  saveItem_({ ...base, id: saved.id, aliases: ['Alias Baru'], detail: 'baru' }, admin);
  expect(pull({ sinceRev: first.nextRev }).items.map((entry) => entry.uid)).toEqual([saved.id]);
});

test('payload tidak sah → VALIDATION; limit dibatasi 200 bila include memuat detail', () => {
  for (const payload of [{ sinceRev: -1 }, { limit: 0 }, { limit: 501 }, { include: ['alias'] }, { include: 'detail' }, 'x']) {
    const result = handleSync_(
      JSON.stringify({ v: 1, method: 'sync.items.pull', token: TOKEN, payload }),
      getSyncRoutes_(),
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  }
  const parsed = validateSyncPull_({ limit: 500, include: ['detail'] }, ['detail', 'stickers', 'accessories']);
  expect(parsed.limit).toBe(200);
  expect(validateSyncPull_({ limit: 500 }, ['detail']).limit).toBe(500);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test sync/items-pull`
Expected: FAIL — `sync.items.pull` belum terdaftar.

- [ ] **Step 3: Implementasi**

`gas/src/modules/item/service.ts` — ubah `function brandNameMap_(` menjadi `export function brandNameMap_(`.

`gas/src/modules/sync/items.ts` (bagian pull; Task 8 melengkapi berkas yang sama):

```ts
import { listFiles_ } from '@gas/modules/files/repo';
import type { ItemRecord } from '@gas/modules/item/repo';
import { listItems_ } from '@gas/modules/item/repo';
import { brandNameMap_ } from '@gas/modules/item/service';
import { FILE_SCHEME } from '@shared/files';
import { DRIVE_REF_SCHEME, mapMarkdownRefs } from '@shared/items';
import type { SyncWireItem } from '@shared/sync';
import { paginateByRev_, validateSyncPull_ } from './pull';

/** Field berat yang hanya dikirim bila diminta lewat `include`. */
export const SYNC_ITEM_INCLUDABLE = ['detail', 'stickers', 'accessories'] as const;

export function toWireItem_(
  item: ItemRecord,
  names: ReadonlyMap<string, string>,
  driveByFile: ReadonlyMap<string, string>,
  include: readonly string[],
): SyncWireItem {
  const wire: SyncWireItem = {
    uid: item.id,
    id: item.externalId === '' ? null : item.externalId,
    merk: names.get(item.brandId) ?? '',
    tipe: item.model,
    isCountryLock: item.isCountryLock,
    images: item.attachments.flatMap((fileId) => {
      const driveId = driveByFile.get(fileId);
      return driveId === undefined ? [] : [driveId];
    }),
    active: item.status === 'active',
    rev: item.syncRev,
  };
  if (include.includes('detail')) {
    wire.detail = mapMarkdownRefs(item.detail, FILE_SCHEME, DRIVE_REF_SCHEME, (id) => driveByFile.get(id) ?? null);
  }
  if (include.includes('stickers')) {
    wire.stickers = item.stickers.map((sticker) => ({
      name: sticker.name,
      note: sticker.note,
      image: sticker.fileId === null ? null : (driveByFile.get(sticker.fileId) ?? null),
    }));
  }
  if (include.includes('accessories')) {
    wire.accessories = item.accessories.map((accessory) => ({ name: accessory.name, qty: accessory.qty }));
  }
  return wire;
}

export function driveIdsByFile_(): Map<string, string> {
  return new Map(listFiles_().map((file) => [file.id, file.driveId]));
}

export function pullItems_(raw: unknown): { items: SyncWireItem[]; nextRev: number; hasMore: boolean } {
  const input = validateSyncPull_(raw, SYNC_ITEM_INCLUDABLE);
  const { page, nextRev, hasMore } = paginateByRev_(listItems_(), input.sinceRev, input.limit);
  const names = brandNameMap_();
  const driveByFile = driveIdsByFile_();
  return { items: page.map((item) => toWireItem_(item, names, driveByFile, input.include)), nextRev, hasMore };
}
```

`gas/src/modules/sync/routes.ts` — impor `pullItems_` dari `./items` dan tambahkan:

```ts
    'sync.items.pull': syncRoute_({ validate: (raw) => raw, handler: (raw) => pullItems_(raw) }),
```

- [ ] **Step 4: Jalankan tes**

Run: `bun run --cwd gas test && bun run --cwd gas typecheck && bun scripts/build-gas.ts`
Expected: lulus.

- [ ] **Step 5: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas
git add gas
git commit -m "feat(sync): sync.items.pull — bentuk kabel, id Drive, kursor rev, dan field berat lewat include" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `sync.items.push`

**Files:**
- Modify: `gas/src/modules/item/service.ts` (ekstrak `writeItem_`; ekspor pembantu), `gas/src/modules/sync/items.ts`, `gas/src/modules/sync/routes.ts`
- Create: `gas/src/modules/sync/items-push.test.ts`

**Interfaces:**
- Consumes: `registerDriveFiles_`/`probeDriveIds_` (Task 5), `isStaleWrite_`/`syncFailureResult_` (Task 6), `validateSyncPush_`, `toWireItem_` (Task 7), `ActorRef` (Task 3).
- Produces:
  - `item/service.ts`: `writeItem_(input: SaveItemInput, options: WriteItemOptions): NewItemRecord` (**pemanggil memegang lock**), `WriteItemOptions { existing?; actor: ActorRef; externalId?; status? }`; diekspor: `toItemView_`, `itemSnapshot_`, `itemLabel_`, `itemSyncSignature_`; `saveItem_`/`setItemStatus_` menerima `ActorRef`.
  - `items.ts`: `SyncItemInput`, `checkSyncItem_`, `pushItems_(envelope)`; rute `sync.items.push`.

- [ ] **Step 1: Tulis tes yang gagal** — `gas/src/modules/sync/items-push.test.ts`

```ts
import { beforeEach, expect, test } from 'bun:test';
import { setPlatform_ } from '@gas/core/platform';
import { listAuditRecords_ } from '@gas/modules/access/repo';
import { insertBrand_, listBrands_ } from '@gas/modules/brand/repo';
import { listFiles_ } from '@gas/modules/files/repo';
import { ensureDriveFolder_ } from '@gas/modules/files/service';
import { insertItem_, listItems_ } from '@gas/modules/item/repo';
import { brand, item } from '@gas-test/item-fixtures';
import type { MemoryPlatform } from '@gas-test/memory-platform';
import { createMemoryPlatform } from '@gas-test/memory-platform';
import { handleSync_ } from './handler';
import { getSyncRoutes_ } from './routes';
import { nextRev_ } from './state';

const TOKEN = 't0k3n'.repeat(8);
const PNG = 'iVBORw0KGgoAAAANSUhEUg==';
let platform: MemoryPlatform;
let folder: string;

beforeEach(() => {
  platform = createMemoryPlatform({
    properties: { ADMIN_EMAIL: 'admin@gmail.com', SESSION_SECRET: 's', SYNC_API_TOKEN: TOKEN },
    now: () => Date.parse('2026-10-15T00:00:00.000Z'),
  });
  setPlatform_(platform);
  folder = ensureDriveFolder_();
});

const drive = (name = 'a.png') => platform.driveCreateFile(folder, name, 'image/png', PNG);
function prime(resource: 'brands' | 'items', count: number): void {
  for (let i = 0; i < count; i++) nextRev_(resource);
}

function call(method: string, payload: unknown) {
  return handleSync_(JSON.stringify({ v: 1, method, token: TOKEN, payload }), getSyncRoutes_());
}
// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes
type Entry = Record<string, any>;
const push = (items: unknown[], extra: Record<string, unknown> = {}) => call('sync.items.push', { items, ...extra });
const results = (items: unknown[], extra: Record<string, unknown> = {}): Entry[] => {
  const out = push(items, extra);
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return (out.data as { results: Entry[] }).results;
};
const pull = (include: string[] = ['detail', 'stickers', 'accessories']): Entry[] => {
  const out = call('sync.items.pull', { include });
  if (!out.ok) throw new Error(JSON.stringify(out.error));
  return (out.data as { items: Entry[] }).items;
};
const audits = () => listAuditRecords_().map((r) => `${r.actor}|${r.action}`);

const BASE = { id: '12', merk: 'Ubiquiti', tipe: 'ES 24 250W', isCountryLock: false };

test('item baru: created, merk dibuat otomatis, dipetakan ke id MySQL, audit atas nama sync:desktop', () => {
  const [out] = results([{ ...BASE, isCountryLock: 'true' }]);
  expect(out).toMatchObject({ index: 0, status: 'created', rev: 1 });
  const stored = listItems_()[0];
  expect(stored).toMatchObject({ model: 'ES 24 250W', externalId: '12', isCountryLock: true, status: 'active', aliases: [] });
  expect(listBrands_().map((b) => b.name)).toEqual(['Ubiquiti']);
  expect(audits()).toEqual(['sync:desktop|brand.create', 'sync:desktop|item.create']);
  expect(pull()[0]).toMatchObject({ uid: out?.uid, id: '12', merk: 'Ubiquiti', tipe: 'ES 24 250W', isCountryLock: true });
});

test('idempoten: push yang sama dua kali → unchanged, rev dan audit tidak bertambah', () => {
  const payload = [{ ...BASE, detail: '## Judul', stickers: [{ name: 'Label', note: 'n', image: null }], accessories: [{ name: 'Kabel', qty: 1 }] }];
  const [first] = results(payload);
  const auditCount = listAuditRecords_().length;
  const [second] = results(payload);
  expect(second).toMatchObject({ status: 'unchanged', uid: first?.uid, rev: first?.rev });
  expect(listAuditRecords_()).toHaveLength(auditCount);
});

test('gambar: id Drive didaftarkan otomatis, Markdown drive: disimpan sebagai qcfile: dan kembali sebagai drive: saat pull', () => {
  const [a, b, c] = [drive('a.png'), drive('b.png'), drive('c.png')];
  const [out] = results([
    { ...BASE, images: [a], stickers: [{ name: 'L', note: '', image: b }], detail: `Teks ![x](drive:${c}) lagi` },
  ]);
  expect(out?.status).toBe('created');
  const rows = listFiles_();
  expect(rows).toHaveLength(3);
  expect(rows.every((r) => r.ownerType === 'item' && r.ownerId === out?.uid && r.createdBy === 'sync:desktop')).toBe(true);
  const stored = listItems_()[0];
  const fileOfC = rows.find((r) => r.driveId === c)?.id;
  expect(stored?.detail).toBe(`Teks ![x](qcfile:${fileOfC}) lagi`);
  expect(pull()[0]).toMatchObject({ images: [a], stickers: [{ name: 'L', note: '', image: b }], detail: `Teks ![x](drive:${c}) lagi` });
});

test('id Drive di luar folder atau tak ada → invalid per field; tidak ada item dibuat', () => {
  const other = platform.driveCreateFolder('Lain');
  const outside = platform.driveCreateFile(other, 'x.png', 'image/png', PNG);
  const [byImage, bySticker, byMd] = results([
    { ...BASE, images: [outside] },
    { ...BASE, id: '13', tipe: 'B', stickers: [{ name: 'L', image: 'tidak-ada' }] },
    { ...BASE, id: '14', tipe: 'C', detail: `![x](drive:${outside})` },
  ]);
  expect(byImage).toMatchObject({ status: 'invalid', fields: { images: expect.stringContaining(outside) } });
  expect(bySticker?.fields).toHaveProperty('stickers');
  expect(byMd?.fields).toHaveProperty('detail');
  expect(listItems_()).toHaveLength(0);
  expect(listFiles_()).toHaveLength(0);
});

test('Markdown pada push: hanya drive:<id>; https, data, dan qcfile ditolak', () => {
  const ok = drive();
  const bad = ['![x](https://x.test/a.png)', '![x](data:image/png;base64,AAAA)', '![x](qcfile:abc)', '![x]()', 'teks qcfile:abc'];
  const out = results([
    { ...BASE, id: '1', tipe: 'ok', detail: `![x](drive:${ok}) dan [tautan](https://x.test)` },
    ...bad.map((detail, i) => ({ ...BASE, id: `${10 + i}`, tipe: `bad${i}`, detail })),
  ]);
  expect(out[0]?.status).toBe('created');
  for (const entry of out.slice(1)) expect(entry).toMatchObject({ status: 'invalid', fields: { detail: expect.any(String) } });
  expect(listItems_()).toHaveLength(1);
});

test('semantik field: tidak dikirim = tidak diubah; [] dan "" menggantikan', () => {
  const img = drive();
  const first = results([{ ...BASE, images: [img], detail: 'asli', stickers: [{ name: 'L', note: '', image: null }], accessories: [{ name: 'K', qty: 1 }] }])[0];
  const uid = first?.uid as string;
  const [keep] = results([{ uid, tipe: 'ES 24 250W', baseRev: first?.rev }]);
  expect(keep?.status).toBe('unchanged');
  const [clear] = results([{ uid, images: [], detail: '', baseRev: first?.rev }]);
  expect(clear?.status).toBe('updated');
  const after = listItems_().find((i) => i.id === uid);
  expect(after).toMatchObject({ attachments: [], detail: '' });
  expect(after?.stickers).toHaveLength(1);
  expect(after?.accessories).toHaveLength(1);
});

test('alias item tidak berubah oleh push', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquiti', model: 'ES 24', aliases: ['ES24'], syncRev: 1 }));
  prime('items', 1);
  const [out] = results([{ uid: 'i1', detail: 'baru', baseRev: 1 }]);
  expect(out?.status).toBe('updated');
  expect(listItems_()[0]?.aliases).toEqual(['ES24']);
});

test('item baru wajib merk, tipe, dan isCountryLock; "true"/"false" diterima; id MySQL angka diterima', () => {
  const [missing, textBool, numeric, badBool] = results([
    { id: '1', detail: 'x' },
    { ...BASE, id: '2', tipe: 'A', isCountryLock: 'false' },
    { merk: 'Ubiquiti', tipe: 'B', isCountryLock: true, id: 3 },
    { ...BASE, id: '4', tipe: 'C', isCountryLock: 'mungkin' },
  ]);
  expect(missing).toMatchObject({ status: 'invalid', fields: { merk: expect.any(String), tipe: expect.any(String), isCountryLock: expect.any(String) } });
  expect(textBool?.status).toBe('created');
  expect(numeric?.status).toBe('created');
  expect(listItems_().find((i) => i.model === 'B')?.externalId).toBe('3');
  expect(badBool).toMatchObject({ status: 'invalid', fields: { isCountryLock: 'Harus true atau false' } });
});

test('konflik dua arah: baseRev basi + beda → conflict (current lengkap, audit); baseRev terkini/overwrite/nilai sama berhasil', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquiti', model: 'ES 24', syncRev: 5, detail: 'server', accessories: [{ name: 'K', qty: 1 }] }));
  prime('items', 5);
  const [stale] = results([{ uid: 'i1', detail: 'desktop', baseRev: 3 }]);
  expect(stale).toMatchObject({
    status: 'conflict',
    uid: 'i1',
    rev: 5,
    current: { uid: 'i1', merk: 'Ubiquiti', tipe: 'ES 24', detail: 'server', stickers: [], accessories: [{ name: 'K', qty: 1 }], active: true, rev: 5 },
  });
  expect(listItems_()[0]?.detail).toBe('server');
  expect(audits().at(-1)).toBe('sync:desktop|item.sync.conflict');
  expect(results([{ uid: 'i1', detail: 'desktop' }])[0]?.status).toBe('conflict'); // tanpa baseRev
  expect(results([{ uid: 'i1', detail: 'server', baseRev: 3 }])[0]?.status).toBe('unchanged'); // sama persis
  expect(results([{ uid: 'i1', detail: 'desktop', baseRev: 3 }], { overwrite: true })[0]?.status).toBe('updated');
  const rev = listItems_()[0]?.syncRev;
  expect(results([{ uid: 'i1', detail: 'lagi', baseRev: rev }])[0]?.status).toBe('updated');
});

test('pencocokan: uid, id MySQL, lalu merk+tipe ternormalisasi; pemetaan saja → updated tanpa kenaikan rev', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquiti', model: 'ES-24 250W', syncRev: 4 }));
  const [mapped] = results([{ id: '7', merk: 'UBIQUITI', tipe: 'ES-24 250W', isCountryLock: false }]);
  expect(mapped).toMatchObject({ status: 'updated', uid: 'i1', rev: 4 });
  expect(listItems_()[0]).toMatchObject({ externalId: '7', syncRev: 4 });
  expect(results([{ id: '7', merk: 'Ubiquiti', tipe: 'ES-24 250W' }])[0]).toMatchObject({ status: 'unchanged', uid: 'i1' });
  expect(results([{ uid: 'i1', id: '8' }])[0]).toMatchObject({ status: 'conflict', fields: { id: expect.any(String) } });
  insertItem_(item({ id: 'i2', brand: 'Ubiquiti', model: 'Lain', externalId: '9', syncRev: 6 }));
  expect(results([{ uid: 'i1', id: '9' }])[0]?.status).toBe('conflict');
  expect(results([{ uid: 'tidak-ada' }])[0]).toMatchObject({ status: 'invalid', fields: { uid: expect.any(String) } });
});

test('nonaktifkan lewat active:false; rev naik; audit item.deactivate', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquiti', model: 'ES 24', syncRev: 3 }));
  prime('items', 3);
  const [out] = results([{ uid: 'i1', active: false, baseRev: 3 }]);
  expect(out?.status).toBe('updated');
  expect(out?.rev).toBe(4);
  expect(pull([])[0]).toMatchObject({ active: false, rev: 4 });
  expect(audits().at(-1)).toBe('sync:desktop|item.deactivate');
});

test('isolasi: entri tidak sah, bentrok nama, dan sehat bercampur; urutan hasil = urutan permintaan', () => {
  insertBrand_(brand('Ubiquiti', { syncRev: 1 }));
  insertItem_(item({ id: 'i1', brand: 'Ubiquiti', model: 'ES 24', aliases: ['Ubiquiti AF 5'], syncRev: 1 }));
  const out = results([
    { ...BASE, id: '1', tipe: 'Sehat 1' },
    'bukan objek',
    { ...BASE, id: '2', tipe: 'AF 5' }, // kunci merk+tipe sama dengan nama lain item lain
    { ...BASE, id: '3', merk: '!!!' },
    { ...BASE, id: '4', tipe: 'Sehat 2' },
  ]);
  expect(out.map((r) => r.status)).toEqual(['created', 'invalid', 'invalid', 'invalid', 'created']);
  expect(out.map((r) => r.index)).toEqual([0, 1, 2, 3, 4]);
  expect(out[2]?.fields).toHaveProperty('tipe');
  expect(listItems_().map((i) => i.model).sort()).toEqual(['ES 24', 'Sehat 1', 'Sehat 2']);
});

test('batas jumlah entri dan bentuk payload', () => {
  const many = Array.from({ length: 201 }, (_, i) => ({ ...BASE, id: String(i), tipe: `T${i}` }));
  expect(push(many)).toMatchObject({ ok: false, error: { code: 'VALIDATION', fields: { items: 'Maksimal 200 item' } } });
  const withDetail = Array.from({ length: 101 }, (_, i) => ({ ...BASE, id: String(i), tipe: `T${i}`, detail: 'x' }));
  expect(push(withDetail)).toMatchObject({ ok: false, error: { code: 'VALIDATION', fields: { items: 'Maksimal 100 item' } } });
  expect(push([])).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(call('sync.items.push', { items: 'x' })).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
  expect(call('sync.items.push', null)).toMatchObject({ ok: false, error: { code: 'VALIDATION' } });
});

test('batas isi: detail > 20.000, stiker/kelengkapan tak sah, gambar > 10', () => {
  const [longDetail, badSticker, badQty, tooManyImages] = results([
    { ...BASE, id: '1', tipe: 'A', detail: 'x'.repeat(20_001) },
    { ...BASE, id: '2', tipe: 'B', stickers: [{ name: '' }] },
    { ...BASE, id: '3', tipe: 'C', accessories: [{ name: 'K', qty: 1.5 }] },
    { ...BASE, id: '4', tipe: 'D', images: Array.from({ length: 11 }, (_, i) => `d${i}`) },
  ]);
  expect(longDetail?.fields).toHaveProperty('detail');
  expect(badSticker?.fields).toHaveProperty('stickers');
  expect(badQty?.fields).toHaveProperty('accessories');
  expect(tooManyImages?.fields).toHaveProperty('images');
  expect(listItems_()).toHaveLength(0);
});
```

(Bila Biome mengeluh tentang `any` pada `type Entry`, letakkan `// biome-ignore lint/suspicious/noExplicitAny: hasil JSON tes` tepat di atasnya.)

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `bun run --cwd gas test sync/items-push`
Expected: FAIL — `sync.items.push` belum terdaftar.

- [ ] **Step 3: Refaktor penulisan item** — `gas/src/modules/item/service.ts`

Ubah impor `UserContext` menjadi `import type { ActorRef } from '@gas/core/actor';` (hapus impor `UserContext`), ubah `ItemView`/`toItemView_`/`itemSnapshot_`/`itemLabel_`/`itemSyncSignature_` menjadi `export`, dan **ganti seluruh fungsi `saveItem_`** dengan:

```ts
export interface WriteItemOptions {
  existing?: ItemRecord | undefined;
  actor: ActorRef;
  /** Hanya sinkronisasi: id MySQL yang dipetakan ke item ini. */
  externalId?: string | undefined;
  /** Hanya sinkronisasi: status yang diminta (default: tetap; item baru aktif). */
  status?: ItemStatus | undefined;
}

/**
 * Menulis item (baru atau ubah): keunikan, penautan berkas atomik, merk dibuat bila belum ada, kenaikan sync_rev,
 * dan audit. Dipakai form web (`saveItem_`) dan sinkronisasi. PEMANGGIL WAJIB memegang lock.
 */
export function writeItem_(input: SaveItemInput, options: WriteItemOptions): NewItemRecord {
  const { existing, actor } = options;
  const items = listItems_();
  const key = itemKey(input.brand, input.model);
  // Merk dinonaktifkan tidak boleh dipakai item baru (atau item yang pindah merk).
  const brandKey = normalizeKey(input.brand);
  const knownBrand = listBrands_().find((brand) => brand.key === brandKey);
  if (knownBrand && knownBrand.status === 'inactive' && existing?.brandId !== knownBrand.id) {
    const message = 'Merk dinonaktifkan; aktifkan dulu di halaman Merk';
    throw appError_('VALIDATION', message, { brand: message });
  }
  assertItemNamesFree_(
    input,
    key,
    items.filter((item) => item.id !== existing?.id),
    brandNameMap_(),
  );
  const id = existing?.id ?? platform_().uuid();
  // Atomik: bila ada rujukan berkas yang tak sah, tidak ada pemilik yang berubah dan item tidak disimpan.
  attachFiles_(referencedFileIds_(input), 'item', id);
  // Merk baru dibuat langsung dari isian (tanpa form tambahan); setelah semua validasi lolos.
  const brand: NewBrandRecord = resolveBrandByName_(input.brand, actor);
  const now = nowIso_();
  const status = options.status ?? existing?.status ?? 'active';
  const fields = {
    brandId: brand.id,
    model: input.model,
    key,
    isCountryLock: input.isCountryLock,
    aliases: [...input.aliases],
    stickers: input.stickers.map((sticker) => ({ ...sticker })),
    accessories: input.accessories.map((accessory) => ({ ...accessory })),
    attachments: [...input.attachments],
    detail: input.detail,
    updatedAt: now,
    updatedBy: actor.email,
  };

  if (existing) {
    const merged: ItemRecord = {
      ...existing,
      ...fields,
      status,
      externalId: options.externalId ?? existing.externalId,
    };
    const changed = itemSyncSignature_(existing) !== itemSyncSignature_(merged);
    const updated: ItemRecord = { ...merged, syncRev: changed ? nextRev_('items') : existing.syncRev };
    updateItem_(updated);
    const names = brandNameMap_();
    const after = toItemView_(updated, names);
    const onlyStatus =
      existing.status !== status &&
      itemSyncSignature_({ ...existing, status }) === itemSyncSignature_(merged);
    appendAudit_({
      ts: now,
      actor: actor.email,
      action: onlyStatus ? (status === 'active' ? 'item.activate' : 'item.deactivate') : 'item.update',
      target: itemLabel_(after),
      before: itemSnapshot_(toItemView_(existing, names)),
      after: itemSnapshot_(after),
    });
    return updated;
  }

  const created: NewItemRecord = {
    id,
    externalId: options.externalId ?? '',
    status,
    syncRev: nextRev_('items'),
    createdAt: now,
    ...fields,
  };
  insertItem_(created);
  const createdView = toItemView_(created, brandNameMap_());
  appendAudit_({
    ts: now,
    actor: actor.email,
    action: 'item.create',
    target: itemLabel_(createdView),
    before: null,
    after: itemSnapshot_(createdView),
  });
  return created;
}

export function saveItem_(input: SaveItemInput, actor: ActorRef): ItemDto {
  return platform_().withLock(() => {
    const existing = input.id ? listItems_().find((item) => item.id === input.id) : undefined;
    if (input.id && !existing) throw appError_('NOT_FOUND', 'Item tidak ditemukan');
    const record = writeItem_(input, { existing, actor });
    return toItemDto_(toItemView_(record, brandNameMap_()));
  });
}
```

dan ubah tipe parameter `actor` pada `setItemStatus_` menjadi `ActorRef`. Jalankan `bun run --cwd gas test item` — **seluruh tes item/merk lama harus tetap lulus tanpa diubah** (refaktor tanpa perubahan perilaku; satu-satunya tambahan: aksi audit `item.activate/deactivate` hanya muncul bila hanya status yang berubah, yang di jalur web tidak pernah terjadi lewat `saveItem_`).

- [ ] **Step 4: Implementasi push** — tambahkan ke `gas/src/modules/sync/items.ts` (impor tambahan di atas berkas; gabungkan dengan impor Task 7)

```ts
import { platform_ } from '@gas/core/platform';
import { appendAudit_ } from '@gas/modules/access/repo';
import { nowIso_ } from '@gas/modules/access/service';
import { updateItem_ } from '@gas/modules/item/repo';
import {
  brandNameMap_,
  itemLabel_,
  itemSnapshot_,
  itemSyncSignature_,
  toItemView_,
  writeItem_,
} from '@gas/modules/item/service';
import { MARKDOWN_MAX_LENGTH } from '@shared/files';
import type { ItemStatus, SaveItemInput } from '@shared/rpc';
import {
  extractRefs,
  extractImageTargets,
  isRefIdChar,
  ITEM_LIMITS,
  normalizeKey,
  normalizeNewlines,
} from '@shared/items';
import type { SyncEntryResult, SyncWireSticker } from '@shared/sync';
import { SYNC_ACTOR } from '@shared/sync';
import { isStaleWrite_, syncFailureResult_ } from './conflict';
import type { DriveProbe } from './files';
import { probeDriveIds_, registerDriveFiles_ } from './files';
import type { SyncPushEnvelope, WireCheck } from './wire';
import { asSyncObject_, readSyncBaseRev_, readSyncBool_, readSyncId_ } from './wire';

export interface SyncItemInput {
  uid?: string;
  id?: string;
  merk?: string;
  tipe?: string;
  isCountryLock?: boolean;
  images?: string[];
  detail?: string;
  stickers?: SyncWireSticker[];
  accessories?: Array<{ name: string; qty: number }>;
  active?: boolean;
  baseRev?: number;
}

const SYNC_ITEM_ACTOR = { email: SYNC_ACTOR };
/** Nama field internal → nama field pada kabel, agar pesan galat sesuai kontrak. */
const WIRE_FIELD_NAMES: Record<string, string> = { brand: 'merk', model: 'tipe', attachments: 'images' };

function checkWireText_(
  source: Record<string, unknown>,
  key: 'merk' | 'tipe',
  max: number,
  fields: Record<string, string>,
): string | undefined {
  if (source[key] === undefined) return undefined;
  const text = typeof source[key] === 'string' ? (source[key] as string).trim() : '';
  if (text === '') fields[key] = 'Wajib diisi';
  else if (text.length > max) fields[key] = `Maksimal ${max} karakter`;
  else if (normalizeKey(text) === '') fields[key] = 'Harus memuat huruf atau angka';
  else return text;
  return undefined;
}

function checkWireDetail_(value: unknown, fields: Record<string, string>): string | undefined {
  if (typeof value !== 'string') {
    fields.detail = 'Harus berupa teks';
    return undefined;
  }
  const detail = normalizeNewlines(value);
  if (detail.length > MARKDOWN_MAX_LENGTH) {
    fields.detail = `Maksimal ${MARKDOWN_MAX_LENGTH} karakter`;
    return undefined;
  }
  if (detail.includes('qcfile:')) {
    fields.detail = 'Rujukan qcfile: tidak diterima; pakai drive:<id>';
    return undefined;
  }
  for (const target of extractImageTargets(detail)) {
    const id = target.startsWith('drive:') ? target.slice('drive:'.length) : '';
    if (id === '' || !isRefIdChar(id.charAt(0))) {
      fields.detail = 'Gambar di Markdown hanya boleh ![alt](drive:<id>)';
      return undefined;
    }
  }
  return detail;
}

function checkWireImages_(value: unknown, fields: Record<string, string>): string[] | undefined {
  if (!Array.isArray(value) || value.length > ITEM_LIMITS.attachments) {
    fields.images = Array.isArray(value) ? `Maksimal ${ITEM_LIMITS.attachments} gambar` : 'Harus berupa daftar id Drive';
    return undefined;
  }
  const ids: string[] = [];
  for (const entry of value) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (id === '' || id.length > 100) {
      fields.images = 'Harus berupa daftar id Drive';
      return undefined;
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function checkWireStickers_(value: unknown, fields: Record<string, string>): SyncWireSticker[] | undefined {
  if (!Array.isArray(value) || value.length > ITEM_LIMITS.stickers) {
    fields.stickers = Array.isArray(value) ? `Maksimal ${ITEM_LIMITS.stickers} stiker` : 'Harus berupa daftar stiker';
    return undefined;
  }
  const out: SyncWireSticker[] = [];
  for (let i = 0; i < value.length; i++) {
    const label = `Stiker ${i + 1}`;
    const entry = asSyncObject_(value[i]);
    const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!entry || name === '' || name.length > ITEM_LIMITS.stickerName) {
      fields.stickers = `${label}: nama wajib 1–${ITEM_LIMITS.stickerName} karakter`;
      return undefined;
    }
    const note = entry.note === undefined || entry.note === null ? '' : entry.note;
    if (typeof note !== 'string' || note.trim().length > ITEM_LIMITS.stickerNote) {
      fields.stickers = `${label}: catatan maksimal ${ITEM_LIMITS.stickerNote} karakter`;
      return undefined;
    }
    const image = entry.image === undefined || entry.image === null || entry.image === '' ? null : entry.image;
    if (image !== null && (typeof image !== 'string' || image.trim().length > 100)) {
      fields.stickers = `${label}: gambar harus id Drive atau null`;
      return undefined;
    }
    out.push({ name, note: note.trim(), image: image === null ? null : (image as string).trim() });
  }
  return out;
}

function checkWireAccessories_(value: unknown, fields: Record<string, string>): Array<{ name: string; qty: number }> | undefined {
  if (!Array.isArray(value) || value.length > ITEM_LIMITS.accessories) {
    fields.accessories = Array.isArray(value) ? `Maksimal ${ITEM_LIMITS.accessories} kelengkapan` : 'Harus berupa daftar kelengkapan';
    return undefined;
  }
  const out: Array<{ name: string; qty: number }> = [];
  for (let i = 0; i < value.length; i++) {
    const label = `Kelengkapan ${i + 1}`;
    const entry = asSyncObject_(value[i]);
    const name = entry && typeof entry.name === 'string' ? entry.name.trim() : '';
    if (!entry || name === '' || name.length > ITEM_LIMITS.accessoryName) {
      fields.accessories = `${label}: nama wajib 1–${ITEM_LIMITS.accessoryName} karakter`;
      return undefined;
    }
    const qty = entry.qty;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > ITEM_LIMITS.accessoryQty) {
      fields.accessories = `${label}: jumlah harus bilangan bulat 1–${ITEM_LIMITS.accessoryQty}`;
      return undefined;
    }
    out.push({ name, qty });
  }
  return out;
}

export function checkSyncItem_(raw: unknown): WireCheck<SyncItemInput> {
  const source = asSyncObject_(raw);
  if (!source) return { ok: false, fields: { _: 'Entri harus berupa objek' } };
  const fields: Record<string, string> = {};
  const value: SyncItemInput = {};
  const uid = readSyncId_(source, 'uid', fields);
  if (uid !== undefined) value.uid = uid;
  const id = readSyncId_(source, 'id', fields);
  if (id !== undefined) value.id = id;
  const merk = checkWireText_(source, 'merk', ITEM_LIMITS.brand, fields);
  if (merk !== undefined) value.merk = merk;
  const tipe = checkWireText_(source, 'tipe', ITEM_LIMITS.model, fields);
  if (tipe !== undefined) value.tipe = tipe;
  const lock = readSyncBool_(source, 'isCountryLock', fields);
  if (lock !== undefined) value.isCountryLock = lock;
  if (source.images !== undefined) {
    const images = checkWireImages_(source.images, fields);
    if (images !== undefined) value.images = images;
  }
  if (source.detail !== undefined) {
    const detail = checkWireDetail_(source.detail, fields);
    if (detail !== undefined) value.detail = detail;
  }
  if (source.stickers !== undefined) {
    const stickers = checkWireStickers_(source.stickers, fields);
    if (stickers !== undefined) value.stickers = stickers;
  }
  if (source.accessories !== undefined) {
    const accessories = checkWireAccessories_(source.accessories, fields);
    if (accessories !== undefined) value.accessories = accessories;
  }
  const active = readSyncBool_(source, 'active', fields);
  if (active !== undefined) value.active = active;
  const baseRev = readSyncBaseRev_(source, fields);
  if (baseRev !== undefined) value.baseRev = baseRev;
  // Sel Sheets maks. 50.000 karakter: tolak JSON besar sebelum menulis (sama dengan validator form web).
  for (const key of ['stickers', 'accessories', 'images'] as const) {
    const list = value[key];
    if (list !== undefined && JSON.stringify(list).length > ITEM_LIMITS.jsonCell) {
      fields[key] = 'Data terlalu besar';
    }
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

/** Semua id Drive yang dirujuk entri: galeri, contoh stiker, dan gambar di Markdown. */
export function driveIdsOf_(entry: SyncItemInput): string[] {
  const ids = [...(entry.images ?? [])];
  for (const sticker of entry.stickers ?? []) {
    if (sticker.image !== null) ids.push(sticker.image);
  }
  ids.push(...extractRefs(entry.detail ?? '', 'drive:'));
  return [...new Set(ids)];
}

type Match =
  | { kind: 'none' }
  | { kind: 'found'; existing: ItemRecord }
  | { kind: 'invalid'; fields: Record<string, string> }
  | { kind: 'conflict'; existing: ItemRecord; fields: Record<string, string> };

/** Pencocokan: uid → id MySQL → merk+tipe ternormalisasi (kontrak 3.3). */
function matchSyncItem_(entry: SyncItemInput, items: readonly ItemRecord[]): Match {
  const byUid = entry.uid === undefined ? undefined : items.find((item) => item.id === entry.uid);
  if (entry.uid !== undefined && !byUid) return { kind: 'invalid', fields: { uid: 'Item tidak ditemukan' } };
  const byId = entry.id === undefined ? undefined : items.find((item) => item.externalId === entry.id);
  if (byUid && byId && byUid.id !== byId.id) {
    return { kind: 'conflict', existing: byUid, fields: { id: 'uid dan id mengarah ke item berbeda' } };
  }
  let existing = byUid ?? byId;
  if (!existing && entry.merk !== undefined && entry.tipe !== undefined) {
    const key = `${normalizeKey(entry.merk)} ${normalizeKey(entry.tipe)}`.trim();
    existing = items.find((item) => item.key === key);
  }
  if (!existing) return { kind: 'none' };
  if (entry.id !== undefined && existing.externalId !== '' && existing.externalId !== entry.id) {
    return { kind: 'conflict', existing, fields: { id: 'Item sudah terpetakan ke id MySQL lain' } };
  }
  return { kind: 'found', existing };
}

function itemConflict_(
  index: number,
  existing: ItemRecord,
  proposed: Partial<ReturnType<typeof toItemView_>>,
  fields?: Record<string, string>,
): SyncEntryResult<SyncWireItem> {
  const names = brandNameMap_();
  const before = toItemView_(existing, names);
  appendAudit_({
    ts: nowIso_(),
    actor: SYNC_ACTOR,
    action: 'item.sync.conflict',
    target: itemLabel_(before),
    before: itemSnapshot_(before),
    after: itemSnapshot_({ ...before, ...proposed }),
  });
  return {
    index,
    status: 'conflict',
    uid: existing.id,
    rev: existing.syncRev,
    current: toWireItem_(existing, names, driveIdsByFile_(), SYNC_ITEM_INCLUDABLE),
    ...(fields ? { fields } : {}),
  };
}

/** Di dalam lock. */
function upsertSyncItem_(
  entry: SyncItemInput,
  index: number,
  overwrite: boolean,
  probes: ReadonlyMap<string, DriveProbe | null>,
): SyncEntryResult<SyncWireItem> {
  const items = listItems_();
  const names = brandNameMap_();
  const matched = matchSyncItem_(entry, items);
  if (matched.kind === 'invalid') return { index, status: 'invalid', fields: matched.fields };
  if (matched.kind === 'conflict') return itemConflict_(index, matched.existing, {}, matched.fields);
  const existing = matched.kind === 'found' ? matched.existing : undefined;

  if (!existing) {
    const required: Record<string, string> = {};
    if (entry.merk === undefined) required.merk = 'Wajib diisi untuk item baru';
    if (entry.tipe === undefined) required.tipe = 'Wajib diisi untuk item baru';
    if (entry.isCountryLock === undefined) required.isCountryLock = 'Wajib diisi untuk item baru';
    if (Object.keys(required).length > 0) return { index, status: 'invalid', fields: required };
  }

  const { map, missing } = registerDriveFiles_(driveIdsOf_(entry), probes);
  if (missing.length > 0) {
    const bad = new Set(missing);
    const fields: Record<string, string> = {};
    const first = (ids: readonly string[]) => ids.find((id) => bad.has(id));
    const badImage = first(entry.images ?? []);
    if (badImage !== undefined) fields.images = `Berkas ${badImage} tidak ada di folder aplikasi`;
    const badSticker = first((entry.stickers ?? []).flatMap((sticker) => (sticker.image === null ? [] : [sticker.image])));
    if (badSticker !== undefined) fields.stickers = `Berkas ${badSticker} tidak ada di folder aplikasi`;
    const badMarkdown = first(extractRefs(entry.detail ?? '', 'drive:'));
    if (badMarkdown !== undefined) fields.detail = `Berkas ${badMarkdown} tidak ada di folder aplikasi`;
    return { index, status: 'invalid', fields };
  }

  const status: ItemStatus = entry.active === undefined ? (existing?.status ?? 'active') : entry.active ? 'active' : 'inactive';
  const merged: SaveItemInput = {
    ...(existing ? { id: existing.id } : {}),
    brand: entry.merk ?? (existing ? (names.get(existing.brandId) ?? '') : ''),
    model: entry.tipe ?? existing?.model ?? '',
    isCountryLock: entry.isCountryLock ?? existing?.isCountryLock ?? false,
    aliases: existing ? [...existing.aliases] : [],
    stickers: entry.stickers
      ? entry.stickers.map((sticker) => ({
          name: sticker.name,
          note: sticker.note,
          fileId: sticker.image === null ? null : (map.get(sticker.image) ?? null),
        }))
      : (existing?.stickers ?? []),
    accessories: entry.accessories ?? existing?.accessories ?? [],
    attachments: entry.images
      ? entry.images.flatMap((driveId) => {
          const fileId = map.get(driveId);
          return fileId === undefined ? [] : [fileId];
        })
      : (existing?.attachments ?? []),
    detail:
      entry.detail !== undefined
        ? mapMarkdownRefs(entry.detail, DRIVE_REF_SCHEME, FILE_SCHEME, (id) => map.get(id) ?? null)
        : (existing?.detail ?? ''),
  };

  if (existing) {
    // Merk dibandingkan menurut kunci ternormalisasi: beda huruf besar/kecil saja bukan perubahan.
    const currentSignature = itemSyncSignature_({
      ...existing,
      brandId: normalizeKey(names.get(existing.brandId) ?? ''),
    });
    const wantedSignature = itemSyncSignature_({
      brandId: normalizeKey(merged.brand),
      model: merged.model,
      isCountryLock: merged.isCountryLock,
      attachments: merged.attachments,
      detail: merged.detail,
      stickers: merged.stickers,
      accessories: merged.accessories,
      status,
    });
    const mapChanged = entry.id !== undefined && existing.externalId === '';
    if (currentSignature === wantedSignature) {
      if (mapChanged) {
        // Pemetaan id MySQL adalah pembukuan, bukan perubahan data: tanpa kenaikan rev dan tanpa audit.
        updateItem_({ ...existing, externalId: entry.id as string });
        return { index, status: 'updated', uid: existing.id, rev: existing.syncRev };
      }
      return { index, status: 'unchanged', uid: existing.id, rev: existing.syncRev };
    }
    if (isStaleWrite_(entry.baseRev, existing.syncRev, overwrite)) {
      return itemConflict_(index, existing, {
        brand: merged.brand,
        model: merged.model,
        isCountryLock: merged.isCountryLock,
        attachments: merged.attachments,
        detail: merged.detail,
        stickers: merged.stickers,
        accessories: merged.accessories,
        status,
      });
    }
  }

  const record = writeItem_(merged, { existing, actor: SYNC_ITEM_ACTOR, externalId: entry.id, status });
  return { index, status: existing ? 'updated' : 'created', uid: record.id, rev: record.syncRev };
}

/** Pesan galat penulisan memakai nama field internal; ubah ke nama pada kabel. */
function toWireFields_<T>(result: SyncEntryResult<T>): SyncEntryResult<T> {
  if (!result.fields) return result;
  const fields: Record<string, string> = {};
  for (const [key, message] of Object.entries(result.fields)) fields[WIRE_FIELD_NAMES[key] ?? key] = message;
  return { ...result, fields };
}

export function pushItems_(envelope: SyncPushEnvelope): { results: Array<SyncEntryResult<SyncWireItem>> } {
  const checks = envelope.entries.map((raw) => checkSyncItem_(raw));
  // I/O Drive di luar lock: info untuk semua id yang belum tercatat, sekali untuk seluruh permintaan.
  const probes = probeDriveIds_(checks.flatMap((check) => (check.ok ? driveIdsOf_(check.value) : [])));
  const results = checks.map((check, index): SyncEntryResult<SyncWireItem> => {
    if (!check.ok) return { index, status: 'invalid', fields: check.fields };
    try {
      return platform_().withLock(() => upsertSyncItem_(check.value, index, envelope.overwrite, probes));
    } catch (error) {
      return toWireFields_(syncFailureResult_<SyncWireItem>(error, index));
    }
  });
  return { results };
}
```

(Gabungkan impor: `FILE_SCHEME` sudah ada dari Task 7; tambahkan `DRIVE_REF_SCHEME`/`mapMarkdownRefs` bila belum; `SyncWireItem` sudah diimpor.)

`gas/src/modules/sync/routes.ts` — impor `pushItems_` dan tambahkan:

```ts
    'sync.items.push': syncRoute_({
      validate: (raw) => validateSyncPush_(raw, 'items', true),
      handler: (envelope) => pushItems_(envelope),
    }),
```

- [ ] **Step 5: Jalankan semua tes, typecheck, dan build**

Run: `bun run --cwd shared test && bun run --cwd gas test && bun run --cwd gas typecheck && bun scripts/build-gas.ts`
Expected: lulus.

- [ ] **Step 6: Format dan commit**

```bash
bunx biome check --write --linter-enabled=false gas
git add gas
git commit -m "feat(sync): sync.items.push — upsert per entri, konflik dua arah, gambar Drive, Markdown drive:, dan writeItem_ bersama dengan form web" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Dokumentasi, E2E, dan verifikasi akhir

**Files:**
- Modify: `docs/api/desktop-sync.md`, `docs/prd/2026-10-09-qc-item-serah-terima.md`, `docs/e2e-checklist.md`, `docs/setup-google.md`, `CLAUDE.md`, `docs/adding-a-module.md`

**Interfaces:**
- Consumes: semua tugas sebelumnya.
- Produces: dokumentasi selaras dengan perilaku yang dibangun.

- [ ] **Step 1: `docs/api/desktop-sync.md`** — perbarui agar sama dengan kode:

1. Tabel awal: `Status` → `Dibangun (Fase B2); versi API 1`; `Dibangun di` → `Fase B2: kerangka, sumber daya brands dan items, sync.file.get`.
2. Bagian 1 (Token): tambahkan butir "**Konfigurasi:** isi Script Property `SYNC_API_TOKEN` (≥ 32 karakter acak) lalu jalankan `setup` — laporannya menyebut status token. Tanpa token yang sah semua permintaan ditolak." dan "**Semua kegagalan sebelum autentikasi lolos** (JSON rusak, body > 5 MB, token salah/hilang/dibatasi, token belum dikonfigurasi) menghasilkan galat yang sama: `UNAUTHENTICATED` 'Token tidak valid'. `VALIDATION` dan `NOT_FOUND` hanya muncul setelah token sah."
3. Tabel `error.code`: baris `UNAUTHENTICATED` → "token salah/hilang/dibatasi, atau permintaan tidak dapat dibaca (tidak dibedakan)"; `VALIDATION` → "setelah autentikasi: `v` tidak didukung atau payload salah bentuk".
4. `sync.ping`: `resources` → `["brands","items"]`.
5. Bagian 3.2: tambahkan "Item/merk yang sudah ada sebelum Fase B2 diberi revisi oleh `setup` (urut waktu dibuat); jalankan `setup` setelah deploy B2 sebelum Desktop menarik." dan "Merk pada `merk` selalu nama merk terkini; mengganti nama merk menaikkan `rev` semua item merk itu."
6. Bagian 3.3: tambahkan butir "Pemetaan id MySQL saja (nilai sama) → `updated` **tanpa** kenaikan `rev` dan tanpa audit. Nama merk dibandingkan menurut kunci ternormalisasi (huruf besar/kecil tidak dianggap beda). Pesan `fields` memakai nama field kabel (`merk`, `tipe`, `images`, …). Konflik dan pembuatan/perubahan dicatat di audit atas nama `sync:desktop` (aksi `item.sync.conflict`, `item.create`, `item.update`, `item.activate/deactivate`)." dan "`id` MySQL boleh dikirim sebagai angka; `isCountryLock` dan `active` boleh berupa teks `\"true\"`/`\"false\"`."
7. Bagian 3b: hapus kata "rencana"; tambahkan bahwa `sync.brands.pull` tidak menerima `include`.
8. Bagian 5: ganti jalur berkas dengan yang nyata: `gas/src/modules/sync/routes.ts` (`getSyncRoutes_`), `syncRoute_`, `validateSyncPull_`/`validateSyncPush_`, `paginateByRev_`, `isStaleWrite_`, `nextRev_('<sumberDaya>')` (pemanggil memegang lock), dan tambahkan sumber daya ke `SYNC_RESOURCES` di `shared/sync.ts`.

- [ ] **Step 2: PRD** — di bagian 9 "Definition of Done › Fase B2" centang `doPost` dan kerangka, `sync.items.pull/push`, `sync.file.get`, dan `setup` (FS13) **hanya setelah** Step 5 lulus; **jangan** mencentang "Migrasi awal dari MySQL dicoba end-to-end" dan "Tim Desktop menyetujui" (butuh Desktop). Tambahkan butir baru: `- [ ] sync.brands.pull/push (merk master dua arah)`, lalu centang bersama tiga butir di atas.

- [ ] **Step 3: `docs/e2e-checklist.md`** — tambahkan (lanjutan nomor terakhir, 42):

```markdown
| 43 | Isi `DRIVE_FOLDER_ID` dengan id folder yang tidak ada lalu jalankan `setup` | Laporan "Folder Drive TIDAK dapat diakses"; properti tidak berubah; tidak ada folder baru | FS13 |
| 44 | Isi `SYNC_API_TOKEN` 40 karakter lalu `setup` | Laporan "SYNC_API_TOKEN terisi (40 karakter)"; item/merk lama diberi revisi ("N baris diberi revisi sinkron") | FS2, FS11 |
| 45 | `curl -L --data '{"v":1,"method":"sync.ping","token":"<token>","payload":null}' <URL /exec>` | `{"ok":true,"data":{"apiVersion":1,...,"resources":["brands","items"]}}` | FS1 |
| 46 | Kirim 10 token salah berturut-turut, lalu satu dengan token benar | Semua `UNAUTHENTICATED`; setelah 10 kali, token benar pun ditolak ±10 menit; setelah itu pulih (kedaluwarsa cache) | FS2 |
| 47 | `sync.items.pull` dengan `include` penuh dari `sinceRev: 0` sampai `hasMore: false` | Semua item tepat sekali; `images` berisi id Drive; `detail` memakai `drive:` | FS4 |
| 48 | `sync.items.push` item baru dengan gambar dari folder aplikasi dan Markdown `drive:` | `created`; item muncul di Data Item dengan gambar tampil; audit `sync:desktop` | FS5, FS8, FS10 |
| 49 | Ulangi push yang sama; ubah detail di web lalu push dengan `baseRev` lama | `unchanged`; lalu `conflict` dengan `current`; Log Audit memuat `item.sync.conflict` | FS5, FS6 |
| 50 | `sync.file.get` untuk id di folder dan id di luar folder | Isi base64 dan `NOT_FOUND` | FS9 |
| 51 | Ganti nama merk di web lalu pull item | Semua item merk itu muncul lagi dengan nama baru | FS11 |
```

- [ ] **Step 4: `docs/setup-google.md`, `CLAUDE.md`, `docs/adding-a-module.md`**

`docs/setup-google.md`: tambahkan bagian "## 7c. Sinkronisasi QC Desktop (mulai Fase B2)": (1) buat token acak ≥ 32 karakter (mis. `openssl rand -hex 24`), isi sebagai Script Property `SYNC_API_TOKEN`, **jangan** menaruhnya di URL atau repo; (2) untuk migrasi dari folder gambar lama isi `DRIVE_FOLDER_ID` **sebelum** `setup`, pastikan akun pemilik script punya akses Editor ke folder itu, dan cocokkan id di laporan `setup`; (3) jalankan `setup` dan baca laporannya; (4) `doPost` memakai deployment yang sama dengan `doGet` (tidak perlu deployment baru; setelah mengubah kode tetap perbarui deployment); (5) memutar token = ganti properti + konfigurasi Desktop.

`CLAUDE.md` bagian Struktur, tambahkan: "- `gas/src/modules/sync/` — jalur sinkronisasi QC Desktop (`doPost`): token bersama + pembatas, tabel rute sinkron `getSyncRoutes_` (terpisah dari `getRoutes_`), `sync_state`/`nextRev_` (penghitung revisi; pemanggil memegang lock), sumber daya `brands` dan `items`. Kontrak: `docs/api/desktop-sync.md`. Perubahan field sinkron item/merk WAJIB menaikkan `sync_rev` (lihat `itemSyncSignature_`)."

`docs/adding-a-module.md`: tambahkan bagian pendek "Sumber daya sinkron" yang menunjuk ke bagian 5 `docs/api/desktop-sync.md` dan menegaskan: handler sinkron tidak menerima `UserContext`; penulisan memakai fungsi domain yang sama dengan RPC web (mis. `writeItem_`) agar keunikan, audit, dan `sync_rev` konsisten.

- [ ] **Step 5: Verifikasi akhir otomatis**

Run: `bun run check` lalu `bun run build`
Expected: `check` hijau (scripts, shared, gas, web); `build` lolos `verify-dist` (tanpa kode mock; `index.html` ≤ 1,5 MB — frontend tidak berubah selain label audit).

- [ ] **Step 6: Verifikasi manual di `/dev`** (butuh deployment; centang PRD sesudahnya)

Setelah PR digabung ke `dev` dan terdeploy: jalankan `setup`, isi `SYNC_API_TOKEN`, lalu E2E 43–51 (curl dengan `-L`; token **hanya** di body). Catat hasilnya di PR. Butir PRD "Migrasi awal dari MySQL" dan "Tim Desktop menyetujui" tetap terbuka sampai Desktop mencobanya.

- [ ] **Step 7: Commit**

```bash
bunx biome check --write --linter-enabled=false web docs
git add docs CLAUDE.md
git commit -m "docs: sinkronisasi QC Desktop (Fase B2) — kontrak, setup token, E2E 43-51, dan panduan modul" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Penutup (setelah Task 9)

- Ikuti `superpowers:executing-plans`: review akhir seluruh branch oleh reviewer terpisah (model paling mampu) dengan paket `review-package`, perbaiki temuan Critical/Important dalam satu putaran dengan TDD, catat Minor.
- Push branch dari `dev` (setelah PR Fase B digabung), buka PR ke `dev`, uji E2E 43–51 di `/dev`.
- Yang sengaja **tidak** dikerjakan di B2: sumber daya stok (Desktop master; kontrak konvensi sudah ada), penulisan-batch Sheets untuk ganti nama merk berisi ratusan item (lihat Minor M3 review merk), kedaluwarsa otomatis berkas yatim, dan rotasi token otomatis.
- Fase C (customer master, serah terima, pengerjaan QC, auto-suggest) ditulis rencananya setelah B2 digabung.
